import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import "./App.css";
import { WSClient } from "./net/ws";
import type { WSMsg } from "./net/ws"
import type { RoomState, PlayerState } from "./net/types";
import { EXPECTED_WORDLIST_VERSION } from "./net/types";

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


type GhostCursor = { pid: string; cursor: number; color: string; faded?: boolean };

function PromptBoxTrainingExact(props: {
    prompt: string;
    typedLen: number;
    caretIndex: number;
    isTyping: boolean;
    errorIndex?: number | null;
    ghostCursors?: GhostCursor[];
}) {
    const { prompt, typedLen, caretIndex, isTyping, errorIndex, ghostCursors } = props;

    const promptBoxRef = useRef<HTMLDivElement | null>(null);

    const [caret, setCaret] = useState({ x: 0, y: 0, h: 22 });
    const caretTargetRef = useRef({ x: 0, y: 0, h: 22 });
    const [ghostPositions, setGhostPositions] = useState<Record<string, { x: number; y: number; h: number }>>({});

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

    useLayoutEffect(() => {
        if (!ghostCursors || ghostCursors.length === 0) {
            setGhostPositions({});
            return;
        }
        const compute = () => {
            const box = promptBoxRef.current;
            if (!box) return;
            const boxRect = box.getBoundingClientRect();
            const next: Record<string, { x: number; y: number; h: number }> = {};
            for (const g of ghostCursors) {
                const idx = Math.min(Math.max(0, g.cursor), prompt.length);
                const el = box.querySelector<HTMLSpanElement>(`span[data-i="${idx}"]`);
                if (!el) continue;
                const r = el.getBoundingClientRect();
                next[g.pid] = { x: r.left - boxRect.left, y: r.top - boxRect.top, h: r.height };
            }
            setGhostPositions(next);
        };
        compute();
        const raf = requestAnimationFrame(compute);
        window.addEventListener("resize", compute);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", compute);
        };
    }, [ghostCursors, prompt]);

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

            {ghostCursors?.map((g) => {
                const pos = ghostPositions[g.pid];
                if (!pos) return null;
                const gh = Math.max(12, pos.h * CARET_SCALE);
                return (
                    <div
                        key={g.pid}
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: 2,
                            height: gh,
                            background: g.color,
                            opacity: g.faded ? 0.3 : 0.7,
                            borderRadius: 1,
                            pointerEvents: "none",
                            transform: `translate(${pos.x}px, ${pos.y + (pos.h - gh) / 2}px)`,
                            transition: "transform 120ms linear",
                        }}
                    />
                );
            })}

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

