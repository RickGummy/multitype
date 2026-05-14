// The WebSocket wire format. Every message is JSON. The `type` field tells
// you which other fields to look at. Mirror types live in apps/web/src/net/types.ts;
// if you add a field, add it in both places.
package main

// ClientMsg is everything the client can send to the server.
// The pointer fields (*bool, *int) let us tell "field was omitted" apart
// from "field is zero/false" when unmarshaling.
type ClientMsg struct {
	Type string `json:"type"`
	Rid  string `json:"rid,omitempty"`

	Name     string `json:"name,omitempty"`
	Ready    *bool  `json:"ready,omitempty"`
	Cursor   *int   `json:"cursor,omitempty"`
	Mistakes *int   `json:"mistakes,omitempty"`
	Finished *bool  `json:"finished,omitempty"`

	PromptMode string `json:"promptMode,omitempty"`
	Token      string `json:"token,omitempty"` // JWT for auth message
	Session    string `json:"session,omitempty"` // rejoin token for the rejoin message
}

// ServerMsg is everything the server can push to a client.
// Data is interface{} because each message type carries a different shape.
type ServerMsg struct {
	Type string      `json:"type"`
	Rid  string      `json:"rid,omitempty"`
	Data interface{} `json:"data,omitempty"`
	Err  string      `json:"err,omitempty"`
}

// PlayerState is one player's slice of a RoomState snapshot.
// Status is one of: LOBBY, RUNNING, FINISHED.
type PlayerState struct {
	Pid      string  `json:"pid"`      // stable id assigned at connection time, survives rejoin
	Name     string  `json:"name"`
	Ready    bool    `json:"ready"`
	Cursor   int     `json:"cursor"`   // how many chars of the prompt this player has typed
	Mistakes int     `json:"mistakes"`
	WPM      float64 `json:"wpm"`
	Acc      float64 `json:"acc"`
	Status   string  `json:"status"`
}

// WordlistVersion identifies the content version of the word lists in apps/web/public/.
// Bump when any of short/medium/long/mixed.txt changes. Clients refuse to play if their
// expected version doesn't match what the server broadcasts.
const WordlistVersion = "v1"

// RoomState is the full snapshot of a room. The server broadcasts this to
// every client whenever anything in the room changes. The client just renders
// whatever's in the latest snapshot; there's no client-side game logic.
//
// Status moves through LOBBY -> COUNTDOWN -> RUNNING -> FINISHED.
// After FINISHED, pressing Play Again on all clients loops back to COUNTDOWN.
//
// StartAtMs is an absolute timestamp in milliseconds (Unix time). Each client
// renders the countdown locally as (startAtMs - now), so they all show the
// same number at roughly the same wall-clock moment. The actual transition
// from COUNTDOWN to RUNNING is decided by a server goroutine, not by clients.
//
// Seed is the random number used to generate the prompt. Every client runs
// the same RNG with this seed and produces the same prompt locally, so the
// server doesn't have to send the (potentially long) prompt text.
type RoomState struct {
	Rid             string        `json:"rid"`
	Status          string        `json:"status"`
	Prompt          string        `json:"prompt"`
	StartAtMs       int64         `json:"startAtMs"`
	Seed            int64         `json:"seed"`
	PromptMode      string        `json:"promptMode"`
	WordlistVersion string        `json:"wordlistVersion"`
	Players         []PlayerState `json:"players"`
}