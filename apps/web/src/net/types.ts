export type  PlayerState = {
    pid: string;
    name: string;
    ready: boolean;
    cursor: number;
    mistakes: number;
    wpm: number;
    acc: number;
    status: string;
};

export type RoomState = {
    rid: string;
    status: string;
    prompt: string;
    startAtMs: number;
    seed: number;
    promptMode: "short" | "medium" | "long" | "mixed";
    wordlistVersion?: string;

    players: PlayerState[];
};

// Must match `WordlistVersion` in apps/server/protocol.go. Bump when word lists change.
export const EXPECTED_WORDLIST_VERSION = "v1";

