import { RAISING, STAT_KEYS, STAT_BANDS, applyRaisingStatChanges, type RaisingStats } from "./chocoboRaising";
import { LAST_RAISING_DAY, RAISING_ABILITIES, applyTrainingAction, careAvailableDay } from "./chocoboRaisingPlanner";

export type RaisingRecord = { day: number } & (
  | { kind: "food"; foodId: number; count: number; forgottenAbility?: string }
  | { kind: "story"; ability: string; learned: boolean }
  | { kind: "care"; careId: number; result: "unknown" | "poor" | "good" }
  | { kind: "report"; stats: RaisingStats; exact: boolean }
  | { kind: "abilities"; abilities: string[] }
);
export type RaisingTracker = {
  startedAt: number;
  day: number;
  initial: RaisingStats;
  exact: boolean;
  knownAbilities: string[];
  initialWorms?: number;
  entries: RaisingRecord[];
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const day = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= LAST_RAISING_DAY;
const validStats = (value: unknown): value is RaisingStats => object(value)
  && STAT_KEYS.every(key => typeof value[key] === "number" && Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 255)
  && STAT_KEYS.reduce((sum, key) => sum + Number(value[key]), 0) <= RAISING.settings.statGrowthCap;
const abilities = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 2
  && value.every(name => RAISING_ABILITIES.some(ability => ability.name === name)) && new Set(value).size === value.length;

function validEntry(value: unknown): value is RaisingRecord {
  if (!object(value) || !day(value.day)) return false;
  switch (value.kind) {
    case "food": return RAISING.foods.some(food => food.id === value.foodId)
      && typeof value.count === "number" && Number.isInteger(value.count) && value.count >= 1 && value.count <= 99
      && (value.forgottenAbility === undefined || RAISING_ABILITIES.some(ability => ability.name === value.forgottenAbility));
    case "story": return RAISING_ABILITIES.some(ability => ability.name === value.ability) && typeof value.learned === "boolean";
    case "care": return RAISING.plans.some(plan => plan.id === value.careId) && ["unknown", "poor", "good"].includes(String(value.result));
    case "report": return validStats(value.stats) && typeof value.exact === "boolean";
    case "abilities": return abilities(value.abilities);
    default: return false;
  }
}

export function validRaisingTrackers(value: unknown): value is RaisingTracker[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || !value.every(tracker => object(tracker)
    && typeof tracker.startedAt === "number" && Number.isFinite(new Date(tracker.startedAt).getTime())
    && day(tracker.day) && validStats(tracker.initial) && typeof tracker.exact === "boolean"
    && (tracker.initialWorms === undefined || typeof tracker.initialWorms === "number" && Number.isSafeInteger(tracker.initialWorms) && tracker.initialWorms >= 0)
    && abilities(tracker.knownAbilities) && Array.isArray(tracker.entries) && tracker.entries.every(validEntry))
    || new Set(value.map(tracker => tracker.startedAt)).size !== value.length) return false;
  try {
    for (const tracker of value) raisingTrackerState(tracker, LAST_RAISING_DAY);
    return true;
  } catch {
    // The storage parser reports invalid histories to the user.
    return false;
  }
}

export function reconcileRaisingStats(current: RaisingStats, report: RaisingStats, exact: boolean): RaisingStats {
  if (!validStats(report)) throw new Error("Stat reports must fit the individual and combined stat caps.");
  if (exact) return { ...report };
  const minimum = { ...report };
  for (const key of STAT_KEYS) minimum[key] = STAT_BANDS[Math.floor(report[key] / 32)].min;
  const result = { ...current };
  for (const key of STAT_KEYS) result[key] = Math.max(minimum[key], Math.min(minimum[key] + 31, result[key]));
  // Grade reports constrain the estimate jointly; their maxima cannot all be assumed at the total cap.
  let excess = STAT_KEYS.reduce((sum, key) => sum + result[key], 0) - RAISING.settings.statGrowthCap;
  for (const key of [...STAT_KEYS].reverse()) {
    const reduction = Math.min(Math.max(0, excess), result[key] - minimum[key]);
    result[key] -= reduction;
    excess -= reduction;
  }
  return result;
}

