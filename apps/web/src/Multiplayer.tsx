import { useEffect, useRef, useState } from "react";
import { WSClient } from "./net/ws";
import type { WSMsg } from "./net/ws"
import type { RoomState } from "./net/types";

const WORD_COUNTS: Record<string, number> = {
    short: 25,
    medium: 30,
    long: 30,
    mixed: 40,
};

function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

function PromptWithCaret({ prompt, caret }: { prompt: string, caret: number }) {
    const i = clamp(caret, 0, prompt.length);
    const left = prompt.slice(0, i);
    const mid = i < prompt.length ? prompt[i] : " ";
    const right = i < prompt.length ? prompt.slice(i + 1) : "";

    return (
        <div
            style={{
                fontFamily: "ui-monspace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                whiteSpace: "pre-wrap",
                lineHeight: 1.6,
                fontSize: 16,
                color: "#eaeaea",
            }}
        >
            <span style={{ opacity: 0.9 }}>{left}</span>
            <span
                style={{
                    background: "#ddd",
                    color: "#111",
                    padding: "0 3px",
                    borderRadius: 4,
                }}
            >
                {mid}
            </span>
            <span style={{ opacity: 0.9 }}>{right}</span>
        </div>
    );
}

function TrainingStylePrompt({ prompt, typed }: { prompt: string; typed: string }) {
    const n = Math.min(prompt.length, typed.length);

    let correctUntil = 0;
    for (let i = 0; i < n; i++) {
        if (prompt[i] === typed[i]) correctUntil++;
        else break;
    }

    const correct = prompt.slice(0, correctUntil);
    const wrongTyped = typed.slice(correctUntil, n);
    const wrongExpected = prompt.slice(correctUntil, n);
    const rest = prompt.slice(n);

    return (
        <div
            style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                whiteSpace: "pre-wrap",
                lineHeight: 1.7,
                fontSize: 18,
                color: "#bdbdbd",
            }}
        >
            <span style={{ color: "#eaeaea" }}>{correct}</span>
            {wrongTyped.length > 0 && (
                <span style={{ background: "#5b1f1f", color: "#fff", borderRadius: 6, padding: "0 3px" }}>
                    {wrongExpected}
                </span>
            )}
            <span>{rest}</span>
        </div>
    );
}

function Pill({
    active, children, onClick, disabled,
}: {
    active: boolean;
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid #2a2a2a",
                background: active ? "#1f1f1f" : "#2b2b2b",
                color: "#fff",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                fontWeight: 600,
            }}
        >
            {children}
        </button>
    )
}

const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "#fff",
    color: "#11",
    cursor: "pointer",
};

const card: React.CSSProperties = {
    border: "1px solid #3a3a3a",
    borderRadius: 18,
    padding: 16,
    background: "#1f1f1f",
};

function nowMs() {
    return Date.now();
}

