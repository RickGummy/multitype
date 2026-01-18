import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import "./App.css";
import { WSClient } from "./net/ws";
import type { WSMsg } from "./net/ws"
import type { RoomState } from "./net/types";

const WORD_COUNTS: Record<string, number> = {
    short: 5, // change to 25
    medium: 30,
    long: 30,
    mixed: 40,
};


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



const btnGhost: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #3a3a3a",
    background: "transparent",
    color: "#eaeaea",
    cursor: "pointer",
    fontWeight: 650,
};

const btn: React.CSSProperties = btnGhost;

const card: React.CSSProperties = {
    border: "1px solid #3a3a3a",
    borderRadius: 18,
    padding: 16,
    background: "#222222",
};

const pageWrap: React.CSSProperties = {
    minHeight: "100vh",
    background: "#2b2b2b",
    color: "#fff",
    display: "flex",
    justifyContent: "center",
    alignItems: "stretch",
};

const pageInner: React.CSSProperties = {
    width: "100%",
    maxWidth: 1200,
    padding: "48px 16px",
};

const centeredTitle: React.CSSProperties = {
    textAlign: "center",
    fontSize: 44,
    fontWeight: 700,
    margin: "0 0 24px 0",
    fontFamily: "Georgia, serif",
};

const lobbyBar: React.CSSProperties = {
    display: "flex",
    width: "100%",
    gap: 14,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
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

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

function cleanName(raw: string) {
    const s = raw.trim();
    return s.length ? s : "Guest";
}


function PromptBoxTrainingExact(props: {
    prompt: string;
    typedLen: number;
    caretIndex: number;
    isTyping: boolean;
}) {
    const { prompt, typedLen, caretIndex, isTyping } = props;

    const promptBoxRef = useRef<HTMLDivElement | null>(null);

    const [caret, setCaret] = useState({ x: 0, y: 0, h: 22 });
    const caretTargetRef = useRef({ x: 0, y: 0, h: 22 });

    const rafRef = useRef<number | null>(null);
    const lastFrameRef = useRef<number>(0);

    const wordsWithStart = React.useMemo(() => {
        const words = prompt ? prompt.split(" ") : [];
        const out: { word: string; start: number }[] = [];
        let start = 0;

        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            out.push({ word: w, start });
            start += w.length;
            if (i !== words.length - 1) start += 1; // space
        }
        return out;
    }, [prompt]);


    useEffect(() => {
        lastFrameRef.current = performance.now();

        const tick = (now: number) => {
            const dt = clamp((now - lastFrameRef.current) / 1000, 0, 0.05);
            lastFrameRef.current = now;

            const SMOOTH = 28;
            const t = 1 - Math.exp(-SMOOTH * dt);
            const target = caretTargetRef.current;

            setCaret((cur) => ({
                x: lerp(cur.x, target.x, t),
                y: lerp(cur.y, target.y, t),
                h: lerp(cur.h, target.h, t),
            }));

            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        };
    }, []);


    useLayoutEffect(() => {
        const update = () => {
            const box = promptBoxRef.current;
            if (!box) return;

            const idx = Math.min(caretIndex, prompt.length);
            const el = box.querySelector<HTMLSpanElement>(`span[data-i="${idx}"]`);
            if (!el) return;

            const boxRect = box.getBoundingClientRect();
            const r = el.getBoundingClientRect();

            const x = r.left - boxRect.left;
            const y = r.top - boxRect.top;
            const h = r.height;

            caretTargetRef.current = { x, y, h };

            setCaret((cur) => {
                const dx = Math.abs(cur.x - x);
                const dy = Math.abs(cur.y - y);
                if (dx + dy > 200) return { x, y, h };
                return cur;
            });

            const padding = 18;
            const caretTop = y;
            const caretBottom = y + h;

            const viewTop = box.scrollTop;
            const viewBottom = box.scrollTop + box.clientHeight;

            if (caretBottom + padding > viewBottom) {
                box.scrollTop = caretBottom + padding - box.clientHeight;
            } else if (caretTop - padding < viewTop) {
                box.scrollTop = Math.max(0, caretTop - padding);
            }
        };

        update();
        const raf = requestAnimationFrame(update);
        window.addEventListener("resize", update);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", update);
        };
    }, [caretIndex, prompt]);

    const CARET_SCALE = 0.6;
    const caretH = Math.max(12, caret.h * CARET_SCALE);

    return (
        <div className="promptBox" ref={promptBoxRef}>
            <div
                className={`cursorCaret ${isTyping ? "typing" : "idle"}`}
                style={{
                    transform: `translate(${caret.x}px, ${caret.y + (caret.h - caretH) / 2}px)`,
                    height: `${caretH}px`,
                }}
            />

            {wordsWithStart.map(({ word, start }, wi) => {
                const isLast = wi === wordsWithStart.length - 1;

                return (
                    <span key={wi} className="word">
                        {word.split("").map((ch, j) => {
                            const i = start + j;
                            const isTyped = i < typedLen;

                            const cls = [
                                "promptChar",
                                !isTyped ? "untyped" : "correct",
                            ].join(" ");

                            return (
                                <span key={i} data-i={i} className={cls}>
                                    {ch}
                                </span>
                            );
                        })}

                        {!isLast && (() => {
                            const i = start + word.length;
                            const isTyped = i < typedLen;

                            const cls = [
                                "promptChar",
                                !isTyped ? "untyped" : "correct",
                            ].join(" ");

                            return (
                                <span key={`sp-${i}`} data-i={i} className={cls}>
                                    {"\u00A0"}
                                </span>
                            );
                        })()}
                    </span>
                );
            })}

            <span data-i={prompt.length} className="promptChar">
                {"\u200B"}
            </span>
        </div>
    );
}

