import { useCallback, useEffect, useRef, useState } from "react";
import type { InputSource, ProgressRow, TurnView } from "../core/api";
import type { BoardItem } from "../core/types";
import { api, ApiError } from "./api";
import { AnswerControls, type Phase } from "./components/AnswerControls";
import type { LogEntry } from "./components/DecisionLog";
import { ProgressRail } from "./components/ProgressRail";
import { SidePanel, type ChatLine } from "./components/SidePanel";
import { TopBar, type Settings } from "./components/TopBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Whiteboard } from "./components/Whiteboard";
import { load, save } from "./storage";
import { browserSttAvailable, serverSttAvailable, VoiceLoop, type SttMode } from "./voice";

// The tutor screen. The voice loop is: Tara speaks → (hands-free) listen →
// transcript → POST /api/turn → apply the turn → Tara speaks…
//
// `turnToken` is the guard against races: every user action (speaking,
// typing, Repeat) and every new turn takes a new token, and the async
// continuation of an older turn (e.g. "she finished speaking, open the mic")
// checks it and gives up if it is stale.

interface PendingSend {
  clientTurnId: string;
  text: string;
  source: InputSource;
  sttMs?: number;
}

const STUDENT_KEY = "qt.studentId";
const SETTINGS_KEY = "qt.settings";

