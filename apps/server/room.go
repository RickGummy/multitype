package main

import (
	"sort"
	"strings"
	"sync"
	"time"
)

type Room struct {
	mu sync.Mutex

	rid    string
	hostPid string
	status string

	prompt     string
	startAtMs  int64
	seed       int64
	promptMode string

	clients map[string]*Client
	prompts []string
}

func NewRoom(rid string) *Room {
	return &Room{
		rid:     rid,
		status:  "LOBBY",
		clients: make(map[string]*Client),
		prompts: []string{
			"The quick brown fox jumps over the lazy dog.",
			"This is a really fun thing to code",
		},
		promptMode: "short",
	}
}

func (r *Room) AddClient(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()

	c.name = normalizeName(c.name)

	r.clients[c.pid] = c
	c.roomID = r.rid
	c.status = "LOBBY"

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
}

func normalizeName(name string) string {
	n := strings.TrimSpace(name)
	if n == "" {
		return "Guest"
	}
	return n
}

func displayName(s string) string {
	s = normalizeName(s)

	if s == "" {
		return "Guest"
	}
	return s
}

func (r *Room) RemoveClient(pid string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if c, ok := r.clients[pid]; ok {
		c.roomID = ""
	}
	delete(r.clients, pid)

	if r.hostPid == pid {
		r.hostPid = ""
		for otherPid := range r.clients {
			r.hostPid = otherPid
			break
		}
	}

	if len(r.clients) > 0 {
        r.resetToLobbyLocked()
    }

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
}

func (r *Room) SetName(pid, name string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if c, ok := r.clients[pid]; ok {
		c.name = normalizeName(name)
	}

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
}

func (r *Room) SetReady(pid string, ready bool) {
	r.mu.Lock()

	defer r.mu.Unlock()

	if c, ok := r.clients[pid]; ok {
		c.ready = ready
	}

	if r.status == "LOBBY" && len(r.clients) >= 2 && r.allReadyLocked() {
		r.beginCountdownLocked()
	}

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
}

func (r *Room) HostPid() string {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.hostPid
}

func (r *Room) SetHost(pid string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.hostPid = pid
}

func (r *Room) SetPromptMode(mode string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.status != "LOBBY" {
		return
	}

	r.promptMode = mode
	r.broadcastLocked(ServerMsg{
		Type: "room_state",
		Rid: r.rid,
		Data: r.snapshotLocked(),
	})
}

func (r *Room) UpdateProgress(pid string, cursor, mistakes int) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.status != "RUNNING" {
		return
	}

	c, ok := r.clients[pid]
	if !ok {
		return
	}

	if cursor < 0 {
		cursor = 0
	}

	if mistakes < 0 {
		mistakes = 0
	}

	c.cursor = cursor
	c.mistakes = mistakes

	elapsed := nowMs() - r.startAtMs
	if elapsed < 0 {
		elapsed = 0
	}

	c.wpm = round2(computeWPM(c.cursor, elapsed))
	c.acc = round2(100.0 * computeAcc(c.cursor, c.mistakes))

	r.broadcastLocked(ServerMsg{
		Type: "player_progress",
		Rid:  r.rid,
		Data: map[string]any{
			"pid":      c.pid,
			"cursor":   c.cursor,
			"mistakes": c.mistakes,
			"wpm":      c.wpm,
			"acc":      c.acc,
			"status":   c.status,
		},
	})
}

func (r *Room) Finish(pid string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.status != "RUNNING" {
		return
	}

	c, ok := r.clients[pid]

	if !ok {
		return
	}

	if c.status == "FINISHED" {
		return
	}

	c.status = "FINISHED"

	elapsed := nowMs() - r.startAtMs
	if elapsed < 0 {
		elapsed = 0
	}

	c.wpm = round2(computeWPM(c.cursor, elapsed))
	c.acc = round2(100.0 * computeAcc(c.cursor, c.mistakes))

	if r.allFinishedLocked() {
		r.status = "FINISHED"
		r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})

		return
	}

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
}

func (r *Room) beginCountdownLocked() {
	r.status = "COUNTDOWN"
	r.seed = time.Now().UnixNano()
	r.prompt = ""
	r.startAtMs = nowMs() + 3000

	for _, c := range r.clients {
		c.cursor = 0
		c.mistakes = 0
		c.wpm = 0
		c.acc = 100
		c.status = "LOBBY"
		c.ready = false
	}

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})

	startAt := r.startAtMs

	go func() {
		for {
			time.Sleep(25 * time.Millisecond)
			r.mu.Lock()

			if r.status != "COUNTDOWN" || r.startAtMs != startAt {
				r.mu.Unlock()
				return
			}

			if nowMs() >= r.startAtMs {
				r.status = "RUNNING"
				for _, c := range r.clients {
					c.status = "RUNNING"
				}

				r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
				r.mu.Unlock()
				return
			}

			r.mu.Unlock()
		}
	}()
}

func (r *Room) resetToLobbyLocked() {
	r.status = "LOBBY"
	r.prompt =""
	r.startAtMs = 0
	r.seed = 0

	for _, c := range r.clients {
		c.cursor = 0
		c.mistakes = 0
		c.wpm = 0
		c.acc = 100
		c.status = "LOBBY"
		c.ready = false
	}
}

func (r *Room) allReadyLocked() bool {
	for _, c := range r.clients {
		if !c.ready {
			return false
		}
	}
	return true
}

func (r *Room) allFinishedLocked() bool {
	for _, c := range r.clients {
		if c.status != "FINISHED" {
			return false
		}
	}
	return true
}

func (r *Room) snapshotLocked() RoomState {
	players := make([]PlayerState, 0, len(r.clients))

	for _, c := range r.clients {
		players = append(players, PlayerState{
			Pid:		c.pid,
			Name:		func() string {
				if c.name == "" {
					return "Guest"
				}
				return c.name
			}(),
			Ready:		c.ready,
			Cursor:		c.cursor,
			Mistakes:	c.mistakes,
			WPM:		c.wpm,
			Acc:		c.acc,
			Status:		c.status,
		})
	}

	sort.Slice(players, func(i, j int) bool {
		return players[i].Pid < players[j].Pid
	})

	return RoomState{
		Rid:		r.rid,
		Status:		r.status,
		Prompt:		r.prompt,
		StartAtMs:  r.startAtMs,
		PromptMode: r.promptMode,
		Seed:		r.seed,
		Players:    players,
	}
}

func (r *Room) broadcastLocked(msg ServerMsg) {
	for _, c := range r.clients {
		select {
		case c.send <- msg:
		default:

		}
	}
}

func (r *Room) IsEmpty() bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.clients) == 0
}

func (r *Room) RestartRound(pid string) {
    r.mu.Lock()
    defer r.mu.Unlock()

    if r.status != "FINISHED" && r.status != "LOBBY" {
        return
    }

    if c, ok := r.clients[pid]; ok {
        c.ready = true
    }

    if r.status == "FINISHED" {
        if len(r.clients) >= 2 && r.allReadyLocked() {
            r.resetToLobbyLocked()
            r.beginCountdownLocked()
        }
        r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
        return
    }

    if r.status == "LOBBY" && len(r.clients) >= 2 && r.allReadyLocked() {
        r.beginCountdownLocked()
    }

    r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
}
