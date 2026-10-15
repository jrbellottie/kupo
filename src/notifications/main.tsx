import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NotificationState } from "./types";
import { formatCountdown } from "../utils/time";
import "./popup.css";

const bridge = window.kupoNotifications;
const audio = new Audio(new URL("../assets/timer-chime.wav", import.meta.url).href);
let lastSoundSequence = 0;
let lastSoundAt = 0;

export default function NotificationPopup() {
  const [state, setState] = useState<NotificationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!bridge) {
      setError("Desktop notifications require the Kupo desktop app.");
      return;
    }
    const update = (next: NotificationState) => {
      setState(next);
      audio.volume = next.volume;
      if (!next.windowOpen || next.alerts.length === 0 || next.volume === 0) {
        audio.pause();
        audio.currentTime = 0;
      }
      if (next.soundSequence > lastSoundSequence) {
        lastSoundSequence = next.soundSequence;
        // Coalesce simultaneous timers into one chime, not overlapping sounds.
        if (next.windowOpen && next.alerts.length && next.volume > 0 && Date.now() - lastSoundAt >= 1000) {
          lastSoundAt = Date.now();
          audio.currentTime = 0;
          void audio.play().catch(reason => {
            if (reason instanceof DOMException && reason.name === "AbortError") return;
            const message = reason instanceof Error ? reason.message : String(reason);
            setError(`Alert sound could not play: ${message}`);
            bridge.reportAudioError(message);
          });
        }
      }
    };
    const unsubscribe = bridge.onState(update);
    void bridge.getState().then(update).catch(reason => setError(`Could not load alerts: ${String(reason)}`));
    return unsubscribe;
  }, []);

  return <main className="popup">
    <header className="popup-header">
      <div><strong>Kupo</strong><span>Timers</span></div>
      <span className="drag-hint">Drag to move</span>
      <button type="button" className="close" aria-label="Dismiss alerts and hide timer window"
        title="Dismiss alerts and hide; running timers stay enabled" onClick={() => bridge?.hide()}>&times;</button>
    </header>
    <div className="alerts" aria-label="Timers and notifications">
      <section className="due-alerts" aria-label="Due alerts" aria-live="polite">
        {state?.alerts.map(alert => <button type="button" className="alert alert-ringing" key={alert.key}
          onClick={() => bridge?.dismiss(alert.key)} aria-label={`Dismiss: ${alert.body}`}>
          <strong>{alert.title}</strong>
          <span>{alert.body}</span>
          <small>Due - click to dismiss</small>
        </button>)}
      </section>
      {!!state?.timers.length && <h2>Upcoming - soonest first</h2>}
      {state?.timers.map(timer => <div className="running-timer" key={timer.id}>
        <strong>{timer.label}</strong>
        <span className="countdown">{formatCountdown(timer.targetEarthMs - nowMs)}</span>
      </div>)}
      {state && !state.alerts.length && !state.timers.length && <p className="empty">No running timers or pending alerts.</p>}
    </div>
    <footer>
      <button type="button" disabled={!state?.alerts.length} onClick={() => bridge?.dismissAll()}>Dismiss all alerts</button>
    </footer>
    {(error || state?.error) && <p className="popup-error" role="alert">{error || state?.error}</p>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<NotificationPopup />);
