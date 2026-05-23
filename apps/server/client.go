// client.go -- one struct + two goroutines per WebSocket connection.
//
// Every connected browser gets a Client. Each Client runs:
//   - readPump:  blocks on conn.ReadJSON, dispatches incoming messages to handle()
//   - writePump: blocks on the `send` channel, marshals + writes JSON to the wire
//
// These two goroutines own the connection. The Room broadcasts to a client by
// pushing a ServerMsg onto c.send; the writePump picks it up and ships it.
//
// The Client struct also carries the player's game state (cursor, mistakes, wpm, etc.)
// because the Room references clients by pid. This is a slight conflation of "connection"
// and "player slot" -- in a bigger refactor I'd split them, but for one process it's fine.
package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"multiplayer-server/db"

	"github.com/gorilla/websocket"
)

// Client = one WebSocket connection + the per-player game state it owns.
type Client struct {
	hub  *Hub
	conn *websocket.Conn

	pid     string // stable player id, survives rejoin
	session string // secret rejoin token, only this client knows it
	userID  string // populated after a successful `auth` message; "" for guests
	send    chan ServerMsg
	name    string
	roomID  string // "" if not in a room

	// Race state.
	ready      bool
	cursor     int
	mistakes   int
	wpm        float64
	acc        float64
	status     string // LOBBY | RUNNING | FINISHED
	durationMs int64
	placement  int
}

// NewClient creates a Client with fresh pid and session token.
// On reconnect, the rejoin flow overwrites pid (back to the old one) and session.
func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		hub:     hub,
		conn:    conn,
		pid:     newID(8),
		session: newID(24),
		send:    make(chan ServerMsg, 64), // buffered so broadcasts don't block on slow clients

		name: "",
		acc:  100,
	}
}

// writePump is the goroutine that owns writes to the WebSocket.
// Two sources of writes: messages off c.send (game state), and periodic pings
// to keep the connection alive past any intermediary's idle timeout.
func (c *Client) writePump() {
	ticker := time.NewTicker(25 * time.Second)

	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			// Channel closed -> cleanup() ran -> send a close frame and exit.
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.conn.WriteJSON(msg); err != nil {
				return // write failed -> connection dead -> let readPump trigger cleanup
			}
		case <-ticker.C:
			// Idle keepalive ping. The client's browser auto-replies with pong.
			_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}

	}
}

// readPump is the goroutine that owns reads from the WebSocket.
// Blocks on ReadJSON, dispatches to handle(). Exits on any read error
// (including a normal client disconnect), triggering cleanup() in the defer.
func (c *Client) readPump() {
	defer func() {
		c.cleanup()
	}()

	c.conn.SetReadLimit(64 * 1024)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	// Each pong from the client resets the read deadline; if we don't get one
	// within 60s the read will fail and we'll fall through to cleanup().
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// First message after connect: tell the client its pid and session token.
	c.send <- ServerMsg{
		Type: "hello",
		Data: map[string]any{"pid": c.pid, "session": c.session},
	}

	for {
		// Two-stage unmarshal: pull Type/Rid out first, then unmarshal Data
		// into the same struct (so the typed fields like Cursor/Mistakes get filled in).
		var envelope struct {
			Type string          `json:"type"`
			Rid  string          `json:"rid,omitempty"`
			Data json.RawMessage `json:"data"`
		}

		if err := c.conn.ReadJSON(&envelope); err != nil {
			return // connection closed or malformed -> cleanup
		}

		var m ClientMsg
		m.Type = envelope.Type
		m.Rid = envelope.Rid

		if len(envelope.Data) > 0 {
			_ = json.Unmarshal(envelope.Data, &m)
		}

		c.handle(m)
	}
}

