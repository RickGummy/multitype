// hub.go -- the global registry of active rooms.
//
// One Hub per server process, holding a map of room IDs to *Room. Every WebSocket
// client gets a pointer to the hub so it can create, find, or leave rooms.
//
// Lock ordering: always hub.mu first, then room.mu. NEVER hold room.mu while
// trying to acquire hub.mu (that's the deadlock direction). The one tricky place
// is purgeSuspended in room.go -- it releases room.mu BEFORE calling
// hub.MaybeDeleteRoom for exactly this reason.
package main

import (
	"log"
	"sync"
)

type Hub struct {
	mu    sync.Mutex       // protects `rooms`
	rooms map[string]*Room // active rooms, keyed by 4-char room id
}

func NewHub() *Hub {
	return &Hub{rooms: make(map[string]*Room)}
}

// GetRoom looks up a room by id. Returns (nil, false) if it doesn't exist.
func (h *Hub) GetRoom(rid string) (*Room, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[rid]
	return r, ok
}

// CreateRoom mints a new room with a random 4-char id, marks `owner` as host,
// and adds them as the first client. Returns the new room.
func (h *Hub) CreateRoom(owner *Client) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()

	rid := newID(4)
	room := NewRoom(rid, h)
	room.SetHost(owner.pid)
	h.rooms[rid] = room
	log.Printf("room created rid=%s", rid)

	owner.name = normalizeName(owner.name)
	room.AddClient(owner)

	return room
}

// JoinRoom adds an existing client to an existing room. Returns the room on success;
// returns ("room not found") if the rid doesn't exist or ("room unavailable") if the
// room is full or no longer accepting joins (status != LOBBY).
func (h *Hub) JoinRoom(rid string, c *Client) (*Room, string) {
	h.mu.Lock()
	room, ok := h.rooms[rid]
	h.mu.Unlock()

	if !ok {
		return nil, "room not found"
	}

	c.name = normalizeName(c.name)
	if !room.AddClient(c) {
		return nil, "room unavailable"
	}

	return room, ""
}

// MaybeDeleteRoom removes a room from the hub if it has no clients AND no suspended
// sessions. Called from cleanup() when a connection drops, and from purgeSuspended()
// when a rejoin grace window expires with no one to come back to.
func (h *Hub) MaybeDeleteRoom(rid string) {
	h.mu.Lock()
	room, ok := h.rooms[rid]

	if !ok {
		h.mu.Unlock()
		return
	}

	empty := room.IsEmpty()
	if empty {
		delete(h.rooms, rid)
	}

	h.mu.Unlock()

	if empty {
		log.Printf("room deleted rid=%s", rid)
	}
}
