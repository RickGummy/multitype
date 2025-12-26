import { useEffect, useState } from "react";
import "./App.css";
import Multiplayer from "./Multiplayer"

import TrainingScreen from "./Training";

type Screen = "home" | "training" | "multiplayer" | "bots" | "history" | "profile";

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

type Profile = {
  displayName: string;
};

const RUN_KEYS = "multitype:runs:v1";
const PROFILE_KEY = "multitype:profile:v1";

const DEFAULT_PROFILE: Profile = {
  displayName: "Rick",
};

function normalizeRun(x: any): RunResult | null {
  if (!x || typeof x !== "object") {
    return null;
  }

  const wpmCorr =
    typeof x.wpmCorr === "number" ? x.wpmCorr :
    typeof x.wpm === "number" ? x.wpm :
    null;

  const wpmRaw =
    typeof x.wpmRaw === "number" ? x.wpmRaw :
    typeof x.wpm === "number" ? x.wpm :
    null;

  const accuracy = typeof x.accuracy === "number" ? x.accuracy : null;
  const elapsedMs = typeof x.elapsedMs === "number" ? x.elapsedMs : null;

  const id = typeof x.id === "string" && x.id ? x.id : null;

  const prompt = typeof x.prompt === "string" ? x.prompt : "";

  const endedAtIso = typeof x.endedAtIso === "string" ? x.endedAtIso : new Date().toISOString();

  if (id == null || wpmCorr == null || wpmRaw == null || accuracy == null || elapsedMs == null) {
    return null;
  }

  return {
    id,
    mode: "training",
    prompt,
    endedAtIso,
    wpmRaw,
    wpmCorr,
    accuracy,
    elapsedMs,
  };
}

function loadRuns(): RunResult[] {
  try {
    const raw = localStorage.getItem(RUN_KEYS);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const cleaned = parsed.map(normalizeRun).filter((r): r is RunResult => r != null);
    localStorage.setItem(RUN_KEYS, JSON.stringify(cleaned));

    return cleaned;
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
        typeof parsed.displayName === "string" && parsed.displayName.trim()
          ? parsed.displayName
          : DEFAULT_PROFILE.displayName,
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
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");

  if (screen === "home") {
    return (
      <HomeScreen
        onPick={(s) => {
          setScreen(s);
        }}
      />
    );
  }

  if (screen === "training") {
    return (
      <TrainingScreen
        onBack={() => setScreen("home")}
        onHistory={() => setScreen("history")}
        saveRun={saveRun}
        uid={uid}
      />
    );
  }

  if (screen === "history") {
    return <HistoryScreen onBack={() => setScreen("home")} />;
  }

  if (screen === "profile") {
    return <ProfileScreen onBack={() => setScreen("home")} />;
  }

  if (screen === "multiplayer") {
    return <Multiplayer />;
  }

  if (screen === "bots") {
    return (
      <div className="page">
        <div className="container">
          <h1 className="title">Vs Bots</h1>
          <p className="hint">Coming Soon</p>
          <div className="row center">
            <button 
              className="btn" 
              onClick={() => setScreen("home")}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
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

function HomeScreen(props: {
  onPick: (s: "training" | "multiplayer" | "bots" | "history" | "profile") => void;
}) {
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
  const bestWpm = runs.length ? Math.max(...runs.map((r) => r.wpmCorr)) : 0;
  const last10 = runs.slice(0, 10);
  const avgLast10 = last10.length ? last10.reduce((s, r) => s + r.wpmCorr, 0) / last10.length : 0;
  const wpms = runs.slice(0, 20).map((r) => r.wpmCorr).reverse();

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
          <div className="cardLabel" style={{ marginBottom: 8 }}>
            Wpm trend
          </div>
          <WpmMiniChart values={wpms} />
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="cardLabel" style={{ marginBottom: 8 }}>
            Recent runs
          </div>

          <div className="runList">
            {runs.slice(0, 12).map((r) => (
              <div key={r.id} className="runRow">
                <div className="runMain">
                  <div className="runWpm">
                    {r.wpmCorr.toFixed(1)} WPM
                    <span className="mutedSmall"> (raw {r.wpmRaw.toFixed(1)})</span>
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
          <button className="btn" onClick={props.onBack}>
            Back
          </button>
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

  const bestWpm = runs.length ? Math.max(...runs.map((r) => r.wpmCorr)) : 0;
  const last10 = runs.slice(0, 10);

  const avgLast10 = last10.length ? last10.reduce((s, r) => s + r.wpmCorr, 0) / last10.length : 0;
  const avgAccLast10 = last10.length ? last10.reduce((s, r) => s + r.accuracy, 0) / last10.length : 0;

  return (
    <div className="page">
      <div className="container">
        <h1 className="title">Profile</h1>
        <div className="card" style={{ minWidth: 0 }}>
          <div className="cardLabel" style={{ marginBottom: 6 }}>
            Display name
          </div>

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

          <div style={{ marginTop: 12 }}>
            <div className="cardLabel">Avg Accuracy (Last 10)</div>
            
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
              {avgAccLast10.toFixed(1)}%
            </div>
          </div>

          <div className="row center" style={{ marginTop: 16 }}>
            <button className="btn" onClick={props.onBack}>
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
