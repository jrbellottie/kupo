import { useEffect, useId, useState } from "react";
import { styles } from "./styles";
import RaisingFoodText from "./RaisingFoodText";
import { peekRestoredTabState, rememberTabState } from "./utils/tabNav";
import { saveJson } from "./utils/storage";
import { RAISING, STAT_KEYS, STAT_LABELS, STAT_GRADES, STAT_BANDS, statRank, ridingEstimate, type RaisingStats } from "./utils/chocoboRaising";
import {
  RAISING_ABILITIES, RAISING_PRESETS, STORY_ATTEMPTS_95, validateRaisingGoal,
  storyLearningProbability, trainingActionName, LAST_RAISING_DAY, RAISING_START_KEY, RAISING_SAVED_STARTS_KEY,
  parseSavedRaisingStarts, type SavedRaisingStart,
  raisingDayAt, localRaisingStart, parseRaisingStart, type RaisingGoalInput,
  groupTrainingDays, trainingFoodTotals, careAvailableDay,
} from "./utils/chocoboRaisingPlanner";
import { RAISING_DAILY_KEY, parseSavedRaisingDaily, dailyProgress, todayCare, tomorrowCare, recordArrangedCare, feedingInputKey, plannerColorGoal, type PlannerForm, type SavedRaisingDaily } from "./utils/raisingDaily";
import { CHOCOBO_COLORS } from "./utils/chocoboColor";
import {
  AFFECTION_REPORTS, HUNGER_REPORTS, BIRD_CONDITIONS, BIRD_AILMENTS, AFFECTION_TARGET,
  feedingSummary, healthGuidance, needsHealthAttention, type FeedingReport,
} from "./utils/chocoboFeeding";
import type { RaisingPlannerResponse } from "./workers/chocoboRaisingPlanner.worker";
import { RAISING_EVENTS, raisingEventGuidance, raisingMilestoneGuidance } from "./utils/raisingEvents";

type StatInputs = Record<keyof RaisingStats, string>;
type PlannerView = SavedRaisingDaily & {
  calculatedDay: number | null;
  calculatedStart?: number | null;
  calculation?: RaisingPlannerResponse;
  todayMode?: boolean;
  feedingMode?: boolean;
  persistenceError?: string;
};
const DEFAULTS_VERSION = 1;
const statInputs = (stats: RaisingStats): StatInputs => ({
  strength: String(stats.strength), endurance: String(stats.endurance),
  discernment: String(stats.discernment), receptivity: String(stats.receptivity),
});
const defaultPreset = RAISING_PRESETS[0];
const defaultForm: PlannerForm = {
  current: { strength: "0", endurance: "0", discernment: "0", receptivity: "0" },
  target: statInputs(defaultPreset.target),
  desiredAbilities: [...defaultPreset.desiredAbilities], knownAbilities: [], priority: defaultPreset.priority,
  useExactStats: false,
};
function restorePlannerView(restored?: PlannerView): PlannerView {
  if (!restored) return { form: defaultForm, defaultsVersion: DEFAULTS_VERSION, calculatedDay: null };
  if (restored.defaultsVersion !== DEFAULTS_VERSION) {
    return {
      form: {
        ...restored.form, target: { ...defaultForm.target }, desiredAbilities: [...defaultForm.desiredAbilities],
        priority: defaultForm.priority, useExactStats: false,
      },
      defaultsVersion: DEFAULTS_VERSION, calculatedDay: null, progress: restored.progress, arrangedCare: restored.arrangedCare,
    };
  }
  return restored;
}
const number = (value: string) => value.trim() === "" ? NaN : Number(value);
const parseStats = (values: StatInputs): RaisingStats => ({
  strength: number(values.strength), endurance: number(values.endurance),
  discernment: number(values.discernment), receptivity: number(values.receptivity),
});
const currentStats = (form: PlannerForm): RaisingStats => {
  const stats = parseStats(form.current);
  if (form.useExactStats !== true) {
    for (const key of STAT_KEYS) {
      if (Number.isInteger(stats[key]) && stats[key] >= 0 && stats[key] <= 255) {
        stats[key] = STAT_BANDS[statRank(stats[key])].min;
      }
    }
  }
  return stats;
};
const statSummary = (stats: RaisingStats) => `${stats.strength} STR / ${stats.endurance} END / ${stats.discernment} DSC / ${stats.receptivity} RCP`;
function feedingReport(form: PlannerForm, day: number): FeedingReport {
  if (day < RAISING.settings.daysToChick) return {
    affection: RAISING.feeding.initialAffection + day * RAISING.plans[0].affection,
    fullness: 255, condition: "healthy", day,
  };
  const report = form.feedingReport;
  return report?.day === day ? {
    affection: report.affection, fullness: report.fullness, condition: report.condition, day, ailments: report.ailments, events: report.events,
  }
    : { affection: -1, fullness: -1, condition: "unknown", day };
}

function loadStart(): { startedAt: number | null; error: string | null } {
  if (typeof window === "undefined") return { startedAt: null, error: null };
  try {
    const raw = localStorage.getItem(RAISING_START_KEY);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (value !== null && (typeof value !== "number" || !Number.isFinite(new Date(value).getTime()))) {
      throw new Error("The saved egg start time is invalid.");
    }
    return { startedAt: value, error: null };
  } catch (error) {
    console.error("Unable to load the raising start time.", error);
    return { startedAt: null, error: "Unable to load the saved egg start time. Set it again before calculating." };
  }
}

function loadSavedStarts(): { entries: SavedRaisingStart[]; error: string | null } {
  if (typeof window === "undefined") return { entries: [], error: null };
  try {
    const raw = localStorage.getItem(RAISING_SAVED_STARTS_KEY);
    return { entries: raw === null ? [] : parseSavedRaisingStarts(raw), error: null };
  } catch (error) {
    console.error("Unable to load saved raising start times.", error);
    return { entries: [], error: "Unable to load saved egg times. Check this device's browser storage before saving or deleting times." };
  }
}

