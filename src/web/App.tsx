import { useCallback, useEffect, useRef, useState } from "react";
import type { InputSource, ProgressRow, TurnView } from "../core/api";
import type { BoardItem } from "../core/types";
import { api, ApiError } from "./api";
import { DecisionLog, type LogEntry } from "./components/DecisionLog";
import { ProgressRail } from "./components/ProgressRail";
import { Whiteboard } from "./components/Whiteboard";
import { browserSttAvailable, listenWithBrowser, listenWithServer, serverSttAvailable, Speaker, type Listener } from "./voice";

type Phase = "welcome" | "loading" | "speaking" | "idle" | "listening" | "transcribing" | "thinking" | "error" | "complete";
type SttMode = "browser" | "server";

interface ChatLine {
  role: "tutor" | "student";
  text: string;
}

interface PendingSend {
  clientTurnId: string;
  text: string;
  source: InputSource;
  sttMs?: number;
}

const STUDENT_KEY = "qt.studentId";
const SETTINGS_KEY = "qt.settings";

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode); fine
  }
}

export function App() {
  const [phase, setPhase] = useState<Phase>("welcome");
  const [studentId, setStudentId] = useState<string | null>(() => load<string | null>(STUDENT_KEY, null));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [caption, setCaption] = useState("");
  const [interim, setInterim] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [tab, setTab] = useState<"why" | "chat">("why");
  const [settings, setSettings] = useState(() =>
    load(SETTINGS_KEY, { voice: true, autoListen: true, stt: (browserSttAvailable() ? "browser" : "server") as SttMode }),
  );

  const speaker = useRef<Speaker | null>(null);
  const listener = useRef<Listener | null>(null);
  const pending = useRef<PendingSend | null>(null);
  const lastTts = useRef<number>(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Read through a ref: the first auto-listen starts before React re-renders with the new session id.
  const sessionRef = useRef<string | null>(null);

  useEffect(() => save(SETTINGS_KEY, settings), [settings]);
  useEffect(() => {
    speaker.current = new Speaker();
    return () => speaker.current?.cancel();
  }, []);

  // ---------------------------------------------------------------- listening

  const submit = useCallback(async (send: PendingSend) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;
      pending.current = send;
      setPhase("thinking");
      setInterim("");
      setError(null);
      setChat((c) => [...c, { role: "student", text: send.text }]);
      try {
        const t = await api.sendTurn(sessionId, send.clientTurnId, send.text, send.source, { sttMs: send.sttMs ?? 0, prevTtsMs: lastTts.current });
        pending.current = null;
        await applyTurn(t, send.text);
      } catch (err) {
        setChat((c) => c.slice(0, -1));
        setError(err instanceof ApiError && err.status === 409 ? "This lesson was updated in another tab. Reload the page." : `${(err as Error).message} Your answer wasn't lost — press Retry.`);
        setPhase("error");
      }
    }, []);

  const startListening = useCallback(() => {
    speaker.current?.cancel(); // barge-in: talking over the tutor stops it
    listener.current?.abort();
    setError(null);
    setInterim("");
    const mode: SttMode = settingsRef.current.stt === "browser" && browserSttAvailable() ? "browser" : "server";
    if (mode === "server" && !serverSttAvailable()) {
      setError("This browser can't record audio. Please type your answer.");
      setPhase("idle");
      return;
    }
    setPhase("listening");
    const cb = {
      onInterim: setInterim,
      onTranscribing: () => setPhase("transcribing"),
      onFinal: (text: string, source: InputSource, sttMs: number) => {
        listener.current = null;
        if (!text) {
          setPhase("idle");
          setNotice("I didn't hear anything. Tap the mic and try again, or type below.");
          return;
        }
        setNotice(null);
        void submit({ clientTurnId: crypto.randomUUID(), text, source, sttMs });
      },
      onError: (message: string, recoverable: boolean) => {
        listener.current = null;
        if (recoverable && mode === "browser" && serverSttAvailable()) {
          // Browser STT failed (e.g. offline speech service) → switch to server STT.
          setSettings((s) => ({ ...s, stt: "server" }));
          setNotice("Switched to server speech recognition.");
        } else {
          setError(message);
        }
        setPhase("idle");
      },
    };
    listener.current = mode === "browser" ? listenWithBrowser(cb) : listenWithServer(cb, async (wav) => (await api.transcribe(wav)).text);
  }, [submit]);

  const stopListening = () => listener.current?.stop();

  // ---------------------------------------------------------------- tutor turn

  async function applyTurn(t: TurnView, studentText: string | null) {
    setBoard(t.board);
    setProgress(t.progress);
    setCaption(t.speech);
    setChat((c) => [...c, { role: "tutor", text: t.speech }]);
    setLog((l) => [
      ...l.filter((e) => e.seq !== t.seq),
      { seq: t.seq, studentText, action: t.decision.action, reason: t.decision.reason, correct: t.assessment?.correct ?? null, degraded: t.degraded, totalMs: t.timings.totalMs },
    ]);
    setNotice(t.degraded ? "The AI service is struggling, so I'm using backup lessons for a moment." : null);

    if (settingsRef.current.voice && speaker.current?.available) {
      setPhase("speaking");
      const t0 = performance.now();
      await speaker.current.speak(t.speech);
      lastTts.current = Math.round(performance.now() - t0);
    }
    if (t.complete) {
      setPhase("complete");
      return;
    }
    setPhase((p) => (p === "speaking" || p === "thinking" || p === "loading" ? "idle" : p));
    if (settingsRef.current.voice && settingsRef.current.autoListen) startListening();
  }

  // ---------------------------------------------------------------- session

  async function begin(forceNewStudent = false) {
    setPhase("loading");
    setError(null);
    const sid = forceNewStudent ? null : studentId;
    try {
      const res = await api.startSession(sid);
      setStudentId(res.studentId);
      save(STUDENT_KEY, res.studentId);
      sessionRef.current = res.sessionId;
      setSessionId(res.sessionId);
      if (res.resumed) {
        const rows = await api.decisionLog(res.sessionId);
        setLog(rows.map((r) => ({ ...r })));
        setChat(rows.flatMap((r) => (r.studentText ? [{ role: "student" as const, text: r.studentText }] : [])));
      } else {
        setLog([]);
        setChat([]);
      }
      await applyTurn(res.turn, null);
    } catch (err) {
      setError(`Couldn't start the lesson: ${(err as Error).message}`);
      setPhase("welcome");
    }
  }

  function retry() {
    if (pending.current) void submit(pending.current);
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    if (!text || phase === "thinking" || phase === "transcribing") return;
    listener.current?.abort();
    speaker.current?.cancel();
    setTyped("");
    void submit({ clientTurnId: crypto.randomUUID(), text, source: "typed" });
  }

  // Space bar toggles the mic (outside the text box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      e.preventDefault();
      if (phase === "listening") stopListening();
      else if (phase === "idle" || phase === "speaking") startListening();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, startListening]);

  // ---------------------------------------------------------------- render

  if (phase === "welcome" || (phase === "loading" && !sessionId)) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <div className="welcome-mark">📐</div>
          <h1>Quadratic Tutor</h1>
          <p>
            Learn NCERT Class 10 quadratic equations with Tara, a voice tutor who teaches on a whiteboard, checks that you've understood, and explains things a different way when
            something doesn't click.
          </p>
          <ul className="welcome-list">
            <li>Speak your answers (or type them).</li>
            <li>Six topics, from standard form to word problems.</li>
            <li>Your progress is saved on this device.</li>
          </ul>
          <div className="welcome-actions">
            <button className="btn primary" disabled={phase === "loading"} onClick={() => begin(false)}>
              {phase === "loading" ? "Starting…" : studentId ? "Continue lesson" : "Start lesson"}
            </button>
            {studentId && (
              <button className="btn ghost" disabled={phase === "loading"} onClick={() => begin(true)}>
                Start over as a new student
              </button>
            )}
          </div>
          {!browserSttAvailable() && <p className="fine">Your browser has no built-in speech recognition, so your voice will be transcribed on our server.</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  const busy = phase === "thinking" || phase === "transcribing" || phase === "loading";
  const status: Record<Phase, string> = {
    welcome: "",
    loading: "Getting ready…",
    speaking: "Tara is speaking — tap the mic to interrupt",
    idle: "Tap the mic (or press space) to answer",
    listening: settings.stt === "browser" ? "Listening… tap to finish" : "Listening… (stops when you pause)",
    transcribing: "Transcribing…",
    thinking: "Tara is thinking…",
    error: "Something went wrong",
    complete: "Course complete!",
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark">📐</span> Quadratic Tutor
        </div>
        <div className="settings">
          <label>
            <input type="checkbox" checked={settings.voice} onChange={(e) => setSettings((s) => ({ ...s, voice: e.target.checked }))} /> Voice
          </label>
          <label>
            <input type="checkbox" checked={settings.autoListen} onChange={(e) => setSettings((s) => ({ ...s, autoListen: e.target.checked }))} /> Hands-free
          </label>
          <label>
            STT
            <select value={settings.stt} onChange={(e) => setSettings((s) => ({ ...s, stt: e.target.value as SttMode }))}>
              <option value="browser" disabled={!browserSttAvailable()}>
                Browser
              </option>
              <option value="server">Server</option>
            </select>
          </label>
        </div>
      </header>

      <main className="main">
        <ProgressRail rows={progress} />

        <section className="stage">
          <Whiteboard items={board} />

          <div className="caption" aria-live="polite">
            <span className="caption-who">Tara</span>
            <span>{caption}</span>
          </div>

          {notice && <div className="notice">{notice}</div>}
          {error && (
            <div className="error-bar">
              <span>{error}</span>
              {pending.current && (
                <button className="btn small" onClick={retry}>
                  Retry
                </button>
              )}
            </div>
          )}

          <div className="controls">
            <button
              className={`mic ${phase}`}
              aria-label={phase === "listening" ? "Stop listening" : "Start speaking"}
              disabled={busy || phase === "complete"}
              onClick={() => (phase === "listening" ? stopListening() : startListening())}
            >
              {phase === "listening" ? "■" : "🎤"}
            </button>
            <div className="status">
              <div className="status-text">{status[phase]}</div>
              <div className="interim">{interim}</div>
            </div>
          </div>

          <form className="typed" onSubmit={sendTyped}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type your answer here" disabled={busy || phase === "complete"} />
            <button className="btn" disabled={!typed.trim() || busy}>
              Send
            </button>
          </form>
        </section>

        <div className="side">
          <div className="tabs">
            <button className={tab === "why" ? "on" : ""} onClick={() => setTab("why")}>
              Decisions
            </button>
            <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
              Transcript
            </button>
          </div>
          {tab === "why" ? (
            <DecisionLog entries={log} />
          ) : (
            <div className="chat">
              {chat.map((c, i) => (
                <div key={i} className={`bubble ${c.role}`}>
                  {c.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
