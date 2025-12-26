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
    players: PlayerState[];
};

