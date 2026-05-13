package main

type ClientMsg struct {
	Type string `json:"type"`
	Rid  string `json:"rid,omitempty"`

	Name       string `json:"name,omitempty"`
	Ready      *bool  `json:"ready,omitempty"`
	Cursor     *int   `json:"cursor,omitempty"`
	Mistakes   *int   `json:"mistakes,omitempty"`
	Finished   *bool  `json:"finished,omitempty"`

	PromptMode string `json:"promptMode,omitempty"`
	Token      string `json:"token,omitempty"`
	Session    string `json:"session,omitempty"`
}

type ServerMsg struct {
	Type string      `json:"type"`
	Rid  string      `json:"rid,omitempty"`
	Data interface{} `json:"data,omitempty"`
	Err  string      `json:"err,omitempty"`
}

type PlayerState struct {
	Pid      string  `json:"pid"`
	Name     string  `json:"name"`
	Ready    bool    `json:"ready"`
	Cursor   int     `json:"cursor"`
	Mistakes int     `json:"mistakes"`
	WPM      float64 `json:"wpm"`
	Acc      float64 `json:"acc"`
	Status   string  `json:"status"`
}

// WordlistVersion identifies the content version of the word lists in apps/web/public/.
// Bump when any of short/medium/long/mixed.txt changes. Clients refuse to play if their
// expected version doesn't match what the server broadcasts.
const WordlistVersion = "v1"

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