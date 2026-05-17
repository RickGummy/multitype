import { useEffect, useState } from "react";
import "./App.css";
import Multiplayer from "./Multiplayer"

import TrainingScreen from "./Training";

type Screen = "home" | "training" | "multiplayer" | "bots" | "history" | "profile";

type AuthUser = {
  id: string;
  username: string;
  token: string;
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

type Profile = {
  displayName: string;
};

const RUN_KEYS = "multitype:runs:v1";
const PROFILE_KEY = "multitype:profile:v1";
const AUTH_KEY = "multitype:auth:v1";

// Override via VITE_API_BASE in apps/web/.env.local (dev) or in the host's env
// (Cloudflare Pages / Vercel dashboard) for production. Defaults to localhost
// so a fresh clone works without setup.
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

const DEFAULT_PROFILE: Profile = {
  displayName: "Rick",
};

function normalizeRun(x: unknown): RunResult | null {
  if (!x || typeof x !== "object") {
    return null;
  }

  const r = x as Record<string, unknown>;

  const wpmCorr =
    typeof r.wpmCorr === "number" ? r.wpmCorr :
    typeof r.wpm === "number" ? r.wpm :
    null;

  const wpmRaw =
    typeof r.wpmRaw === "number" ? r.wpmRaw :
    typeof r.wpm === "number" ? r.wpm :
    null;

  const accuracy = typeof r.accuracy === "number" ? r.accuracy : null;
  const elapsedMs = typeof r.elapsedMs === "number" ? r.elapsedMs : null;

  const id = typeof r.id === "string" && r.id ? r.id : null;

  const prompt = typeof r.prompt === "string" ? r.prompt : "";

  const endedAtIso = typeof r.endedAtIso === "string" ? r.endedAtIso : new Date().toISOString();

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

function loadAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== "string" || typeof parsed.username !== "string") return null;
    return parsed as AuthUser;
  } catch {
    return null;
  }
}

function saveAuthUser(user: AuthUser) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

