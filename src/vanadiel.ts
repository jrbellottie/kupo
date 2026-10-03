// vanadiel.ts

export type VanaWeekday =
  | "Firesday"
  | "Earthsday"
  | "Watersday"
  | "Windsday"
  | "Iceday"
  | "Lightningday"
  | "Lightsday"
  | "Darksday";

export type Calibration = {
  timeOffsetMs: number;
  newMoonStartEarthMs: number;
};

// Default calibration (baked-in) — TIMEZONE-INDEPENDENT.
//
// Both values are anchored to absolute instants so the shipped defaults are
// correct in every time zone without any manual setup:
//
// - timeOffsetMs: offset applied to `Date.now()` (UTC epoch ms) to derive
//   Vana'diel time. Because Vana'diel time is global and Date.now() is UTC,
//   this value is the same on every machine.
//
// - newMoonStartEarthMs: the real "New Moon Start" instant. Stored as a fixed
//   UTC epoch (via Date.UTC) rather than a local-time Date(...) so it resolves
//   to the identical absolute moment regardless of the user's time zone.
//   Source reading: 01/24/2026 03:14:24 AM US Central (CST, UTC-6)
//                 = 01/24/2026 09:14:24 UTC.
//
// Manual calibration remains available if a user ever wants to override these.
export const DEFAULT_CALIBRATION: Calibration = {
  timeOffsetMs: 4_753_280,
  newMoonStartEarthMs: Date.UTC(2026, 0, 24, 9, 14, 24, 0),
};

const VANA_MS_PER_VANA_SECOND = 40;
const VANA_SECONDS_PER_DAY = 86400;
const VANA_SECONDS_PER_WEEK = VANA_SECONDS_PER_DAY * 8;

const WEEKDAYS: VanaWeekday[] = [
  "Firesday",
  "Earthsday",
  "Watersday",
  "Windsday",
  "Iceday",
  "Lightningday",
  "Lightsday",
  "Darksday",
];

// Moon constants
const MOON_STEPS_PER_CYCLE = 200;
const EARTH_MS_PER_MOON_STEP = 1_451_520;
const EARTH_MS_PER_MOON_CYCLE = EARTH_MS_PER_MOON_STEP * MOON_STEPS_PER_CYCLE;

// Display offset retained
const MOON_DISPLAY_STEP_OFFSET = 10;

export type VanaNow = {
  weekday: VanaWeekday;
  hour: number;
  minute: number;

  weekOffsetSeconds: number;

  moonStep: number; // 0..199 display step
  moonPercent: number; // 0..100
  moonPhaseName: string;

  nextMoonStepAtEarthMs: number;
};

function padFloor(n: number) {
  return Math.floor(Number.isFinite(n) ? n : 0);
}

function earthMsToVanaAbsSeconds(earthMs: number): number {
  return Math.floor(earthMs / VANA_MS_PER_VANA_SECOND);
}

function applyCalibrationToEarthMs(earthMs: number, cal?: Calibration): number {
  if (!cal) return earthMs;
  return earthMs + cal.timeOffsetMs;
}

function mod(n: number, m: number): number {
  const r = n % m;
  return r < 0 ? r + m : r;
}

function moonStepToPercent(step: number): number {
  return step <= 100 ? step : 200 - step;
}

function moonPhaseName(step: number): string {
  const pct = moonStepToPercent(step);
  const waxing = step < 100;

  if (pct >= 87) return "Full Moon";
  if (pct >= 57) return waxing ? "Waxing Gibbous" : "Waning Gibbous";
  if (pct >= 37) return waxing ? "First Quarter" : "Last Quarter";
  if (pct >= 7) return waxing ? "Waxing Crescent" : "Waning Crescent";
  return "New Moon";
}

function earthMsToMoonStepRaw(nowEarthMs: number, cal?: Calibration): number {
  const anchor = cal?.newMoonStartEarthMs;
  if (!Number.isFinite(anchor as number) || (anchor as number) <= 0) {
    return Math.floor((nowEarthMs / EARTH_MS_PER_MOON_STEP) % MOON_STEPS_PER_CYCLE);
  }

  const remainingMs = mod((anchor as number) - nowEarthMs, EARTH_MS_PER_MOON_CYCLE);
  const elapsedMs = mod(EARTH_MS_PER_MOON_CYCLE - remainingMs, EARTH_MS_PER_MOON_CYCLE);

  const step = Math.floor(elapsedMs / EARTH_MS_PER_MOON_STEP);
  return mod(step, MOON_STEPS_PER_CYCLE);
}

function applyMoonDisplayOffset(rawStep: number): number {
  return mod(rawStep - MOON_DISPLAY_STEP_OFFSET, MOON_STEPS_PER_CYCLE);
}

