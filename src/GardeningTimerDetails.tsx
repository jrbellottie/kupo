import { useState } from "react";
import type { GardeningTimer } from "./types";
import { styles } from "./styles";
import { gardeningEvents, nextGardeningEvent } from "./utils/gardeningTimers";
import { formatCountdown, parseLocalDateTimeToMs } from "./utils/time";

export type RecordGardeningFeed = (id: string, index: number, atMs: number | null) => void;

export default function GardeningTimerDetails({ timer, nowMs, onRecordFeed }: {
  timer: GardeningTimer; nowMs: number; onRecordFeed?: RecordGardeningFeed;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const next = nextGardeningEvent(timer);
  const record = (index: number, atMs: number | null | undefined) => {
    try {
      if (atMs === undefined) throw new Error("Enter a valid local feeding date and time.");
      if (!onRecordFeed) throw new Error("Feeding records are unavailable.");
      onRecordFeed(timer.id, index, atMs);
      setError(null);
      setNotice(atMs === null ? `Feed ${index + 1} record cleared; estimated timing restored.` : `Feed ${index + 1} recorded; remaining times updated.`);
    } catch (cause) {
      console.error("Unable to record gardening feeding.", cause);
      setNotice(null);
      setError(cause instanceof Error ? cause.message : "Unable to record feeding.");
    }
  };
  return <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
    <p style={{ margin: 0 }}><strong>{next
      ? `${next.label} (estimated) - ${formatCountdown(next.atMs - nowMs)}${timer.enabled ? "" : " (alerts disabled)"}`
      : "Estimated schedule finished; check the plant for harvest."}</strong></p>
    <p style={{ ...styles.sub, margin: 0 }}>Planted: {new Date(timer.plantedAtMs).toLocaleString()}. Without actual feeding records, alerts assume feeding near the end of each window; skipped feeds wait out their windows. Feed before the closing deadline, not after its alert. If you feed earlier, record it to move later alerts earlier too. Offline stage updates may delay everything. Check the Moogle and keep examining the plant.</p>
    <details>
      <summary>Schedule and optional feeding records</summary>
      <ol>{gardeningEvents(timer).map(event => <li key={event.id}>
        {event.label}: {new Date(event.atMs).toLocaleString()} (scheduled estimate)
        {event.earliestAtMs !== event.atMs && `; could be as early as ${new Date(event.earliestAtMs).toLocaleString()} with earlier feeding`}
        {timer.notifiedEvents.includes(event.id) ? " - passed / handled" : ""}
      </li>)}</ol>
      {timer.feeds.map((feed, index) => <div key={index} style={{ marginTop: 10 }}>
        <div><strong>Feed {index + 1}: {feed.crystal}</strong>{feed.skip ? " - let the window expire" : feed.fedAtMs !== null ? ` - recorded ${new Date(feed.fedAtMs).toLocaleString()}` : " - actual time not recorded"}</div>
        {!feed.skip && onRecordFeed && <div style={{ ...styles.buttonRow, marginTop: 6 }}>
          <label>Actual feed {index + 1} time (local){" "}
            <input type="datetime-local" step="1" style={styles.input} value={drafts[index] ?? ""} onChange={event => setDrafts(previous => ({ ...previous, [index]: event.target.value }))} />
          </label>
          <button type="button" style={styles.buttonCompact} onClick={() => record(index, parseLocalDateTimeToMs(drafts[index] ?? ""))}>Save feed {index + 1} time</button>
          <button type="button" style={styles.buttonCompact} onClick={() => record(index, Date.now())}>Fed {index + 1} now</button>
          {feed.fedAtMs !== null && <button type="button" style={styles.buttonCompact} onClick={() => record(index, null)}>Clear feed {index + 1}</button>}
        </div>}
      </div>)}
    </details>
    {error && <p role="alert" style={{ color: "#ff8a8a", margin: 0 }}>{error}</p>}
    {notice && <p role="status" style={{ margin: 0 }}>{notice}</p>}
  </div>;
}
