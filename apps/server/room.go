// room.go -- the core game logic and state machine.
//
// State machine:
//   LOBBY      players join, set names, hit Ready. Mode-pill picker visible to host.
//   COUNTDOWN  triggered when all clients in lobby are ready AND there are at least 2.
//              A goroutine started by beginCountdownLocked watches the clock and
//              flips to RUNNING when startAtMs is reached.
//   RUNNING    players type; cursor + mistakes broadcast via player_progress.
//              Each Finish() call marks one player FINISHED; once all clients are
//              FINISHED, the room transitions to FINISHED and (if the DB is up)
//              persists a race record.
//   FINISHED   stats screen. RestartRound() acts like Ready in the rematch flow;
//              when all clients have pressed Play Again the room loops back to COUNTDOWN.
//
// Concurrency model: every method that touches Room state takes r.mu.
// Internal helpers ending in `Locked` ASSUME the caller already holds r.mu and
// must NOT lock again. Broadcasts happen under the lock (broadcastLocked) but
// just push messages onto each Client's buffered send channel -- no blocking I/O.
//
// Disconnect/rejoin: when a connection drops mid-race (cleanup() in client.go),
// SuspendClient snapshots the player state into `r.suspended` and starts a 30s
// purge timer. The client can reconnect and call RejoinClient(token) to restore.
// After 30s purgeSuspended runs and the snapshot is gone for good.
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

// maxPlayers caps the number of concurrent racers per room.
// Frontend layout: 1 opponent -> split screen, 2+ opponents -> ghost-cursor shadowing.
const maxPlayers = 5

// rejoinGrace is how long a disconnected player's slot is held mid-race
// before we give up and treat them as gone for good.
const rejoinGrace = 30 * time.Second

// SuspendedSession is the snapshot we keep when a player disconnects mid-race.
// Lives in Room.suspended until the player rejoins (via RejoinClient) or the
// purgeTimer fires after rejoinGrace.
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

// Room represents a single game room.
type Room struct {
	mu sync.Mutex // guards everything below

	hub *Hub // back-reference so the room can ask the hub to clean it up when empty

	rid          string
	hostPid      string // first player to create the room; gets the mode-picker UI
	status       string // LOBBY | COUNTDOWN | RUNNING | FINISHED
	guestCounter int    // monotonic; gives unnamed players "Guest 1", "Guest 2"...

	// Per-race state, reset by resetToLobbyLocked or replaced by beginCountdownLocked.
	prompt      string   // currently unused (clients regenerate from seed)
	startAtMs   int64    // absolute wall-clock ms when COUNTDOWN -> RUNNING flips
	seed        int64    // RNG seed clients use to deterministically build the prompt
	promptMode  string   // "short" | "medium" | "long" | "mixed"
	finishOrder []string // pids in the order they finished (drives placement)

	clients   map[string]*Client            // keyed by pid; live, active connections
	suspended map[string]*SuspendedSession  // keyed by session token; disconnected mid-race
	prompts   []string                      // legacy hardcoded prompts (unused now)
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

// AddClient inserts a fresh client into the room. Returns false if the room
// is full or no longer in LOBBY (rejoin uses a separate path that bypasses both checks).
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

// RemoveClient is the "hard remove" path. Called when:
//   - a player intentionally leaves (leave_room message)
//   - cleanup runs and SuspendClient returned false (i.e. we're in LOBBY/FINISHED)
//
// During LOBBY/FINISHED this is straightforward: pull them out, reassign host if needed.
// During COUNTDOWN/RUNNING (only possible if SuspendClient also failed for some reason)
// we additionally check whether the leaver was the last unfinished player, and end
// the race if so -- otherwise survivors would be stuck waiting forever.
func (r *Room) RemoveClient(pid string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if c, ok := r.clients[pid]; ok {
		c.roomID = ""
	}
	delete(r.clients, pid)

	// Host got dropped -> promote anyone else who's still here.
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
		// Race continues for the survivors. The only special case: if everyone
		// remaining is already FINISHED, the race is effectively over.
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

// SetReady toggles a player's ready flag. If the toggle results in every player
// being ready AND there are at least 2 players AND we're still in LOBBY, the
// countdown kicks off automatically.
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

// Finish marks a single player as having reached the end of the prompt.
// Idempotent (returns early if they're already FINISHED). When this call results
// in every remaining client being FINISHED, transitions the room to FINISHED
// and (if Postgres is up) persists the race record asynchronously.
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

// beginCountdownLocked starts the countdown phase.
//
// 1. Picks a fresh RNG seed; clients use this to deterministically generate the
//    same prompt locally (see Multiplayer.tsx prompt-gen effect).
// 2. Sets startAtMs to 5 seconds in the future. Clients render the countdown
//    locally as `startAtMs - now`.
// 3. Resets each player's per-race state (cursor, mistakes, wpm, etc.) and clears ready.
// 4. Spawns a goroutine that polls every 25ms; when wall-clock reaches startAtMs
//    it flips status to RUNNING and rebroadcasts. The 25ms tick is a tradeoff:
//    tighter than humans can perceive but cheap enough to leave running.
//
// The goroutine self-cancels if status changes (e.g. someone leaves and triggers
// a state transition) or if a different startAt has been set (a new countdown
// started concurrently -- shouldn't happen but guards against it).
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

			// Bail if state has moved on (e.g. all players left, new countdown started).
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

// resetToLobbyLocked wipes per-race state so the room is ready to start a new
// round (or just sit idle in lobby). Called by RestartRound when everyone
// pressed Play Again, and previously by RemoveClient (no longer, see disconnect handling).
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

// broadcastLocked fans a message out to every connected client in the room.
// Non-blocking on purpose: if a client's send buffer is full (slow consumer),
// the message is dropped for that client rather than stalling the whole room.
// The room is fine because the next state change will broadcast again with
// the latest snapshot anyway.
func (r *Room) broadcastLocked(msg ServerMsg) {
	for _, c := range r.clients {
		select {
		case c.send <- msg:
		default:
			// buffer full -> drop. Next broadcast will catch them up.
		}
	}
}

func (r *Room) IsEmpty() bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.clients) == 0 && len(r.suspended) == 0
}

