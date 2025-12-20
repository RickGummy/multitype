import { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react'
import './App.css'

function nowMs() {
  return performance.now();
}

type Stats = {
  wpm: number,
  accuracy: number,
  elapsedMs: number
};

type Sample = { tSec: number; wpm: number };

type Screen = "home" | "training" | "multiplayer" | "bots" | "history" | "profile";

type RunResult = {
  id: string;
  mode: "training";
  prompt: string;
  endedAtIso: string;
  wpm: number;
  accuracy: number;
  elapsedMs: number;
};

type Profile = {
  displayName: string;
}

type WordCount = 10 | 20 | 50 | 100;

type WordListMode = "short" | "medium" | "long" | "mixed";

const RUN_KEYS = "multitype:runs:v1";
const PROFILE_KEY = "multitype:profile:v1";

const DEFAULT_PROFILE: Profile = {
  displayName: "Rick",
};

function loadRuns(): RunResult[] {
  try {
    const raw = localStorage.getItem(RUN_KEYS);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }
  catch {
    return [];
  }
}

function saveRun(run: RunResult) {
  const prev = loadRuns();
  const next = [run, ...prev].slice(0, 200);
  localStorage.setItem(RUN_KEYS, JSON.stringify(next));
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      return DEFAULT_PROFILE;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_PROFILE;
    }

    return {
      displayName:
        typeof parsed.displayName === "string" && parsed.displayName.trim() ? parsed.displayName : DEFAULT_PROFILE.displayName,
    };
  }
  catch {
    return DEFAULT_PROFILE;
  }
}

function saveProfile(p: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

function clearRuns() {
  localStorage.removeItem(RUN_KEYS);
}

function uid() {
  return `${Date.now()} - ${Math.random().toString(16).slice(2)}`;
}

function pickWord(list: string[]) {
  return list[Math.floor(Math.random() * list.length)];
}

function generatePromptFromList(list: string[], wordCount: WordCount) {
  const out: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    out.push(pickWord(list));
  }
  return out.join(" ");
}

