import { RAISING, STAT_KEYS, PROJECTION_FOODS, type RaisingStats } from "./chocoboRaising";
import { LAST_RAISING_DAY, RAISING_ABILITIES, type RaisingGoalInput, type TrainingDay } from "./chocoboRaisingPlanner";
import { BIRD_CONDITIONS, FEEDING_FOODS, validateFeedingReport, type FeedingReport } from "./chocoboFeeding";

export const RAISING_DAILY_KEY = "kupo.raising.daily.v1";
export type PlannerForm = Omit<RaisingGoalInput, "current" | "target" | "currentDay" | "today"> & {
  current: Record<keyof RaisingStats, string>;
  target: Record<keyof RaisingStats, string>;
  useExactStats?: boolean;
};
export type DailyStep = Pick<TrainingDay, "day" | "foodId" | "foodCount" | "story" | "careId" | "feeding">;
export type DailySchedule = {
  startedAt: number | null; plannedDay: number; days: DailyStep[];
  feedingReport?: FeedingReport; feedingInputs?: string;
};
export type DailyProgress = {
  startedAt: number | null;
  day: number;
  feedingDone: boolean;
  storyDone: boolean;
  careKey: string | null;
};
export type SavedRaisingDaily = {
  form: PlannerForm;
  defaultsVersion?: number;
  daily?: DailySchedule;
  progress?: DailyProgress;
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const dayNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= LAST_RAISING_DAY;
const startTime = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(new Date(value).getTime());
const statInputs = (value: unknown) => record(value) && STAT_KEYS.every(key => typeof value[key] === "string");
const abilityNames = (value: unknown) => Array.isArray(value) && value.every(name => RAISING_ABILITIES.some(ability => ability.name === name));
export function feedingInputKey(form: PlannerForm, report: FeedingReport): string {
  return JSON.stringify([
    STAT_KEYS.map(key => form.current[key]), STAT_KEYS.map(key => form.target[key]), form.useExactStats === true,
    form.desiredAbilities, form.knownAbilities, form.priority, report.affection, report.fullness, report.condition, report.day,
  ]);
}
const wholeRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
function validFeeding(value: unknown, day: number): boolean {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 4
    || !["affectionBefore", "affectionAfter", "fullnessBefore", "fullnessAfter"].every(key => wholeRange(value[key], 0, 255))
    || !wholeRange(value.careSuccess, 5, 95)) return false;
  let affection = Number(value.affectionBefore);
  let fullness = Number(value.fullnessBefore);
  for (const id of value.items) {
    const food = FEEDING_FOODS.find(food => food.id === id);
    if (!food || day < RAISING.settings.daysToChick || fullness >= 224) return false;
    const variant = day < RAISING.settings.daysToAdolescent ? food.chick : food;
    affection = Math.min(255, affection + variant.affection);
    fullness = Math.min(255, fullness + variant.fullness);
  }
  return affection === value.affectionAfter && fullness === value.fullnessAfter;
}

function isSavedDaily(value: unknown): value is SavedRaisingDaily {
  if (!record(value) || !record(value.form)) return false;
  const form = value.form;
  if (!statInputs(form.current) || !statInputs(form.target) || !abilityNames(form.desiredAbilities)
    || !abilityNames(form.knownAbilities) || !STAT_KEYS.some(key => key === form.priority)
    || (form.useExactStats !== undefined && typeof form.useExactStats !== "boolean")
    || (value.defaultsVersion !== undefined && typeof value.defaultsVersion !== "number")) return false;
  if (form.feedingReport !== undefined) {
    const report = form.feedingReport;
    if (!record(report) || !wholeRange(report.affection, -1, 255) || !wholeRange(report.fullness, -1, 255)
      || !wholeRange(report.day, -1, LAST_RAISING_DAY)
      || (report.condition !== "unknown" && !BIRD_CONDITIONS.some(entry => entry.id === report.condition))) return false;
  }
  if (value.daily !== undefined) {
    const daily = value.daily;
    if (!record(daily) || !startTime(daily.startedAt) || !dayNumber(daily.plannedDay) || !Array.isArray(daily.days)
      || (daily.feedingInputs !== undefined && typeof daily.feedingInputs !== "string")
      || daily.days.length !== LAST_RAISING_DAY - daily.plannedDay + 1 || !daily.days.every((step: unknown, index: number) =>
        record(step) && dayNumber(step.day) && step.day === Number(daily.plannedDay) + index
        && RAISING.plans.some(plan => plan.id !== 1 && plan.id === step.careId)
        && (step.foodId === null || PROJECTION_FOODS.some(food => !food.forgetsAbility && food.id === step.foodId))
        && typeof step.foodCount === "number" && Number.isInteger(step.foodCount) && step.foodCount >= 0 && step.foodCount <= 4
        && (step.foodId !== null || step.foodCount === 0)
        && (step.story === null || RAISING_ABILITIES.some(ability => ability.name === step.story))
        && (step.feeding === undefined || (step.foodId === null && step.foodCount === 0 && validFeeding(step.feeding, step.day))))) return false;
    if (daily.feedingReport !== undefined) {
      const report = daily.feedingReport;
      if (!record(report)) return false;
      const condition = BIRD_CONDITIONS.find(entry => entry.id === report.condition);
      if (!condition || typeof report.affection !== "number" || typeof report.fullness !== "number" || report.day !== daily.plannedDay
        || validateFeedingReport({
          affection: report.affection, fullness: report.fullness, day: daily.plannedDay,
          condition: condition.id,
        }, daily.plannedDay)) return false;
    }
  }
  if (value.progress !== undefined) {
    const progress = value.progress;
    if (!record(progress) || !startTime(progress.startedAt) || !dayNumber(progress.day)
      || typeof progress.feedingDone !== "boolean" || typeof progress.storyDone !== "boolean"
      || (progress.careKey !== null && typeof progress.careKey !== "string")) return false;
  }
  return true;
}

export function parseSavedRaisingDaily(raw: string): SavedRaisingDaily {
  const value: unknown = JSON.parse(raw);
  if (!isSavedDaily(value)) throw new Error("The saved raising checklist is invalid.");
  return value;
}

export function dailyProgress(progress: DailyProgress | undefined, startedAt: number | null, day: number): DailyProgress {
  return progress?.startedAt === startedAt && progress.day === day ? progress
    : { startedAt, day, feedingDone: false, storyDone: false, careKey: null };
}

export function todayCare(schedule: DailySchedule, day: number) {
  if (day < RAISING.settings.daysToChick) return null;
  const first = schedule.days.find(step => step.day === day + 2);
  if (!first) return null;
  let count = 1;
  while (count < 7 && schedule.days.some(step => step.day === first.day + count && step.careId === first.careId)) count++;
  return { careId: first.careId, firstDay: first.day, lastDay: first.day + count - 1, count, key: `${first.day}:${first.careId}:${count}` };
}
