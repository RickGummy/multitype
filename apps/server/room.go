package main

import (
	"context"
	"fmt"
	"log"
	"sort"
	"sync"
	"time"

	"multiplayer-server/db"
)

const maxPlayers = 5
const rejoinGrace = 30 * time.Second

type SuspendedSession struct {
	pid        string
	name       string
	userID     string
	cursor     int
	mistakes   int
	wpm        float64
	acc        float64
	status     string
	durationMs int64
	placement  int
	purgeTimer *time.Timer
}

type Room struct {
	mu sync.Mutex

	hub *Hub

	rid          string
	hostPid      string
	status       string
	guestCounter int

	prompt      string
	startAtMs   int64
	seed        int64
	promptMode  string
	finishOrder []string

	clients   map[string]*Client
	suspended map[string]*SuspendedSession // keyed by session token
	prompts   []string
}

func NewRoom(rid string, hub *Hub) *Room {
	return &Room{
		hub:       hub,
		rid:       rid,
		status:    "LOBBY",
		clients:   make(map[string]*Client),
		suspended: make(map[string]*SuspendedSession),
		prompts: []string{
			"The quick brown fox jumps over the lazy dog.",
			"This is a really fun thing to code",
		},
		promptMode: "short",
	}
}

func (r *Room) AddClient(c *Client) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.clients) >= maxPlayers {
		return false
	}
	if r.status != "LOBBY" {
		return false
	}

	clean := sanitizeName(c.name)
	if clean == "" {
		r.guestCounter++
		c.name = fmt.Sprintf("Guest %d", r.guestCounter)
	} else {
		c.name = clean
	}

	r.clients[c.pid] = c
	c.roomID = r.rid
	c.status = "LOBBY"

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
	return true
}

func normalizeName(name string) string {
	return sanitizeName(name)
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

	switch r.status {
	case "LOBBY":
		// nothing to do; players just see one fewer entry
	case "COUNTDOWN", "RUNNING":
		// race continues. If the leaver was the last one we were waiting on,
		// transition the room to FINISHED now.
		if len(r.clients) > 0 && r.status == "RUNNING" && r.allFinishedLocked() {
			r.status = "FINISHED"
			if db.Pool != nil {
				record := r.buildRaceRecordLocked()
				go func() {
					if err := db.SaveRace(context.Background(), record); err != nil {
						log.Printf("SaveRace error: %v", err)
					}
				}()
			}
		}
	case "FINISHED":
		// post-race; leaving doesn't change anything for the others
	}

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
}

func (r *Room) SetName(pid, name string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if c, ok := r.clients[pid]; ok {
		clean := sanitizeName(name)
		if clean != "" {
			c.name = clean
		}
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
	c.durationMs = elapsed

	r.finishOrder = append(r.finishOrder, pid)
	c.placement = len(r.finishOrder)

	if r.allFinishedLocked() {
		r.status = "FINISHED"
		r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})

		if db.Pool != nil {
			record := r.buildRaceRecordLocked()
			go func() {
				if err := db.SaveRace(context.Background(), record); err != nil {
					log.Printf("SaveRace error: %v", err)
				}
			}()
		}
		return
	}

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
}

func (r *Room) beginCountdownLocked() {
	r.status = "COUNTDOWN"
	r.seed = time.Now().UnixNano()
	r.prompt = ""
	r.startAtMs = nowMs() + 5000

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
	r.prompt = ""
	r.startAtMs = 0
	r.seed = 0
	r.finishOrder = r.finishOrder[:0]

	for _, c := range r.clients {
		c.cursor = 0
		c.mistakes = 0
		c.wpm = 0
		c.acc = 100
		c.status = "LOBBY"
		c.ready = false
		c.durationMs = 0
		c.placement = 0
	}
}