/**
 * Next RAW step boundary time.
 * (Display offset does not change boundary times.)
 */
function nextMoonStepBoundaryEarthMs(nowEarthMs: number, cal?: Calibration): number {
  const anchor = cal?.newMoonStartEarthMs;
  if (!Number.isFinite(anchor as number) || (anchor as number) <= 0) {
    const currentStepStartMs = Math.floor(nowEarthMs / EARTH_MS_PER_MOON_STEP) * EARTH_MS_PER_MOON_STEP;
    return currentStepStartMs + EARTH_MS_PER_MOON_STEP;
  }

  const remainingMs = mod((anchor as number) - nowEarthMs, EARTH_MS_PER_MOON_CYCLE);
  const elapsedMs = mod(EARTH_MS_PER_MOON_CYCLE - remainingMs, EARTH_MS_PER_MOON_CYCLE);

  const intoStepMs = elapsedMs % EARTH_MS_PER_MOON_STEP;
  const untilNextStepMs = intoStepMs === 0 ? EARTH_MS_PER_MOON_STEP : EARTH_MS_PER_MOON_STEP - intoStepMs;

  return nowEarthMs + untilNextStepMs;
}

/**
 * START time of the current moon step window (stable within a step).
 * Compute schedules from the step start, not from "now".
 */
function currentMoonStepStartEarthMs(nowEarthMs: number, cal?: Calibration): number {
  const nextBoundary = nextMoonStepBoundaryEarthMs(nowEarthMs, cal);
  return nextBoundary - EARTH_MS_PER_MOON_STEP;
}

/** Moon percent (0..100, display-offset applied) at an arbitrary earth instant. */
export function moonPercentAtEarthMs(earthMs: number, cal?: Calibration): number {
  const step = applyMoonDisplayOffset(earthMsToMoonStepRaw(earthMs, cal));
  return moonStepToPercent(step);
}

export function getVanaNow(earthMsRaw: number, cal?: Calibration): VanaNow {
  const earthMsForVanaTime = applyCalibrationToEarthMs(earthMsRaw, cal);
  const vanaAbs = earthMsToVanaAbsSeconds(earthMsForVanaTime);
  const weekOffsetSeconds =
    ((vanaAbs % VANA_SECONDS_PER_WEEK) + VANA_SECONDS_PER_WEEK) % VANA_SECONDS_PER_WEEK;

  const dayIndex = Math.floor(weekOffsetSeconds / VANA_SECONDS_PER_DAY);
  const timeOfDay = weekOffsetSeconds % VANA_SECONDS_PER_DAY;

  const hour = Math.floor(timeOfDay / 3600);
  const minute = Math.floor((timeOfDay % 3600) / 60);

  const rawStep = earthMsToMoonStepRaw(earthMsRaw, cal);
  const step = applyMoonDisplayOffset(rawStep);
  const pct = moonStepToPercent(step);

  return {
    weekday: WEEKDAYS[dayIndex],
    hour,
    minute,
    weekOffsetSeconds,

    moonStep: step,
    moonPercent: pct,
    moonPhaseName: moonPhaseName(step),

    nextMoonStepAtEarthMs: nextMoonStepBoundaryEarthMs(earthMsRaw, cal),
  };
}

export function nextEarthMsForVanaWeekdayTime(args: {
  nowEarthMs: number;
  cal?: Calibration;
  targetWeekday: VanaWeekday;
  targetHour: number;
  targetMinute: number;
}): number {
  const { nowEarthMs, cal, targetWeekday, targetHour, targetMinute } = args;

  const now = getVanaNow(nowEarthMs, cal);
  const targetDayIndex = WEEKDAYS.indexOf(targetWeekday);

  const targetOffsetSeconds = targetDayIndex * VANA_SECONDS_PER_DAY + targetHour * 3600 + targetMinute * 60;

  let deltaVanaSeconds = targetOffsetSeconds - now.weekOffsetSeconds;
  if (deltaVanaSeconds <= 0) deltaVanaSeconds += VANA_SECONDS_PER_WEEK;

  return nowEarthMs + deltaVanaSeconds * VANA_MS_PER_VANA_SECOND;
}

