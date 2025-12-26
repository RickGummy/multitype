package main

import (
	"log"
	"sync"
)

type Hub struct {
	mu    sync.Mutex
	rooms map[string]*Room
}

func NewHub() *Hub {
	return &Hub{rooms: make(map[string]*Room)}
}

func (h *Hub) GetRoom(rid string) (*Room, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[rid]
	return r, ok
}

func (h *Hub) CreateRoom(owner *Client) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()

	rid := newID(4)
	room := NewRoom(rid)
	h.rooms[rid] = room
	log.Printf("room created rid=%s", rid)

	room.AddClient(owner)
	return room
}

func (h *Hub) JoinRoom(rid string, c *Client) (*Room, bool) {
	h.mu.Lock()
	room, ok := h.rooms[rid]
	h.mu.Unlock()

	if !ok {
		return nil, false
	}

	room.AddClient(c)

	return room, true
}

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