export default function App() {
  const [wordCount, setWordCount] = useState<WordCount>(20);
  const [prompt, setPrompt] = useState("");

  const [input, setInput] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);

  const [samples, setSamples] = useState<Sample[]>([]);

  const [mistakeSeconds, setMistakeSeconds] = useState<number[]>([]);

  const [screen, setScreen] = useState<Screen>("home");

  const promptBoxRef = useRef<HTMLDivElement | null>(null);
  const [caret, setCaret] = useState({ x: 0, y: 0, h: 22 });

  const done = screen === "training" && prompt.length > 0 && input.length >= prompt.length;

  const typeAreaRef = useRef<HTMLDivElement | null>(null);

  const startedAtRef = useRef<number | null>(null);

  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<number | null>(null);

  const [wordListMode, setWordListMode] = useState<WordListMode>("short");
  const [wordLists, setWordLists] = useState<Record<WordListMode, string[]> | null>(null);


  useEffect(() => {
    startedAtRef.current = startedAt;
  }, [startedAt]);

  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    typeAreaRef.current?.focus();
  }, [prompt]);

  const stats: Stats | null = useMemo(() => {
    if (startedAt == null) {
      return null;
    }
    const end = endedAt ?? nowMs();
    const elapsedMs = Math.max(1, end - startedAt);

    let correct = 0;
    for (let i = 0; i < Math.min(input.length, prompt.length); i++) {
      if (input[i] == prompt[i]) {
        correct++;
      }
    }

    const accuracy = input.length === 0 ? 100 : (correct / input.length) * 100;
    const minutes = elapsedMs / 60000;
    const wpm = minutes === 0 ? 0 : (input.length / 5) / minutes;

    return { wpm, accuracy, elapsedMs };
  }, [input, startedAt, endedAt, prompt]);

  const savedEndRef = useRef<number | null>(null);
  useEffect(() => {
    if (endedAt == null || stats == null) {
      return;
    }
    if (savedEndRef.current === endedAt) {
      return;
    }
    savedEndRef.current = endedAt;

    saveRun({
      id: uid(),
      mode: "training",
      prompt,
      endedAtIso: new Date().toISOString(),
      wpm: stats.wpm,
      accuracy: stats.accuracy,
      elapsedMs: stats.elapsedMs,
    });
  }, [endedAt, stats, prompt]);

  const endedAtRef = useRef<number | null>(null);
  useEffect(() => {
    endedAtRef.current = endedAt;
  }, [endedAt]);

  useEffect(() => {
    if (startedAt == null) {
      return;
    }
    if (endedAt != null) {
      return;
    }
    const id = window.setInterval(() => {
      if (endedAtRef.current != null) {
        return;
      }

      const start = startedAtRef.current;
      if (start == null) {
        return;
      }
      const elapsedMs = Math.max(1, nowMs() - start);
      const minutes = elapsedMs / 60000;
      const wpm = minutes === 0 ? 0 : (inputRef.current.length / 5) / minutes;
      const tSec = elapsedMs / 1000;

      setSamples((prev) => {
        const last = prev[prev.length - 1];
        if (last && Math.floor(last.tSec) === Math.floor(tSec)) {
          return [...prev.slice(0, -1), { tSec, wpm }];
        }
        return [...prev, { tSec, wpm }];
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, endedAt]);

  useLayoutEffect(() => {
    if (screen !== "training") {
      return;
    }
    const update = () => {
      const box = promptBoxRef.current;
      if (!box) {
        return;
      }

      const idx = Math.min(input.length, prompt.length);

      const el = box.querySelector<HTMLSpanElement>(`span[data-i="${idx}"]`);
      if (!el) {
        return;
      }

      const boxRect = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();

      const x = r.left - boxRect.left;
      const y = r.top - boxRect.top;
      const h = r.height;

      setCaret({ x, y, h });
    };

    update();

    const raf = requestAnimationFrame(update);

    window.addEventListener("resize", update);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, [input.length, prompt, screen]);

  useEffect(() => {
    if (screen !== "training") {
      return;
    }
    setIsTyping(true);
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
    }

    typingTimerRef.current = window.setTimeout(() => {
      setIsTyping(false);
    }, 200);

    return () => {
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
      }
    };
  }, [input.length, screen]);

  useEffect(() => {
    if (!wordLists) {
      return;
    }

    const list = wordLists[wordListMode];
    if (!list || list.length === 0) {
      return;
    }
    setPrompt(generatePromptFromList(list, wordCount));
    resetSamePrompt();
  }, [wordLists, wordListMode, wordCount]);

  function resetSamePrompt() {
    setInput("");
    setStartedAt(null);
    setEndedAt(null);
    setSamples([]);
    setMistakeSeconds([]);

    setTimeout(() => typeAreaRef.current?.focus(), 0);
  }

  function nextPrompt() {
    if (!wordLists) {
      return;
    }

    const list = wordLists[wordListMode];
    if (!list || list.length === 0) {
      return;
    }

    setPrompt(generatePromptFromList(list, wordCount));
    resetSamePrompt();
  }

  function recordMistake() {
    const start = startedAtRef.current;
    if (start == null) {
      return;
    }
    const sec = Math.max(1, Math.floor((nowMs() - start) / 1000));
    setMistakeSeconds((prev) => (prev.includes(sec) ? prev : [...prev, sec]));
  }

  function finishRun() {
    const end = nowMs();
    setEndedAt(end);

    const start = startedAtRef.current ?? end;
    const elapsedMs = Math.max(1, end - start);
    const tSec = elapsedMs / 1000;

    const minutes = elapsedMs / 60000;
    const wpm = minutes === 0 ? 0 : (prompt.length / 5) / minutes;

    setSamples((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.floor(last.tSec) === Math.floor(tSec)) {
        return [...prev.slice(0, -1), { tSec, wpm }];
      }
      return [...prev, { tSec, wpm }];
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      resetSamePrompt();
      return;
    }
    if (e.key === "Enter") {
      if (done) {
        nextPrompt();
      }
      return;
    }

    if (done) {
      return;
    }

    if (!prompt) {
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }

    const isPrintable = e.key.length === 1;

    if (startedAtRef.current == null && isPrintable) {
      const start = nowMs();
      setStartedAt(start);
      startedAtRef.current = start;
      setMistakeSeconds([]);
      setSamples([{ tSec: 1, wpm: 0 }]);
    }

    if (e.key === "Backspace") {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (!isPrintable) {
      return;
    }

    const prev = inputRef.current;
    const nextIndex = prev.length;
    const typedChar = e.key;

    if (nextIndex < prompt.length && typedChar !== prompt[nextIndex]) {
      recordMistake();
    }

    const next = (prev + e.key).slice(0, prompt.length);
    setInput(next);
    if (next.length >= prompt.length && startedAtRef.current != null) {
      finishRun();
    }
  }

  async function fetchWordList(path: string): Promise<string[]> {
    const res = await fetch(path);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${path}: ${res.status}`);
    }
    const text = await res.text();
    const words = text.split(/\s+/).map(w => w.trim().toLowerCase()).filter(Boolean);
    return Array.from(new Set(words));
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [short, medium, long, mixed] = await Promise.all([
          fetchWordList("/short.txt"),
          fetchWordList("/medium.txt"),
          fetchWordList("/long.txt"),
          fetchWordList("/mixed.txt"),
        ]);

        if (!alive) {
          return;
        }

        setWordLists({
          short,
          medium,
          long,
          mixed,
        });
      }
      catch (e) {
        console.error(e);
        if (!alive) {
          return;
        }
        setWordLists({ short: [], medium: [], long: [], mixed: [] });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (screen === "training" && done && stats) {
    return (
      <StatsScreen
        stats={stats}
        samples={samples}
        mistakeSeconds={mistakeSeconds}
        onRetry={resetSamePrompt}
        onNextPrompt={nextPrompt}
        onHistory={() => setScreen("history")}
        onBack={() => setScreen("home")}
      />
    );
  }

  if (screen == "home") {
    return <HomeScreen onPick={(s) => { resetSamePrompt(); setScreen(s); }} />;
  }

  if (screen == "multiplayer") {
    return (
      <div className="page">
        <div className="container">
          <h1 className="title">Multiplayer</h1>
          <p className="hint">Coming Soon</p>
          <div className="row center">
            <button className="btn" onClick={() => setScreen("home")}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  if (screen == "bots") {
    return (
      <div className="page">
        <div className="container">
          <h1 className="title">Vs Bots</h1>
          <p className="hint">Coming Soon</p>
          <div className="row center">
            <button className="btn" onClick={() => setScreen("home")}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  if (screen == "history") {
    return <HistoryScreen onBack={() => setScreen("home")} />;
  }

  if (screen == "training") {
    const CARET_SCALE = 0.6;
    const caretH = Math.max(12, caret.h * CARET_SCALE);
    return (
      <div className="page">
        <div className="container">
          <h1 className="title">Multitype</h1>

          <div className="row center" style={{ marginBottom: 12 }}>
            {(["short", "medium", "long", "mixed"] as WordListMode[]).map((m) => (
              <button
                key={m}
                className="btn"
                onClick={() => {  
                  setWordListMode(m);
                }}
                style={{ opacity: wordListMode === m ? 1 : 0.7 }}
                disabled={!wordLists}
              >
                {m}
              </button>
            ))}

            {[10, 20, 50, 100].map((n) => (
              <button
                key={n}
                className="btn"
                onClick={() => {
                  if (!wordLists) {
                    return;
                  }
                  const wc = n as WordCount;
                  const list = wordLists[wordListMode];
                  setWordCount(wc);
                  setPrompt(generatePromptFromList(list, wc));
                  resetSamePrompt();
                }}
                style={{
                  opacity: wordCount === n ? 1 : 0.7,
                }}
              >
                {n} words
              </button>
            ))}
          </div>



          <div
            ref={typeAreaRef}
            tabIndex={0}
            className="typeArea"
            onKeyDown={onKeyDown}
            onClick={() => typeAreaRef.current?.focus()}
          >

            <div className="promptBox" ref={promptBoxRef}>


              <div
                className={`cursorCaret ${isTyping ? "typing" : "idle"}`}
                style={{
                  transform: `translate(${caret.x}px, ${caret.y + (caret.h - caretH) / 2}px)`,
                  height: `${caretH}px`,
                }}
              />

              {prompt.split(/(\s+)/).map((token, tokenIdx) => {
                const isSpace = /^\s+$/.test(token);
                if (isSpace) {
                  const start = prompt.split(/(\s+)/).slice(0, tokenIdx).join("").length;
                  return (
                    <span key={`s-${tokenIdx}`} className="space">
                      {token.split("").map((ch, j) => {
                        const i = start + j;
                        const typed = input[i];
                        const isTyped = typed !== undefined;
                        const isCorrect = isTyped && typed === ch;

                        const cls = [
                          "promptChar",
                          !isTyped ? "untyped" : "",
                          isTyped && isCorrect ? "correct" : "",
                          isTyped && !isCorrect ? "wrong" : "",
                        ].join(" ");

                        return (
                          <span key={i} data-i={i} className={cls}>
                            {"\u00A0"}
                          </span>
                        );
                      })}
                    </span>
                  );
                }

                const start = prompt.split(/(\s+)/).slice(0, tokenIdx).join("").length;

                return (
                  <span key={`w-${tokenIdx}`} className="word">
                    {token.split("").map((ch, j) => {
                      const i = start + j;
                      const typed = input[i];
                      const isTyped = typed !== undefined;
                      const isCorrect = isTyped && typed == ch;
                      const cls = [
                        "promptChar",
                        !isTyped ? "untyped" : "",
                        isTyped && isCorrect ? "correct" : "",
                        isTyped && !isCorrect ? "wrong" : "",
                      ].join(" ");

                      return (
                        <span key={i} data-i={i} className={cls}>
                          {ch === " " ? "\u00A0" : ch}
                        </span>
                      );
                      /*return (
                        <span key={i}
                          className={[
                            "promptChar",
                            !isTyped ? "untyped" : "",
                            isTyped && isCorrect ? "correct" : "",
                            isTyped && !isCorrect ? "wrong" : "",
                            isCursor ? "cursor" : "",
                          ].join(" ")}
                        >
                          {ch}
                        </span>
                      );
                      */
                    })}
                  </span>

                );
              })}
              <span data-i={prompt.length} className="promptChar">
                {"\u00A0"}
              </span>

            </div>
          </div>
          <div className="row center" style={{ marginTop: 14 }}>
            <button
              className="btn"
              onClick={() => {
                resetSamePrompt();
                setScreen("home");
              }}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen == "profile") {
    return <ProfileScreen onBack={() => setScreen("home")} />;
  }
  return null;
}

function StatCard(props: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="cardLabel">{props.label}</div>
      <div className="cardValue">{props.value}</div>
    </div>
  );
}

function StatsScreen(props: {
  stats: Stats;
  samples: Sample[];
  mistakeSeconds: number[];
  onRetry: () => void
  onNextPrompt: () => void;
  onHistory: () => void;
  onBack: () => void;
}) {
  const { stats, samples, mistakeSeconds } = props;

  return (
    <div className="page">
      <div className="container">
        <header className="header">
          <h1 className="title">Run Complete</h1>
        </header>

        <div className="statsGrid">
          <StatCard label="WPM" value={stats.wpm.toFixed(1)} />
          <StatCard label="Accuracy" value={`${stats.accuracy.toFixed(1)}%`} />
          <StatCard label="Time" value={`${(stats.elapsedMs / 1000).toFixed(2)}s`} />
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="cardLabel" style={{ marginBottom: 8 }}>
            WPM over time
          </div>
          <WpmChart samples={samples} mistakeSeconds={mistakeSeconds} />
        </div>

        <div className="row center" style={{ marginTop: 16 }}>
          <button className="btn" onClick={props.onHistory}>
            History
          </button>
          <button className="btn" onClick={props.onRetry}>
            Try again
          </button>
          <button className="btn" onClick={props.onNextPrompt}>
            Next prompt
          </button>
        </div>
      </div>
    </div>
  );
}

function WpmChart(props: { samples: Sample[]; mistakeSeconds: number[] }) {
  const { samples, mistakeSeconds } = props;
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
        <div className="cardLabel">
          Not enough data yet (type longer).
        </div>
      </div>
    )
  }

  const maxT = secAt(samples[samples.length - 1].tSec);

  const tSpan = Math.max(1, maxT - minT);

  const wpmVals = samples.map((s) => s.wpm);
  const maxWpm = Math.max(10, ...wpmVals);
  const minWpm = Math.min(1, ...wpmVals);
  const span = Math.max(1, maxWpm - minWpm);


  const x0 = padL;
  const x1 = W - padR;
  const y0 = H - padB;
  const y1 = padT;

  const toX = (t: number) => x0 + ((x1 - x0) * (t - minT) / tSpan);
  const toY = (wpm: number) => {
    const norm = (wpm - minWpm) / span;
    return y0 - (y0 - y1) * norm;
  };

  const poly = samples.map((s) => {
    const t = Math.max(minT, secAt(s.tSec));
    return `${toX(t)},${toY(s.wpm)}`;
  })
    .join(" ");

  const yTicks = 5;
  const xTickStep = maxT <= 15 ? 1 : maxT <= 40 ? 2 : maxT <= 90 ? 5 : 10;


  const sampleBySec = new Map<number, Sample>();

  for (const s of samples) {
    sampleBySec.set(secAt(s.tSec), s);
  }

  const mistakeSet = new Set(mistakeSeconds);



  return (
    <div className="card" style={{ minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="260">
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const frac = i / yTicks;
          const y = y0 - (y0 - y1) * frac;
          const wpmLabel = (minWpm + span * frac).toFixed(0);

          return (
            <g key={`y-${i}`}>
              <line
                x1={x0}
                x2={x1}
                y1={y}
                y2={y}
                stroke="currentColor"
                opacity="0.12"
              />
              <text
                x={x0 - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="currentColor"
                opacity="0.6"
              >
                {wpmLabel}
              </text>
            </g>
          );
        })}

        {Array.from({ length: Math.floor((maxT - minT) / xTickStep) + 1 }).map((_, i) => {
          const t = minT + i * xTickStep;
          const x = toX(t);
          return (
            <g key={`x-${i}`}>
              <line
                x1={x}
                x2={x}
                y1={y1}
                y2={y0}
                stroke="currentColor"
                opacity="0.10"
              />
              <text
                x={x}
                y={y0 + 18}
                textAnchor="middle"
                fontSize="12"
                fill="currentColor"
                opacity="0.6"
              >
                {t}s
              </text>
            </g>
          );
        })}

        <text
          x={(x0 + x1) / 2}
          y={H - 10}
          textAnchor="middle"
          fontSize="12"
          fill="currentColor"
          opacity="0.75"
        >
          Time (seconds)
        </text>
        <text
          x={14}
          y={(y0 + y1) / 2}
          textAnchor="middle"
          fontSize="12"
          fill="currentColor"
          opacity="0.75"
          transform={`rotate(-90 14 ${(y0 + y1) / 2})`}
        >
          WPM
        </text>

        <polyline
          points={poly}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          opacity="0.9"
        />
        {samples.map((s, idx) => {
          const sec = Math.max(minT, secAt(s.tSec));
          if (mistakeSet.has(sec)) {
            return null;
          }
          return (
            <circle
              key={idx}
              cx={toX(sec)}
              cy={toY(s.wpm)}
              r="4"
              fill="currentColor"
              opacity="0.9"
            />
          );

        })}

        {mistakeSeconds.map((sec) => {
          const s = sampleBySec.get(sec);
          if (!s) {
            return null;
          }

          const x = toX(Math.max(1, sec));
          const y = toY(s.wpm);
          const size = 6;
          return (
            <path
              key={`m-${sec}`}
              d={`M ${x - size} ${y - size} L ${x + size} ${y + size}
                  M ${x - size} ${y + size} L ${x + size} ${y - size}`}
              style={{ stroke: "var(--danger)" }}
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
              opacity="0.95"
            />

          );
        })}
      </svg>
      <div className="cardLabel" style={{ marginTop: 6 }}>
        {samples.length} samples peak {maxWpm.toFixed(1)} WPM
      </div>
    </div>
  );
}

function HomeScreen(props: { onPick: (s: "training" | "multiplayer" | "bots" | "history" | "profile") => void }) {
  return (
    <div className="page">
      <div className="container">
        <h1 className="title">Multitype</h1>

        <div className="menu">
          <button className="menuBtn" onClick={() => props.onPick("training")}>
            Training
          </button>
          <button className="menuBtn" onClick={() => props.onPick("multiplayer")}>
            Multiplayer
          </button>
          <button className="menuBtn" onClick={() => props.onPick("bots")}>
            Vs Bots
          </button>
          <button className="menuBtn" onClick={() => props.onPick("history")}>
            History
          </button>
          <button className="menuBtn" onClick={() => props.onPick("profile")}>
            Profile
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryScreen(props: { onBack: () => void }) {
  const [runs, setRuns] = useState<RunResult[]>(() => loadRuns());
  const bestWpm = runs.length ? Math.max(...runs.map(r => r.wpm)) : 0;
  const last10 = runs.slice(0, 10);
  const avgLast10 = last10.length ? last10.reduce((s, r) => s + r.wpm, 0) / last10.length : 0;
  const wpms = runs.slice(0, 20).map(r => r.wpm).reverse();

  return (
    <div className="page">
      <div className="container">
        <h1 className="title">History</h1>

        <div className="statsGrid">
          <StatCard label="Personal Best" value={bestWpm.toFixed(1)} />
          <StatCard label="Average (Last 10)" value={avgLast10.toFixed(1)} />
          <StatCard label="Runs" value={`${runs.length}`} />
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="cardLabel" style={{ marginBottom: 8 }}>Wpm trend</div>
          <WpmMiniChart values={wpms} />
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="cardLabel" style={{ marginBottom: 8 }}>Recent runs</div>
          <div className="runList">
            {runs.slice(0, 12).map((r) => (
              <div key={r.id} className="runRow">
                <div className="runMain">
                  <div className="runWpm">{r.wpm.toFixed(1)} WPM</div>
                  <div className="runMeta">
                    {r.accuracy.toFixed(1)}% • {(r.elapsedMs / 1000).toFixed(2)}s
                  </div>
                </div>
                <div className="runPrompt">{r.prompt}</div>
              </div>
            ))}
            {runs.length === 0 && (
              <div className="cardLabel">No runs yet. Do a training run first.</div>
            )}
          </div>
        </div>

        <div className="row center" style={{ marginTop: 18 }}>
          <button className="btn" onClick={props.onBack}>Back</button>
          <button
            className="btn"
            onClick={() => {
              clearRuns();
              setRuns([]);
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function WpmMiniChart(props: { values: number[] }) {
  const values = props.values;
  const W = 900;
  const H = 180;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;

  if (values.length < 2) {
    return (
      <div className="card">
        <div className="cardLabel">Not enough runs yet.</div>
      </div>
    );
  }

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = Math.max(1, maxV - minV);

  const x0 = padL;
  const x1 = W - padR;
  const y0 = H - padB;
  const y1 = padT;

  const toX = (i: number) => x0 + ((x1 - x0) * i) / (values.length - 1);
  const toY = (v: number) => y0 - ((y0 - y1) * (v - minV)) / span;

  const points = values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");

  const yTicks = 5;

  return (
    <div className="card" style={{ minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="220">
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const frac = i / yTicks;
          const y = y0 - (y0 - y1) * frac;
          const label = (minV + span * frac).toFixed(0);
          return (
            <g key={i}>
              <line x1={x0} x2={x1} y1={y} y2={y} stroke="currentColor" opacity="0.12" />
              <text
                x={x0 - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="currentColor"
                opacity="0.6"
              >
                {label}
              </text>
            </g>
          );
        })}

        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" opacity="0.9" />
        {values.map((v, i) => (
          <circle key={i} cx={toX(i)} cy={toY(v)} r="4" fill="currentColor" opacity="0.9" />
        ))}
        <text x={14} y={(y0 + y1) / 2} textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.75"
          transform={`rotate(-90 14 ${(y0 + y1) / 2})`}
        >
          WPM
        </text>
      </svg>
    </div>
  );
}

function ProfileScreen(props: { onBack: () => void }) {
  const [name, setName] = useState(() => loadProfile().displayName);

  const [runs, setRuns] = useState<RunResult[]>(() => loadRuns());

  useEffect(() => {
    setRuns(loadRuns());
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      saveProfile({ displayName: name.trim() || DEFAULT_PROFILE.displayName });
    }, 400);
    return () => window.clearTimeout(id);
  }, [name]);

  const bestWpm = runs.length ? Math.max(...runs.map(r => r.wpm)) : 0;
  const last10 = runs.slice(0, 10);
  const avgLast10 = last10.length ? last10.reduce((s, r) => s + r.wpm, 0) / last10.length : 0;
  const avgAccLast10 = last10.length ? last10.reduce((s, r) => s + r.accuracy, 0) / last10.length : 0;

  return (
    <div className="page">
      <div className="container">
        <h1 className="title">Profile</h1>

        <div className="card" style={{ minWidth: 0 }}>
          <div className="cardLabel" style={{ marginBottom: 6 }}>Display name</div>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rick"
          />

          <div className="statsGrid" style={{ marginTop: 16 }}>
            <StatCard label="Runs" value={`${runs.length}`} />
            <StatCard label="Personal Best" value={bestWpm.toFixed(1)} />
            <StatCard label="Avg WPM (Last 10)" value={avgLast10.toFixed(1)} />
          </div>

          <div style={{ marginTop: 12 }} >
            <div className="cardLabel">Avg Accuracy (Last 10)</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
              {avgAccLast10.toFixed(1)}%
            </div>
          </div>

          <div className="row center" style={{ marginTop: 16 }}>
            <button className="btn" onClick={props.onBack}>Back</button>
          </div>
        </div>
      </div>
    </div>
  );
}