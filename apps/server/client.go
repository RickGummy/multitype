package main

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	hub  *Hub
	conn *websocket.Conn

	pid    string
	send   chan ServerMsg
	name   string
	roomID string

	ready    bool
	cursor   int
	mistakes int
	wpm      float64
	acc      float64
	status   string
}

func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		hub:  hub,
		conn: conn,
		pid:  newID(8),
		send: make(chan ServerMsg, 64),

		name: "Guest",
		acc:  100,
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(25 * time.Second)

	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.conn.WriteJSON(msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}

	}
}

func (c *Client) readPump() {
	defer func() {
		c.cleanup()
	}()

	c.conn.SetReadLimit(64 * 1024)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	c.send <- ServerMsg{
		Type: "hello",
		Data: map[string]any{"pid": c.pid},
	}

	for {
		var envelope struct {
			Type string          `json:"type"`
			Rid  string          `json:"rid,omitempty"`
			Data json.RawMessage `json:"data"`
		}

		if err := c.conn.ReadJSON(&envelope); err != nil {
			return
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

func (c *Client) handle(m ClientMsg) {
	switch m.Type {

	case "set_name":
		if m.Name == "" {
			return
		}
		c.name = m.Name
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
		room := c.hub.CreateRoom(c)
		c.send <- ServerMsg{Type: "room_joined", Rid: room.rid, Data: map[string]any{"rid": room.rid}}

	case "join_room":
		if m.Rid == "" {
			c.send <- ServerMsg{Type: "error", Err: "missing rid"}
			return
		}

		room, ok := c.hub.JoinRoom(m.Rid, c)
		if !ok {
			c.send <- ServerMsg{Type: "error", Err: "room not found"}
			return
		}

		c.send <- ServerMsg{Type: "room_joined", Rid: room.rid, Data: map[string]any{"rid": room.rid}}

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

func (c *Client) cleanup() {
	if c.roomID != "" {
		if room, ok := c.hub.GetRoom(c.roomID); ok {
			rid := c.roomID
			room.RemoveClient(c.pid)
			c.hub.MaybeDeleteRoom(rid)
		}
	}

	close(c.send)
	_ = c.conn.Close()
	log.Printf("client disconnected pid=%s", c.pid)
}
