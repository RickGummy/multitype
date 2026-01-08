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

    players: PlayerState[];
};

export function resetPlayerForNewRound(p: any) {
    p.cursor = 0;
    p.mistakes = 0;
    p.wpm = 0;
    p.acc = 100;
    p.status = "RUNNING";
    p.finished = false;
    p.ready = true;
}

export function restartRoomRound(room: any, countdownMs = 3000) {
    room.seed = (Math.random() * 2 ** 31) | 0;

    room.startAtMs = Date.now() + countdownMs;
    room.status = "COUNTDOWN";

    for(const p of room.players) {
        resetPlayerForNewRound(p);
    }

    return room;
}