function score(prompt: string, typed: string) {
    const n = Math.min(prompt.length, typed.length);
    let cursor = 0;
    let mistakes = 0;

    for (let i = 0; i < n; i++) {
        if (prompt[i] === typed[i]) {
            if (mistakes === 0 && cursor === i) {
                cursor++;
            }
        }
        else {
            mistakes++;
        }

        if (mistakes > 0 && cursor < i + 1) {

        }
    }

    cursor = 0;
    for (let i = 0; i < n; i++) {
        if (prompt[i] === typed[i]) {
            cursor++;
        }
        else {
            break;
        }
    }

    mistakes = 0;
    for (let i = 0; i < n; i++) {
        if (prompt[i] !== typed[i]) {
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
    const [typed, setTyped] = useState("");
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [lists, setLists] = useState<null | {
        short: string[];
        medium: string[];
        long: string[];
        mixed: string[];
    }>(null);

    const [prompt, setPrompt] = useState<string>("");
    const [isHost, setIsHost] = useState(false);

    const [view, setView] = useState<"lobby" | "battle">("lobby");
    const [finishLeft, setFinishLeft] = useState<number | null>(null);

    const wsRef = useRef<WSClient | null>(null);
    const lastProgressSentAt = useRef<number>(0);

    useEffect(() => {
        const ws = new WSClient((m: WSMsg) => {
            if (m.type === "hello") {
                setPid(m.data?.pid ?? "");
            }
            if (m.type === "room_state") {
                setRoom(m.data);
            }
            if (m.type === "error") {
                console.log("server error:", m.err);
            }
            if (m.type === "player_progress") {
                const d = m.data as any;
                setRoom((prev) => {
                    if (!prev) {
                        return prev;
                    }
                    return {
                        ...prev,
                        players: prev.players.map((p) =>
                            p.pid === d.pid
                                ? { ...p, cursor: d.cursor, mistakes: d.mistakes, wpm: d.wpm, acc: d.acc, status: d.status }
                                : p
                        ),
                    };
                });
            }


        });

        ws.connect();
        wsRef.current = ws;
        return () => ws.close();
    }, []);

    useEffect(() => {
        async function loadLists() {
            const fetchList = async (path: string) => {
                const res = await fetch(path);
                const text = await res.text();
                return text
                    .split(/\r?\n/)
                    .map(w => w.trim())
                    .filter(Boolean)
            }

            const [short, medium, long, mixed] = await Promise.all([
                fetchList("/short.txt"),
                fetchList("/medium.txt"),
                fetchList("/long.txt"),
                fetchList("/mixed.txt"),
            ]);

            setLists({ short, medium, long, mixed });
        }

        loadLists();
    }, []);

    useEffect(() => {
        if (!room || !lists) return;
        if (!room.seed || !room.promptMode) return;

        const rand = (() => {
            let a = room.seed >>> 0;
            return () => {
                a |= 0;
                a = (a + 0x6D2B79F5) | 0;
                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        })();

        const list = lists[room.promptMode];
        const wordCount = WORD_COUNTS[room.promptMode];

        const out: string[] = [];
        for (let i = 0; i < wordCount; i++) {
            const idx = Math.floor(rand() * list.length);
            out.push(list[idx]);
        }

        setPrompt(out.join(" "));
        setInput("");
    }, [room?.seed, room?.promptMode, lists]);

    const canType = room?.status === "RUNNING";

    useEffect(() => {
        if (!room || !canType || !prompt) {
            return;
        }
        const t = nowMs();
        if (t - lastProgressSentAt.current < 120) {
            return;
        }

        const { cursor, mistakes } = score(prompt, typed);
        wsRef.current?.send({
            type: "progress",
            data: { cursor, mistakes },
        });
        lastProgressSentAt.current = t;

        if (cursor >= prompt.length) {
            wsRef.current?.send({ type: "finish", data: {} });
        }
    }, [typed, room, canType]);

    const status = room?.status ?? "NONE";
    const inRoom = !!room?.rid;

    const me = room?.players.find(p => p.pid === pid);
    const amReady = !!me?.ready;

    useEffect(() => {
        if (!room) {
            setView("lobby");
            return;
        }

        if (room.status === "LOBBY") {
            setView("lobby");
            setFinishLeft(null);
            return;
        }

        if (room.status === "COUNTDOWN" || room.status === "RUNNING") {
            setView("battle");
            setFinishLeft(null);
            return;
        }

        if (room.status === "FINISHED") {
            setView("battle");
            setFinishLeft(10);
        }
    }, [room?.rid, room?.status]);

    useEffect(() => {
        if (finishLeft == null) {
            return;
        }

        if (finishLeft <= 0) {
            setView("lobby");
            setFinishLeft(null);
            setInput("");
            return;
        }

        const id = window.setInterval(() => {
            setFinishLeft((x) => (x == null ? x : x - 1));
        }, 1000);

        return () => window.clearInterval(id);
    }, [finishLeft]);

    const countdownMs = room ? room.startAtMs - nowMs() : 0;
    const startsInSec = Math.max(0, Math.ceil(countdownMs / 1000));
    const meCursor = prompt ? score(prompt, typed).cursor : 0;

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "#2b2b2b",
                color: "#fff",
                padding: "28px 16px",
                fontFamily: "system-ui"
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h2 style={{ margin: 0 }}>Multiplayer</h2>
                <button
                    style={btnGhost}
                    onClick={() => {
                        wsRef.current?.send({ type: "leave_room", data: {} });
                        setRoom(null);
                        setTyped("");
                        setPrompt("");
                        setRidInput("");
                        setView("lobby");
                    }}
                >
                    Back
                </button>
            </div>

            {/* Lobby */}
            {(view === "lobby") && (
                <div style={{ display: "grid", gap: 14 }}>
                    <div style={card}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span>Name</span>
                                <input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                                />
                            </label>

                            <button style={btn} onClick={() => wsRef.current?.send({ type: "set_name", data: { name } })}>
                                Set name
                            </button>

                            {!room && (
                                <>
                                    <button
                                        style={btn}
                                        onClick={() => {
                                            setIsHost(true);
                                            wsRef.current?.send({ type: "create_room", data: {} });
                                        }}
                                    >
                                        Create room
                                    </button>

                                    <input
                                        placeholder="Room code"
                                        value={ridInput}
                                        onChange={(e) => setRidInput(e.target.value)}
                                        style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                                    />
                                    <button
                                        style={btnGhost}
                                        onClick={() => {
                                            setIsHost(false);
                                            wsRef.current?.send({ type: "join_room", rid: ridInput, data: {} });
                                        }}
                                    >
                                        Join room
                                    </button>
                                </>
                            )}

                            {room && (
                                <>
                                    <button style={btnGhost} onClick={() => wsRef.current?.send({ type: "leave_room", data: {} })}>
                                        Leave room
                                    </button>

                                    <button
                                        style={amReady ? btn : btnGhost}
                                        onClick={() => wsRef.current?.send({ type: "ready", data: { ready: !amReady } })}
                                    >
                                        {amReady ? "Unready" : "Ready"}
                                    </button>


                                    {room && isHost && room.status === "LOBBY" && (
                                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                            <span style={{ fontSize: 13, opacity: 0.9, color: "#111" }}>Mode</span>

                                            <div style={{ display: "flex", gap: 8 }}>
                                                {(["short", "medium", "long", "mixed"] as const).map((m) => (
                                                    <Pill
                                                        key={m}
                                                        active={room.promptMode === m}
                                                        onClick={() =>
                                                            wsRef.current?.send({
                                                                type: "set_prompt_mode",
                                                                data: { promptMode: m },
                                                            })
                                                        }
                                                    >
                                                        {m}
                                                    </Pill>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                </>
                            )}
                        </div>
                    </div>

                    {room && (
                        <div style={card}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <div><b>Room:</b> {room.rid}</div>
                                    <div style={{ fontSize: 14, opacity: 0.8 }}>
                                        Prompt mode: <b>{room.promptMode}</b> · Seed: <b>{room.seed}</b>
                                    </div>
                                </div>
                            </div>

                            <h3 style={{ marginTop: 14, marginBottom: 8 }}>Players</h3>

                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {room.players.map((p) => (
                                    <li key={p.pid}>
                                        <span
                                            style={{
                                                marginLeft: 8,
                                                padding: "2px 8px",
                                                borderRadius: 999,
                                                border: "1px solid #ddd",
                                                fontSize: 12,
                                                opacity: 0.9,
                                            }}
                                        >
                                            {p.ready ? "Ready" : "Not ready"}
                                        </span>

                                    </li>
                                ))}
                            </ul>

                            <h3 style={{ marginTop: 14, marginBottom: 8 }}>Prompt preview</h3>

                            <div style={{ padding: 12, background: "#f6f6f6", borderRadius: 12 }}>
                                {prompt || "(loading prompt...)"}
                            </div>
                        </div>
                    )}
                </div>

            )}



            {/* Battle */}
            {(view === "battle") && room && (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1px 1fr",
                        gap: 0,
                        height: "calc(100vh - 140px)",
                    }}
                >
                    <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
                        <div style={{ width: "100%", maxWidth: 520 }}>
                            {/* Left side, me */}
                            <div style={card}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                    <h3 style={{ margin: 0 }}>You</h3>
                                    <div style={{ fontSize: 14, opacity: 0.8 }}>
                                        {status === "COUNTDOWN" ? `Starting in ${startsInSec}s` : ""}
                                        {status === "RUNNING" ? "Go!" : ""}
                                        {status === "FINISHED" ? "Finished" : ""}
                                    </div>
                                </div>

                                <input
                                    ref={inputRef}
                                    value={typed}
                                    onChange={(e) => setTyped(e.target.value)}
                                    disabled={room.status !== "RUNNING"}
                                    style={{
                                        position: "absolute",
                                        opacity: 0,
                                        pointerEvents: "none",
                                        height: 0,
                                        width: 0,
                                    }}
                                />

                                <div
                                    onClick={() => inputRef.current?.focus()}
                                    style={{
                                        marginTop: 18,
                                        padding: "22px 22px",
                                        borderRadius: 18,
                                        background: "#2a2a2a",
                                        border: "1px solid #3a3a3a",
                                        boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
                                        cursor: room.status === "RUNNING" ? "text" : "default",
                                    }}
                                >
                                    {prompt ? (
                                        <TrainingStylePrompt prompt={prompt} typed={typed} />
                                    ) : (
                                        "(loading prompt...)"
                                    )}
                                </div>



                                <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                                    <button style={btnGhost} onClick={() => wsRef.current?.send({ type: "leave_room", data: {} })}>
                                        Leave
                                    </button>
                                    <button
                                        style={btn}
                                        onClick={() => {
                                            setInput("");
                                            setView("lobby");
                                            wsRef.current?.send({ type: "ready", data: { ready: true } });
                                        }}
                                    >
                                        Play again
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* border */}
                    <div style={{ background: "#3b3b3b" }} />

                    <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
                        <div style={{ width: "100%", maxWidth: 520 }}>
                            {/* Right side, opponents */}
                            <div style={card}>
                                <h3 style={{ marginTop: 0 }}>Opponents</h3>

                                {room.players.filter((p) => p.pid !== pid).length === 0 && (
                                    <div style={{ opacity: 0.7 }}>Waiting for someone to join…</div>
                                )}

                                {room.players
                                    .filter((p) => p.pid !== pid)
                                    .map((p) => {
                                        const prog = prompt.length ? Math.min(1, p.cursor / prompt.length) : 0;
                                        return (
                                            <div key={p.pid} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                                    <b>{p.name}</b>
                                                    <span style={{ fontSize: 14, opacity: 0.8 }}>
                                                        {p.wpm} wpm · {p.acc}% acc
                                                    </span>
                                                </div>

                                                <div style={{ height: 10, background: "#eee", borderRadius: 10, overflow: "hidden", marginTop: 8 }}>
                                                    <div style={{ width: `${prog * 100}%`, height: "100%", background: "#111" }} />
                                                </div>

                                                <div
                                                    style={{
                                                        marginTop: 18,
                                                        padding: "22px 22px",
                                                        borderRadius: 18,
                                                        background: "#2a2a2a",
                                                        border: "1px solid #3a3a3a",
                                                        boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
                                                    }}
                                                >
                                                    {prompt ? <PromptWithCaret prompt={prompt} caret={p.cursor} /> : "(loading prompt...)"}
                                                </div>

                                            </div>
                                        );
                                    })}

                                {/* finish overlay */}
                                {status === "FINISHED" && (
                                    <div style={{ marginTop: 8, padding: 12, borderRadius: 12, border: "1px solid #111" }}>
                                        <b>Race finished.</b>{" "}
                                        {finishLeft != null ? `Returning to lobby in ${finishLeft}s.` : ""}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>

    );
}