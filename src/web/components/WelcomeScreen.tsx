import { browserSttAvailable } from "../voice";

export function WelcomeScreen(props: { loading: boolean; returning: boolean; error: string | null; onStart(newStudent: boolean): void }) {
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
          <button className="btn primary" disabled={props.loading} onClick={() => props.onStart(false)}>
            {props.loading ? "Starting…" : props.returning ? "Continue lesson" : "Start lesson"}
          </button>
          {props.returning && (
            <button className="btn ghost" disabled={props.loading} onClick={() => props.onStart(true)}>
              Start over as a new student
            </button>
          )}
        </div>
        {!browserSttAvailable() && <p className="fine">Your browser has no built-in speech recognition, so your voice will be transcribed on our server.</p>}
        {props.error && <p className="error">{props.error}</p>}
      </div>
    </div>
  );
}