// SuspendClient is the "soft remove" path for mid-race disconnects.
//
// Called by cleanup() when a connection drops. Snapshots the player's current
// game state (cursor, mistakes, wpm, etc.) into r.suspended[session] and arms
// a purge timer. If the same session token comes back via RejoinClient within
// rejoinGrace, we restore that snapshot onto the new connection. Otherwise
// purgeSuspended fires and they're gone for good.
//
// Returns true if the client was suspended (caller should NOT also hard-remove).
// Returns false in LOBBY/FINISHED, where there's no race state worth preserving
// so the caller should just RemoveClient instead.
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

// purgeSuspended fires from the AfterFunc timer rejoinGrace after a suspend.
// If nobody rejoined in time, drops the snapshot, re-checks "all remaining
// finished?" in case this removal completed the race, and asks the hub to
// delete the room if it ended up empty.
//
// We release r.mu before calling hub.MaybeDeleteRoom because that function takes
// hub.mu, and the rest of the codebase always acquires hub.mu first then room.mu.
// Going the other way risks deadlock.
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

	// Avoid holding the room lock while taking the hub lock - that's the opposite
	// order from JoinRoom and would deadlock if they ever interleaved.
	if empty && r.hub != nil {
		r.hub.MaybeDeleteRoom(rid)
	}
}

// RejoinClient is the counterpart to SuspendClient: claim a suspended snapshot
// for a NEW connection.
//
// Flow: client reconnects WS -> server emits a fresh hello with a new pid/session ->
// the frontend notices it has a stashed session from before and sends a `rejoin`
// message with the OLD session token. That lands here. We:
//   1. Look up the snapshot by old session token.
//   2. Refuse if the race already finished (race is done, you're back to lobby).
//   3. Otherwise restore the snapshot's pid + game state onto the new Client.
//
// After this returns true, the rest of the room sees the same pid they saw
// pre-disconnect (just attached to a different WS connection). Other players'
// "lastKnown" rendering on the frontend tracks the player by pid so they
// transition smoothly from "disconnected" back to "live."
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

// RestartRound is the rematch handler.
// Each call marks the requesting player as ready. When all clients are ready
// AND we're either in FINISHED (post-race) or LOBBY (idle), kick off a fresh countdown.
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