export function nextEarthMsForVanaDailySchedule(args: {
  nowEarthMs: number;
  cal?: Calibration;
  departureMinutes: readonly number[];
  offsetHours: number;
}): number {
  const { nowEarthMs, cal, departureMinutes, offsetHours } = args;
  if (
    !Number.isFinite(nowEarthMs) ||
    !Number.isFinite(cal?.timeOffsetMs ?? 0) ||
    !Number.isInteger(offsetHours) || offsetHours < 0 || offsetHours > 23 ||
    departureMinutes.length === 0 ||
    departureMinutes.some((minute) => !Number.isInteger(minute) || minute < 0 || minute >= 1440)
  ) {
    throw new Error("Invalid Vana'diel transport schedule.");
  }

  const minuteMs = 60 * VANA_MS_PER_VANA_SECOND;
  const dayMs = VANA_SECONDS_PER_DAY * VANA_MS_PER_VANA_SECOND;
  const nowInDayMs = mod(applyCalibrationToEarthMs(nowEarthMs, cal), dayMs);
  const deltas = departureMinutes.map((minute) => {
    const delta = mod((minute - offsetHours * 60) * minuteMs - nowInDayMs, dayMs);
    return delta === 0 ? dayMs : delta;
  });
  return nowEarthMs + Math.min(...deltas);
}

export function nextEarthMsForMoonPercent(args: {
  nowEarthMs: number;
  cal?: Calibration;
  targetPercent: number;
}): number {
  const { nowEarthMs, cal, targetPercent } = args;

  const base = currentMoonStepStartEarthMs(nowEarthMs, cal);

  const rawNowStep = earthMsToMoonStepRaw(base, cal);
  const nowStep = applyMoonDisplayOffset(rawNowStep);

  const p = Math.max(0, Math.min(100, Math.floor(targetPercent)));

  const candidates: number[] = [p];
  if (p !== 0 && p !== 100) candidates.push(200 - p);

  const stepsToNext = (targetStep: number) => {
    let delta = targetStep - nowStep;
    if (delta < 0) delta += MOON_STEPS_PER_CYCLE;
    // IMPORTANT: allow delta==0 (meaning "we are currently at that step at base")
    return delta;
  };

  const bestDeltaSteps = Math.min(...candidates.map(stepsToNext));
  return base + bestDeltaSteps * EARTH_MS_PER_MOON_STEP;
}

export function nextEarthMsForMoonStep(args: {
  nowEarthMs: number;
  cal?: Calibration;
  targetMoonStep: number; // 0..199 display step
}): number {
  const { nowEarthMs, cal } = args;

  const base = currentMoonStepStartEarthMs(nowEarthMs, cal);

  const target = mod(Math.floor(args.targetMoonStep), MOON_STEPS_PER_CYCLE);

  const rawNowStep = earthMsToMoonStepRaw(base, cal);
  const nowStep = applyMoonDisplayOffset(rawNowStep);

  let delta = target - nowStep;
  if (delta < 0) delta += MOON_STEPS_PER_CYCLE;
  // IMPORTANT: allow delta==0 => "the step is active now at base"
  return base + delta * EARTH_MS_PER_MOON_STEP;
}

export function calibrationFromSnapshot(args: {
  snapshotEarthMs: number;
  weekday: VanaWeekday;
  hour: number;
  minute: number;
  newMoonStartEarthMs: number;
}): Calibration {
  const { snapshotEarthMs, weekday, hour, minute, newMoonStartEarthMs } = args;

  const dayIndex = WEEKDAYS.indexOf(weekday);
  const desiredWeekOffsetSeconds = dayIndex * 86400 + padFloor(hour) * 3600 + padFloor(minute) * 60;

  const vanaAbsUncal = earthMsToVanaAbsSeconds(snapshotEarthMs);
  const uncalWeekOffsetSeconds =
    ((vanaAbsUncal % VANA_SECONDS_PER_WEEK) + VANA_SECONDS_PER_WEEK) % VANA_SECONDS_PER_WEEK;

  let deltaVanaSeconds = desiredWeekOffsetSeconds - uncalWeekOffsetSeconds;

  if (deltaVanaSeconds > VANA_SECONDS_PER_WEEK / 2) deltaVanaSeconds -= VANA_SECONDS_PER_WEEK;
  if (deltaVanaSeconds < -VANA_SECONDS_PER_WEEK / 2) deltaVanaSeconds += VANA_SECONDS_PER_WEEK;

  const timeOffsetMs = deltaVanaSeconds * VANA_MS_PER_VANA_SECOND;

  return {
    timeOffsetMs,
    newMoonStartEarthMs: Number(newMoonStartEarthMs),
  };
}

// ---------- UI helpers ----------

export type MoonDirection = "WAXING" | "WANING";

export function moonPercentFromStep(step: number): number {
  return moonStepToPercent(mod(Math.floor(step), MOON_STEPS_PER_CYCLE));
}

export function moonDirectionFromStep(step: number): MoonDirection {
  const s = mod(Math.floor(step), MOON_STEPS_PER_CYCLE);
  return s < 100 ? "WAXING" : "WANING";
}

export function moonPhaseNameFromStep(step: number): string {
  return moonPhaseName(mod(Math.floor(step), MOON_STEPS_PER_CYCLE));
}
