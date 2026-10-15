import { useEffect, useState } from "react";
import { styles } from "./styles";

export default function NotificationSettings() {
  const [volume, setVolume] = useState(45);
  const [error, setError] = useState<string | null>(null);
  const bridge = window.kupoNotifications;

  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.onError(setError);
    void bridge.getSettings().then(settings => {
      setVolume(Math.round(settings.volume * 100));
      setError(settings.error);
    }).catch(reason => setError(`Could not load notification settings: ${String(reason)}`));
    return unsubscribe;
  }, [bridge]);

  const run = (action: () => Promise<unknown>) => {
    void action().catch(reason => setError(`Notification settings failed: ${String(reason)}`));
  };

  return <section style={styles.card} aria-label="Notification settings">
    <h3 style={styles.h3}>Timer popups</h3>
    <p style={styles.sub}>Watch running timers soonest first, with flashing due alerts and a soft chime.
      Move or resize the window; its monitor, position, and size are saved.
      Dismissing alerts keeps the window open and recurring timers enabled.</p>
    {!bridge
      ? <p style={styles.sub}>Desktop popups are available in the Windows and Linux desktop app.</p>
      : <div style={{ ...styles.buttonRow, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={styles.buttonCompact} onClick={() => run(bridge.open)}>Open timer window</button>
        <button type="button" style={styles.buttonCompact} onClick={() => run(bridge.preview)}>Test / position popup</button>
        <button type="button" style={styles.buttonCompact} onClick={() => run(bridge.resetPosition)}>Reset to primary monitor</button>
        <label style={{ ...styles.sub, display: "flex", gap: 8, alignItems: "center" }}>
          Alert volume
          <input type="range" min={0} max={100} step={5} value={volume}
            onChange={event => {
              const value = Number(event.target.value);
              setVolume(value);
              run(() => bridge.setVolume(value / 100));
            }} />
          <span style={{ minWidth: 42 }}>{volume === 0 ? "Muted" : `${volume}%`}</span>
        </label>
      </div>}
    {error && <p style={styles.errorText} role="alert">{error}</p>}
  </section>;
}
