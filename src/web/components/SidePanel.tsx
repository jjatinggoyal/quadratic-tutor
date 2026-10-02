import { useState } from "react";
import { DecisionLog, type LogEntry } from "./DecisionLog";

export interface ChatLine {
  role: "tutor" | "student";
  text: string;
}

/** "Why the tutor did that" and the transcript, as tabs. */
export function SidePanel(props: { log: LogEntry[]; chat: ChatLine[] }) {
  const [tab, setTab] = useState<"why" | "chat">("why");
  return (
    <div className="side">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "why"} className={tab === "why" ? "on" : ""} onClick={() => setTab("why")}>
          Decisions
        </button>
        <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
          Transcript
        </button>
      </div>
      {tab === "why" ? (
        <DecisionLog entries={props.log} />
      ) : (
        <div className="chat">
          {props.chat.map((c, i) => (
            <div key={i} className={`bubble ${c.role}`}>
              {c.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