export default function ChocoboRaisingPlanner() {
  const formId = useId();
  const [view, setView] = useState<PlannerView>(() => {
    const remembered = peekRestoredTabState<PlannerView>("raising");
    if (remembered) return restorePlannerView(remembered);
    try {
      const raw = typeof window === "undefined" ? null : localStorage.getItem(RAISING_DAILY_KEY);
      return restorePlannerView(raw ? { ...parseSavedRaisingDaily(raw), calculatedDay: null } : undefined);
    } catch (error) {
      console.error("Unable to load the raising checklist.", error);
      return { ...restorePlannerView(), persistenceError: "Unable to load the saved raising data. Verify your reports and care schedule before calculating again." };
    }
  });
  const [clock, setClock] = useState(loadStart);
  const [draftStart, setDraftStart] = useState(() => clock.startedAt === null ? "" : localRaisingStart(clock.startedAt));
  const [startError, setStartError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [dailyNotice, setDailyNotice] = useState<string | null>(null);
  const [savedStartState, setSavedStartState] = useState(loadSavedStarts);
  const [selectedStartName, setSelectedStartName] = useState(() =>
    savedStartState.entries.find(entry => entry.startedAt === clock.startedAt)?.name ?? "");
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [saveNameDraft, setSaveNameDraft] = useState("");
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
  const savedStarts = savedStartState?.entries ?? [];
  const savedStartError = savedStartState?.error ?? null;
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); };
  }, []);
  useEffect(() => {
    const restored = restorePlannerView(view);
    if (restored !== view) setView(restored);
    else {
      rememberTabState("raising", view);
      if (!view.persistenceError) {
        try {
          saveJson(RAISING_DAILY_KEY, { form: view.form, defaultsVersion: view.defaultsVersion, daily: view.daily, progress: view.progress, arrangedCare: view.arrangedCare });
        } catch (error) {
          console.error("Unable to save the raising checklist.", error);
          setView(previous => previous === view ? { ...previous, persistenceError: "Unable to save the raising data on this device. Keep the app open; changes may be lost on restart. Try again after checking browser storage." } : previous);
        }
      }
    }
  }, [view]);
  const { form } = view;
  const useExactStats = form.useExactStats === true;
  const futureStart = clock.startedAt !== null && clock.startedAt > now;
  const currentDay = clock.startedAt === null || futureStart ? 0 : raisingDayAt(clock.startedAt, now);
  const progress = dailyProgress(view.progress, clock.startedAt, currentDay);
  const lockedCare = tomorrowCare(view, clock.startedAt, currentDay);
  const input: RaisingGoalInput = {
    ...form, current: currentStats(form), target: parseStats(form.target), currentDay,
    today: { feedingDone: false, storyDone: false },
    feedingReport: feedingReport(form, currentDay),
    colorGoal: plannerColorGoal(form),
    tomorrowCareId: lockedCare.careId,
  };
  const selectedPreset = RAISING_PRESETS.find(preset =>
    STAT_KEYS.every(key => preset.target[key] === input.target[key]) && preset.priority === form.priority
    && preset.desiredAbilities.length === form.desiredAbilities.length
    && preset.desiredAbilities.every(name => form.desiredAbilities.includes(name)));
  const error = clock.error ?? (futureStart ? "The saved egg start time is in the future. Correct the start time or your device clock."
    : lockedCare.careId === undefined ? "Select tomorrow's already-scheduled care; no previous recommendation is saved for that day."
    : validateRaisingGoal(input));
  const isCurrent = view.todayMode === true && view.feedingMode === true && view.defaultsVersion === DEFAULTS_VERSION && view.calculatedDay === currentDay && view.calculatedStart === clock.startedAt && !error;
  const calculation = isCurrent ? view.calculation : undefined;
  const isCalculating = !!isCurrent && !calculation;
  const plan = calculation?.status === "success" ? calculation.plan : null;
  const colorPlan = plan?.color;
  useEffect(() => {
    if (!isCalculating) return;
    let worker: Worker | undefined;
    let active = true;
    const finish = (result: RaisingPlannerResponse) => {
      if (!active) return;
      active = false;
      worker?.terminate();
      if (result.status === "error") console.error("Unable to calculate the chocobo plan.", result.message);
      setView(previous => previous === view ? {
        ...previous, calculation: result,
        daily: result.status === "success" ? {
          startedAt: view.calculatedStart ?? null, plannedDay: currentDay,
          feedingReport: feedingReport(view.form, currentDay),
          feedingInputs: feedingInputKey(view.form, feedingReport(view.form, currentDay)),
          days: result.plan.days.map(({ day, foodId, foodCount, story, careId, feeding }) => ({ day, foodId, foodCount, story, careId, feeding })),
        } : previous.daily,
      } : previous);
    };
    try {
      worker = new Worker(new URL("./workers/chocoboRaisingPlanner.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<RaisingPlannerResponse>) => finish(event.data);
      worker.onerror = event => {
        event.preventDefault();
        finish({ status: "error", message: event.message || "The calculation worker could not run." });
      };
      worker.onmessageerror = () => finish({ status: "error", message: "The calculation result could not be read." });
      const request: RaisingGoalInput = {
        ...view.form, current: currentStats(view.form), target: parseStats(view.form.target), currentDay,
        today: { feedingDone: false, storyDone: false },
        feedingReport: feedingReport(view.form, currentDay),
        colorGoal: plannerColorGoal(view.form),
        tomorrowCareId: tomorrowCare(view, view.calculatedStart ?? null, currentDay).careId,
      };
      worker.postMessage(request);
    } catch (error) {
      finish({ status: "error", message: error instanceof Error ? error.message : "The calculation could not start." });
    }
    return () => { active = false; worker?.terminate(); };
  }, [view, currentDay, isCalculating]);
  const calculate = () => {
    if (isCalculating) return;
    const refreshedNow = Date.now();
    setNow(refreshedNow);
    const refreshedFutureStart = clock.startedAt !== null && clock.startedAt > refreshedNow;
    const refreshedDay = clock.startedAt === null || refreshedFutureStart ? 0 : raisingDayAt(clock.startedAt, refreshedNow);
    const refreshedCare = tomorrowCare(view, clock.startedAt, refreshedDay);
    const invalid = clock.error || refreshedFutureStart || refreshedCare.careId === undefined
      || validateRaisingGoal({ ...input, currentDay: refreshedDay, feedingReport: feedingReport(form, refreshedDay), tomorrowCareId: refreshedCare.careId });
    setDailyNotice(null);
    setView(previous => ({
      ...previous, form: form.feedingReport ? { ...form, feedingReport: feedingReport(form, refreshedDay) } : form,
      defaultsVersion: DEFAULTS_VERSION, todayMode: true, feedingMode: true, persistenceError: undefined, calculation: undefined,
      calculatedDay: invalid ? null : refreshedDay, calculatedStart: clock.startedAt,
      progress: { ...dailyProgress(previous.progress, clock.startedAt, refreshedDay), feedingDone: false, storyDone: false },
    }));
  };
  const update = (patch: Partial<PlannerForm>) => setView(previous => ({
    ...previous, form: { ...form, ...patch }, defaultsVersion: DEFAULTS_VERSION, calculatedDay: null, calculation: undefined, persistenceError: undefined,
  }));
  const updateLockedCare = (value: string) => {
    const refreshedNow = Date.now();
    setNow(refreshedNow);
    if (clock.startedAt !== null && (clock.startedAt > refreshedNow || raisingDayAt(clock.startedAt, refreshedNow) !== currentDay)) {
      setDailyNotice("The raising day changed. Check the trainer's scheduled care for the new day before correcting it.");
      return;
    }
    const careId = Number(value);
    if (value === "" || !RAISING.plans.some(entry => entry.id === careId
      && (entry.id === 0 || entry.id >= 2 && currentDay + 1 >= careAvailableDay(entry.id) + 2))) {
      setDailyNotice("Choose a valid activity for tomorrow's scheduled care.");
      return;
    }
    setView(previous => ({
      ...previous, arrangedCare: recordArrangedCare(previous.arrangedCare, clock.startedAt, currentDay + 1, currentDay + 1, careId),
      daily: previous.daily ? { ...previous.daily, feedingInputs: undefined } : undefined,
      calculatedDay: null, calculation: undefined, persistenceError: undefined,
    }));
    setDailyNotice("Tomorrow's locked care recorded. Recalculate using your current reports.");
  };
  const confirmCare = (careKey: string | null) => {
    const refreshedNow = Date.now();
    setNow(refreshedNow);
    if (clock.startedAt === null || clock.startedAt > refreshedNow || raisingDayAt(clock.startedAt, refreshedNow) !== currentDay) {
      setDailyNotice("The raising day changed. Review the current day's care recommendation before confirming it.");
      return;
    }
    setDailyNotice(careKey === null ? "Care schedule confirmation cleared." : "Care schedule confirmed.");
    setView(previous => ({
      ...previous, progress: { ...progress, careKey }, persistenceError: undefined,
      arrangedCare: care ? recordArrangedCare(previous.arrangedCare, clock.startedAt,
        care.firstDay, care.lastDay, careKey === null ? null : care.careId) : previous.arrangedCare,
    }));
  };
  const saveStart = (startedAt: number | null) => {
    try {
      saveJson(RAISING_START_KEY, startedAt);
    } catch (error) {
      console.error("Unable to save the raising start time.", error);
      setStartError("Unable to save the egg start time. The previous start time is unchanged.");
      return false;
    }
    setClock({ startedAt, error: null });
    setDraftStart(startedAt === null ? "" : localRaisingStart(startedAt));
    setStartError(null);
    setNow(Date.now());
    setDailyNotice(null);
    setView(previous => ({
      form: clock.startedAt !== startedAt && previous.form.feedingReport
        ? { ...previous.form, feedingReport: { ...previous.form.feedingReport, events: undefined } } : previous.form,
      defaultsVersion: DEFAULTS_VERSION, calculatedDay: null,
      daily: previous.daily?.startedAt === startedAt ? previous.daily : undefined,
      progress: previous.progress?.startedAt === startedAt ? previous.progress : undefined,
      arrangedCare: previous.arrangedCare?.startedAt === startedAt ? previous.arrangedCare : undefined,
    }));
    return true;
  };
  const beginNamedStart = (startedAt: number) => {
    if (savedStartError) {
      setStartError(savedStartError);
      return;
    }
    setPendingStart(startedAt);
    setSaveNameDraft("");
    setDraftStart(localRaisingStart(startedAt));
    setStartError(null);
  };
  const saveNamedStart = () => {
    if (pendingStart === null) return;
    const name = saveNameDraft.trim();
    if (!name) {
      setStartError("Enter a name for this saved egg time.");
      return;
    }
    if (savedStarts.some(entry => entry.name.toLowerCase() === name.toLowerCase())) {
      setStartError("A saved egg time with that name already exists. Choose a different name.");
      return;
    }
    const entries = [...savedStarts, { name, startedAt: pendingStart }];
    try {
      saveJson(RAISING_SAVED_STARTS_KEY, entries);
    } catch (error) {
      console.error("Unable to save the named raising start time.", error);
      setStartError("Unable to save the named egg time. Check this device's browser storage and try again.");
      return;
    }
    setSavedStartState({ entries, error: null });
    const saved = saveStart(pendingStart);
    setPendingStart(null);
    setSaveNameDraft("");
    if (saved) setSelectedStartName(name);
  };
  const selectSavedStart = (name: string) => {
    if (!name) {
      setSelectedStartName("");
      return;
    }
    const entry = savedStarts.find(saved => saved.name === name);
    if (entry && saveStart(entry.startedAt)) setSelectedStartName(entry.name);
  };
  const requestDeleteSavedStart = () => {
    if (savedStarts.some(entry => entry.name === selectedStartName)) setPendingDeleteName(selectedStartName);
  };
  const deleteSavedStart = () => {
    const entry = savedStarts.find(saved => saved.name === pendingDeleteName);
    if (!entry) {
      setPendingDeleteName(null);
      return;
    }
    const entries = savedStarts.filter(saved => saved.name !== entry.name);
    try {
      saveJson(RAISING_SAVED_STARTS_KEY, entries);
    } catch (error) {
      console.error("Unable to delete the named raising start time.", error);
      setStartError("Unable to delete the saved egg time. Check this device's browser storage and try again.");
      return;
    }
    setSavedStartState({ entries, error: null });
    setSelectedStartName("");
    setPendingDeleteName(null);
    if (clock.startedAt === entry.startedAt) saveStart(null);
  };
  const saveManualStart = () => {
    let startedAt: number;
    try {
      startedAt = parseRaisingStart(draftStart, Date.now());
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Invalid egg start time.");
      return;
    }
    beginNamedStart(startedAt);
  };
  const toggleAbility = (key: "desiredAbilities" | "knownAbilities", name: string) =>
    update({ [key]: form[key].includes(name) ? form[key].filter(entry => entry !== name) : [...form[key], name] });
  const riding = plan ? ridingEstimate(plan.result, plan.finalAbilities.includes("Gallop"), plan.finalAbilities.includes("Canter")) : null;
  const schedule = view.daily?.startedAt === clock.startedAt && view.daily.plannedDay <= currentDay ? view.daily : undefined;
  const care = schedule ? todayCare(schedule, currentDay) : null;
  const futureDays = plan?.days.filter(step => step.day > currentDay) ?? [];
  const todayPlan = plan?.days.find(step => step.day === currentDay);
  const todayStory = RAISING_ABILITIES.find(ability => ability.name === todayPlan?.story);
  const foodTotals = plan ? trainingFoodTotals(plan.days) : [];
  const canComplete = clock.startedAt !== null && !futureStart && currentDay <= LAST_RAISING_DAY && !isCalculating;
  const report = feedingReport(form, currentDay);
  const health = healthGuidance(report, currentDay);
  const healthFirst = needsHealthAttention(report);
  const showAilmentGuidance = healthFirst || report.condition === "tired";
  const additionalHealthMessages = health.messages.filter(message => !health.treatmentAction.startsWith(message));
  const reportEvents = raisingEventGuidance(report, currentDay);
  const handkerchiefGuidance = reportEvents.filter(message => message.startsWith("White Handkerchief"));
  const otherEventInstructions = reportEvents.filter(message => !message.startsWith("White Handkerchief"));
  const hasPositiveCondition = report.events?.some(event =>
    event === "high-spirits" || event === "full-of-energy" || event === "bright-and-focused") ?? false;
  const eventInstructions = otherEventInstructions.length > 0 && <ul className="raising-report-guidance" aria-label="Other event guidance">
    {otherEventInstructions.map(message => <li key={message}>{message}</li>)}
  </ul>;
  const milestoneMessages = raisingMilestoneGuidance(currentDay);
  const milestoneInstructions = milestoneMessages.length > 0 && <ul aria-label="Raising day reminders">
    {milestoneMessages.map(message => <li key={message}>{message}</li>)}
  </ul>;
  const separateDays = futureDays.filter(step => step.day === currentDay + 1 || raisingMilestoneGuidance(step.day).length > 0).map(step => step.day);
  const updateReport = (patch: Partial<FeedingReport>) => update({ feedingReport: { ...report, ...patch, day: currentDay } });
  return <section className="raising-planner" aria-label="Chocobo goal planner" style={styles.subCard}>
    <h4>Plan my chocobo</h4>
    <details>
      <summary>How to use the calculator and care plans</summary>
      <h4>Set up your first plan</h4>
      <ol>
        <li><strong>Save the egg hand-in time.</strong> Use current time is for the moment you trade the egg. If you already handed it in, enter that local date and time and press Save start time. The saved timestamp survives app restarts and determines the raising day in {RAISING.settings.dayLength / 3600}-hour periods, not at midnight. Leave it unset only to explore a new-egg plan at day 0; refreshing an existing bird's age requires a saved start time.</li>
        <li><strong>Choose Build preset.</strong> Digging is the default, with Bore + Burrow and an Endurance/Receptivity focus. Racing is the community starter build with Gallop + Canter. Circuit is a specialized community build for an Elm saddle and NPC-heavy competition, not a universal best racer. Racing availability and effects are not verified for the live ruleset. Open Why these build stats and abilities? beside the selector to see each build's targets, tradeoffs and sources.</li>
        <li><strong>Enter your bird's current reports.</strong> Read today's stable care report, then select each stat description before doing the feeding and stories you want the app to plan. For example, Impressive Discernment means 160-191 points; the estimate starts at 160, not a measured exact value. Advanced: exact current stats is optional and off by default. Mark every already-learned or inherited ability under Already learned (occupies a slot), even if it differs from the preset. Only two abilities fit; selecting desired abilities does not teach them in game.</li>
        <li><strong>Adjust goals only if needed.</strong> A preset fills in minimum final stats, desired abilities and Most important stat. Editing those goals changes the selector to Custom goals. Applying another preset keeps your current reports, exact-stat mode, learned abilities and egg time. Zero means no minimum, 224 starts SS, and 255 is the raw maximum; the four targets must fit the {RAISING.settings.statGrowthCap}-point cap. Most important stat guides the search if a complete route cannot be found; it does not automatically maximize that stat.</li>
        <li><strong>Calculate and read the estimate.</strong> Press Calculate plan for day N below the inputs, just above the divider before Estimated plan. Each calculation simulates the start of the current day: no feeding, stories or treatment done yet. Start with the table's Today row. Later rows cover the forecast through day {LAST_RAISING_DAY}. Check the ability-preparation steps and any partial-route warning too. Do not lower Discernment until the selected abilities are actually learned, even if the estimate assumes learning has finished.</li>
      </ol>
      <p><strong>Read quantities as totals, not a daily diet.</strong> Food counts mean items actually eaten, not days or one large trade. Care counts mean executed training days. Follow the dated rows and allow for hunger, health, energy, story encounters, locked plans and retirement; do not apply the whole summary at once.</p>
      <h4>How often should I check in?</h4>
      <p><strong>Recommended routine: visit the home stable and check this guide once per raising day</strong> while actively raising the bird. That is one {RAISING.settings.dayLength / 3600}-hour period from egg hand-in, not every Vana'diel day or every hour. You do not need to keep the app open.</p>
      <ol>
        <li><strong>Read the report, then plan today's remaining actions.</strong> Check health, affection, hunger and the trainer's stat descriptions. Enter those reports and press Calculate plan for day N above the Estimated plan divider. This works even when an estimate is already displayed and uses the current device time. Recalculate even if the descriptions stayed the same: the available time has changed. An unchanged description does not mean no points were gained; do not enter the forecast's numbers as measured stats or reset the egg hand-in time.</li>
        <li><strong>Follow today's table row.</strong> This is a start-of-day simulation, not a completion log. Follow it only if hunger, health, energy and Discernment allow. Recalculating does not remember actions or medicine already given; do not repeat them just because they appear again. Mark an ability learned only when it actually succeeds.</li>
        <li><strong>Check the trainer's schedule.</strong> Today's care cell shows any future care block to prepare. For example, on day 20 you can arrange care for day 22 onward; day 21 is already decided. Check what is already scheduled in game and only change future activities if needed, then use Confirm care schedule. The app cannot see or change the trainer's schedule, and it does not feed your bird.</li>
      </ol>
      <p><strong>Check again sooner if something changes:</strong> an ability is learned, a stat description changes, illness or hunger prevents a planned action, or you change a goal. You do not need to recalculate after every individual food item; finish the day's routine first unless a change affects what is safe to do next.</p>
      <p><strong>Leaving the app open:</strong> the raising day updates automatically. Use Calculate plan for day N to read the device clock immediately and replace the plan. It keeps your egg time, goals, learned abilities and confirmed care. Within the same 24-hour period, the raising day stays the same. Enter the reports for the start of the day you are simulating.</p>
      <p><strong>If you miss a day:</strong> raising time does not pause. Queued care and elapsed-day reports catch up at the next home-stable visit, but missed feeding and hands-on actions are not performed for you. Review the reports, update the guide and recalculate from the current age. Do not force-feed extra food to make up missed days.</p>
      <h4>What is a care plan?</h4>
      <p>A care plan is the daily routine you ask the stable trainer to carry out for your chocobo. You choose an activity and how many days it should run; the trainer performs it as raising days advance. Calculating a plan in this app does not queue anything in game.</p>
      <ul>
        <li><strong>Feeding:</strong> <RaisingFoodText text="you give an item such as a Vomp Carrot. Its effects apply when eaten." /></li>
        <li><strong>Care plans:</strong> the trainer performs daily training such as Carry Packages. These plans affect stats, affection and energy.</li>
        <li><strong>Hands-on activities:</strong> you choose a short, regular or long walk, tell a story, or perform another action. These use energy for encounters, stories and other effects. The Take a Walk care plan is not the same as taking a hands-on walk.</li>
      </ul>
      <p><strong>Examples:</strong> Take a Walk and Carry Packages train Strength and Endurance; Listen to Music trains Discernment and Receptivity; Exercise in a Group focuses on Endurance. Rest helps recovery instead of building stats. Availability depends on the bird's growth stage.</p>
      <p>You can queue four care-plan blocks of 1-7 days each. Plan 1 is the first editable block; Plan 2 runs after Plan 1 finishes, not two days from now. A plan selected on day N first affects results on day N + 2, because the next day's plan is already locked. Today's table row gives the activity and duration to set in Plan 1 if those future days are not already correct. Do not add Basic Care days to cover the delay. Use the timeline's queue-by dates to arrange later blocks with the trainer, and recheck them if you change an earlier block's duration. Empty blocks refill with Basic Care. Good and poor results change the amount of training gained; keep the bird healthy and its affection up.</p>
      <h4>How often can I feed it?</h4>
      <p>You can feed more than one item in a day. Trade food to your stable trainer: up to four items can be eaten per trade, not per day. More trades are possible, but fullness is the practical limit. Each eaten item applies its own effects; negative stat changes stop at zero, with no hidden deficit.</p>
      <p>Fullness runs from 0 to 255. Eating an item while already at 224 or higher counts as force-feeding. The check happens before each item, including items in the same trade. Force-feeding flags a {RAISING.forcedFeedIllnessChance}% stomachache-onset chance at the next rollover. For regular feeding, check the trainer's response rather than forcing food for faster stat gains; a matching illness remedy is a separate optional tradeoff explained in today's health guidance.</p>
      <div className="raising-table-wrap"><table aria-label="Feeding from zero fullness">
        <caption>Examples starting at 0 fullness, with no other food eaten</caption>
        <thead><tr><th>Food</th><th>Fullness per item</th><th>Items before the next would be force-feeding</th></tr></thead>
        <tbody>
          <tr><th scope="row"><RaisingFoodText text="Vomp Carrot" /></th><td>+64</td><td>4</td></tr>
          <tr><th scope="row"><RaisingFoodText text="Zegham Carrot" /></th><td>+96</td><td>3</td></tr>
        </tbody>
      </table></div>
      <p><RaisingFoodText text="These are not fixed daily rations. A partly full bird can eat fewer items before force-feeding. Three Zegham Carrots give +6 Discernment, +6 Receptivity, -6 Strength and -6 Endurance before caps and floors." /></p>
      <p><strong>Getting hungry again:</strong> a newly hatched chick starts full. Chicks lose fullness at the daily update according to energy spent; adolescent and adult birds reset to starving at rollover. Raising days last 24 Earth hours, anchored to egg hand-in rather than midnight or the shorter Vana'diel day. Reports are processed when visiting the home stable. Eggs cannot be fed.</p>
      <p><strong>Calculator food totals are not days:</strong> <RaisingFoodText text="a result of 80 Zegham Carrots means 80 items actually eaten, not 80 days. Food totals include both training and affection meals. Follow each day's order, one item per trade: mixed trades are reordered by the game. Check hunger between items and stop at completely full." /></p>
      <p><strong>Affection and stat training together:</strong> <RaisingFoodText text={`the search compares single foods and two-food mixtures, aiming to keep affection in the highest band (${AFFECTION_TARGET}-255) while meeting your chosen build. It does not automatically feed Azouph Greens: training carrots also raise affection, while greens, suitable pastes or Cupid Worms can help with recovery. Stat losses and the shared stat cap still apply. Random food bonuses are not credited as guaranteed gains.`} /></p>
      <p><strong>Optional non-yellow goal:</strong> <RaisingFoodText text={`choose the original egg warmth and check Avoid a yellow bird. For non-bred eggs, the calculator follows the hidden-gene distribution through each worm roll. It prioritizes non-yellow odds, then balances training progress and affection, comparing safe ordered meals including Parasite Worms before day ${RAISING.settings.daysToAdolescent}. Zero worms can be best for a favorable egg. This is a bounded search under the displayed care and hunger assumptions, not proof of an optimal schedule or a guaranteed color.`} /></p>
      <p><RaisingFoodText text="Record the total Parasite Worms actually eaten before adolescence, including today's worms, before recalculating. Planned meals and Feeding finished for today never increase that count automatically: the checkbox can also mean you skipped feeding. Missed worms do not count. For a different bird, update the egg selection and reset the count. Bred eggs and unknown egg origins need different genetic information and are not supported by this estimate." /></p>
      <p><strong>Today's reports matter:</strong> select the trainer's current hunger and affection descriptions and the bird's condition. Calculate becomes available when all required fields are valid. These three fields reset on a new raising day. The estimate uses the lowest affection and highest fullness in those descriptions, so it does not assume extra feeding capacity. Eggs cannot eat. Future chick meals assume only the displayed care plans, with no extra hunger from walks; actual activity and illness can change the amount. Recheck reports each day rather than forcing the future ration.</p>
      <p><strong>Treat ailments before training:</strong> select the trainer's reported ailments at the start of the day. The ailment box shows guidance and matching remedies as bullets. Medicine counts as food; at 224 or higher fullness, force-feeding a matching remedy is an optional tradeoff with a stomachache risk. Do not force-feed an unverified remedy. No doses are tracked or assumed already given. Future meals require recovery and a fresh hunger check; the forecast does not include the proposed medicine's fullness. Health details reset each raising day.</p>
      <p><strong>Report events:</strong> select events actually reported, not things you have completed. Checked events show their meaning and any follow-up below the list; age-based milestones stay on their dated timeline rows. Random events are not predicted. High spirits can increase the chance of later positive conditions; Full of energy benefits physical care plans, while Bright and focused benefits mental care plans. Both can improve the chance of learning an ability from a story. These condition bonuses are not included in the numeric forecast. Hands-on recovery and event actions are not added to the numeric forecast. Event selections reset each raising day and when changing eggs. White Handkerchief timing uses raising-report days, not Vana'diel days; its return is a trainer dialogue, not feeding. Live settings may differ; see the <a href={`${RAISING.source.repository}/blob/${RAISING.source.revision}/scripts/globals/hobbies/chocobo_raising/model.lua`} target="_blank" rel="noreferrer">daily-event implementation</a>.</p>
      <h4>One timeline through day 128</h4>
      <p>The planner simulates today's feeding, stories and treatment from the start of the day, then forecasts through day {LAST_RAISING_DAY}. Today's automatic care gains are already included in the reports you enter, so the model does not add them again. Day 0 is egg hand-in. Basic Care covers the egg stage; chick plans can be queued after hatching, and more plans become available at adolescence and adulthood. New care takes effect no earlier than two days after it is selected. Tomorrow's locked activity comes from confirmed care, or from the last calculated recommendation as an unconfirmed estimate. Correct it to match the trainer's schedule before calculating. With no saved recommendation, choose the actual activity.</p>
      <p><strong>Before day 64:</strong> the calculation includes care-plan gains and losses, balancing early training against the stats you want to keep. <strong>Days 64-128:</strong> care-plan stat losses stop automatically. Food penalties do not stop: Vomp Carrots still lower Discernment and Receptivity. You no longer choose one period or the other. Day 129 starts retirement: raising ends, but you can keep using the registered riding bird. Keep the retirement registration card and re-register its final stats.</p>
      <p className="raising-small">This is a conditional training scenario, not a guaranteed or optimal schedule. Care rows show the assumed good-day roll and its estimated chance; you cannot choose that roll in game, and poor days can halve changes. Food and care affection changes are included. Basic Care's random stat gains, random food bonuses, medical treatment and unscheduled activities are not simulated. Future days assume a healthy bird with enough energy for the listed story. Story acquisition is not timed by the calculator. A partial route is not proof that the goal is impossible. Live settings may differ.</p>
    </details>
    <p>Enter your start-of-day reports and calculate. Follow the table's Today row. Every calculation assumes no feeding, stories or treatment done yet.</p>
    <p className="raising-small">The trainer reports ranges, not exact points. Poor is the default assumption, not a report read from the game. An SS goal starts at 224; 255 is the raw maximum. Minimum final points are goals you choose, not numbers you need to read from your bird.</p>
    <div className="raising-start-controls">
      <div className="raising-controls">
        <label>Egg hand-in date and time (local)<input style={styles.input} type="datetime-local" step={1}
          value={draftStart} onChange={event => { setDraftStart(event.target.value); setStartError(null); }} /></label>
        <button style={styles.buttonCompact} type="button" onClick={() => beginNamedStart(Date.now())}>Use current time</button>
        <button style={styles.buttonCompact} type="button" onClick={saveManualStart}>Save start time</button>
        {(clock.startedAt !== null || clock.error) && <button style={styles.buttonCompact} type="button" onClick={() => {
          if (saveStart(null)) setSelectedStartName("");
        }}>Clear start time</button>}
      </div>
      <div className="raising-controls">
        {pendingStart !== null && <div className="raising-controls" role="group" aria-label="Name saved egg time">
          <label>Name for saved egg time<input style={styles.input} value={saveNameDraft}
            onChange={event => { setSaveNameDraft(event.target.value); setStartError(null); }} /></label>
          <button style={styles.buttonCompact} type="button" onClick={saveNamedStart}>Save named time</button>
          <button style={styles.buttonCompact} type="button" onClick={() => {
            setPendingStart(null);
            setSaveNameDraft("");
            setStartError(null);
          }}>Cancel</button>
        </div>}
        <label>Saved egg times<select style={styles.select} value={selectedStartName}
          onChange={event => selectSavedStart(event.target.value)}>
          <option value="">Choose a saved egg time</option>
          {savedStarts.map(entry => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
        </select></label>
        <button style={styles.buttonCompact} type="button" disabled={!selectedStartName || !!savedStartError}
          onClick={requestDeleteSavedStart}>Delete saved time</button>
        {pendingDeleteName && <div role="group" aria-label="Confirm saved time deletion">
          <p>Delete saved egg time: <strong>{pendingDeleteName}</strong>?</p>
          <button style={styles.buttonCompact} type="button" onClick={deleteSavedStart}>Confirm delete</button>
          <button style={styles.buttonCompact} type="button" onClick={() => setPendingDeleteName(null)}>Cancel delete</button>
        </div>}
      </div>
    </div>
    {startError && <p role="alert" className="raising-loss">{startError}</p>}
    {savedStartError && <p role="alert" className="raising-loss">{savedStartError}</p>}
    <p role="status">{clock.startedAt === null
      ? "No start time saved: planning a new egg at day 0."
      : <>Started {new Date(clock.startedAt).toLocaleString()}. <strong>{futureStart ? "Start time is in the future." : `Current raising day: ${currentDay}`}</strong>. {currentDay <= LAST_RAISING_DAY ? `${LAST_RAISING_DAY - currentDay} future raising days remain through day ${LAST_RAISING_DAY}.` : "Retirement has begun."}</>}</p>
    <p className="raising-small">Use the time you traded the egg, not the hatch time. The clock follows {RAISING.settings.dayLength / 3600}-hour periods. Save names appear in the saved egg times menu, so you can restore or delete them later. Enter descriptions after today's care report, before feeding and stories.</p>
    {view.persistenceError && <div>
      <p role="alert" className="raising-loss">{view.persistenceError}</p>
      <button type="button" style={styles.buttonCompact} onClick={() => setView(previous => ({ ...previous, persistenceError: undefined }))}>Save current raising data again</button>
    </div>}
    {dailyNotice && <p role="status" className="raising-notice">{dailyNotice}</p>}
    <form id={formId} onSubmit={event => { event.preventDefault(); calculate(); }}>
      <section aria-label="Chocobo color goal">
        <h4>Color preference</h4>
        <div className="raising-controls">
          <label>Starting egg warmth<select style={styles.select} value={form.eggId ?? ""}
            required={form.avoidYellow === true} onChange={event => update({ eggId: event.target.value })}>
            <option value="">Choose a non-bred egg</option>
            {RAISING.eggColorOdds.map(egg => <option key={egg.id} value={egg.id}>{egg.name}</option>)}
          </select></label>
        </div>
        <label className="raising-exact-toggle"><input type="checkbox" checked={form.avoidYellow === true}
          onChange={event => update({ avoidYellow: event.target.checked })} />Avoid a yellow bird</label>
        {form.avoidYellow && <>
          <div className="raising-controls">
            <label><RaisingFoodText text={`Parasite Worms already eaten before day ${RAISING.settings.daysToAdolescent}`} /><input style={styles.input}
              type="number" min={0} step={1} required value={form.wormsFed ?? "0"}
              onChange={event => update({ wormsFed: event.target.value })} /></label>
          </div>
          {currentDay >= RAISING.settings.daysToAdolescent && <p role="status" className="raising-notice"><RaisingFoodText text="Plumage is already fixed. No Parasite Worms will be planned; further worms affect breeding genes only. The estimate describes historical odds, not the color you can now see." /></p>}
        </>}
      </section>
      <div className="raising-controls">
        <label>Build preset<select style={styles.select} value={selectedPreset?.id ?? ""} onChange={event => {
          const preset = RAISING_PRESETS.find(entry => entry.id === event.target.value);
          if (preset) update({ target: statInputs(preset.target), desiredAbilities: [...preset.desiredAbilities], priority: preset.priority });
        }}>
          {RAISING_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          <option value="" disabled>Custom goals</option>
        </select></label>
      </div>
      {selectedPreset && selectedPreset.id !== "digging" && <p className="raising-notice">Community racing goal only: racing is marked disabled in the cited implementation. Confirm live availability before raising a racer. This calculator predicts training, not race wins.</p>}
      {selectedPreset?.id === "circuit" && <p className="raising-notice">Circuit assumes an Elm saddle and NPC-heavy competition. Its low Endurance is a deliberate equipment-dependent tradeoff. Confirm saddle availability and effects before committing; saddle bonuses are not included in the training plan. Trainer descriptions cannot confirm the exact 254/34/224/128 allocation.</p>}
      <details>
        <summary>Why these build stats and abilities?</summary>
        {!selectedPreset && <p>Your goals are customized. These preset explanations are reference starting points, not a description of your edited targets.</p>}
        {(selectedPreset ? [selectedPreset] : RAISING_PRESETS).map(preset => <section key={preset.id}>
          <h4>{preset.label}</h4>
          <p>{preset.summary}</p>
          <div className="raising-table-wrap"><table aria-label={`${preset.label} stat choices`}>
            <thead><tr><th>Stat</th><th>Minimum goal</th><th>What it does and why this build wants it</th></tr></thead>
            <tbody>{STAT_KEYS.map(key => <tr key={key}>
              <th scope="row">{STAT_LABELS[key]}</th><td>{STAT_GRADES[statRank(preset.target[key])]} ({preset.target[key]} points)</td><td className="raising-description">{preset.reasons[key]}</td>
            </tr>)}</tbody>
          </table></div>
          <p><strong>{preset.desiredAbilities.join(" + ")}:</strong> {preset.abilityReason}</p>
          {preset.id === "digging"
            ? <p className="raising-small">These digging bonuses are documented in the <a href="https://wiki.phoenix-xi.com/Chocobo_digging#Digging_with_your_own_chocobo" target="_blank" rel="noreferrer">source-derived digging guide</a>. The active digging override does not apply personal-chocobo stats or these abilities; live behavior may differ. The preset does not change the Digging tab's calculations.</p>
            : <p className="raising-small">{preset.id === "circuit"
              ? <>The exact allocation and Elm saddle assumption come from the <a href="https://www.ffxiah.com/forum/topic/58501/demystifying-chocobo-raising-plans-and-food/2/" target="_blank" rel="noreferrer">community Circuit build discussion</a>; NPC-versus-player tradeoffs follow the <a href="https://www.ffxiah.com/forum/topic/32770/ninians-guide-to-chocobo-raising-v2/5/" target="_blank" rel="noreferrer">community racing stat discussion</a>. The ability pair follows <a href="https://www.ffxiah.com/forum/topic/32770/ninians-guide-to-chocobo-raising-v2/" target="_blank" rel="noreferrer">Ninian's community raising guide</a>. </>
              : <>The SS/B/A/C recommendation and ability pair come from <a href="https://www.ffxiah.com/forum/topic/32770/ninians-guide-to-chocobo-raising-v2/" target="_blank" rel="noreferrer">Ninian's community raising guide</a>. </>}
              Stat roles follow the <a href="https://www.bg-wiki.com/ffxi/Chocobo_Racing" target="_blank" rel="noreferrer">retail racing reference</a>. The <a href={`${RAISING.source.repository}/blob/${RAISING.source.revision}/scripts/globals/chocobo_racing.lua`} target="_blank" rel="noreferrer">racing implementation</a> marks racing disabled. Treat racing advice as secondary guidance, not confirmed live-server mechanics. No saddle, racing-item or training-token bonuses are applied to training calculations.</p>}
        </section>)}
      </details>
      {currentDay + 1 >= RAISING.settings.daysToChick + 2 && currentDay < LAST_RAISING_DAY && <section aria-label="Tomorrow's locked care">
        <h4>Tomorrow's locked care - day {currentDay + 1}</h4>
        <div className="raising-controls">
          <label>Already-scheduled activity<select style={styles.select} required value={lockedCare.careId ?? ""}
            onChange={event => updateLockedCare(event.target.value)}>
            <option value="" disabled>Choose the trainer's scheduled activity</option>
            {RAISING.plans.filter(entry => entry.id === 0 || entry.id >= 2 && currentDay + 1 >= careAvailableDay(entry.id) + 2)
              .map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select></label>
        </div>
        <p className="raising-small">{lockedCare.source === "confirmed"
          ? "Recorded as arranged or corrected by you."
          : lockedCare.source === "estimated"
            ? "Unconfirmed estimate from your last calculated plan, not a report from the trainer."
            : "No saved care covers tomorrow. Select the activity already queued with the trainer."} Correct this if it differs in game.</p>
      </section>}
      {currentDay >= RAISING.settings.daysToChick && currentDay <= LAST_RAISING_DAY && <section aria-label="Today's feeding reports">
        <h4>Today's hunger, affection and condition</h4>
        <div className="raising-controls">
          <label>Affection report<select style={styles.select} required value={report.affection < 0 ? "" : report.affection}
            onChange={event => updateReport({ affection: event.target.value === "" ? -1 : Number(event.target.value) })}>
            <option value="" disabled>Choose the trainer's description</option>
            {report.affection >= 0 && !AFFECTION_REPORTS.some(entry => entry.min === report.affection)
              && <option value={report.affection}>Saved estimate: {report.affection}/255</option>}
            {AFFECTION_REPORTS.map(entry => <option key={entry.min} value={entry.min}>{entry.label} ({entry.min}-{entry.max})</option>)}
          </select></label>
          <label>Hunger report<select style={styles.select} required value={report.fullness < 0 ? "" : report.fullness}
            onChange={event => updateReport({ fullness: event.target.value === "" ? -1 : Number(event.target.value) })}>
            <option value="" disabled>Choose the trainer's description</option>
            {report.fullness >= 0 && !HUNGER_REPORTS.some(entry => entry.max === report.fullness)
              && <option value={report.fullness}>Saved estimate: {report.fullness}/255</option>}
            {HUNGER_REPORTS.map(entry => <option key={entry.max} value={entry.max}>{entry.label}</option>)}
          </select></label>
          <label>Condition / activity readiness<select style={styles.select} required value={report.condition === "unknown" ? "" : report.condition} onChange={event => {
            const condition = BIRD_CONDITIONS.find(entry => entry.id === event.target.value);
            updateReport({ condition: condition?.id ?? "unknown" });
          }}>
            <option value="" disabled>Check health and energy</option>
            {BIRD_CONDITIONS.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select></label>
        </div>
        <fieldset className="raising-report-area"><legend>Ailments reported by the trainer (select all that apply)</legend>
          <div className="raising-report-options">
            {BIRD_AILMENTS.map(ailment => <label key={ailment.id}>
              <input type="checkbox" checked={report.ailments?.includes(ailment.id) ?? false}
                onChange={event => updateReport({ ailments: event.target.checked
                  ? [...(report.ailments ?? []), ailment.id] : (report.ailments ?? []).filter(id => id !== ailment.id) })} />
              {ailment.label}
            </label>)}
          </div>
          {showAilmentGuidance && <ul className="raising-ailment-guidance" role="status" aria-label="Ailment guidance">
            <li><RaisingFoodText text={health.treatmentAction} /></li>
            {additionalHealthMessages.map(message => <li key={message}><RaisingFoodText text={message} /></li>)}
            {health.careActions.map(action => <li key={action}>{action}</li>)}
            {health.remedies.length > 0 && <li>
              {health.canTreat
                ? "Choose one matching treatment, not one per ailment."
                : health.canForceFeedRemedy
                  ? "Reference only: a matching remedy is an optional force-feeding tradeoff described above."
                  : "Reference only; do not feed these items now."}
              <ul>{health.remedies.map(ailment => <li key={ailment.id}><strong>{ailment.label}:</strong>{" "}
                <RaisingFoodText text={`${ailment.foods.map(food => food.name).join("; ")}.`} />
              </li>)}</ul>
            </li>}
            <li>Rest gives a 50% cure roll per bad condition and induces sleep. New care starts two days later, not immediately. Do not use extra walks to force hunger in an ill bird. Live settings may differ.</li>
          </ul>}
        </fieldset>
        <fieldset className="raising-report-area"><legend>Other events in the trainer's report (select all that apply)</legend>
          <div className="raising-report-options">
            {RAISING_EVENTS.map(event => <label key={event.id}>
              <input type="checkbox" checked={report.events?.includes(event.id) ?? false}
                onChange={change => updateReport({ events: change.target.checked
                  ? [...(report.events ?? []).filter(id => !(event.id === "whistle-search" && id === "whistle-found")
                    && !(event.id === "whistle-found" && id === "whistle-search")), event.id]
                  : (report.events ?? []).filter(id => id !== event.id) })} />
              {event.label}
            </label>)}
          </div>
          {handkerchiefGuidance.length > 0 && <ul className="raising-report-guidance" aria-label="White Handkerchief guidance">
            {handkerchiefGuidance.map(message => <li key={message}>{message}</li>)}
          </ul>}
          {eventInstructions}
          {hasPositiveCondition && <p className="raising-small">These guide-described benefits are not included in the numeric forecast; see the <a href="https://www.bg-wiki.com/ffxi/Chocobo_Raising#Conditions" target="_blank" rel="noreferrer">condition effects guide</a>. Live settings may differ.</p>}
        </fieldset>
      </section>}
      <details>
        <summary>Advanced: exact current stats</summary>
        <label className="raising-exact-toggle"><input type="checkbox" checked={useExactStats}
          onChange={event => update({ useExactStats: event.target.checked })} />Use exact current stats</label>
        <p className="raising-small">Off by default: use the trainer's descriptions unless you independently know the raw values. A trainer description alone does not reveal an exact number. This overrides the grade-based starting estimates, not the randomness of future training.</p>
      </details>
      <div className="raising-table-wrap">
        <table aria-label="Current and target chocobo stats">
          <thead><tr><th>Stat / purpose</th><th>{useExactStats ? "Exact current points" : "Trainer's description"}</th><th>Possible current range</th><th>Minimum final points</th></tr></thead>
          <tbody>{STAT_KEYS.map(key => {
            const raw = number(form.current[key]);
            const band = Number.isInteger(raw) && raw >= 0 && raw <= 255 ? STAT_BANDS[statRank(raw)] : null;
            return <tr key={key}>
            <th scope="row">{STAT_LABELS[key]}<span className="raising-stat-purpose">{{
              strength: "Riding speed", endurance: "Riding duration",
              discernment: "Story-learning thresholds", receptivity: "Trainer encounters and breeding",
            }[key]}</span></th>
            <td>{useExactStats
              ? <input aria-label={`Current ${STAT_LABELS[key]}`} style={styles.input}
                type="number" min={0} max={255} step={1} required value={form.current[key]}
                onChange={event => update({ current: { ...form.current, [key]: event.target.value } })} />
              : <select aria-label={`Current ${STAT_LABELS[key]} description`} style={styles.select} required value={band?.min ?? ""}
                onChange={event => update({ current: { ...form.current, [key]: event.target.value } })}>
                <option value="" disabled>Select a description</option>
                {STAT_BANDS.map(entry => <option key={entry.grade} value={entry.min}>{entry.description} ({entry.grade})</option>)}
              </select>}
            </td>
            <td>{band ? useExactStats ? `${raw} (exact override)` : <>{band.min}-{band.max} points<span className="raising-stat-purpose">Starting estimate: {band.min}</span></> : "Enter a valid stat"}</td>
            <td><input aria-label={`Target ${STAT_LABELS[key]}`} style={styles.input}
              type="number" min={0} max={255} step={1} required value={form.target[key]}
              onChange={event => update({ target: { ...form.target, [key]: event.target.value } })} /></td>
          </tr>;
          })}</tbody>
        </table>
      </div>
      {!useExactStats && <p className="raising-small">Estimate only: the calculation starts at the lower end of each range, not every possible value. The four stats share a {RAISING.settings.statGrowthCap}-point cap, so their range maxima may not all be possible together. Higher actual starting points can change cap-limited gains; this is not a guaranteed worst-case forecast.</p>}
      <div className="raising-controls">
        <label>Most important stat<select style={styles.select} value={form.priority} onChange={event => {
          const priority = STAT_KEYS.find(key => key === event.target.value);
          if (priority) update({ priority });
        }}>{STAT_KEYS.map(key => <option key={key} value={key}>{STAT_LABELS[key]}</option>)}</select></label>
      </div>
      <p className="raising-small"><strong>Most important stat:</strong> guides the training search and favors this stat if no complete route is found. It does not change your targets; a complete route must meet every minimum.</p>
      <p className="raising-small">Care-plan losses are included before day 64 and stop automatically from day 64 onward. Only the remaining days through {LAST_RAISING_DAY} are available; changing the start time changes that budget.</p>
      <div className="raising-ability-groups">
        <fieldset><legend>Desired abilities (up to two)</legend>{RAISING_ABILITIES.map(ability => <label key={ability.name}>
          <input type="checkbox" checked={form.desiredAbilities.includes(ability.name)} onChange={() => toggleAbility("desiredAbilities", ability.name)} />{ability.name}
        </label>)}</fieldset>
        <fieldset><legend>Already learned (occupies a slot)</legend>{RAISING_ABILITIES.map(ability => <label key={ability.name}>
          <input type="checkbox" checked={form.knownAbilities.includes(ability.name)} onChange={() => toggleAbility("knownAbilities", ability.name)} />{ability.name}
        </label>)}</fieldset>
      </div>
      {care && <p className="raising-small">
        <button type="button" style={styles.buttonCompact} aria-label="Confirm recommended care schedule"
          disabled={!canComplete} onClick={() => confirmCare(progress.careKey === care.key ? null : care.key)}>
          {progress.careKey === care.key ? "Clear care confirmation" : "Confirm care schedule"}
        </button>{" "}{trainingActionName({ kind: "care", id: care.careId })}, days {care.firstDay}-{care.lastDay}
      </p>}
      {error && <p role="alert" className="raising-loss">{error}</p>}
    </form>
    <div className="raising-controls">
      <button style={styles.buttonCompact} type="submit" form={formId} disabled={!!error || isCalculating}>{`Calculate plan for day ${currentDay}`}</button>
    </div>
    <hr className="raising-plan-divider" />
    <section aria-label="Calculated chocobo plan" aria-busy={isCalculating}>
    {!plan && <div className="raising-plan-placeholder" style={styles.subCard}>
      <h4>Estimated plan</h4>
      {isCalculating ? <p role="status" className="raising-plan-loading">
        <span className="raising-plan-spinner" aria-hidden="true" />
        Calculating your plan for day {currentDay}... This may take a few seconds.
      </p> : <>
        {calculation?.status === "error"
          ? <p role="alert" className="raising-loss">Unable to calculate the plan: {calculation.message} You can try again.</p>
          : <p>No plan available for the current day and inputs. Calculate a plan for raising day {currentDay} to see your estimated training timeline here.</p>}
        {error && <p className="raising-small">Before calculating: {error}</p>}
      </>}
      {milestoneInstructions}
    </div>}
    {plan && <div className="raising-plan-result" aria-live="polite">
      <h4>Estimated plan</h4>
      {healthFirst && <p role="status" className="raising-notice"><strong>Hypothetical recovery forecast, not feeding instructions.</strong> Future meals and stories require confirmed recovery and fresh hunger/energy reports. Proposed medicine is not included in the fullness forecast. Skip training while the bird remains unwell.</p>}
      <p>{useExactStats ? "Starting points (exact overrides)" : "Starting-point estimate (lower ends of the selected ranges)"}: <strong>{statSummary(input.current)}</strong>. This is a scenario, not a measurement of your bird.</p>
      <section>
        <h4>Estimated training timeline: {futureDays.length ? `days ${currentDay}-${LAST_RAISING_DAY}` : `day ${currentDay}`}</h4>
        <p>Today starts before feeding, stories and treatment. Later rows are forecasts, not extra actions for today.</p>
        {healthFirst && <p className="raising-notice">Future meals after today's treatment row are conditional on confirmed recovery and a fresh hunger check. This forecast does not predict when the illness will end.</p>}
        {!plan.complete && <p role="alert" className="raising-loss">No complete route was found within the remaining days and this model. This does not prove the goals are impossible. Partial progress only: {plan.remaining.join("; ")}. Check the start time, trainer descriptions or exact overrides, and learned abilities, or revise your goals.</p>}
        <div className="raising-table-wrap">
          <table aria-label="Goal training steps">
            <thead><tr><th>Raising days</th><th>Daily care / assumed roll</th><th>Food / treatment, in feeding order</th><th>Story attempts</th><th>Modeled stats afterward</th></tr></thead>
            <tbody>
              <tr aria-label="Today's remaining actions">
                <th scope="row">Today - day {currentDay}{clock.startedAt !== null && <span className="raising-stat-purpose">{new Date(clock.startedAt + currentDay * RAISING.settings.dayLength * 1000).toLocaleDateString()}</span>}</th>
                <td>Today's care is already in your reports in game.
                  {care && <span className="raising-stat-purpose">{healthFirst ? "After reviewing recovery, check" : "Check"} Plan 1: {trainingActionName({ kind: "care", id: care.careId })}, {care.count} days ({care.firstDay}-{care.lastDay}). Leave it unchanged if already correct.</span>}
                </td>
                <td className="raising-description">{currentDay < RAISING.settings.daysToChick ? "Egg stage: no food or medicine."
                  : healthFirst ? <><strong>Treatment:</strong>{" "}<RaisingFoodText text={health.treatmentAction} /></>
                  : todayPlan?.feeding?.items.length ? <RaisingFoodText text={`Feed ${feedingSummary(todayPlan.feeding.items)}, one at a time. Stop at completely full.`} />
                  : "Full in this estimate; recheck hunger."}
                  {healthFirst && <span className="raising-stat-purpose">Skip stat food and <RaisingFoodText text="Parasite Worms" /> while addressing this report.</span>}
                  {milestoneInstructions}
                </td>
                <td>{currentDay < RAISING.settings.daysToChick ? "Egg stage: no stories."
                  : healthFirst || report.condition !== "healthy" ? "Skip stories until healthy, awake and ready."
                  : todayStory && !form.knownAbilities.includes(todayStory.name) ? <span aria-label="Today's story instruction">
                    Tell a Story: {todayStory.story}, once ({todayStory.name}). Requires {todayStory.discernment} DSC, {RAISING.actionEnergy[50]["2"]}+ energy and a free ability slot.
                  </span>
                  : "No story attempt remaining today."}</td>
                <td>{statSummary(todayPlan?.after ?? input.current)}
                  {healthFirst && <span className="raising-stat-purpose">Treatment is not assumed to have cured the condition.</span>}
                </td>
              </tr>
              {groupTrainingDays(futureDays, separateDays).map(step => <tr key={step.day}>
              <th scope="row">{step.day === step.endDay ? step.day : `${step.day}-${step.endDay}`}{clock.startedAt !== null && <span className="raising-stat-purpose">{new Date(clock.startedAt + step.day * RAISING.settings.dayLength * 1000).toLocaleDateString()}</span>}</th>
              <td>{trainingActionName({ kind: "care", id: step.careId })}<br /><span className="raising-small">{step.careId === 0 ? "No random gain assumed" : `${step.carePoints} points per arrow`}; {step.day === currentDay + 1 ? "already locked" : `queue by day ${step.day - 2}`}</span>
                {raisingMilestoneGuidance(step.day).map(message => <span key={message} className="raising-stat-purpose">{message}</span>)}
                {step.feeding && step.careId !== 0 && <span className="raising-stat-purpose">Good-day chance: {step.feeding.careSuccess}%{step.days > 1 ? " minimum in this block" : ""}</span>}</td>
              <td className="raising-description">{step.feeding
                ? step.feeding.items.length ? <RaisingFoodText text={`${feedingSummary(step.feeding.items)} (${step.feeding.items.length * step.days} items total)`} />
                  : step.day < RAISING.settings.daysToChick ? "Egg stage" : "Full in this estimate; recheck hunger that day"
                : step.foodId === null ? "Recalculate with feeding reports" : <RaisingFoodText text={`${step.foodCount} ${trainingActionName({ kind: "food", id: step.foodId })} (${step.foodCount * step.days} total)`} />}
                {healthFirst && (step.feeding?.items.length || step.foodCount > 0) ? <strong className="raising-stat-purpose">Only after confirmed recovery and a fresh hunger check.</strong> : null}
                {step.feeding && <span className="raising-stat-purpose">Affection afterward: {step.feeding.affectionAfter}/255{step.days > 1 ? " at block end" : ""} (estimate)</span>}</td>
              <td>{step.story ? <>{`${step.story}: ${step.firstAttempt === step.attempt ? step.attempt : `${step.firstAttempt}-${step.attempt}`}/${STORY_ATTEMPTS_95}${step.assumedLearned ? "; assumes learned at end" : ""}`}
                {healthFirst && <strong className="raising-stat-purpose">Only after confirmed recovery and an energy check.</strong>}</> : "-"}</td>
              <td>{statSummary(step.after)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {!futureDays.length && <p>Day {LAST_RAISING_DAY} is the last training day. Check today's row for any remaining actions; retirement starts on day {RAISING.settings.daysToAdult4}.</p>}
        {plan.pending.length > 0 && <p>Learn the selected abilities before lowering Discernment. Lowering it later does not erase learned abilities; avoid Lethe foods, which can forget a random ability.</p>}
      </section>
      <div className="raising-table-wrap"><table aria-label="Goal planner results">
        <thead><tr><th>Stat</th><th>Minimum goal</th><th>Estimated result</th><th>Grade</th></tr></thead>
        <tbody>{STAT_KEYS.map(key => <tr key={key}><th scope="row">{STAT_LABELS[key]}</th><td>{input.target[key]}</td>
          <td className={plan.result[key] < input.target[key] ? "raising-loss" : ""}>{plan.result[key]}</td><td>{STAT_GRADES[statRank(plan.result[key])]}</td></tr>)}</tbody>
      </table></div>
      {riding && <p>With {plan.finalAbilities.length ? plan.finalAbilities.join(" + ") : "no selected abilities"}, the modeled result gives <strong>{riding.rentalPercent}% of rental speed</strong> and <strong>{riding.minutes} minutes riding</strong>, before game-speed rounding and without racing silks. Abilities are assumed learned, not granted by this planner. Re-register your chocobo after actual stat changes.</p>}
      {plan.finalAbilities.some(name => ["Bore", "Burrow", "Treasure Finder"].includes(name)) && <p className="raising-notice">Bore, Burrow and Treasure Finder are learnable, but the active digging override does not apply personal-chocobo stats or these abilities. This plan does not promise improved digging results on the live server.</p>}
      <p className="raising-notice raising-food-totals" aria-label="Estimated food totals"><strong>Total food needed for this plan:</strong>{" "}
        <RaisingFoodText text={foodTotals.length ? foodTotals.map(food => `${food.count} ${food.name}`).join("; ") : "No food needed in this estimate"} />.
        {" "}Includes today's planned food and all future meals through day {LAST_RAISING_DAY}, including affection meals. Use these estimates to plan gardening; recalculate after daily reports.
        {healthFirst && " Hypothetical totals conditional on recovery, not a medicine or feeding prescription."}
      </p>
      {plan.pending.length > 0 && <details>
        <summary>Ability preparation and learning checkpoint</summary>
        <p>Build at least <strong>{plan.threshold} Discernment</strong>, then keep it at or above that level until the selected abilities are learned. The timeline includes early care gains and food together; do not add a separate 80-carrot preparation phase.</p>
        <ol>{plan.pending.map(ability => <li key={ability.name}>
          <strong>{ability.name}: {ability.story}</strong> - requires {ability.discernment} DSC after the story's +1. {ability.obtain}
        </li>)}</ol>
        <p>Tell stories from adolescence (day {RAISING.settings.daysToAdolescent}); long walks require adulthood (day {RAISING.settings.daysToAdult1}). This scenario starts attempts no earlier than day {plan.firstStoryDay}, assuming the stories have been collected, and budgets one eligible attempt per day for {STORY_ATTEMPTS_95} days per missing ability. Each attempt has a {RAISING.learnChance}% chance; {STORY_ATTEMPTS_95} attempts gives {(storyLearningProbability(STORY_ATTEMPTS_95) * 100).toFixed(1)}% for <strong>one ability</strong>, not a guarantee or a combined chance for both.</p>
        <p>Failed attempts retain the story. Successful learning consumes it. Stop retelling a learned ability's story: that can give inspiration instead of a new ability.</p>
        <p className="raising-small">For stat arithmetic, each ability is assumed learned on the last of its {STORY_ATTEMPTS_95} reserved attempts; every attempt adds capped +1 DSC. Real learning can happen earlier or later. If a story is not yet available or the ability is still missing, do not follow later steps that lower DSC: keep feeding suitable maintenance food such as <RaisingFoodText text="Azouph Greens" />, maintain the threshold, and recalculate. Mark abilities already learned to avoid reserving another full allowance.</p>
      </details>}
      {!plan.pending.length && <p>No new ability learning is required for these selections. Already-learned abilities are retained.</p>}
      {colorPlan && <details aria-label="Estimated non-yellow strategy">
        <summary>{colorPlan.locked ? "Color already locked" : "Non-yellow feeding strategy"}</summary>
        <p><strong>{colorPlan.plannedWorms} additional <RaisingFoodText text="Parasite Worms" /></strong> planned before day {RAISING.settings.daysToAdolescent}; {colorPlan.wormsFed} already eaten. Estimated non-yellow chance: <strong>{((1 - colorPlan.before.yellow) * 100).toFixed(2)}% before this plan</strong> to <strong>{((1 - colorPlan.after.yellow) * 100).toFixed(2)}% after the planned worms</strong>.</p>
        <div className="raising-table-wrap"><table aria-label="Planned plumage color chances">
          <caption>Final plumage odds from the starting egg and worm count, not individual gene-roll odds</caption>
          <thead><tr><th scope="col">Color</th><th scope="col">Before remaining meals</th><th scope="col">After remaining meals</th></tr></thead>
          <tbody>{CHOCOBO_COLORS.map(color => <tr key={color}>
            <th scope="row">{color[0].toUpperCase() + color.slice(1)}</th>
            <td>{(colorPlan.before[color] * 100).toFixed(2)}%</td><td>{(colorPlan.after[color] * 100).toFixed(2)}%</td>
          </tr>)}</tbody>
        </table></div>
        <p className="raising-small">{colorPlan.locked
          ? "These are historical model probabilities, not a new chance to change the bird's visible color."
          : colorPlan.plannedWorms === 0
            ? "No beneficial worm meal was found within the remaining safe feeding opportunities. This may be because the egg already has better odds without worms."
            : "Follow the listed meal order and recheck hunger between items. Do not add worms on top of these meals or force-feed to meet the estimated count."} The calculation averages over hidden genes and assumes the recorded egg and worm history are correct. It is not a measurement or a guarantee; live settings may differ.</p>
        <p className="raising-small">Best route found by a bounded search: non-yellow odds come first, then training progress and affection are balanced. Future chick hunger assumes scheduled care only. Recalculate after reports or missed meals; training goals may take longer or remain incomplete.</p>
      </details>}
    </div>}
    </section>
  </section>;
}