const RACER_COLORS = ["#f0f0f0", "#c4c4c4", "#9a9a9a", "#7a7a7a", "#5e5e5e"] as const;

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
    const [name, setName] = useState(() => {
        try {
            return localStorage.getItem("multitype:name") ?? "";
        } catch {
            return "";
        }
    });

    useEffect(() => {
        const trimmed = name.trim();
        try {
            if (trimmed) localStorage.setItem("multitype:name", trimmed);
        } catch { /* ignore */ }
    }, [name]);

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

    // Current connection's session token (from hello), and the stash that drives rejoin.
    const sessionRef = useRef<string>("");
    const persistedSessionRef = useRef<{ rid: string; session: string } | null>((() => {
        try {
            const raw = sessionStorage.getItem("multitype:rejoin");
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    })());

    const roomRef = useRef<RoomState | null>(null);

    useEffect(() => {
        roomRef.current = room;
    }, [room]);

    useEffect(() => {
        const ws = new WSClient((m: WSMsg) => {
            if (m.type === "hello") {
                const d = m.data as { pid?: string; session?: string } | undefined;
                sessionRef.current = d?.session ?? "";

                // If we have a stashed session, try to rejoin instead of starting fresh.
                const stash = persistedSessionRef.current;
                if (stash && stash.rid && stash.session) {
                    ws.send({ type: "rejoin", rid: stash.rid, data: { session: stash.session } });
                    return;
                }

                setPid(d?.pid ?? "");
                if (tokenRef.current) {
                    ws.send({ type: "auth", data: { token: tokenRef.current } });
                }
            }
            if (m.type === "room_joined") {
                const d = m.data as { rid?: string } | undefined;
                if (d?.rid && sessionRef.current) {
                    const entry = { rid: d.rid, session: sessionRef.current };
                    persistedSessionRef.current = entry;
                    try { sessionStorage.setItem("multitype:rejoin", JSON.stringify(entry)); } catch { /* ignore */ }
                }
            }
            if (m.type === "rejoin_ok") {
                const d = m.data as { pid?: string; session?: string; rid?: string } | undefined;
                if (d?.pid) setPid(d.pid);
                if (d?.session) sessionRef.current = d.session;
                if (d?.rid && d?.session) {
                    const entry = { rid: d.rid, session: d.session };
                    persistedSessionRef.current = entry;
                    try { sessionStorage.setItem("multitype:rejoin", JSON.stringify(entry)); } catch { /* ignore */ }
                }
                acceptRoomStateRef.current = true;
                if (tokenRef.current) {
                    ws.send({ type: "auth", data: { token: tokenRef.current } });
                }
            }
            if (m.type === "rejoin_failed") {
                persistedSessionRef.current = null;
                try { sessionStorage.removeItem("multitype:rejoin"); } catch { /* ignore */ }
                acceptRoomStateRef.current = false;
                setRoom(null);
                setIsHost(false);
                setRidInput("");
                setView("lobby");
                setJoinError("Your session expired. Please rejoin manually.");
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

    const [versionMismatch, setVersionMismatch] = useState(false);
    const [roomCopied, setRoomCopied] = useState(false);

    const copyRoomCode = async (code: string) => {
        try {
            await navigator.clipboard.writeText(code);
            setRoomCopied(true);
            window.setTimeout(() => setRoomCopied(false), 1200);
        } catch { /* ignore */ }
    };

    useEffect(() => {
        if (!room || !lists) return;
        if (!room.seed || !room.promptMode) return;

        if (room.wordlistVersion && room.wordlistVersion !== EXPECTED_WORDLIST_VERSION) {
            setVersionMismatch(true);
            return;
        }
        if (versionMismatch) setVersionMismatch(false);

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


    // Mirror room.players additively so opponents who drop mid-race retain their last-known state.
    const [lastKnown, setLastKnown] = useState<Map<string, PlayerState>>(new Map());
    useEffect(() => {
        if (!room) {
            setLastKnown(new Map());
            return;
        }
        setLastKnown((prev) => {
            const next = new Map(prev);
            for (const p of room.players) next.set(p.pid, p);
            return next;
        });
    }, [room]);

    // Snapshot of participant ordering taken when the race starts.
    // Layout (split-screen vs ghost-shadowing) is decided from this and never shifts mid-race.
    const [raceParticipants, setRaceParticipants] = useState<string[] | null>(null);
    useEffect(() => {
        if (!room) {
            setRaceParticipants(null);
            return;
        }
        if (room.status === "LOBBY" || room.status === "COUNTDOWN") {
            setRaceParticipants(null);
        } else if ((room.status === "RUNNING" || room.status === "FINISHED") && raceParticipants == null) {
            setRaceParticipants(room.players.map((p) => p.pid));
        }
    }, [room?.status, room?.players, raceParticipants, room]);

    const liveMap = new Map(room?.players.map((p) => [p.pid, p] as const) ?? []);
    const isRacing = room?.status === "RUNNING" || room?.status === "FINISHED";

    const displayPlayers: PlayerState[] = isRacing && raceParticipants
        ? raceParticipants
            .map((pp) => liveMap.get(pp) ?? lastKnown.get(pp))
            .filter((p): p is PlayerState => p != null)
        : (room?.players ?? []);

    const isDisconnected = (playerPid: string) =>
        isRacing && raceParticipants != null && !liveMap.has(playerPid);

    const me = displayPlayers.find((p) => p.pid === pid);
    const amReady = liveMap.get(pid)?.ready ?? false;

    const myStatus = me?.status ?? "NONE";
    const opponents = displayPlayers.filter((p) => p.pid !== pid);

    const playerLines = room ? [
        { pid, color: RACER_COLORS[0], name: me?.name || "You" },
        ...opponents.map((p, i) => ({
            pid: p.pid,
            color: RACER_COLORS[i + 1] ?? RACER_COLORS[RACER_COLORS.length - 1],
            name: p.name || `Racer ${i + 2}`,
        })),
    ] : [];

    useEffect(() => {
        if (!room || room.status !== "RUNNING" || !prompt) return;

        const cursor = typed.length;
        const mistakes = mistakeCount;

        if (cursor >= prompt.length && errorIndex == null && !finishSentRef.current) {
            finishSentRef.current = true;
            wsRef.current?.send({ type: "progress", data: { cursor, mistakes } });
            wsRef.current?.send({ type: "finish", data: {} });
            lastProgressSentAt.current = nowMs();
            return;
        }

        const t = nowMs();
        if (t - lastProgressSentAt.current < 120) return;

        wsRef.current?.send({ type: "progress", data: { cursor, mistakes } });
        lastProgressSentAt.current = t;

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
            // Intentional leave — clear the rejoin stash so we don't try to come back.
            persistedSessionRef.current = null;
            try { sessionStorage.removeItem("multitype:rejoin"); } catch { /* ignore */ }

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
                        color: "var(--text)",
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

            <div className="container" style={{ maxWidth: view === "battle" && opponents.length === 1 ? 1400 : undefined }}>
                <h1 className="title">Multiplayer</h1>

                {versionMismatch && (
                    <div style={{
                        margin: "0 auto 14px",
                        maxWidth: 520,
                        padding: "10px 14px",
                        border: "1px solid var(--danger)",
                        borderRadius: 12,
                        background: "rgba(255, 90, 95, 0.08)",
                        color: "var(--text)",
                        fontSize: 13,
                        textAlign: "center",
                    }}>
                        The server's word lists are a different version than this page. Please reload to continue.
                    </div>
                )}

                {view === "lobby" && (
                    <>
                        {!room ? (
                            <div className="card" style={{ maxWidth: 520, margin: "0 auto", padding: 14 }}>
                                <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
                                    <input
                                        className="input"
                                        placeholder="Name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        style={{ width: 130, padding: "8px 12px", fontSize: 14, borderRadius: 10 }}
                                    />
                                    <button
                                        className="btn primary"
                                        style={{ height: 38, padding: "0 14px", fontSize: 14, borderRadius: 10 }}
                                        onClick={() => {
                                            acceptRoomStateRef.current = true;
                                            setIsHost(true);
                                            wsRef.current?.send({ type: "set_name", data: { name: cleanName(name) } });
                                            wsRef.current?.send({ type: "create_room", data: { name: cleanName(name) } });
                                        }}
                                    >
                                        Create
                                    </button>
                                    <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
                                    <input
                                        className="input"
                                        placeholder="Room code"
                                        value={ridInput}
                                        onChange={(e) => { setRidInput(e.target.value); setJoinError(null); }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && ridInput.trim()) {
                                                setJoinError(null);
                                                acceptRoomStateRef.current = true;
                                                setIsHost(false);
                                                wsRef.current?.send({ type: "set_name", data: { name: cleanName(name) } });
                                                wsRef.current?.send({ type: "join_room", rid: ridInput, data: { name: cleanName(name) } });
                                            }
                                        }}
                                        style={{ width: 110, padding: "8px 12px", fontSize: 14, borderRadius: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: 1 }}
                                    />
                                    <button
                                        className="btn"
                                        style={{ height: 38, padding: "0 14px", fontSize: 14, borderRadius: 10 }}
                                        onClick={() => {
                                            setJoinError(null);
                                            acceptRoomStateRef.current = true;
                                            setIsHost(false);
                                            wsRef.current?.send({ type: "set_name", data: { name: cleanName(name) } });
                                            wsRef.current?.send({ type: "join_room", rid: ridInput, data: { name: cleanName(name) } });
                                        }}
                                    >
                                        Join
                                    </button>
                                </div>

                                {joinError && (
                                    <div style={{ color: "var(--danger)", fontSize: 12, textAlign: "center", marginTop: 10 }}>
                                        {joinError}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="card" style={{ maxWidth: 520, margin: "0 auto", padding: 14 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span className="mutedSmall">Room</span>
                                        <button
                                            onClick={() => copyRoomCode(room.rid)}
                                            title="Copy room code"
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 6,
                                                padding: "4px 10px",
                                                borderRadius: 8,
                                                border: "1px solid var(--border)",
                                                background: "transparent",
                                                color: "var(--text)",
                                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                                fontWeight: 700,
                                                letterSpacing: 2,
                                                fontSize: 15,
                                                cursor: "pointer",
                                            }}
                                        >
                                            {room.rid}
                                            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0, opacity: 0.7, fontFamily: "system-ui, -apple-system, sans-serif", marginLeft: 2 }}>
                                                {roomCopied ? "copied" : "copy"}
                                            </span>
                                        </button>
                                    </div>

                                    <button
                                        className={`btn ${amReady ? "" : "primary"}`}
                                        style={{ height: 38, padding: "0 16px", fontSize: 14, borderRadius: 10 }}
                                        onClick={() => {
                                            acceptRoomStateRef.current = true;
                                            wsRef.current?.send({ type: "ready", data: { ready: !amReady } });
                                        }}
                                    >
                                        {amReady ? "Unready" : "Ready"}
                                    </button>
                                </div>

                                {isHost && room.status === "LOBBY" && (
                                    <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                                        {(["short", "medium", "long", "mixed"] as const).map((m) => (
                                            <button
                                                key={m}
                                                className={`pill ${room.promptMode === m ? "active" : ""}`}
                                                style={{ padding: "5px 12px", fontSize: 12, borderRadius: 999, fontWeight: 600 }}
                                                onClick={() => wsRef.current?.send({ type: "set_prompt_mode", data: { promptMode: m } })}
                                            >
                                                {m}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                                    {room.players.map((p) => {
                                        const line = playerLines.find((l) => l.pid === p.pid);
                                        return (
                                            <div key={p.pid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0" }}>
                                                <span style={{ color: line?.color ?? "var(--text)", fontSize: 14, fontWeight: 600 }}>
                                                    {p.name}{p.pid === pid ? " (you)" : ""}
                                                </span>
                                                <span style={{ fontSize: 12, color: p.ready ? "var(--text)" : "var(--muted)", fontWeight: p.ready ? 700 : 400 }}>
                                                    {p.ready ? "✓ Ready" : "Waiting"}
                                                </span>
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

                {view === "battle" && room && (
                    <>
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
                            style={{ position: "fixed", opacity: 0, pointerEvents: "none", left: 0, top: 0, height: 1, width: 1 }}
                        />

                        {opponents.length === 1 ? (
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1px 1fr",
                                gap: 24,
                                alignItems: "start",
                            }}>
                                <div>
                                    <div className="cardLabel" style={{ marginBottom: 8, color: RACER_COLORS[0] }}>You</div>
                                    <div
                                        className="typeArea"
                                        onClick={() => hiddenInputRef.current?.focus()}
                                        style={{ cursor: room.status === "RUNNING" ? "text" : "default" }}
                                    >
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
                                </div>

                                <div style={{ background: "var(--border)", alignSelf: "stretch" }} />

                                <div style={{ opacity: isDisconnected(opponents[0].pid) ? 0.55 : 1, transition: "opacity 200ms ease" }}>
                                    <div className="cardLabel" style={{ marginBottom: 8, color: RACER_COLORS[1], display: "flex", justifyContent: "space-between" }}>
                                        <span>{opponents[0].name || "Opponent"}{isDisconnected(opponents[0].pid) ? " · disconnected" : ""}</span>
                                        <span className="mutedSmall">
                                            {(opponents[0].wpm ?? 0).toFixed(0)} WPM
                                            {opponents[0].status === "FINISHED" ? " · finished" : ""}
                                        </span>
                                    </div>
                                    <div className="typeArea" style={{ cursor: "default" }}>
                                        {prompt ? (
                                            <PromptBoxTrainingExact
                                                prompt={prompt}
                                                typedLen={opponents[0].cursor}
                                                caretIndex={opponents[0].cursor}
                                                isTyping={!isDisconnected(opponents[0].pid)}
                                            />
                                        ) : (
                                            <div className="promptBox" style={{ opacity: 0.6 }}>(loading prompt…)</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div
                                className="typeArea"
                                onClick={() => hiddenInputRef.current?.focus()}
                                style={{ cursor: room.status === "RUNNING" ? "text" : "default" }}
                            >
                                {prompt ? (
                                    <PromptBoxTrainingExact
                                        prompt={prompt}
                                        typedLen={typed.length}
                                        caretIndex={typed.length}
                                        isTyping={isTyping}
                                        errorIndex={errorIndex}
                                        ghostCursors={opponents.map((p, i) => ({
                                            pid: p.pid,
                                            cursor: p.cursor,
                                            color: RACER_COLORS[i + 1] ?? RACER_COLORS[RACER_COLORS.length - 1],
                                            faded: isDisconnected(p.pid),
                                        }))}
                                    />
                                ) : (
                                    <div className="promptBox" style={{ opacity: 0.6 }}>(loading prompt…)</div>
                                )}
                            </div>
                        )}

                        {myStatus === "FINISHED" && (
                            <div className="mutedSmall" style={{ textAlign: "center", marginTop: 10 }}>
                                You finished — waiting for opponents…
                            </div>
                        )}

                        {opponents.length >= 2 && (
                            <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
                                {opponents.map((p, i) => {
                                    const color = RACER_COLORS[i + 1] ?? RACER_COLORS[RACER_COLORS.length - 1];
                                    const offline = isDisconnected(p.pid);
                                    return (
                                        <span key={p.pid} className="mutedSmall" style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: offline ? 0.55 : 1 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: offline ? 0.35 : 0.6, display: "inline-block" }} />
                                            <span style={{ color }}>{p.name || `Racer ${i + 2}`}</span>
                                            <span style={{ opacity: 0.7 }}>
                                                {(p.wpm ?? 0).toFixed(0)} WPM
                                                {p.status === "FINISHED" ? " · finished" : ""}
                                                {offline ? " · disconnected" : ""}
                                            </span>
                                        </span>
                                    );
                                })}
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
                            {displayPlayers
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
                                                borderColor: p.ready ? "var(--text)" : undefined,
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
