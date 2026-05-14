// types.ts -- TypeScript mirror of the server's WebSocket wire types.
// Keep in sync with apps/server/protocol.go. If you change a field on one side,
// change it on the other.

// PlayerState: one entry per player inside a RoomState snapshot.
export type  PlayerState = {
    pid: string;       // stable id; survives rejoin
    name: string;
    ready: boolean;
    cursor: number;    // how many chars of the prompt they've typed
    mistakes: number;
    wpm: number;
    acc: number;
    status: string;    // LOBBY | RUNNING | FINISHED
};

// RoomState: full room snapshot. Broadcast on every state change.
// The frontend re-renders from this; there is no client-side game state machine.
export type RoomState = {
    rid: string;
    status: string;              // LOBBY | COUNTDOWN | RUNNING | FINISHED
    prompt: string;              // currently unused (client regenerates from seed)
    startAtMs: number;           // absolute wall-clock ms when RUNNING starts
    seed: number;                // RNG seed -> deterministically generates the same prompt on every client
    promptMode: "short" | "medium" | "long" | "mixed";
    wordlistVersion?: string;    // server's content version; client refuses on mismatch

    players: PlayerState[];
};

// EXPECTED_WORDLIST_VERSION: must match WordlistVersion in apps/server/protocol.go.
// Bump in BOTH places when any of apps/web/public/*.txt changes.
export const EXPECTED_WORDLIST_VERSION = "v1";