// handle dispatches a single incoming message to the right action.
// Most cases either mutate the Client's own fields or delegate to a Room method.
func (c *Client) handle(m ClientMsg) {
	switch m.Type {

	case "auth":
		if m.Token == "" || db.Pool == nil {
			return
		}
		user, err := validateToken(context.Background(), m.Token)
		if err != nil || user == nil {
			return
		}
		c.userID = user.ID
		c.name = user.Username
		if c.roomID != "" {
			if room, ok := c.hub.GetRoom(c.roomID); ok {
				room.SetName(c.pid, c.name)
			}
		}

	case "set_name":
		c.name = sanitizeName(m.Name)
		if c.roomID != "" {
			if room, ok := c.hub.GetRoom(c.roomID); ok {
				room.SetName(c.pid, c.name)
			}
		}

	case "set_prompt_mode":
		if c.roomID == "" || m.PromptMode == "" {
			return
		}

		room, ok := c.hub.GetRoom(c.roomID)
		if !ok {
			return
		}

		if room.HostPid() != c.pid {
			return
		}
		room.SetPromptMode(m.PromptMode)

	case "create_room":
		if m.Name != "" {
			c.name = sanitizeName(m.Name)
		}
		room := c.hub.CreateRoom(c)
		if room == nil {
			c.send <- ServerMsg{Type: "error", Err: "server at capacity, try again later"}
			return
		}
		if c.name != "" {
			room.SetName(c.pid, c.name)
		}
		c.send <- ServerMsg{Type: "room_joined", Rid: room.rid, Data: map[string]any{"rid": room.rid}}

	case "restart_round":
		if c.roomID == "" {
			return
		}
		if room, ok := c.hub.GetRoom(c.roomID); ok {
			room.RestartRound(c.pid)
		}

	case "join_room":
		if m.Rid == "" {
			c.send <- ServerMsg{Type: "error", Err: "missing rid"}
			return
		}

		room, errStr := c.hub.JoinRoom(m.Rid, c)
		if errStr != "" {
			c.send <- ServerMsg{Type: "error", Err: errStr}
			return
		}

		if m.Name != "" {
			c.name = sanitizeName(m.Name)
			room.SetName(c.pid, c.name)
		}

		c.send <- ServerMsg{Type: "room_joined", Rid: room.rid, Data: map[string]any{"rid": room.rid}}

	case "rejoin":
		if m.Rid == "" || m.Session == "" {
			c.send <- ServerMsg{Type: "rejoin_failed", Err: "missing rid or session"}
			return
		}
		room, ok := c.hub.GetRoom(m.Rid)
		if !ok {
			c.send <- ServerMsg{Type: "rejoin_failed", Err: "room not found"}
			return
		}
		if !room.RejoinClient(c, m.Session) {
			c.send <- ServerMsg{Type: "rejoin_failed", Err: "session expired"}
			return
		}
		c.send <- ServerMsg{
			Type: "rejoin_ok",
			Rid:  room.rid,
			Data: map[string]any{"pid": c.pid, "session": c.session, "rid": room.rid},
		}

	case "leave_room":
		if c.roomID == "" {
			return
		}

		if room, ok := c.hub.GetRoom(c.roomID); ok {
			rid := c.roomID
			room.RemoveClient(c.pid)
			c.hub.MaybeDeleteRoom(rid)
		}

	case "ready":
		if c.roomID == "" || m.Ready == nil {
			return
		}

		if room, ok := c.hub.GetRoom(c.roomID); ok {
			room.SetReady(c.pid, *m.Ready)
		}

	case "progress":
		if c.roomID == "" || m.Cursor == nil || m.Mistakes == nil {
			return
		}

		if room, ok := c.hub.GetRoom(c.roomID); ok {
			room.UpdateProgress(c.pid, *m.Cursor, *m.Mistakes)
			if m.Finished != nil && *m.Finished {
				room.Finish(c.pid)
			}
		}

	case "finish":
		if c.roomID == "" {
			return
		}

		if room, ok := c.hub.GetRoom(c.roomID); ok {
			room.Finish(c.pid)
		}

	default:

	}
}

// cleanup runs when readPump exits (connection dropped or readonly error).
// Tries to suspend the client's slot first (so they can rejoin within 30s if the
// race is mid-flight); falls back to a hard remove otherwise. Then closes the
// send channel which stops writePump.
func (c *Client) cleanup() {
	if c.roomID != "" {
		if room, ok := c.hub.GetRoom(c.roomID); ok {
			rid := c.roomID
			// SuspendClient only succeeds during COUNTDOWN/RUNNING. In LOBBY/FINISHED
			// it returns false and we just fully remove.
			if !room.SuspendClient(c.pid, c.session) {
				room.RemoveClient(c.pid)
			}
			c.hub.MaybeDeleteRoom(rid)
		}
	}

	close(c.send) // signals writePump to exit
	_ = c.conn.Close()
	log.Printf("client disconnected pid=%s", c.pid)
}
