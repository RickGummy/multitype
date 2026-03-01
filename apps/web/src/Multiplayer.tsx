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




export default function Multiplayer({ onExit }: { onExit: () => void }) {
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

    const [wpmSamples, setWpmSamples] = useState<WpmSample[]>([]);

    const [rematchRequested, setRematchRequested] = useState(false);
    const [showGoOverlay, setShowGoOverlay] = useState(false);
    const prevStatusRef = useRef<string | null>(null);

    const wsRef = useRef<WSClient | null>(null);
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

    const [finalStats, setFinalStats] = useState<null | {
        seed: number;
        meName: string; meWpm: number; meAcc: number;
        oppName: string; oppWpm: number; oppAcc: number;
        samples: WpmSample[];
    }>(null);

    useEffect(() => {
        if (!room) return;
        if (room.status !== "FINISHED") return;
        const done = room.players.length > 0 && room.players.every(p => p.status === "FINISHED");
        if (!done) return;

        // only snapshot once per round
        if (finalStats && finalStats.seed === room.seed) return;

        const meP = room.players.find(p => p.pid === pid);
        const opP = room.players.find(p => p.pid !== pid);

        setFinalStats({
            seed: room.seed,
            meName: meP?.name ?? "You",
            meWpm: meP?.wpm ?? 0,
            meAcc: meP?.acc ?? 0,
            oppName: opP?.name ?? "Opponent",
            oppWpm: opP?.wpm ?? 0,
            oppAcc: opP?.acc ?? 0,
            samples: wpmSamples,
        });
    }, [room?.status, room?.seed, room?.players, pid, wpmSamples, finalStats]);


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

        if (view === "stats") return;

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

        if (room?.rid) {
            acceptRoomStateRef.current = false;
            wsRef.current?.send({ type: "leave_room", data: {} });
            setRoom(null);
            setIsHost(false);
            setRidInput("");
            setPrompt("");
            setTyped("");
            setWpmSamples([]);
            setRematchRequested(false);
            finishSentRef.current = false;

            onExit();
            return;
        }

        acceptRoomStateRef.current = false;
        resetToLobbyScreen();
    }


    const countdownMs = room ? room.startAtMs - clockNow : 0;
    const startsInSec = Math.max(0, Math.ceil(countdownMs / 1000));
    const overlayVisible = room?.status === "COUNTDOWN" || showGoOverlay;
    const overlayLabel = showGoOverlay ? "GO!" : (startsInSec > 0 ? String(startsInSec) : "GO!");


    const BATTLE_SHIFT_PX = 225;


    return (
        <div style={{
            ...pageWrap,
            alignItems: view === "lobby" ? "center" : "stretch",
        }}
        >
            {/* Fullscreen countdown overlay */}
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
                        color: showGoOverlay ? "#4ade80" : "#ffffff",
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

                                                // Block all forward typing while there is an error (uses ref, not stale closure)
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
                                                errorIndex={errorIndex}
                                            />
                                        ) : (
                                            "(loading prompt...)"
                                        )}
                                    </div>


                                    <div style={{ fontSize: 14, opacity: 0.8 }}>

                                        {myStatus === "FINISHED" ? "Finished" : ""}
                                    </div>



                                </div>
                            </div>
                        </div>

                        {/* border */}
                        <div style={{ background: "#3a3a3a" }} />

                        <div style={{ padding: 24, display: "flex", justifyContent: "flex-start", transform: `translateX(${BATTLE_SHIFT_PX}px)`, }}>
                            <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
                                {/* Right side, opponents (up to 2) */}
                                {opponents.length === 0 ? (
                                    <div style={{ ...card }}>
                                        <div style={{ opacity: 0.7 }}>Waiting for someone to join…</div>
                                    </div>
                                ) : (
                                    opponents.slice(0, 2).map((p, i) => {
                                        const color = RACER_COLORS[i + 1] ?? RACER_COLORS[1];
                                        return (
                                            <div key={p.pid} style={card}>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                                    <h3 style={{ margin: 0, color }}>
                                                        {p.name || `Racer ${i + 2}`}
                                                    </h3>
                                                    <div style={{ fontSize: 14, opacity: 0.8 }}>
                                                        {p.status === "FINISHED" ? "Finished" : ""}
                                                    </div>
                                                </div>
                                                <div className="typeArea" style={{ marginTop: 18, cursor: "default" }}>
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
                                        );
                                    })
                                )}
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
                                    players={playerLines}
                                />

                                <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
                                    {room.players
                                        .slice()
                                        .sort((a, b) => (b.wpm ?? 0) - (a.wpm ?? 0))
                                        .map((p, i) => {
                                            const line = playerLines.find((l) => l.pid === p.pid);
                                            const label = p.pid === pid ? "You" : (p.name || `Racer ${i + 1}`);
                                            return (
                                                <div key={p.pid} style={{ ...card, flex: 1, minWidth: 180 }}>
                                                    <div style={{ fontSize: 12, opacity: 0.8, color: line?.color }}>
                                                        {i === 0 ? "🥇 " : ""}{label}
                                                    </div>
                                                    <div style={{ fontSize: 22, fontWeight: 800 }}>{p.wpm ?? 0} WPM</div>
                                                    <div style={{ fontSize: 14, opacity: 0.85 }}>{p.acc ?? 0}% acc</div>
                                                </div>
                                            );
                                        })}
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
                                        {rematchRequested ? "Waiting for others…" : "Play again"}
                                    </button>

                                    <div style={{ fontSize: 13, opacity: 0.75, alignSelf: "center" }}>
                                        All players must click Play again to start a new round.
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