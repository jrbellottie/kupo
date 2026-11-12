import { useState } from "react";
import { styles } from "./styles";
import RaisingFoodText from "./RaisingFoodText";
import { RAISING, STAT_KEYS, STAT_LABELS } from "./utils/chocoboRaising";
import { RAISING_ABILITIES, LAST_RAISING_DAY } from "./utils/chocoboRaisingPlanner";
import { raisingRecordLabel, raisingTrackerState, type RaisingRecord, type RaisingTracker } from "./utils/raisingTracker";

type Props = {
  tracker?: RaisingTracker;
  currentDay: number;
  canRecord: boolean;
  careId?: number;
  feedingDone: boolean;
  onStart: (day: number) => void;
  onRecord: (entry: RaisingRecord) => void;
  onUndo: () => void;
  onFeedingDone: (done: boolean) => void;
};

export default function RaisingProgressTracker({ tracker, currentDay, canRecord, careId, feedingDone, onStart, onRecord, onUndo, onFeedingDone }: Props) {
  const [recordDay, setRecordDay] = useState("");
  const [kind, setKind] = useState<"food" | "story" | "care">("food");
  const [foodId, setFoodId] = useState(5607);
  const [count, setCount] = useState("1");
  const [ability, setAbility] = useState("Bore");
  const [learned, setLearned] = useState(false);
  const [forgottenAbility, setForgottenAbility] = useState("");
  const [selectedCare, setSelectedCare] = useState("");
  const [careResult, setCareResult] = useState<"unknown" | "poor" | "good">("unknown");
  const day = recordDay === "" ? currentDay : Number(recordDay);
  const state = tracker ? raisingTrackerState(tracker, currentDay) : undefined;
  const food = RAISING.foods.find(food => food.id === foodId);
  const selectedCareId = selectedCare === "" ? careId ?? 0 : Number(selectedCare);
  const submit = () => {
    if (!tracker) onStart(day);
    else if (kind === "food") onRecord({ kind, day, foodId, count: Number(count), forgottenAbility: forgottenAbility || undefined });
    else if (kind === "story") onRecord({ kind, day, ability, learned });
    else onRecord({ kind, day, careId: selectedCareId, result: careResult });
  };
  return <section aria-label="Recorded raising progress" style={styles.subCard}>
    <h4>Recorded progress</h4>
    {tracker && state ? <>
      <p><strong>Running stat estimate</strong> from your day {tracker.day} starting report and {tracker.entries.length} saved entries. Calculating or restarting does not reset it.</p>
      <div className="raising-table-wrap"><table aria-label="Tracked current stats">
        <thead><tr>{STAT_KEYS.map(key => <th key={key}>{STAT_LABELS[key]}</th>)}</tr></thead>
        <tbody><tr>{STAT_KEYS.map(key => <td key={key}>{state.stats[key]}</td>)}</tr></tbody>
      </table></div>
      <p>Learned: <strong>{state.knownAbilities.join(", ") || "none recorded"}</strong>. Owning a story is not the same as learning its ability.</p>
      {state.warnings.length > 0 && <ul className="raising-small">{state.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      {state.missingCareDays.length > 0 && <p role="status" className="raising-notice">Care not recorded for days {state.missingCareDays.join(", ")}. Log the completed care from the trainer's reports, including missed days, or confirm current stat descriptions below. Queued care is not automatically counted as completed.</p>}
    </> : <p>Start from the stat descriptions or exact values entered below, after that day's care and before the actions you want to log. For earlier actions, choose an earlier starting-report day and enter the reports from then. Old calculations were not action logs and cannot recover unrecorded gains.</p>}
    <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <div className="raising-controls">
        <label>{tracker ? "Action day" : "Starting-report day"}<input style={styles.input} type="number"
          min={tracker?.day ?? 0} max={Math.min(currentDay, LAST_RAISING_DAY)} step={1} required
          value={recordDay === "" ? currentDay : recordDay} onChange={event => setRecordDay(event.target.value)} /></label>
        {tracker && <>
          <label>Action completed<select style={styles.select} value={kind} onChange={event => {
            if (event.target.value === "food" || event.target.value === "story" || event.target.value === "care") setKind(event.target.value);
          }}>
            <option value="food">Food / medicine eaten</option><option value="story">Story attempted</option><option value="care">Daily care completed</option>
          </select></label>
          {kind === "food" && <>
            <label>Item eaten<select style={styles.select} value={foodId} onChange={event => setFoodId(Number(event.target.value))}>
              {RAISING.foods.map(food => <option key={food.id} value={food.id}>{food.name}</option>)}
            </select></label>
            <label>Quantity actually eaten<input style={styles.input} type="number" min={1} max={food?.forgetsAbility ? 1 : 99}
              step={1} required value={count} onChange={event => setCount(event.target.value)} /></label>
            {food?.forgetsAbility && <label>Ability actually forgotten<select style={styles.select} required
              value={forgottenAbility} onChange={event => setForgottenAbility(event.target.value)}>
              <option value="">Choose the lost ability</option>
              {RAISING_ABILITIES.map(ability => <option key={ability.name}>{ability.name}</option>)}
            </select></label>}
          </>}
          {kind === "story" && <>
            <label>Story<select style={styles.select} value={ability} onChange={event => setAbility(event.target.value)}>
              {RAISING_ABILITIES.map(ability => <option key={ability.name} value={ability.name}>{ability.story} ({ability.name})</option>)}
            </select></label>
            <label><input type="checkbox" checked={learned} onChange={event => setLearned(event.target.checked)} />Ability actually learned</label>
          </>}
          {kind === "care" && <>
            <label>Completed care<select style={styles.select} value={selectedCareId} onChange={event => setSelectedCare(event.target.value)}>
              {RAISING.plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select></label>
            {selectedCareId > 1 && <label>Care result<select style={styles.select} value={careResult} onChange={event => {
              if (event.target.value === "unknown" || event.target.value === "poor" || event.target.value === "good") setCareResult(event.target.value);
            }}>
              <option value="unknown">Not sure (estimate 2 points per arrow)</option>
              <option value="poor">Poor (2 points per arrow)</option><option value="good">Good (3 points per arrow)</option>
            </select></label>}
          </>}
        </>}
      </div>
      {tracker && kind === "food" && <p className="raising-small">Record only items actually eaten, in feeding order. This logs what happened; it is not a feeding recommendation. Random stat effects remain unknown; confirm descriptions afterward. Historical food does not change today's hunger report.</p>}
      {tracker && kind === "story" && <p className="raising-small">Each completed ability-story attempt adds 1 DSC before caps, even when learning fails. Check success only if the ability was learned; an inspiration without learning is not a learned ability.</p>}
      <button style={styles.buttonCompact} type="submit" disabled={!canRecord}>{tracker ? "Record completed action" : "Start tracking from these reports"}</button>
    </form>
    {tracker && <>
      <label className="raising-exact-toggle"><input type="checkbox" checked={feedingDone} disabled={!canRecord}
        onChange={event => onFeedingDone(event.target.checked)} />Finished feeding for today (do not recommend more)</label>
      <details>
        <summary>Saved action history ({tracker.entries.length})</summary>
        <p className="raising-small">Entries stay with this saved egg time. Undo removes the last entry you recorded, including a backfilled entry, and recalculates the estimate. Recheck today's hunger afterward.</p>
        {tracker.entries.length > 0 ? <>
          <button type="button" style={styles.buttonCompact} disabled={!canRecord} onClick={onUndo}>Undo last recorded entry</button>
          <ol>{tracker.entries.map((entry, index) => <li key={index}>Day {entry.day}: <RaisingFoodText text={raisingRecordLabel(entry)} /></li>)}</ol>
        </> : <p>No completed actions recorded yet.</p>}
      </details>
    </>}
  </section>;
}