export function App() {
  const [phase, setPhase] = useState<Phase>("welcome");
  const [studentId, setStudentId] = useState<string | null>(() => load<string | null>(STUDENT_KEY, null));
  const [sessionNumber, setSessionNumber] = useState<number | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [caption, setCaption] = useState("");
  const [interim, setInterim] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [inReview, setInReview] = useState(false);
  const [badge, setBadge] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(() => load(SETTINGS_KEY, { voice: true, autoListen: true, stt: browserSttAvailable() ? "browser" : "server" }));

  const voice = useRef<VoiceLoop | null>(null);
  voice.current ??= new VoiceLoop();
  const turnToken = useRef(0);
  const pending = useRef<PendingSend | null>(null);
  const lastTtsMs = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Read through a ref: the first auto-listen starts before React re-renders with the new session id.
  const sessionRef = useRef<string | null>(null);

  useEffect(() => save(SETTINGS_KEY, settings), [settings]);
  useEffect(() => () => voice.current?.interrupt(), []);

  // ---------------------------------------------------------------- applying a tutor turn

  const applyTurn = useCallback(async (t: TurnView, studentText: string | null) => {
    const token = ++turnToken.current;
    setBoard(t.board);
    setProgress(t.progress);
    setCaption(t.speech);
    setChat((c) => [...c, ...(studentText ? [{ role: "student" as const, text: studentText }] : []), { role: "tutor", text: t.speech }]);
    setLog((l) => [
      ...l.filter((e) => e.seq !== t.seq),
      { seq: t.seq, studentText, action: t.decision.action, reason: t.decision.reason, correct: t.assessment?.correct ?? null, degraded: t.degraded, totalMs: t.timings.totalMs },
    ]);
    setNotice(t.degraded ? "The AI service is struggling, so I'm using backup lessons for a moment." : null);
    setStreak(t.streak);
    setInReview(t.review);
    if (t.celebrate) {
      setBadge(t.celebrate.label);
      setTimeout(() => setBadge(null), 6000);
    }

    if (settingsRef.current.voice && voice.current!.canSpeak) {
      setPhase("speaking");
      const t0 = performance.now();
      const outcome = await voice.current!.speak(t.speech, t.speechRate);
      lastTtsMs.current = Math.round(performance.now() - t0);
      // Interrupted (barge-in, typing, Repeat) or superseded: whoever interrupted owns the phase now.
      if (outcome === "interrupted" || token !== turnToken.current) return;
    }
    if (t.complete) return setPhase("complete");
    setPhase("idle");
    if (settingsRef.current.voice && settingsRef.current.autoListen) startListening();
    // No deps: everything it touches is a ref, a state setter, or startListening, which is itself stable.
  }, []);

  // ---------------------------------------------------------------- sending a student turn

  const submit = useCallback(
    async (send: PendingSend) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;
      turnToken.current++;
      voice.current!.interrupt();
      pending.current = send;
      setPhase("thinking");
      setInterim("");
      setError(null);
      setCanRetry(false);
      let t: TurnView;
      try {
        t = await api.sendTurn(sessionId, send.clientTurnId, send.text, send.source, { sttMs: send.sttMs ?? 0, prevTtsMs: lastTtsMs.current });
      } catch (err) {
        if (err instanceof ApiError && err.code === "session_closed") {
          // This tab's session ended (timed out or restarted elsewhere): carry on in a fresh one.
          pending.current = null;
          setNotice("That session had ended, so we've started a new one.");
          return void begin(false);
        }
        setError(err instanceof ApiError && err.status === 409 ? "This lesson was updated in another tab. Reload the page." : `${(err as Error).message} Your answer wasn't lost.`);
        setCanRetry(!(err instanceof ApiError && err.status === 409));
        setPhase("error");
        return;
      }
      pending.current = null;
      await applyTurn(t, send.text);
    },
    [applyTurn], // begin() only uses refs and setters, so the first render's copy is fine
  );

  const startListening = useCallback(() => {
    turnToken.current++;
    setError(null);
    setInterim("");
    const mode: SttMode = settingsRef.current.stt === "browser" && browserSttAvailable() ? "browser" : "server";
    if (mode === "server" && !serverSttAvailable()) {
      setError("This browser can't record audio. Please type your answer.");
      return setPhase("idle");
    }
    setPhase("listening");
    voice.current!.listen(
      mode,
      {
        onInterim: setInterim,
        onTranscribing: () => setPhase("transcribing"),
        onFinal: (text, source, sttMs) => {
          if (!text) {
            setPhase("idle");
            return setNotice("I didn't hear anything. Tap the mic and try again, or type below.");
          }
          setNotice(null);
          void submit({ clientTurnId: crypto.randomUUID(), text, source, sttMs });
        },
        onError: (message, recoverable) => {
          if (recoverable && mode === "browser" && serverSttAvailable()) {
            // Browser STT failed (e.g. offline speech service) → switch to server STT.
            setSettings((s) => ({ ...s, stt: "server" }));
            setNotice("Switched to server speech recognition.");
          } else {
            setError(message);
          }
          setPhase("idle");
        },
      },
      async (wav) => (await api.transcribe(wav)).text,
    );
  }, [submit]);

  // ---------------------------------------------------------------- session

  async function begin(newStudent: boolean) {
    setPhase("loading");
    setError(null);
    try {
      const res = await api.startSession(newStudent ? null : load<string | null>(STUDENT_KEY, null));
      setStudentId(res.studentId);
      save(STUDENT_KEY, res.studentId);
      sessionRef.current = res.sessionId;
      setSessionNumber(res.sessionNumber);
      const rows = res.resumed ? await api.decisionLog(res.sessionId) : [];
      setLog(rows);
      setChat(rows.flatMap((r): ChatLine[] => [...(r.studentText ? [{ role: "student" as const, text: r.studentText }] : []), { role: "tutor", text: r.tutorSpeech }]));
      await applyTurn(res.turn, null);
    } catch (err) {
      setError(`Couldn't start the lesson: ${(err as Error).message}`);
      setPhase("welcome");
    }
  }

  /** Replay Tara's last turn, instantly and locally (no server round trip). */
  async function replay(rate: number) {
    if (!caption || !voice.current!.canSpeak) return;
    turnToken.current++;
    setPhase("speaking");
    if ((await voice.current!.speak(caption, rate)) === "done") setPhase("idle");
  }

  function onMic() {
    if (phase === "listening") voice.current!.finishListening();
    else startListening();
  }

  // Space toggles the mic, unless focus is on something Space already operates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code !== "Space" || e.repeat || el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el?.tagName ?? "")) return;
      if (phase !== "listening" && phase !== "idle" && phase !== "speaking") return;
      e.preventDefault();
      onMic();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------------- render

  if (phase === "welcome" || (phase === "loading" && !sessionRef.current)) {
    return <WelcomeScreen loading={phase === "loading"} returning={!!studentId} error={error} onStart={begin} />;
  }

  const busy = phase === "thinking" || phase === "transcribing" || phase === "loading";
  return (
    <div className="app">
      <TopBar sessionNumber={sessionNumber} streak={streak} settings={settings} onSettings={setSettings} />
      <main className="main">
        <ProgressRail rows={progress} />

        <section className="stage">
          {inReview && <div className="review-banner">Warm-up: a quick question from a topic you mastered before, to check it stuck.</div>}
          {badge && (
            <div className="fixed-badge" role="status">
              ✨ You fixed it: <strong>{badge}</strong>
            </div>
          )}
          <Whiteboard items={board} />

          <div className="caption" aria-live="polite">
            <span className="caption-who">Tara</span>
            <span className="caption-text">{caption}</span>
            {caption && settings.voice && (
              <span className="caption-actions">
                <button className="btn small" onClick={() => replay(1)} disabled={busy} title="Hear that again">
                  ↻ Repeat
                </button>
                <button className="btn small" onClick={() => replay(0.75)} disabled={busy} title="Hear that again, slower">
                  🐢 Slower
                </button>
              </span>
            )}
          </div>

          {notice && <div className="notice">{notice}</div>}
          {error && (
            <div className="error-bar">
              <span>{error}</span>
              {canRetry && pending.current && (
                <button className="btn small" onClick={() => pending.current && submit(pending.current)}>
                  Retry
                </button>
              )}
            </div>
          )}

          <AnswerControls phase={phase} interim={interim} onMic={onMic} onSend={(text) => submit({ clientTurnId: crypto.randomUUID(), text, source: "typed" })} />
        </section>

        <SidePanel log={log} chat={chat} />
      </main>
    </div>
  );
}