function clearAuthUser() {
  localStorage.removeItem(AUTH_KEY);
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => loadAuthUser());

  function handleAuthChange(user: AuthUser | null) {
    if (user) {
      saveAuthUser(user);
    } else {
      clearAuthUser();
    }
    setCurrentUser(user);
  }

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
    return <ProfileScreen onBack={() => setScreen("home")} currentUser={currentUser} onAuthChange={handleAuthChange} />;
  }

  if (screen === "multiplayer") {
    return <Multiplayer onExit={() => setScreen("home")} token={currentUser?.token} />;
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



  // With <2 points we can't derive a meaningful scale (0 points = Infinity,
  // 1 point = min===max collapses the y-axis), so fall back to a fixed 0-100
  // WPM scale. yTicks=5 then renders nicely as 0, 20, 40, 60, 80, 100.
  const useFixedScale = values.length < 2;
  const minV = useFixedScale ? 0 : Math.min(...values);
  const maxV = useFixedScale ? 100 : Math.max(...values);
  const span = Math.max(1, maxV - minV);

  const x0 = padL;
  const x1 = W - padR;
  const y0 = H - padB;
  const y1 = padT;

  // With a single point, (length - 1) is 0 -> NaN x. Center it instead.
  const toX = (i: number) =>
    values.length === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (values.length - 1);
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

function ProfileScreen(props: {
  onBack: () => void;
  currentUser: AuthUser | null;
  onAuthChange: (user: AuthUser | null) => void;
}) {
  const { currentUser, onAuthChange } = props;
  const [name, setName] = useState(() => loadProfile().displayName);
  const [runs, setRuns] = useState<RunResult[]>(() => loadRuns());

  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  type MpRace = { wpm?: number; accuracy?: number; prompt_mode?: string; placement?: number };
  type MpStats = {
    overall?: { races?: number; best_wpm?: number; avg_wpm?: number };
    recent?: MpRace[];
  };
  const [mpStats, setMpStats] = useState<MpStats | null>(null);
  const [mpLoading, setMpLoading] = useState(false);

  useEffect(() => {
    setRuns(loadRuns());
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      saveProfile({ displayName: name.trim() || DEFAULT_PROFILE.displayName });
    }, 400);
    return () => window.clearTimeout(id);
  }, [name]);

  useEffect(() => {
    if (!currentUser) {
      setMpStats(null);
      return;
    }
    setMpLoading(true);
    fetch(`${API_BASE}/api/profile/${currentUser.username}`)
      .then((r) => r.json())
      .then((data) => setMpStats(data))
      .catch(() => setMpStats(null))
      .finally(() => setMpLoading(false));
  }, [currentUser?.username]);

  const bestWpm = runs.length ? Math.max(...runs.map((r) => r.wpmCorr)) : 0;
  const last10 = runs.slice(0, 10);
  const avgLast10 = last10.length ? last10.reduce((s, r) => s + r.wpmCorr, 0) / last10.length : 0;
  const avgAccLast10 = last10.length ? last10.reduce((s, r) => s + r.accuracy, 0) / last10.length : 0;

  async function handleAuth() {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const url =
        authTab === "login"
          ? `${API_BASE}/api/auth/login`
          : `${API_BASE}/api/auth/register`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error ?? "Something went wrong.");
        return;
      }
      onAuthChange({ id: data.id, username: data.username, token: data.token });
    } catch {
      setAuthError("Could not reach server.");
    } finally {
      setAuthLoading(false);
    }
  }

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
        </div>

        {!currentUser ? (
          <div className="card" style={{ minWidth: 0, marginTop: 16 }}>
            <div className="cardLabel" style={{ marginBottom: 12 }}>Multiplayer account</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                className="btn"
                style={{ opacity: authTab === "login" ? 1 : 0.5 }}
                onClick={() => { setAuthTab("login"); setAuthError(null); }}
              >
                Log in
              </button>
              <button
                className="btn"
                style={{ opacity: authTab === "register" ? 1 : 0.5 }}
                onClick={() => { setAuthTab("register"); setAuthError(null); }}
              >
                Register
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 280 }}>
              <input
                className="input"
                placeholder="Username"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
              />
              <input
                className="input"
                type="password"
                placeholder="Password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAuth(); }}
              />
              {authError && (
                <div style={{ color: "#ff6b6b", fontSize: 13 }}>{authError}</div>
              )}
              <button className="btn" onClick={handleAuth} disabled={authLoading}>
                {authLoading ? "..." : authTab === "login" ? "Log in" : "Register"}
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ minWidth: 0, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div className="cardLabel">Logged in as</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{currentUser.username}</div>
              </div>
              <button className="btn" onClick={() => onAuthChange(null)}>
                Log out
              </button>
            </div>
            {mpLoading && <div className="cardLabel">Loading stats...</div>}
            {mpStats && (
              <>
                {mpStats.overall && (
                  <div className="statsGrid">
                    <StatCard label="Races" value={`${mpStats.overall.races ?? 0}`} />
                    <StatCard label="Best WPM" value={(mpStats.overall.best_wpm ?? 0).toFixed(1)} />
                    <StatCard label="Avg WPM" value={(mpStats.overall.avg_wpm ?? 0).toFixed(1)} />
                  </div>
                )}
                {mpStats.recent && mpStats.recent.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="cardLabel" style={{ marginBottom: 8 }}>Recent races</div>
                    <div className="runList">
                      {mpStats.recent.map((r, i) => (
                        <div key={i} className="runRow">
                          <div className="runMain">
                            <div className="runWpm">{(r.wpm ?? 0).toFixed(1)} WPM</div>
                          </div>
                          <div className="runPrompt">
                            {r.prompt_mode} · {(r.accuracy ?? 0).toFixed(1)}% acc · pos {r.placement}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mpStats.recent && mpStats.recent.length === 0 && (
                  <div className="cardLabel">No multiplayer races yet.</div>
                )}
              </>
            )}
          </div>
        )}

        <div className="row center" style={{ marginTop: 18 }}>
          <button className="btn" onClick={props.onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