export function raisingTrackerState(tracker: RaisingTracker, currentDay: number) {
  let stats = { ...tracker.initial };
  let knownAbilities = [...tracker.knownAbilities];
  let wormsFed = tracker.initialWorms ?? 0;
  const warnings = new Set<string>();
  const careDays = new Set<number>();
  const entries = tracker.entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.day - b.entry.day || Number(b.entry.kind === "care") - Number(a.entry.kind === "care") || a.index - b.index);
  let reportDay = tracker.day;
  if (!tracker.exact) warnings.add("The starting description hides the exact points; this remains an estimate.");
  for (const { entry } of entries) {
    if (entry.day < tracker.day) throw new Error("Actions cannot predate the starting report.");
    if (entry.day > currentDay) continue;
    if (entry.kind === "report") {
      stats = reconcileRaisingStats(stats, entry.stats, entry.exact);
      reportDay = entry.day;
    } else if (entry.kind === "abilities") {
      knownAbilities = [...entry.abilities];
    } else if (entry.kind === "food") {
      const food = RAISING.foods.find(food => food.id === entry.foodId);
      if (!food || entry.day < RAISING.settings.daysToChick) throw new Error("Food requires a hatched chocobo and a valid item.");
      if (food.forgetsAbility) {
        if (entry.count !== 1 || !entry.forgottenAbility || !knownAbilities.includes(entry.forgottenAbility)) {
          throw new Error("Record one Lethe item at a time and select the ability actually forgotten.");
        }
        knownAbilities = knownAbilities.filter(name => name !== entry.forgottenAbility);
      }
      for (let item = 0; item < entry.count; item++) stats = applyRaisingStatChanges(stats, food.stats);
      if (food.rerollGene && entry.day < RAISING.settings.daysToAdolescent) wormsFed += entry.count;
      if (food.random.chance > 0) warnings.add("Random food stat effects are unknown and are not added. Confirm the trainer's descriptions afterward.");
    } else if (entry.kind === "story") {
      if (entry.day < RAISING.settings.daysToAdolescent) throw new Error("Stories require an adolescent or adult chocobo.");
      stats = applyRaisingStatChanges(stats, { strength: 0, endurance: 0, discernment: 1, receptivity: 0 });
      if (entry.learned && !knownAbilities.includes(entry.ability)) knownAbilities.push(entry.ability);
      if (knownAbilities.length > 2) throw new Error("Only two learned abilities fit. Correct the ability history before recording this success.");
    } else {
      if (entry.day === tracker.day) throw new Error("The starting report already includes that day's care. Log care only for later days.");
      if (careDays.has(entry.day)) throw new Error(`Care is already recorded for day ${entry.day}. Undo that entry before correcting it.`);
      careDays.add(entry.day);
      if (entry.careId !== 0 && entry.day < (entry.careId === 1 ? RAISING.settings.daysToChick : careAvailableDay(entry.careId) + 2)) {
        throw new Error("That care plan is not available on this raising day.");
      }
      if (entry.careId === 0) warnings.add("Basic Care's random gains are unknown; no stat gain is assumed.");
      else if (entry.careId !== 1) {
        stats = applyTrainingAction(stats, { kind: "care", id: entry.careId }, entry.day, entry.result === "good" ? 3 : 2);
        if (entry.result === "unknown") warnings.add("Unspecified care results use the poor-day estimate of 2 points per arrow.");
      }
    }
  }
  const missingCareDays: number[] = [];
  for (let value = reportDay + 1; value <= Math.min(currentDay, LAST_RAISING_DAY); value++) {
    if (!careDays.has(value)) missingCareDays.push(value);
  }
  return {
    stats, knownAbilities, wormsFed, warnings: [...warnings], missingCareDays,
    storyDone: tracker.entries.some(entry => entry.day === currentDay && entry.kind === "story"),
  };
}

export function recordRaisingAction(tracker: RaisingTracker, entry: RaisingRecord, currentDay: number): RaisingTracker {
  if (!validEntry(entry) || entry.day > currentDay) throw new Error("Choose a valid action and a day that has already occurred.");
  const next = { ...tracker, entries: [...tracker.entries, entry] };
  raisingTrackerState(next, currentDay);
  return next;
}

export function raisingRecordLabel(entry: RaisingRecord): string {
  switch (entry.kind) {
    case "food": return `${entry.count} ${RAISING.foods.find(food => food.id === entry.foodId)?.name}${entry.forgottenAbility ? `; forgot ${entry.forgottenAbility}` : ""}`;
    case "story": return `${entry.ability} story: ${entry.learned ? "learned" : "attempted, not learned"} (+1 DSC before caps)`;
    case "care": return `${RAISING.plans.find(plan => plan.id === entry.careId)?.name}: ${entry.result === "unknown" ? "estimated result" : `${entry.result} result`}`;
    case "report": return entry.exact ? "Exact stat correction" : "Trainer description correction";
    case "abilities": return `Learned abilities corrected: ${entry.abilities.join(", ") || "none"}`;
  }
}