function SharedWpmChart({
    samples,
    meName,
    oppName,
}: {
    samples: { t: number; me: number; opp: number }[];
    meName: string;
    oppName: string;
}) {
    const W = 900;
    const H = 260;
    const padL = 44;
    const padR = 16;
    const padT = 16;
    const padB = 32;

    if (samples.length < 2) {
        return (
            <div style={{ opacity: 0.75, fontSize: 14 }}>
                (not enough data yet to draw chart)
            </div>
        );
    }

    const tMax = Math.max(...samples.map(s => s.t), 1);
    const wMax = Math.max(...samples.map(s => Math.max(s.me, s.opp)), 10);

    const x = (t: number) => padL + (t / tMax) * (W - padL - padR);
    const y = (w: number) => padT + (1 - w / wMax) * (H - padT - padB);

    const ptsMe = samples.map(s => `${x(s.t).toFixed(2)},${y(s.me).toFixed(2)}`).join(" ");
    const ptsOp = samples.map(s => `${x(s.t).toFixed(2)},${y(s.opp).toFixed(2)}`).join(" ");

    const gridLines = 4;
    const grid = Array.from({ length: gridLines + 1 }, (_, i) => i);

    return (
        <div style={{ width: "100%", overflowX: "auto" }}>
            <svg width={W} height={H} style={{ display: "block" }}>
                {/* grid */}
                {grid.map(i => {
                    const yy = padT + (i / gridLines) * (H - padT - padB);
                    return (
                        <line
                            key={i}
                            x1={padL}
                            x2={W - padR}
                            y1={yy}
                            y2={yy}
                            stroke="#3a3a3a"
                            strokeWidth={1}
                        />
                    );
                })}

                {/* axes */}
                <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="#6a6a6a" />
                <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="#6a6a6a" />

                {/* lines */}
                <polyline fill="none" stroke="#9ad0ff" strokeWidth={2.5} points={ptsMe} />
                <polyline fill="none" stroke="#ffb3c7" strokeWidth={2.5} points={ptsOp} />

                {/* labels */}
                <text x={padL} y={H - 10} fill="#cfcfcf" fontSize="12">
                    time (s)
                </text>
                <text x={10} y={padT + 12} fill="#cfcfcf" fontSize="12">
                    WPM
                </text>

                <text x={padL} y={padT + 12} fill="#9ad0ff" fontSize="12">
                    {meName}
                </text>
                <text x={padL} y={padT + 28} fill="#ffb3c7" fontSize="12">
                    {oppName}
                </text>

                <text x={W - padR - 60} y={padT + 12} fill="#cfcfcf" fontSize="12">
                    max {Math.round(wMax)}
                </text>
            </svg>
        </div>
    );
}



