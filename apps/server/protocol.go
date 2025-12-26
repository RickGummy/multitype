package main

type ClientMsg struct {
	Type string `json:"type"`
	Rid  string `json:"rid,omitempty"`

	Name     string `json:"name,omitempty"`
	Ready    *bool  `json:"ready,omitempty"`
	Cursor   *int   `json:"cursor,omitempty"`
	Mistakes *int   `json:"mistakes,omitempty"`
	Finished *bool  `json:"finished,omitempty"`
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

type RoomState struct {
	Rid       string        `json:"rid"`
	Status    string        `json:"status"`
	Prompt    string        `json:"prompt"`
	StartAtMs int64         `json:"startAtMs"`
	Players   []PlayerState `json:"players"`
}