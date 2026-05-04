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



function nowMs() {
    return Date.now();
}

function computeWpmFromCursor(cursor: number, elapsedMs: number) {
    const minutes = Math.max(0.001, elapsedMs / 60000);
    return (cursor / 5) / minutes;
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
    errorIndex?: number | null;
}) {
    const { prompt, typedLen, caretIndex, isTyping, errorIndex } = props;

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

                            const isError = errorIndex != null && i === errorIndex;
                            const cls = [
                                "promptChar",
                                isError ? "wrong" : (!isTyped ? "untyped" : "correct"),
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

                            const isError = errorIndex != null && i === errorIndex;
                            const cls = [
                                "promptChar",
                                isError ? "wrong" : (!isTyped ? "untyped" : "correct"),
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

const RACER_COLORS = ["#ff4d4d", "#4da3ff", "#4ade80"] as const;

type WpmSample = { tSec: number; wpm: Record<string, number> };

function SharedWpmChart(props: {
    samples: WpmSample[];
    players: { pid: string; name: string; color: string }[];
}) {
    const { samples, players } = props;

    const W = 900;
    const H = 220;
    const padL = 48;
    const padR = 16;
    const padT = 18;
    const padB = 44;

    const minT = 1;
    const secAt = (tSec: number) => Math.max(minT, Math.floor(tSec));

    if (!samples || samples.length < 2) {
        return (
            <div className="card" style={{ minWidth: 0 }}>
                <div className="cardLabel">Not enough data yet (type longer).</div>
            </div>
        );
    }

    const maxT = secAt(samples[samples.length - 1].tSec);
    const tSpan = Math.max(1, maxT - minT);

    const x0 = padL;
    const x1 = W - padR;
    const y0 = H - padB;
    const y1 = padT;

    const allVals = samples.flatMap((s) => Object.values(s.wpm));
    const maxWpm = Math.max(10, ...allVals);
    const minWpm = Math.min(1, ...allVals);
    const span = Math.max(1, maxWpm - minWpm);

    const toX = (t: number) => x0 + ((x1 - x0) * (t - minT)) / tSpan;
    const toY = (wpm: number) => y0 - (y0 - y1) * ((wpm - minWpm) / span);

    const yTicks = 4;
    const xTickStep = maxT <= 15 ? 1 : maxT <= 40 ? 2 : maxT <= 90 ? 5 : 10;

    return (
        <div className="card" style={{ minWidth: 0 }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="260">
                {Array.from({ length: yTicks + 1 }).map((_, i) => {
                    const frac = i / yTicks;
                    const y = y0 - (y0 - y1) * frac;
                    return (
                        <g key={`y-${i}`}>
                            <line x1={x0} x2={x1} y1={y} y2={y} stroke="currentColor" opacity="0.12" />
                            <text x={x0 - 8} y={y + 4} textAnchor="end" fontSize="12" fill="currentColor" opacity="0.6">
                                {(minWpm + span * frac).toFixed(0)}
                            </text>
                        </g>
                    );
                })}

                {Array.from({ length: Math.floor((maxT - minT) / xTickStep) + 1 }).map((_, i) => {
                    const t = minT + i * xTickStep;
                    const x = toX(t);
                    return (
                        <g key={`x-${i}`}>
                            <line x1={x} x2={x} y1={y1} y2={y0} stroke="currentColor" opacity="0.10" />
                            <text x={x} y={y0 + 18} textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.6">
                                {t}s
                            </text>
                        </g>
                    );
                })}

                <text x={(x0 + x1) / 2} y={H - 10} textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.75">
                    Time (seconds)
                </text>
                <text x={14} y={(y0 + y1) / 2} textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.75" transform={`rotate(-90 14 ${(y0 + y1) / 2})`}>
                    WPM
                </text>

                {players.map((p) => {
                    const poly = samples
                        .map((s) => {
                            const t = Math.max(minT, secAt(s.tSec));
                            return `${toX(t)},${toY(s.wpm[p.pid] ?? 0)}`;
                        })
                        .join(" ");
                    return <polyline key={p.pid} points={poly} fill="none" stroke={p.color} strokeWidth="3" opacity="0.95" />;
                })}

                {players.map((p, i) => (
                    <text key={p.pid} x={x0} y={padT + 14 + i * 16} fill={p.color} fontSize="12">
                        {p.name}
                    </text>
                ))}
            </svg>

            <div className="cardLabel" style={{ marginTop: 6 }}>
                {samples.length} samples · peak {maxWpm.toFixed(1)} WPM
            </div>
        </div>
    );
}




export default function Multiplayer({ onExit, token }: { onExit: () => void; token?: string }) {
    const [pid, setPid] = useState<string>("");
    const [room, setRoom] = useState<RoomState | null>(null);
    const [ridInput, setRidInput] = useState("");
    const [name, setName] = useState("");

    const [typed, setTyped] = useState("");

    const [errorIndex, setErrorIndex] = useState<number | null>(null);
    const errorIndexRef = useRef<number | null>(null);
    const [mistakeCount, setMistakeCount] = useState(0);


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
    const [joinError, setJoinError] = useState<string | null>(null);

    const [wpmSamples, setWpmSamples] = useState<WpmSample[]>([]);

    const [rematchRequested, setRematchRequested] = useState(false);
    const [showGoOverlay, setShowGoOverlay] = useState(false);
    const prevStatusRef = useRef<string | null>(null);

    const wsRef = useRef<WSClient | null>(null);
    const tokenRef = useRef(token);
    useEffect(() => { tokenRef.current = token; }, [token]);
    const lastProgressSentAt = useRef<number>(0);

    const finishSentRef = useRef(false);

    const hiddenInputRef = useRef<HTMLInputElement | null>(null);
    const acceptRoomStateRef = useRef(false);

    const roomRef = useRef<RoomState | null>(null);

    useEffect(() => {
        roomRef.current = room;
    }, [room]);

    useEffect(() => {
        const ws = new WSClient((m: WSMsg) => {
            if (m.type === "hello") {
                const d = m.data as { pid?: string } | undefined;
                setPid(d?.pid ?? "");
                if (tokenRef.current) {
                    ws.send({ type: "auth", data: { token: tokenRef.current } });
                }
            }
            if (m.type === "room_state") {
                if (!acceptRoomStateRef.current) {
                    return;
                }
                setRoom(m.data as RoomState);
            }
            if (m.type === "error") {
                const errMap: Record<string, string> = {
                    "room not found":   "Room not found. Check the code and try again.",
                    "room unavailable": "This room is full or already in progress.",
                    "missing rid":      "Please enter a room code.",
                };
                setJoinError(errMap[m.err ?? ""] ?? m.err ?? "Something went wrong.");
                acceptRoomStateRef.current = false;
            }
            if (m.type === "player_progress") {
                const d = m.data as {
                    pid: string;
                    cursor: number;
                    mistakes: number;
                    wpm: number;
                    acc: number;
                    status: string;
                };
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
        errorIndexRef.current = null;
        setErrorIndex(null);
        setMistakeCount(0);
        setWpmSamples([]);
        setRematchRequested(false);
        finishSentRef.current = false;

        setRematchRequested(false);
    }, [room?.seed, room?.promptMode, lists]);


    const me = room?.players.find((p) => p.pid === pid);
    const amReady = me?.ready ?? false;

    const myStatus = me?.status ?? "NONE";
    const opponents = room?.players.filter((p) => p.pid !== pid) ?? [];

    // Assign stable colors: me=red, opp1=blue, opp2=green
    const playerLines = room ? [
        { pid, color: RACER_COLORS[0], name: me?.name || "You" },
        ...opponents.map((p, i) => ({
            pid: p.pid,
            color: RACER_COLORS[i + 1] ?? RACER_COLORS[1],
            name: p.name || `Racer ${i + 2}`,
        })),
    ] : [];

    useEffect(() => {
        if (!room || room.status !== "RUNNING" || !prompt) return;

        const t = nowMs();
        if (t - lastProgressSentAt.current < 120) return;

        const cursor = typed.length;
        const mistakes = mistakeCount;

        wsRef.current?.send({ type: "progress", data: { cursor, mistakes } });
        lastProgressSentAt.current = t;

        if (cursor >= prompt.length && errorIndex == null && !finishSentRef.current) {
            finishSentRef.current = true;
            wsRef.current?.send({ type: "finish", data: {} });
        }

    }, [typed, mistakeCount, errorIndex, room?.status, room?.rid, prompt]);


    const [clockNow, setClockNow] = useState(() => nowMs());

    useEffect(() => {
        if (!room) return;

        if (room.status !== "COUNTDOWN") return;

        const id = window.setInterval(() => {
            setClockNow(nowMs());
        }, 50);

        return () => window.clearInterval(id);
    }, [room?.status, room?.rid]);

    // Show "GO!" overlay briefly when COUNTDOWN → RUNNING transition fires
    useEffect(() => {
        if (!room) return;
        const prev = prevStatusRef.current;
        prevStatusRef.current = room.status;
        if (prev === "COUNTDOWN" && room.status === "RUNNING") {
            setShowGoOverlay(true);
            const t = window.setTimeout(() => setShowGoOverlay(false), 800);
            return () => window.clearTimeout(t);
        }
    }, [room?.status]);

    useEffect(() => {
        if (view !== "battle") return;
        if (!room) return;
        if (room.status !== "RUNNING") return;

        const id = window.setTimeout(() => hiddenInputRef.current?.focus(), 0);
        return () => window.clearTimeout(id);
    }, [view, room?.status, room?.rid]);

    useEffect(() => {
        if (!room || room.status !== "RUNNING") return;
      
        const startMs = room.startAtMs;
        setWpmSamples([]);
      
        let lastSec = -1;
      
        const id = window.setInterval(() => {
          const r = roomRef.current;
          if (!r) return;

          const tSec = (nowMs() - startMs) / 1000;
          const sec = Math.max(1, Math.floor(tSec));
          if (sec === lastSec) return;
          lastSec = sec;

          const elapsedMs = nowMs() - startMs;
          const wpm: Record<string, number> = {};
          for (const p of r.players) {
              wpm[p.pid] = p.status === "FINISHED"
                  ? (p.wpm ?? 0)
                  : computeWpmFromCursor(p.cursor, elapsedMs);
          }

          setWpmSamples(prev => [...prev, { tSec: sec, wpm }]);
        }, 50);
      
        return () => window.clearInterval(id);
      }, [room?.status, room?.startAtMs, pid]);
      




    useEffect(() => {
        if (!room) {
            setView("lobby");
            return;
        }

        // Keep stats visible while the race is finished; transition away for any other status
        if (view === "stats" && room.status === "FINISHED") return;

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
        setJoinError(null);
        setView("lobby");
        resetLocalRound();
    };

    const onBack = () => {
        if (room?.rid) {
            // Leave the current room and return to the Multiplayer lobby screen
            wsRef.current?.send({ type: "leave_room", data: {} });
            resetToLobbyScreen();
            return;
        }

        // Not in a room — exit back to the main app
        onExit();
    }


    const countdownMs = room ? room.startAtMs - clockNow : 0;
    const startsInSec = Math.max(0, Math.ceil(countdownMs / 1000));
    const overlayVisible = room?.status === "COUNTDOWN" || showGoOverlay;
    const overlayLabel = showGoOverlay ? "GO!" : (startsInSec > 0 ? String(startsInSec) : "GO!");



    return (
        <div className="page" style={{ alignItems: view === "lobby" ? "center" : "flex-start" }}>
            {overlayVisible && (
                <div style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.93)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000,
                    flexDirection: "column",
                    gap: 16,
                }}>
                    <div style={{
                        fontSize: 140,
                        fontWeight: 900,
                        color: showGoOverlay ? "#4ade80" : "var(--text)",
                        lineHeight: 1,
                        letterSpacing: -4,
                    }}>
                        {overlayLabel}
                    </div>
                    {!showGoOverlay && (
                        <div style={{ fontSize: 16, opacity: 0.5, letterSpacing: 2, textTransform: "uppercase" }}>
                            get ready
                        </div>
                    )}
                </div>
            )}

            <div className="container">
                <h1 className="title">Multiplayer</h1>

                {view === "lobby" && (
                    <>
                        {!room ? (
                            <div className="settingsCard">
                                <div className="settingsRow">
                                    <input
                                        className="input"
                                        placeholder="Your name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        style={{ maxWidth: 280 }}
                                    />
                                    <button
                                        className="btn"
                                        onClick={() => wsRef.current?.send({ type: "set_name", data: { name: cleanName(name) } })}
                                    >
                                        Set name
                                    </button>
                                </div>

                                <div className="settingsRow">
                                    <button
                                        className="btn primary"
                                        onClick={() => {
                                            acceptRoomStateRef.current = true;
                                            setIsHost(true);
                                            wsRef.current?.send({ type: "create_room", data: { name: cleanName(name) } });
                                        }}
                                    >
                                        Create room
                                    </button>

                                    <div style={{ display: "flex", gap: 10, alignItems: "center", flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
                                        <input
                                            className="input"
                                            placeholder="Room code"
                                            value={ridInput}
                                            onChange={(e) => { setRidInput(e.target.value); setJoinError(null); }}
                                            style={{ maxWidth: 200 }}
                                        />
                                        <button
                                            className="btn"
                                            onClick={() => {
                                                setJoinError(null);
                                                acceptRoomStateRef.current = true;
                                                setIsHost(false);
                                                wsRef.current?.send({ type: "join_room", rid: ridInput, data: { name: cleanName(name) } });
                                            }}
                                        >
                                            Join
                                        </button>
                                    </div>
                                </div>

                                {joinError && (
                                    <div style={{ color: "var(--danger)", fontSize: 13 }}>
                                        {joinError}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="settingsCard">
                                    <div className="settingsRow">
                                        <div>
                                            <div className="cardLabel">Room</div>
                                            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                                                {room.rid}
                                            </div>
                                        </div>

                                        <button
                                            className={`btn ${amReady ? "" : "primary"}`}
                                            onClick={() => {
                                                acceptRoomStateRef.current = true;
                                                wsRef.current?.send({ type: "ready", data: { ready: !amReady } });
                                            }}
                                        >
                                            {amReady ? "Unready" : "Ready"}
                                        </button>
                                    </div>

                                    {isHost && room.status === "LOBBY" && (
                                        <div className="settingsRow">
                                            <span className="mutedSmall">Mode</span>
                                            <div className="pillRow">
                                                {(["short", "medium", "long", "mixed"] as const).map((m) => (
                                                    <button
                                                        key={m}
                                                        className={`pill ${room.promptMode === m ? "active" : ""}`}
                                                        onClick={() => wsRef.current?.send({ type: "set_prompt_mode", data: { promptMode: m } })}
                                                    >
                                                        {m}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="card" style={{ marginTop: 12 }}>
                                    <div className="cardLabel" style={{ marginBottom: 10 }}>Players</div>
                                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                                        {room.players.map((p) => {
                                            const line = playerLines.find((l) => l.pid === p.pid);
                                            return (
                                                <li key={p.pid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                    <span style={{ color: line?.color ?? "var(--text)", fontWeight: 700 }}>
                                                        {p.name}{p.pid === pid ? " (you)" : ""}
                                                    </span>
                                                    <span className="mutedSmall" style={{ color: p.ready ? "#4ade80" : "var(--muted)" }}>
                                                        {p.ready ? "Ready" : "Waiting"}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            </>
                        )}

                        <div className="row center" style={{ marginTop: 14 }}>
                            <button className="btn" onClick={onBack}>Back</button>
                        </div>
                    </>
                )}

                {view === "battle" && room && (
                    <>
                        <div
                            className="typeArea"
                            onClick={() => hiddenInputRef.current?.focus()}
                            style={{ cursor: room.status === "RUNNING" ? "text" : "default" }}
                        >
                            <input
                                ref={hiddenInputRef}
                                value={typed}
                                readOnly
                                onKeyDown={(e) => {
                                    if (!room) return;
                                    if (room.status !== "RUNNING") return;
                                    if (!prompt) return;

                                    if (e.key === "Tab") { e.preventDefault(); return; }
                                    if (e.metaKey || e.ctrlKey || e.altKey) return;

                                    if (e.key === "Backspace") {
                                        e.preventDefault();
                                        if (errorIndexRef.current != null) {
                                            errorIndexRef.current = null;
                                            setErrorIndex(null);
                                            setTyped((prev) => prev.slice(0, -1));
                                            return;
                                        }
                                        setTyped((prev) => prev.slice(0, -1));
                                        return;
                                    }

                                    if (e.key === " ") e.preventDefault();

                                    const isPrintable = e.key.length === 1;
                                    if (!isPrintable) return;

                                    if (errorIndexRef.current != null) {
                                        e.preventDefault();
                                        return;
                                    }

                                    const i = typedRef.current.length;
                                    if (i >= prompt.length) return;

                                    const expected = prompt[i];
                                    const got = e.key;

                                    if (got !== expected) {
                                        errorIndexRef.current = i;
                                        setErrorIndex(i);
                                        setTyped(prev => prev + got);
                                        setMistakeCount((x) => x + 1);
                                        return;
                                    }

                                    e.preventDefault();
                                    setTyped((prev) => (prev + got).slice(0, prompt.length));
                                }}
                                disabled={room.status !== "RUNNING"}
                                style={{ position: "absolute", opacity: 0, pointerEvents: "none", left: 0, top: 0, height: 1, width: 1 }}
                            />

                            {prompt ? (
                                <PromptBoxTrainingExact
                                    prompt={prompt}
                                    typedLen={typed.length}
                                    caretIndex={typed.length}
                                    isTyping={isTyping}
                                    errorIndex={errorIndex}
                                />
                            ) : (
                                <div className="promptBox" style={{ opacity: 0.6 }}>(loading prompt…)</div>
                            )}
                        </div>

                        {myStatus === "FINISHED" && (
                            <div className="mutedSmall" style={{ textAlign: "center", marginTop: 10 }}>
                                You finished — waiting for opponents…
                            </div>
                        )}

                        {opponents.length > 0 && (
                            <div style={{ marginTop: 18 }}>
                                <div className="cardLabel" style={{ marginBottom: 8 }}>Racing against</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    {opponents.slice(0, 2).map((p, i) => {
                                        const color = RACER_COLORS[i + 1] ?? RACER_COLORS[1];
                                        const total = prompt.length || 1;
                                        const pct = Math.min(100, Math.round((p.cursor / total) * 100));
                                        return (
                                            <div key={p.pid} className="card">
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                                                    <span style={{ color, fontWeight: 700 }}>
                                                        {p.name || `Racer ${i + 2}`}
                                                    </span>
                                                    <span className="mutedSmall">
                                                        {(p.wpm ?? 0).toFixed(0)} WPM · {pct}%{p.status === "FINISHED" ? " · finished" : ""}
                                                    </span>
                                                </div>
                                                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                                                    <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 120ms linear" }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="row center" style={{ marginTop: 14 }}>
                            <button className="btn" onClick={onBack}>Back</button>
                        </div>
                    </>
                )}

                {view === "stats" && room && (
                    <>
                        <div className="statsGrid">
                            {room.players
                                .slice()
                                .sort((a, b) => (b.wpm ?? 0) - (a.wpm ?? 0))
                                .map((p, i) => {
                                    const line = playerLines.find((l) => l.pid === p.pid);
                                    const label = p.pid === pid ? "You" : (p.name || `Racer ${i + 1}`);
                                    const place = i === 0 ? "1st" : i === 1 ? "2nd" : "3rd";
                                    return (
                                        <div key={p.pid} className="card">
                                            <div className="cardLabel" style={{ color: line?.color }}>
                                                {place} · {label}
                                            </div>
                                            <div className="cardValue">{(p.wpm ?? 0).toFixed(1)}</div>
                                            <div className="mutedSmall">{(p.acc ?? 0).toFixed(0)}% accuracy</div>
                                        </div>
                                    );
                                })}
                        </div>

                        <div style={{ marginTop: 16 }}>
                            <div className="cardLabel" style={{ marginBottom: 8 }}>WPM over time</div>
                            <SharedWpmChart samples={wpmSamples} players={playerLines} />
                        </div>

                        <div className="settingsCard">
                            <div className="cardLabel" style={{ marginBottom: 8 }}>
                                Rematch — both players must click Play again to start a new round with a new prompt.
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {room.players.map((p) => {
                                    const line = playerLines.find((l) => l.pid === p.pid);
                                    const label = p.pid === pid ? `${p.name || "You"} (you)` : (p.name || "Opponent");
                                    return (
                                        <span
                                            key={p.pid}
                                            className="pill"
                                            style={{
                                                color: line?.color,
                                                borderColor: p.ready ? "#4ade80" : undefined,
                                                opacity: 1,
                                                cursor: "default",
                                            }}
                                        >
                                            {label} · {p.ready ? "✓ Ready" : "Waiting"}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="row center" style={{ marginTop: 16 }}>
                            <button
                                className={`btn ${rematchRequested ? "" : "primary"}`}
                                disabled={rematchRequested}
                                onClick={() => {
                                    setRematchRequested(true);
                                    finishSentRef.current = false;
                                    setTyped("");
                                    wsRef.current?.send({ type: "restart_round", data: {} });
                                }}
                            >
                                {rematchRequested ? "Waiting for others…" : "Play again"}
                            </button>
                            <button className="btn" onClick={onBack}>Leave room</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
