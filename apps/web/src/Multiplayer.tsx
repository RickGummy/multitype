import { useEffect, useRef, useState } from "react";
import { WSClient } from "./net/ws";
import type { WSMsg } from "./net/ws"
import type { RoomState} from "./net/types";

function nowMs() {
    return Date.now();
}

function score(prompt: string, input: string) {
    const n = Math.min(prompt.length, input.length);
    let cursor = 0;
    let mistakes = 0;

    for(let i = 0; i < n; i++) {
        if(prompt[i] === input[i]) {
            if(mistakes === 0 && cursor === i) {
                cursor++;
            }
        }
        else {
            mistakes++;
        }

        if(mistakes > 0 && cursor < i + 1) {

        }
    }

    cursor = 0;
    for(let i = 0; i < n; i++) {
        if (prompt[i] === input[i]) {
            cursor++;
        }
        else {
            break;
        }
    }

    mistakes = 0;
    for(let i = 0; i < n; i++) {
        if(prompt[i] !== input[i]) {
            mistakes++;
        }
    }
    return { cursor, mistakes };
}

export default function Multiplayer() {
    const [pid, setPid] = useState<string>("");
    const [room, setRoom] = useState<RoomState | null>(null);
    const [ridInput, setRidInput] = useState("");
    const [name, setName] = useState("Rick");
    const [input, setInput] = useState("");

    const wsRef = useRef<WSClient | null>(null);
    const lastProgressSentAt = useRef<number>(0);

    useEffect(() => {
        const ws = new WSClient((m: WSMsg) => {
            if(m.type === "hello") {
                setPid(m.data?.pid ?? "");
            }
            if (m.type === "room_state") {
                setRoom(m.data);
            }
            if(m.type === "error") {
                console.log("server error:", m.err);
            }
        });

        ws.connect();
        wsRef.current = ws;
        return () => ws.close();
    }, []);

    const canType = room?.status === "RUNNING";

    useEffect(() => {
        if (!room || !canType) {
            return;
        }
        const t = nowMs();
        if(t - lastProgressSentAt.current < 120) {
            return;
        }

        const { cursor, mistakes } = score(room.prompt, input);
        wsRef.current?.send({
            type: "progress",
            data: {cursor, mistakes},
        });
        lastProgressSentAt.current = t;

        if (cursor >= room.prompt.length) {
            wsRef.current?.send({ type: "finish", data: {} });
        }
    }, [input, room, canType]);

    const countdownMs = room ? room.startAtMs - nowMs() : 0;

    return (
        <div style={{ maxWidth: 900, margin: "40px auto", fontFamily: "system-ui" }}>
            <h2>Multiplayer</h2>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <label>
                    Name{" "}
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        style={{ padding: 8}}
                    />
                </label>
                <button onClick={() => wsRef.current?.send({ type: "set_name", data: { name }})}>
                    Set name
                </button>

                <button onClick={() => wsRef.current?.send({ type: "create_room", data: {} })}>
                    Create room
                </button>

                <input
                    placeholder="Room id (rid)"
                    value={ridInput}
                    onChange={(e) => setRidInput(e.target.value)}
                    style={{ padding: 8}}
                />
                <button onClick={() => wsRef.current?.send({ type: "join_room", rid: ridInput, data: {}})}>
                    Join room
                </button>

                <button onClick={() => wsRef.current?.send({ type: "leave_room", data: {} })}>
                    Leave room
                </button>

                <button onClick={() => wsRef.current?.send({ type: "ready", data: { ready: true } })}>
                    Ready
                </button>

                <button onClick={() => wsRef.current?.send({ type: "ready", data: { ready: false } })}>
                    Unready
                </button>
            </div>

            <hr style={{ margin: "20px 0" }} />

            <div>
                <div><b>Your pid:</b> {pid || "(waiting...)"}</div>
                <div><b>Room:</b> {room?.rid ?? "(none)"}</div>
                <div><b>Status:</b> {room?.status ?? "(none)"}</div>

                {room?.status === "COUNTDOWN" && (
                    <div><b>Starts in:</b> {Math.max(0, Math.ceil(countdownMs / 1000))}s</div>
                )}
            </div>

            {room && (
                <>
                    <h3 style={{ marginTop: 24}}>Players</h3>
                    <ul>
                        {room.players.map((p) => {
                            const prog = room.prompt.length ? Math.min(1, p.cursor / room.prompt.length) : 0;
                            return (
                                <li key={p.pid} style={{ marginBottom: 10 }}>
                                    <div>
                                        <b>{p.name}</b> {p.pid === pid ? "(you)" : ""} - {p.status} - ready:{" "}
                                        {String(p.ready)} - {p.wpm} wpm - {p.acc}% acc
                                    </div>

                                    <div style={{ height: 8, background: "#eee", borderRadius: 6, overflow: "hidden" }}>
                                        <div style={{ width: `${prog * 100}%`, height: "100%", background: "#333" }} />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    <h3>Prompt</h3>
                    <div style={{ padding: 12, background: "#f6f6f6", borderRadius: 8 }}>
                        {room.prompt || "(waiting for prompt)"}
                    </div>

                    <h3 style={{ marginTop: 16 }}>Type here</h3>
                    <textarea
                        disabled={!canType}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={canType ? "Type..." : "Waiting for RUNNING..."}
                        rows={4}
                        style={{ width: "100%", padding: 12, fontSize: 16 }}
                    />
                </>
            )}
        </div>
    );
}