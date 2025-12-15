import { useMemo, useState, useEffect, useRef } from 'react'

import './App.css'

const PROMPTS = [
  "The quick brown fox jumps over the lazy dog. Practice makes Progress!",
  "My mathematics final grade just came out and I got a score that I didn't expect, 28.75 / 32 instead of what I thought I would get.",
  "Hopefully my EECS 281 and EECS 370 grades are like my Math 425 grade where I thought I did worse than I actually did",
];

function nowMs() {
  return performance.now();
}

type Stats = {
  wpm: number,
  accuracy: number,
  elapsedMs: number,
  correct: number,
  mistakes: number,
};

type Sample = { tSec: number; wpm: number};

export default function App() {
  const [promptIndex, setPromptIndex] = useState(0);
  const prompt = PROMPTS[promptIndex];

  const [input, setInput] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);

  const [samples, setSamples] = useState<Sample[]>([]);

  const done = input.length >= prompt.length;

  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const stats: Stats | null = useMemo(() => {
    if (startedAt == null) {
      return null;
    }
    const end = endedAt ?? nowMs();
    const elapsedMs = Math.max(1, end - startedAt);

    let correct = 0;
    let mistakes = 0;
    for (let i = 0; i < Math.min(input.length, prompt.length); i++) {
      if (input[i] == prompt[i]) {
        correct++;
      }
      else {
        mistakes++;
      }
    }

    const accuracy = input.length === 0 ? 100 : (correct / input.length) * 100;

    const minutes = elapsedMs / 60000;
    const wpm = minutes === 0 ? 0 : (input.length / 5) / minutes;

    return { wpm, accuracy, elapsedMs, correct, mistakes };
  }, [input, startedAt, endedAt]);

  useEffect(() => {
    if(startedAt == null) {
      return;
    }
    if(endedAt != null) {
      return;
    }
    const id = window.setInterval(() => {
      const elapsedMs = Math.max(1, nowMs() - startedAt);
      const minutes = elapsedMs / 60000;
      const wpm = minutes === 0 ? 0 : (inputRef.current.length / 5) / minutes;
      const tSec = elapsedMs / 1000;

      setSamples((prev) => {
        const last = prev[prev.length - 1];
        if(last && Math.floor(last.tSec) === Math.floor(tSec)) {
          return[...prev.slice(0, -1), { tSec, wpm }];
        }
        return [...prev, { tSec, wpm }];
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, endedAt]);

  function resetSamePrompt() {
    setInput("");
    setStartedAt(null);
    setEndedAt(null);
    setSamples([]);
  }

  function nextPrompt() {
    setPromptIndex((i) => (i + 1) % PROMPTS.length);
    setInput("");
    setStartedAt(null);
    setEndedAt(null);
    setSamples([]);
  }

  function handleChange(nextRaw: string) {
    if (startedAt == null && nextRaw.length > 0) {
      setStartedAt(nowMs());
    }

    const next = nextRaw.slice(0, prompt.length);
    setInput(next);

    if (next.length >= prompt.length) {
      const end = nowMs();
      setEndedAt(nowMs());
      if(startedAt != null) {
        const elapsedMs = Math.max(1, end - startedAt);
        const minutes = elapsedMs / 60000;
        const wpm = minutes === 0 ? 0 : (next.length / 5 ) / minutes;
        setSamples((prev) => [...prev, { tSec: elapsedMs / 1000, wpm}]);
      }
    }
    else {
      setEndedAt(null);
    }
  }

  if (done && stats) {
    return (
      <StatsScreen stats={stats} samples={samples} onRetry={resetSamePrompt} onNextPrompt={nextPrompt}/>
    )
  }

  return (
    <div className="page">
      <div className="container">
        <header className="header"></header>
        <h1 className="title">MultiType</h1>
        <p className="subtitle">
          Training Mode - type the prompt below.
        </p>

        <div className="promptBox">
          {prompt.split("").map((ch, i) => {
            const typed = input[i];
            const isTyped = typed !== undefined;
            const isCorrect = isTyped && typed === ch;
            const isCursor = i === input.length;

            return (
              <span
                key={i}
                className={[
                  "promptChar",
                  isCursor ? "cursor" : "",
                  isTyped && !isCorrect ? "wrong" : "",
                ].join(" ")}
              >
                {ch}
              </span>
            );
          })}
        </div>

        <textarea
          className="typeBox"
          autoFocus
          spellCheck={false}
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          disabled={done}
          placeholder="Start typing here..."
        />

        <div className="row">
          <StatCard
            label="WPM"
            value={stats ? stats.wpm.toFixed(1) : "-"}
          />
          <StatCard
            label="Accuracy"
            value={stats ? `${stats.accuracy.toFixed(1)}%` : "-"}
          />
          <StatCard
            label="Time"
            value={stats ? `${(stats.elapsedMs / 1000).toFixed(2)}s` : "-"}
          />

          <button className="btn" onClick={resetSamePrompt}>
            Reset
          </button>

          <button className="btn primary" onClick={nextPrompt}>
            Next
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
  onRetry: () => void
  onNextPrompt: () => void;
}) {
  const { stats, samples } = props;

  return (
    <div className="page">
      <div className="container">
        <header className="header">
          <h1 className="title">Run Complete</h1>
          <p className="subtitle">Here are your stats for this run</p>
        </header>

        <div className="statsGrid">
          <StatCard label="WPM" value={stats.wpm.toFixed(1)} />
          <StatCard label="Accuracy" value={`${stats.accuracy.toFixed(1)}%`} />
          <StatCard label="Time" value={`${(stats.elapsedMs / 1000).toFixed(2)}s`} />
          <StatCard label="Correct" value={`${stats.correct}`} />
          <StatCard label="Mistakes" value={`${stats.mistakes}`} />
        </div>

        <div style={{marginTop: 16}}>
          <div className="cardLabel" style={{ marginBottom: 8}}>
            WPM over time
          </div>
          <WpmChart samples={samples} />
        </div>

        <div className="row">
          <button className="btn primary" onClick={props.onRetry}>
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

function WpmChart(props: { samples: Sample[] }) {
  const { samples } = props;
  const W = 900;
  const H = 220;
  const pad = 20;

  if(!samples || samples.length < 2) {
    return (
      <div className="card" style={{ minWidth: 0}}>
        <div className="cardLabel">
          Not enough data yet (type longer).
        </div>
      </div>
    )
  }

  const maxT = Math.max(...samples.map((s) => s.tSec));
  const maxWpm = Math.max(10, ...samples.map((s) => s.wpm));
  const minWpm = Math.min(...samples.map((s) => s.wpm));

  const toX = (t: number) => pad + ((W - 2 * pad) * (t / maxT));
  const toY = (wpm: number) => {
    const span = Math.max(1, maxWpm - minWpm);
    const norm = (wpm - minWpm) / span;
    return H - pad - (H - 2 * pad) * norm;
  };

  const points = samples.map((s) => `${toX(s.tSec)},${toY(s.wpm)}`).join(" ");

  return (
    <div className="card" style={{ minWidth: 0}}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="220">
        <rect x="0" y="0" width={W} height={H} fill="none" stroke="currentColor" opacity="0.15"/>
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" opacity="0.9"/>
      </svg>
      <div className="cardLabel" style={{ marginTop: 6 }}>
        peak {maxWpm.toFixed(1)} WPM
      </div>
    </div>
  );
}