export default function Multiplayer({ onExit }: { onExit: () => void }) {
    const [pid, setPid] = useState<string>("");
    const [room, setRoom] = useState<RoomState | null>(null);
    const [ridInput, setRidInput] = useState("");
    const [name, setName] = useState("");

    const [typed, setTyped] = useState("");


    const typedRef = useRef(typed);
    useEffect(() => {
        typedRef.current = typed;
    }, [typed]);

    const [isTyping, setIsTyping] = useState(false);
    const typingTimerRef = useRef<number | null>(null);

    useEffect(() => {
        setIsTyping(true);
        if (typingTimerRef.current) {
            window.clearTimeout(typingTimerRef.current);
            typingTimerRef.current = null;
        }

        typingTimerRef.current = window.setTimeout(() => setIsTyping(false), 200);

        return () => {
            if (typingTimerRef.current) {
                window.setTimeout(() => setIsTyping(false), 200);
            }
        };
    }, [typed.length]);

    const [lists, setLists] = useState<null | {
        short: string[];
        medium: string[];
        long: string[];
        mixed: string[];
    }>(null);

    const [prompt, setPrompt] = useState<string>("");
    const [isHost, setIsHost] = useState(false);

    const [view, setView] = useState<"lobby" | "battle" | "stats">("lobby");

    type WpmSample = { t: number; me: number; opp: number };

    const [wpmSamples, setWpmSamples] = useState<WpmSample[]>([]);

    const [rematchRequested, setRematchRequested] = useState(false);

    const wsRef = useRef<WSClient | null>(null);
    const lastProgressSentAt = useRef<number>(0);

    const finishSentRef = useRef(false);

    const hiddenInputRef = useRef<HTMLInputElement | null>(null);
    const acceptRoomStateRef = useRef(false);


    useEffect(() => {
        const ws = new WSClient((m: WSMsg) => {
            if (m.type === "hello") {
                setPid(m.data?.pid ?? "");
            }
            if (m.type === "room_state") {
                if (!acceptRoomStateRef.current) {
                    return;
                }
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
        setTyped("");
        finishSentRef.current = false;

        setRematchRequested(false);
    }, [room?.seed, room?.promptMode, lists]);


    const canType = room?.status === "RUNNING";
    const me = room?.players.find((p) => p.pid === pid);
    const amReady = me?.ready ?? false;

    const myStatus = me?.status ?? "NONE";
    const opponent = room?.players.find((p) => p.pid !== pid);
    const oppStatus = opponent?.status ?? "NONE";

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

        if (cursor >= prompt.length && !finishSentRef.current) {
            finishSentRef.current = true;
            wsRef.current?.send({ type: "finish", data: {} });
        }
    }, [typed, room, canType]);

    const status = room?.status ?? "NONE";
    const allFinished = room?.players?.length ? room.players.every((p) => p.status === "FINISHED") : false;

    const [clockNow, setClockNow] = useState(() => nowMs());

    useEffect(() => {
        if (!room) return;

        if (room.status !== "COUNTDOWN") return;

        const id = window.setInterval(() => {
            setClockNow(nowMs());
        }, 50);

        return () => window.clearInterval(id);
    }, [room?.status, room?.rid]);

    useEffect(() => {
        if (view !== "battle") return;
        if (!room) return;
        if (room.status !== "RUNNING") return;

        const id = window.setTimeout(() => hiddenInputRef.current?.focus(), 0);
        return () => window.clearTimeout(id);
    }, [view, room?.status, room?.rid]);

    useEffect(() => {
        if (!room) return;
        if (room.status !== "RUNNING") return;

        const id = window.setInterval(() => {
            const meP = room.players.find(p => p.pid === pid);
            const opP = room.players.find(p => p.pid !== pid);

            const t = Math.max(0, (nowMs() - room.startAtMs) / 1000);

            setWpmSamples(prev => {
                const next = prev.concat({ t, me: meP?.wpm ?? 0, opp: opP?.wpm ?? 0 });

                if (next.length > 600) {
                    return next.slice(next.length - 600);
                }
                return next;
            });
        }, 250);

        return () => window.clearInterval(id);
    }, [room?.status, room?.startAtMs, room?.rid, pid]);


    useEffect(() => {
        if (!room) {
            setView("lobby");
            return;
        }

        if (room.status === "LOBBY") {
            setView("lobby");
            return;
        }

        if (room.status === "COUNTDOWN" || room.status === "RUNNING") {
            setView("battle");
            return;
        }

        if (room.status === "FINISHED") {
            const done = room.players.length > 0 && room.players.every(p => p.status === "FINISHED");
            setView(done ? "stats" : "battle");
        }
    }, [room?.rid, room?.status]);


    const resetLocalRound = () => {
        setTyped("");
        finishSentRef.current = false;
        setRematchRequested(false);
    };

    const resetToLobbyScreen = () => {
        acceptRoomStateRef.current = false;
        setRoom(null);
        setIsHost(false);
        setRidInput("");
        setView("lobby");
        resetLocalRound();
    };

    const onBack = () => {
        if (view === "battle") {
            setView("lobby");
            return;
        }

        if (!room?.rid) {
            acceptRoomStateRef.current = false;
            onExit();
            return;
        }

        acceptRoomStateRef.current = false;
        wsRef.current?.send({ type: "leave_room", data: {} });
        resetToLobbyScreen();
    }


    const countdownMs = room ? room.startAtMs - clockNow : 0;
    const startsInSec = Math.max(0, Math.ceil(countdownMs / 1000));


    const BATTLE_SHIFT_PX = 225;


    return (
        <div style={{
            ...pageWrap,
            alignItems: view === "lobby" ? "center" : "stretch",
        }}
        >
            <div style={{
                ...pageInner,
                display: "flex",
                flexDirection: "column",
                justifyContent: view === "lobby" ? "center" : "flex-start",
            }}
            >
                <div
                    style={{
                        position: "relative",
                        width: "100%",
                        display: "flex",
                        justifyContent: "center",
                        marginBottom: 18,
                    }}
                >
                    <h1 style={{ ...centeredTitle, margin: 0 }}>Multiplayer</h1>

                    <button
                        style={{ ...btnGhost, position: "absolute", right: 0, top: 0, zIndex: 10 }}
                        onClick={onBack}
                    >
                        Back
                    </button>
                </div>


                {/* Lobby */}
                {(view === "lobby") && (
                    <div style={lobbyBar}>
                        <div style={card}>
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <span>Name</span>
                                    <input
                                        placeholder="Rick"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        style={{ padding: 10, borderRadius: 10, border: "1px solid #3a3a3a", background: "#1f1f1f", color: "#eaeaea", outline: "none", }}
                                    />
                                </label>

                                <button style={btn} onClick={() => wsRef.current?.send({ type: "set_name", data: { name: cleanName(name) } })}>
                                    Set name
                                </button>

                                {!room && (
                                    <>
                                        <button
                                            style={btn}
                                            onClick={() => {
                                                acceptRoomStateRef.current = true;
                                                setIsHost(true);
                                                wsRef.current?.send({ type: "create_room", data: { name: cleanName(name) } });
                                            }}
                                        >
                                            Create room
                                        </button>

                                        <input
                                            placeholder="Room code"
                                            value={ridInput}
                                            onChange={(e) => setRidInput(e.target.value)}
                                            style={{ padding: 10, borderRadius: 10, border: "1px solid #3a3a3a", background: "#1f1f1f", color: "#eaeaea", outline: "none", }}
                                        />
                                        <button
                                            style={btnGhost}
                                            onClick={() => {
                                                acceptRoomStateRef.current = true;
                                                setIsHost(false);
                                                wsRef.current?.send({ type: "join_room", rid: ridInput, data: { name: cleanName(name) } });
                                            }}
                                        >
                                            Join room
                                        </button>
                                    </>
                                )}

                                {room && (
                                    <>

                                        <button
                                            style={amReady ? btn : btnGhost}
                                            onClick={() => {
                                                acceptRoomStateRef.current = true;
                                                wsRef.current?.send({ type: "ready", data: { ready: !amReady } })
                                            }
                                            }
                                        >
                                            {amReady ? "Unready" : "Ready"}
                                        </button>


                                        {room && isHost && room.status === "LOBBY" && (
                                            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                                <span style={{ fontSize: 13, opacity: 0.9, color: "#eaeaea" }}>Mode</span>

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
                                            <b>{p.name}</b> {p.pid === pid ? "(you)" : ""}{" "}
                                            <span
                                                style={{
                                                    marginLeft: 8,
                                                    padding: "2px 8px",
                                                    borderRadius: 999,
                                                    border: "1px solid #3a3a3a",
                                                    fontSize: 12,
                                                    opacity: 0.9,
                                                }}
                                            >
                                                {p.ready ? "Ready" : "Not ready"}
                                            </span>

                                        </li>
                                    ))}
                                </ul>
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
                        <div style={{ padding: 24, display: "flex", justifyContent: "flex-end", transform: `translateX(-${BATTLE_SHIFT_PX}px)` }}>
                            <div style={{ width: "100%", maxWidth: 560 }}>
                                {/* Left side, me */}
                                <div style={card}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                        <h3 style={{ margin: 0 }}>You</h3>

                                        <div style={{ fontSize: 14, opacity: 0.8 }}>
                                            {status === "COUNTDOWN" ? `Starting in ${startsInSec}s` : ""}
                                            {status === "RUNNING" && myStatus !== "FINISHED" ? "Go!" : ""}
                                            {myStatus === "FINISHED" ? "Finished" : ""}
                                        </div>
                                    </div>

                                    <div
                                        className="typeArea"
                                        onClick={() => hiddenInputRef.current?.focus()}
                                        style={{ marginTop: 18, cursor: room.status === "RUNNING" ? "text" : "default" }}
                                    >
                                        <input
                                            ref={hiddenInputRef}
                                            value={typed}
                                            onChange={(e) => {
                                                // take raw input, clamp to prompt length
                                                const next = e.target.value.slice(0, prompt.length);
                                                setTyped(next);
                                            }}
                                            disabled={room.status !== "RUNNING"}
                                            style={{
                                                position: "absolute",
                                                opacity: 0,
                                                pointerEvents: "none",
                                                left: 0,
                                                top: 0,
                                                height: 1,
                                                width: 1,
                                            }}
                                        />

                                        {prompt ? (

                                            <PromptBoxTrainingExact
                                                prompt={prompt}
                                                typedLen={typed.length}
                                                caretIndex={typed.length}
                                                isTyping={isTyping}
                                            />
                                        ) : (
                                            "(loading prompt...)"
                                        )}
                                    </div>


                                    <div style={{ fontSize: 14, opacity: 0.8 }}>

                                        {myStatus === "FINISHED" ? "Finished" : ""}
                                    </div>


                                    <div style={{ marginTop: 10, display: "flex", gap: 10 }}>

                                        {room.status === "FINISHED" && allFinished && (
                                            <button
                                                style={btn}
                                                disabled={rematchRequested}
                                                onClick={() => {
                                                    setRematchRequested(true);
                                                    finishSentRef.current = false;
                                                    setTyped("");


                                                    wsRef.current?.send({ type: "restart_round", data: { ready: true } });
                                                }}
                                            >
                                                {rematchRequested ? "Waiting for opponent..." : "Play again"}
                                            </button>
                                        )}

                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* border */}
                        <div style={{ background: "#3a3a3a" }} />

                        <div style={{ padding: 24, display: "flex", justifyContent: "flex-start", transform: `translateX(${BATTLE_SHIFT_PX}px)`, }}>
                            <div style={{ width: "100%", maxWidth: 560 }}>
                                {/* Right side, opponents */}
                                <div style={card}>
                                    <h3 style={{ marginTop: 0 }}>Opponent</h3>

                                    {room.players.filter((p) => p.pid !== pid).length === 0 ? (
                                        <div style={{ opacity: 0.7 }}>Waiting for someone to join…</div>
                                    ) : (
                                        room.players
                                            .filter((p) => p.pid !== pid)
                                            .slice(0, 1)
                                            .map((p) => (
                                                <div
                                                    style={{
                                                        marginTop: 18,
                                                    }}
                                                >
                                                    <div
                                                        className="typeArea"
                                                        style={{
                                                            cursor: "default",
                                                        }}
                                                    >
                                                        {prompt ? (
                                                            <PromptBoxTrainingExact
                                                                prompt={prompt}
                                                                typedLen={p.cursor}
                                                                caretIndex={p.cursor}
                                                                isTyping={true}
                                                            />
                                                        ) : (
                                                            "(loading prompt...)"
                                                        )}
                                                    </div>
                                                </div>
                                            ))
                                    )}

                                    <div style={{ fontSize: 14, opacity: 0.8, marginTop: 6 }}>
                                        {oppStatus === "FINISHED" ? "Finished" : ""}
                                    </div>

                                    {/* finish  */}
                                    {status === "FINISHED" && (
                                        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #3a3a3a" }}>
                                            <b>Race finished.</b>{" "}
                                        </div>
                                    )}
                                </div>

                            </div>
                        </div>
                    </div>
                )}

                {view === "stats" && room && (
                    <div style={{ display: "flex", justifyContent: "center" }}>
                        <div style={{ width: "100%", maxWidth: 980 }}>
                            <div style={card}>
                                <h2 style={{ marginTop: 0 }}>Race Results</h2>

                                <SharedWpmChart
                                    samples={wpmSamples}
                                    meName={me?.name ?? "You"}
                                    oppName={opponent?.name ?? "Opponent"}
                                />

                                <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
                                    <div style={{ ...card, flex: 1, minWidth: 220 }}>
                                        <div style={{ fontSize: 12, opacity: 0.8 }}>You</div>
                                        <div style={{ fontSize: 22, fontWeight: 800 }}>{me?.wpm ?? 0} WPM</div>
                                        <div style={{ fontSize: 14, opacity: 0.85 }}>{me?.acc ?? 0}% acc</div>
                                    </div>

                                    <div style={{ ...card, flex: 1, minWidth: 220 }}>
                                        <div style={{ fontSize: 12, opacity: 0.8 }}>Opponent</div>
                                        <div style={{ fontSize: 22, fontWeight: 800 }}>{opponent?.wpm ?? 0} WPM</div>
                                        <div style={{ fontSize: 14, opacity: 0.85 }}>{opponent?.acc ?? 0}% acc</div>
                                    </div>
                                </div>

                                <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 10 }}>
                                    <button
                                        style={btn}
                                        disabled={rematchRequested}
                                        onClick={() => {
                                            setRematchRequested(true);
                                            finishSentRef.current = false;
                                            setTyped("");
                                            wsRef.current?.send({ type: "restart_round", data: {} });
                                        }}
                                    >
                                        {rematchRequested ? "Waiting for opponent..." : "Play again"}
                                    </button>

                                    <div style={{ fontSize: 13, opacity: 0.75, alignSelf: "center" }}>
                                        When both click Play again, you’ll get a new prompt + new countdown.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>

    );
}