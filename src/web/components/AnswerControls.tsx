import { useState } from "react";

export type Phase = "welcome" | "loading" | "speaking" | "idle" | "listening" | "transcribing" | "thinking" | "error" | "complete";

const STATUS: Record<Phase, string> = {
  welcome: "",
  loading: "Getting ready…",
  speaking: "Tara is speaking — tap the mic to interrupt",
  idle: "Tap the mic (or press space) to answer",
  listening: "Listening… tap to finish",
  transcribing: "Transcribing…",
  thinking: "Tara is thinking…",
  error: "Something went wrong",
  complete: "Course complete!",
};

/** Mic button, status line and the typed-answer fallback. */
export function AnswerControls(props: { phase: Phase; interim: string; onMic(): void; onSend(text: string): void }) {
  const [typed, setTyped] = useState("");
  const { phase } = props;
  const busy = phase === "thinking" || phase === "transcribing" || phase === "loading";
  const closed = busy || phase === "complete";

  return (
    <>
      <div className="controls">
        <button className={`mic ${phase}`} aria-label={phase === "listening" ? "Stop listening" : "Start speaking"} disabled={closed} onClick={props.onMic}>
          {phase === "listening" ? "■" : "🎤"}
        </button>
        <div className="status">
          <div className="status-text">{STATUS[phase]}</div>
          <div className="interim">{props.interim}</div>
        </div>
      </div>
      <form
        className="typed"
        onSubmit={(e) => {
          e.preventDefault();
          if (!typed.trim() || busy) return;
          props.onSend(typed.trim());
          setTyped("");
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type your answer here" aria-label="Type your answer" disabled={closed} />
        <button className="btn" disabled={!typed.trim() || busy}>
          Send
        </button>
      </form>
    </>
  );
}
