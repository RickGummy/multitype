import { useMemo, useState, useEffect, useRef, useLayoutEffect } from "react";
import "./App.css";

function nowMs() {
  return performance.now();
}

type Stats = {
  wpm: number;
  accuracy: number;
  elapsedMs: number;
};

type Sample = { tSec: number; rawWpm: number; corrWpm: number };

type WordCount = 10 | 20 | 50 | 100;
type WordListMode = "short" | "medium" | "long" | "mixed";
type ContentMode = "words" | "passage";

type Toggles = {
  punctuation: boolean;
  numbers: boolean;
};

type RunResult = {
  id: string;
  mode: "training";
  prompt: string;
  endedAtIso: string;
  wpmRaw: number;
  wpmCorr: number;
  accuracy: number;
  elapsedMs: number;
};

function pickWord(list: string[]) {
  return list[Math.floor(Math.random() * list.length)];
}

export default function TrainingScreen(props: {
  onBack: () => void;
  onHistory: () => void;
  saveRun: (run: RunResult) => void;
  uid: () => string;
}) {
  const [wordCount, setWordCount] = useState<WordCount>(20);

  const [prompt, setPrompt] = useState("");

  const [input, setInput] = useState("");

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);

  const [samples, setSamples] = useState<Sample[]>([]);
  const [mistakeSeconds, setMistakeSeconds] = useState<number[]>([]);

  const promptBoxRef = useRef<HTMLDivElement | null>(null);

  const [caret, setCaret] = useState({ x: 0, y: 0, h: 22 });
  const caretTargetRef = useRef({ x: 0, y: 0, h: 22 });

  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);

  const done = prompt.length > 0 && input.length >= prompt.length;

  const typeAreaRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<number | null>(null);

  const [wordListMode, setWordListMode] = useState<WordListMode>("short");
  const [wordLists, setWordLists] = useState<Record<WordListMode, string[]> | null>(null);

  const [contentMode, setContentMode] = useState<ContentMode>("words");
  const [toggles, setToggles] = useState<Toggles>({
    punctuation: false,
    numbers: false,
  });

  const [passages, setPassages] = useState<string[]>([]);
  const [passageIndex, setPassageIndex] = useState(0);

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
      if (input[i] === prompt[i]) {
        correct++;
      }
    }

    const accuracy = input.length === 0 ? 100 : (correct / input.length) * 100;
    const minutes = elapsedMs / 60000;
    const correctChars = countCorrectChars(input, prompt);
    const wpm = minutes === 0 ? 0 : (correctChars / 5) / minutes;

    return { wpm, accuracy, elapsedMs };
  }, [input, startedAt, endedAt, prompt]);

  const wordsWithStart = useMemo(() => {
    const words = prompt ? prompt.split(" ") : [];
    const out: { word: string; start: number }[] = [];
    let start = 0;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      out.push({ word: w, start });
      start += w.length;
      if (i !== words.length - 1) {
        start += 1;
      }
    }
    return out;
  }, [prompt]);


  const savedEndRef = useRef<number | null>(null);
  useEffect(() => {
    if (endedAt == null || stats == null) {
        return;
    }

    if (savedEndRef.current === endedAt) {
        return;
    }

    savedEndRef.current = endedAt;

    const typed = input;
    const correctChars = countCorrectChars(typed, prompt);
    const minutes = stats.elapsedMs / 60000;


    const wpmRaw = minutes === 0 ? 0 : (typed.length / 5) / minutes;
    const wpmCorr = minutes === 0 ? 0 : (correctChars / 5) / minutes;

    props.saveRun({
      id: props.uid(),
      mode: "training",
      prompt,
      endedAtIso: new Date().toISOString(),
      wpmRaw,
      wpmCorr,
      accuracy: stats.accuracy,
      elapsedMs: stats.elapsedMs,
    });
  }, [endedAt, stats, prompt, input, props]);


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
      if (endedAtRef.current != null) return;

      const start = startedAtRef.current;
      if (start == null) return;

      const elapsedMs = Math.max(1, nowMs() - start);
      const minutes = elapsedMs / 60000;

      const tSec = elapsedMs / 1000;

      const typed = inputRef.current;
      const correctChars = countCorrectChars(typed, prompt);

      const rawWpm = minutes === 0 ? 0 : (typed.length / 5) / minutes;
      const corrWpm = minutes === 0 ? 0 : (correctChars / 5) / minutes;

      setSamples((prev) => {
        const last = prev[prev.length - 1];
        if (last && Math.floor(last.tSec) === Math.floor(tSec)) {
          return [...prev.slice(0, -1), { tSec, rawWpm, corrWpm }];
        }
        return [...prev, { tSec, rawWpm, corrWpm }];
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [startedAt, endedAt, prompt]);

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
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);


  useLayoutEffect(() => {
    const update = () => {
      const box = promptBoxRef.current;
      if (!box) return;

      const idx = Math.min(input.length, prompt.length);
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
  }, [input.length, prompt]);


  useEffect(() => {
    setIsTyping(true);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);

    typingTimerRef.current = window.setTimeout(() => setIsTyping(false), 200);

    return () => {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    };
  }, [input.length]);



  useEffect(() => {
    const next = regeneratePrompt(
      wordLists,
      wordListMode,
      wordCount,
      contentMode,
      passages,
      passageIndex,
      toggles
    );
    setPrompt(next);
    resetSamePrompt();

  }, [wordLists, wordListMode, wordCount, contentMode, passages, passageIndex, toggles.punctuation, toggles.numbers]);


  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await fetch("/quotes.json");
        if (!res.ok) throw new Error(`Failed quotes.json: ${res.status}`);
        const data: unknown = await res.json();
        if (!alive) return;

        if (!Array.isArray(data)) {
          setPassages([]);
          return;
        }

        const list = data
          .map((q: any) => (typeof q?.text === "string" ? q.text.trim() : ""))
          .filter(Boolean);

        setPassages(list);
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setPassages([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);


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

        if (!alive) return;

        setWordLists({ short, medium, long, mixed });
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setWordLists({ short: [], medium: [], long: [], mixed: [] });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  function resetSamePrompt() {
    setInput("");
    setStartedAt(null);
    setEndedAt(null);
    setSamples([]);
    setMistakeSeconds([]);
    setTimeout(() => typeAreaRef.current?.focus(), 0);
  }

  function nextPrompt() {
    if (contentMode === "passage") {
      setPassageIndex((p) => {
        if (!passages.length) return p;

        let next = p;

        while (passages.length > 1 && next === p) {
          next = Math.floor(Math.random() * passages.length);
        }
        return next;
      });
      return;
    }

    setPrompt(regeneratePrompt(wordLists, wordListMode, wordCount, contentMode, passages, passageIndex, toggles));
    resetSamePrompt();
  }

  function recordMistake() {
    const start = startedAtRef.current;
    if (start == null) return;

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
    const typed = inputRef.current;
    const correctChars = countCorrectChars(typed, prompt);

    const rawWpm = minutes === 0 ? 0 : (typed.length / 5) / minutes;
    const corrWpm = minutes === 0 ? 0 : (correctChars / 5) / minutes;

    setSamples((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.floor(last.tSec) === Math.floor(tSec)) {
        return [...prev.slice(0, -1), { tSec, rawWpm, corrWpm }];
      }

      return [...prev, { tSec, rawWpm, corrWpm }];
    });
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
      if (done) nextPrompt();
      return;
    }

    if (done) return;
    if (!prompt) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const isPrintable = e.key.length === 1;

    if (startedAtRef.current == null && isPrintable) {
      const start = nowMs();
      setStartedAt(start);
      startedAtRef.current = start;
      setMistakeSeconds([]);
      setSamples([{ tSec: 1, rawWpm: 0, corrWpm: 0 }]);
    }

    if (e.key === "Backspace") {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (!isPrintable) return;

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

  if (done && stats) {
    return (
      <StatsScreen
        stats={stats}
        samples={samples}
        mistakeSeconds={mistakeSeconds}
        onRetry={resetSamePrompt}
        onNextPrompt={nextPrompt}
        onHistory={props.onHistory}
        onBack={props.onBack}
      />
    );
  }

  const CARET_SCALE = 0.6;
  const caretH = Math.max(12, caret.h * CARET_SCALE);

  return (
    <div className="page">
      <div className="container">
        <h1 className="title">Multitype</h1>

        <div className="settingsCard">
          <div className="settingsRow">
            <div className="segmented">
              <button
                className={`segBtn ${contentMode === "words" ? "active" : ""}`}
                onClick={() => setContentMode("words")}
              >
                Words
              </button>

              <button
                className={`segBtn ${contentMode === "passage" ? "active" : ""}`}
                onClick={() => {
                  setContentMode("passage");
                  if (passages.length) setPassageIndex(Math.floor(Math.random() * passages.length));
                }}
              >
                Passage
              </button>
            </div>

            {contentMode === "passage" ? (
              <button
                className="btn"
                onClick={() => setPassageIndex((p) => p + 1)}
                disabled={!passages.length}
              >
                Next passage
              </button>
            ) : (
              <div className="toggleGroup">
                <button
                  className={`toggleBtn ${toggles.punctuation ? "on" : ""}`}
                  onClick={() => setToggles((t) => ({ ...t, punctuation: !t.punctuation }))}
                >
                  Punctuation: {toggles.punctuation ? "On" : "Off"}
                </button>

                <button
                  className={`toggleBtn ${toggles.numbers ? "on" : ""}`}
                  onClick={() => setToggles((t) => ({ ...t, numbers: !t.numbers }))}
                >
                  Numbers: {toggles.numbers ? "On" : "Off"}
                </button>
              </div>
            )}
          </div>

          {contentMode === "words" && (
            <div className="settingsRow">
              <div className="pillRow">
                {(["short", "medium", "long", "mixed"] as WordListMode[]).map((m) => (
                  <button
                    key={m}
                    className={`pill ${wordListMode === m ? "active" : ""}`}
                    onClick={() => setWordListMode(m)}
                    disabled={!wordLists}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="pillRow">
                {[10, 20, 50, 100].map((n) => (
                  <button
                    key={n}
                    className={`pill ${wordCount === n ? "active" : ""}`}
                    onClick={() => setWordCount(n as WordCount)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
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

            {wordsWithStart.map(({ word, start }, wi) => {
              const isLast = wi === wordsWithStart.length - 1;

              return (
                <span key={wi} className="word">
                  {word.split("").map((ch, j) => {
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
                        {ch}
                      </span>
                    );
                  })}

                  {!isLast && (() => {
                    const i = start + word.length;
                    const typed = input[i];
                    const isTyped = typed !== undefined;
                    const isCorrect = isTyped && typed === " ";

                    const cls = [
                      "promptChar",
                      !isTyped ? "untyped" : "",
                      isTyped && isCorrect ? "correct" : "",
                      isTyped && !isCorrect ? "wrong" : "",
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
        </div>

        <div className="row center" style={{ marginTop: 14 }}>
          <button className="btn" onClick={props.onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
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
  onRetry: () => void;
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

        <div className="row center" style={{ marginTop: 10 }}>
          <button className="btn" onClick={props.onBack}>
            Back
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

  const rawVals = samples.map((s) => s.rawWpm);
  const corrVals = samples.map((s) => s.corrWpm);
  const allVals = [...rawVals, ...corrVals];

  const maxWpm = Math.max(10, ...allVals);
  const minWpm = Math.min(1, ...allVals);

  const span = Math.max(1, maxWpm - minWpm);

  const toX = (t: number) => x0 + ((x1 - x0) * (t - minT)) / tSpan;
  const toY = (wpm: number) => {
    const norm = (wpm - minWpm) / span;
    return y0 - (y0 - y1) * norm;
  };

  const rawPoly = samples
    .map((s) => {
      const t = Math.max(minT, secAt(s.tSec));
      return `${toX(t)},${toY(s.rawWpm)}`;
    })
    .join(" ");

  const corrPoly = samples
    .map((s) => {
      const t = Math.max(minT, secAt(s.tSec));
      return `${toX(t)},${toY(s.corrWpm)}`;
    })
    .join(" ");

  const yTicks = 4;
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
              <line x1={x0} x2={x1} y1={y} y2={y} stroke="currentColor" opacity="0.12" />
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
              <line x1={x} x2={x} y1={y1} y2={y0} stroke="currentColor" opacity="0.10" />
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
            points={rawPoly} 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            opacity="0.25" 
        />
        <polyline 
            points={corrPoly} 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="3" 
            opacity="0.95" 
        />

        {samples.map((s, idx) => {
          const sec = Math.max(minT, secAt(s.tSec));
          if (mistakeSet.has(sec)) return null;
          return (
            <circle
              key={idx}
              cx={toX(sec)}
              cy={toY(s.corrWpm)}
              r="3"
              fill="currentColor"
              opacity="0.9"
            />
          );
        })}

        {mistakeSeconds.map((sec) => {
          const s = sampleBySec.get(sec);
          if (!s) return null;

          const x = toX(Math.max(1, sec));
          const y = toY(s.corrWpm);
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

function randInt(lo: number, hi: number) {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function pickPunct() {
    const P = [".", ",", "!", "?", ";", ":"];
    return P[Math.floor(Math.random() * P.length)];
}

function sampleNonAdjacentIndices(n: number, k:number) {
    if(k <= 0) {
        return [];
    }
    const maxK = Math.ceil(n / 2);
    k = Math.min(k, maxK);

    const picked: number[] = [];
    const forbidden = new Set<number>();

    let tries = 0;
    while(picked.length < k && tries < 500) {
        tries++;
        const i = randInt(0, n - 1);
        if(forbidden.has(i)) {
            continue;
        }
        picked.push(i);
        forbidden.add(i);
        forbidden.add(i - 1);
        forbidden.add(i + 1);
    }

    if(picked.length === k) {
        return picked;
    }

    picked.length = 0;
    for(let i = 0; i < n && picked.length  < k; i += 2) {
        picked.push(i);
    }
    return picked;
}

function makeNumberToken() {
    const x = randInt(0, 9999);
    return String(x);
}

function applyTogglesToText(text: string, t: Toggles) {
    let out = text;
    if(!t.numbers) {
        out = out.replace(/[0-9]/g, "");
    }

    if(!t.punctuation) {
        out = out.replace(/[^\p{L}\p{N}\s]/gu, "");
    }

    out = out.replace(/\s+/g, " ").trim();
    return out;
}

function generateWordsPrompt(list: string[], wordCount: WordCount, t: Toggles) {
    const tokens: string[] = new Array(wordCount);

    let numCount = 0;
    if(t.numbers) {
        const target = Math.max(1, Math.floor(wordCount * 0.12));
        numCount = Math.min(target, 3, wordCount);
    }

    const numberPositions = new Set<number>();
    while(numberPositions.size < numCount) {
        numberPositions.add(randInt(0, wordCount - 1));
    }

    for(let i = 0; i < wordCount; i++) {
        if(numberPositions.has(i)) {
            tokens[i] = makeNumberToken();
        }
        else {
            tokens[i] = pickWord(list);
        }
    }

    if(t.punctuation && wordCount > 0) {
        const punctCount = Math.max(1, Math.floor(wordCount * 0.25));
        const punctIdxs = sampleNonAdjacentIndices(wordCount, punctCount);

        if(punctIdxs.length === 0) {
            punctIdxs.push(0);
        }

        for(const idx of punctIdxs) {
            if(/^\d+$/.test(tokens[idx])) {
                continue;
            }
            tokens[idx] = tokens[idx] + pickPunct();
        }

        const hasAnyPunct = tokens.some((x) => /[.,!?;:]$/.test(x));
        if(!hasAnyPunct) {
            const firstWordIdx = tokens.findIndex((x) => !/^\d+$/.test(x));
            if(firstWordIdx >= 0) {
                tokens[firstWordIdx] = tokens[firstWordIdx] + pickPunct();
            }
            else {
                tokens[0] = tokens[0] + pickPunct();
            }
        }
    }
    return tokens.join(" ").trim();
}

function generatePassagePrompt(passages: string[], idx: number, t: Toggles) {
    if(!passages.length) {
        return "";
    }

    return applyTogglesToText(passages[idx % passages.length], t);
}

function passageToggles(t: Toggles) : Toggles {
    return { ...t, punctuation: true };
}

/*
function applyTogglesToText(text: string, t: Toggles) {
  let out = text;

  if (!t.numbers) {
    out = out.replace(/[0-9]/g, "");
  }

  if (!t.punctuation) {
    out = out.replace(/[^\p{L}\p{N}\s]/gu, "");
  }

  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function generateWordsPrompt(list: string[], wordCount: WordCount, t: Toggles) {
  const out: string[] = [];
  for (let i = 0; i < wordCount; i++) out.push(pickWord(list));
  return applyTogglesToText(out.join(" "), t);
}
*/


function regeneratePrompt(
  wordLists: Record<WordListMode, string[]> | null,
  wordListMode: WordListMode,
  wordCount: WordCount,
  contentMode: ContentMode,
  passages: string[],
  passageIndex: number,
  toggles: Toggles) {
  if (contentMode === "passage") {
    return generatePassagePrompt(passages, passageIndex, passageToggles(toggles));
  }

  const list = wordLists?.[wordListMode] ?? [];
  if (!list.length) return "";

  return generateWordsPrompt(list, wordCount, toggles);
}

async function fetchWordList(path: string): Promise<string[]> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);

  const text = await res.text();
  const words = text
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(words));
}

function countCorrectChars(typed: string, prompt: string) {
  let correct = 0;
  const n = Math.min(typed.length, prompt.length);

  for (let i = 0; i < n; i++) {
    if (typed[i] === prompt[i]) correct++;
  }
  return correct;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