func (r *Room) buildRaceRecordLocked() db.RaceRecord {
	players := make([]db.PlayerResult, 0, len(r.clients))
	for _, c := range r.clients {
		players = append(players, db.PlayerResult{
			UserID:     c.userID,
			PlayerName: c.name,
			WPM:        c.wpm,
			Accuracy:   c.acc,
			Mistakes:   c.mistakes,
			DurationMs: c.durationMs,
			Placement:  c.placement,
		})
	}
	return db.RaceRecord{
		RoomID:     r.rid,
		PromptText: r.prompt,
		PromptMode: r.promptMode,
		Seed:       r.seed,
		StartedAt:  time.UnixMilli(r.startAtMs),
		FinishedAt: time.Now(),
		Players:    players,
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
			Pid:  c.pid,
			Name: c.name,
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
		Rid:             r.rid,
		Status:          r.status,
		Prompt:          r.prompt,
		StartAtMs:       r.startAtMs,
		PromptMode:      r.promptMode,
		Seed:            r.seed,
		WordlistVersion: WordlistVersion,
		Players:         players,
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

	return len(r.clients) == 0 && len(r.suspended) == 0
}

// SuspendClient holds a disconnected client's state for rejoinGrace so they can rejoin.
// Returns true if the client was actually suspended (and should NOT be hard-removed).
// Returns false if the disconnect should be treated as a normal full removal.
func (r *Room) SuspendClient(pid, session string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	c, ok := r.clients[pid]
	if !ok {
		return false
	}
	// Only suspend during an active race. In LOBBY/FINISHED, just remove.
	if r.status != "COUNTDOWN" && r.status != "RUNNING" {
		return false
	}
	if session == "" {
		return false
	}

	snap := &SuspendedSession{
		pid:        c.pid,
		name:       c.name,
		userID:     c.userID,
		cursor:     c.cursor,
		mistakes:   c.mistakes,
		wpm:        c.wpm,
		acc:        c.acc,
		status:     c.status,
		durationMs: c.durationMs,
		placement:  c.placement,
	}

	delete(r.clients, pid)
	if r.hostPid == pid {
		r.hostPid = ""
		for otherPid := range r.clients {
			r.hostPid = otherPid
			break
		}
	}

	r.suspended[session] = snap

	// Capture rid for the purge timer so it doesn't close over `r` lock issues.
	rid := r.rid
	snap.purgeTimer = time.AfterFunc(rejoinGrace, func() {
		r.purgeSuspended(session, rid)
	})

	// If the suspended player was the only one we were waiting on, finish the race.
	if r.status == "RUNNING" && len(r.clients) > 0 && r.allFinishedLocked() {
		r.status = "FINISHED"
		if db.Pool != nil {
			record := r.buildRaceRecordLocked()
			go func() {
				if err := db.SaveRace(context.Background(), record); err != nil {
					log.Printf("SaveRace error: %v", err)
				}
			}()
		}
	}

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
	return true
}

func (r *Room) purgeSuspended(session, rid string) {
	r.mu.Lock()
	snap, ok := r.suspended[session]
	if !ok {
		r.mu.Unlock()
		return
	}
	delete(r.suspended, session)
	// Re-check race end after the player is fully gone.
	if r.status == "RUNNING" && len(r.clients) > 0 && r.allFinishedLocked() {
		r.status = "FINISHED"
		if db.Pool != nil {
			record := r.buildRaceRecordLocked()
			go func() {
				if err := db.SaveRace(context.Background(), record); err != nil {
					log.Printf("SaveRace error: %v", err)
				}
			}()
		}
	}
	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
	empty := len(r.clients) == 0 && len(r.suspended) == 0
	r.mu.Unlock()

	log.Printf("rejoin window expired rid=%s pid=%s", rid, snap.pid)

	// Avoid holding the room lock while taking the hub lock — opposite order to JoinRoom.
	if empty && r.hub != nil {
		r.hub.MaybeDeleteRoom(rid)
	}
}

// RejoinClient restores a suspended session onto the given new Client connection.
// Returns true on success. The Client's pid and session fields are overwritten with the suspended ones.
// Fails if the race already finished while the client was away — the client should
// bounce back to the multiplayer home screen.
func (r *Room) RejoinClient(c *Client, session string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	snap, ok := r.suspended[session]
	if !ok {
		return false
	}

	// If the race ended while they were gone, drop the session and tell them to start over.
	if r.status != "COUNTDOWN" && r.status != "RUNNING" {
		if snap.purgeTimer != nil {
			snap.purgeTimer.Stop()
		}
		delete(r.suspended, session)
		return false
	}

	if snap.purgeTimer != nil {
		snap.purgeTimer.Stop()
	}
	delete(r.suspended, session)

	// Restore identity onto the new connection.
	c.pid = snap.pid
	c.session = session
	c.userID = snap.userID
	c.name = snap.name
	c.roomID = r.rid

	c.cursor = snap.cursor
	c.mistakes = snap.mistakes
	c.wpm = snap.wpm
	c.acc = snap.acc
	c.status = snap.status
	c.durationMs = snap.durationMs
	c.placement = snap.placement
	c.ready = false

	r.clients[c.pid] = c
	if r.hostPid == "" {
		r.hostPid = c.pid
	}

	r.broadcastLocked(ServerMsg{Type: "room_state", Rid: r.rid, Data: r.snapshotLocked()})
	return true
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
