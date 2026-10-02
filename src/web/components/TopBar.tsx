import { browserSttAvailable, type SttMode } from "../voice";

export interface Settings {
  voice: boolean;
  autoListen: boolean;
  stt: SttMode;
}

export function TopBar(props: { sessionNumber: number | null; streak: number; settings: Settings; onSettings(s: Settings): void }) {
  const { settings: s, onSettings: set } = props;
  return (
    <header className="top">
      <div className="brand">
        <span className="brand-mark">📐</span> Quadratic Tutor
        {props.sessionNumber !== null && <span className="session-chip">Session {props.sessionNumber}</span>}
        {props.streak >= 2 && (
          <span className="streak-chip" title="Correct answers in a row">
            🔥 {props.streak} in a row
          </span>
        )}
      </div>
      <div className="settings">
        <label>
          <input type="checkbox" checked={s.voice} onChange={(e) => set({ ...s, voice: e.target.checked })} /> Voice
        </label>
        <label>
          <input type="checkbox" checked={s.autoListen} onChange={(e) => set({ ...s, autoListen: e.target.checked })} /> Hands-free
        </label>
        <a href="/insights" title="How the tutor is doing, from the turn log">
          Insights
        </a>
        <label>
          STT
          <select value={s.stt} onChange={(e) => set({ ...s, stt: e.target.value as SttMode })}>
            <option value="browser" disabled={!browserSttAvailable()}>
              Browser
            </option>
            <option value="server">Server</option>
          </select>
        </label>
      </div>
    </header>
  );
}
