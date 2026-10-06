import { useEffect, useId, useState } from "react";
import { styles } from "./styles";
import { peekRestoredTabState, rememberTabState } from "./utils/tabNav";
import { saveJson } from "./utils/storage";
import { RAISING, STAT_KEYS, STAT_LABELS, STAT_GRADES, STAT_BANDS, statRank, ridingEstimate, type RaisingStats } from "./utils/chocoboRaising";
import {
  RAISING_ABILITIES, RAISING_PRESETS, STORY_ATTEMPTS_95, validateRaisingGoal,
  storyLearningProbability, trainingActionName, LAST_RAISING_DAY, RAISING_START_KEY,
  raisingDayAt, localRaisingStart, parseRaisingStart, type RaisingGoalInput,
  groupTrainingDays,
} from "./utils/chocoboRaisingPlanner";
import { RAISING_DAILY_KEY, parseSavedRaisingDaily, dailyProgress, todayCare, feedingInputKey, type PlannerForm, type SavedRaisingDaily } from "./utils/raisingDaily";
import {
  AFFECTION_REPORTS, HUNGER_REPORTS, BIRD_CONDITIONS, AFFECTION_TARGET, feedingSummary, validateFeedingReport, type FeedingReport,
} from "./utils/chocoboFeeding";
import type { RaisingPlannerResponse } from "./workers/chocoboRaisingPlanner.worker";

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
      defaultsVersion: DEFAULTS_VERSION, calculatedDay: null, progress: restored.progress,
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
  return form.feedingReport?.day === day ? form.feedingReport
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
      return { ...restorePlannerView(), persistenceError: "Unable to load the saved raising checklist. Verify your reports and completed actions before calculating again." };
    }
  });
  const [clock, setClock] = useState(loadStart);
  const [draftStart, setDraftStart] = useState(() => clock.startedAt === null ? "" : localRaisingStart(clock.startedAt));
  const [startError, setStartError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [dailyNotice, setDailyNotice] = useState<string | null>(null);
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
          saveJson(RAISING_DAILY_KEY, { form: view.form, defaultsVersion: view.defaultsVersion, daily: view.daily, progress: view.progress });
        } catch (error) {
          console.error("Unable to save the raising checklist.", error);
          setView(previous => previous === view ? { ...previous, persistenceError: "Unable to save the raising checklist on this device. Keep the app open; changes may be lost on restart. Try again after checking browser storage." } : previous);
        }
      }
    }
  }, [view]);
  const { form } = view;
  const useExactStats = form.useExactStats === true;
  const futureStart = clock.startedAt !== null && clock.startedAt > now;
  const currentDay = clock.startedAt === null || futureStart ? 0 : raisingDayAt(clock.startedAt, now);
  const progress = dailyProgress(view.progress, clock.startedAt, currentDay);
  const input: RaisingGoalInput = {
    ...form, current: currentStats(form), target: parseStats(form.target), currentDay,
    today: { feedingDone: progress.feedingDone, storyDone: progress.storyDone },
    feedingReport: feedingReport(form, currentDay),
  };
  const selectedPreset = RAISING_PRESETS.find(preset =>
    STAT_KEYS.every(key => preset.target[key] === input.target[key]) && preset.priority === form.priority
    && preset.desiredAbilities.length === form.desiredAbilities.length
    && preset.desiredAbilities.every(name => form.desiredAbilities.includes(name)));
  const error = clock.error ?? (futureStart ? "The saved egg start time is in the future. Correct the start time or your device clock." : validateRaisingGoal(input));
  const isCurrent = view.todayMode === true && view.feedingMode === true && view.defaultsVersion === DEFAULTS_VERSION && view.calculatedDay === currentDay && view.calculatedStart === clock.startedAt && !error;
  const calculation = isCurrent ? view.calculation : undefined;
  const isCalculating = !!isCurrent && !calculation;
  const plan = calculation?.status === "success" ? calculation.plan : null;
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
        today: { feedingDone: progress.feedingDone, storyDone: progress.storyDone },
        feedingReport: feedingReport(view.form, currentDay),
      };
      worker.postMessage(request);
    } catch (error) {
      finish({ status: "error", message: error instanceof Error ? error.message : "The calculation could not start." });
    }
    return () => { active = false; worker?.terminate(); };
  }, [view, currentDay, isCalculating, progress.feedingDone, progress.storyDone]);
  const calculate = () => {
    if (isCalculating) return;
    const refreshedNow = Date.now();
    setNow(refreshedNow);
    const refreshedFutureStart = clock.startedAt !== null && clock.startedAt > refreshedNow;
    const refreshedDay = clock.startedAt === null || refreshedFutureStart ? 0 : raisingDayAt(clock.startedAt, refreshedNow);
    const invalid = clock.error || refreshedFutureStart || validateRaisingGoal({ ...input, currentDay: refreshedDay, feedingReport: feedingReport(form, refreshedDay) });
    setDailyNotice(null);
    setView(previous => ({
      ...previous, form, defaultsVersion: DEFAULTS_VERSION, todayMode: true, feedingMode: true, persistenceError: undefined, calculation: undefined,
      calculatedDay: invalid ? null : refreshedDay, calculatedStart: clock.startedAt,
    }));
  };
  const update = (patch: Partial<PlannerForm>) => setView(previous => ({
    ...previous, form: { ...form, ...patch }, defaultsVersion: DEFAULTS_VERSION, calculatedDay: null, calculation: undefined, persistenceError: undefined,
  }));
  const completeToday = (patch: Partial<typeof progress>) => {
    const refreshedNow = Date.now();
    setNow(refreshedNow);
    if (clock.startedAt === null || clock.startedAt > refreshedNow || raisingDayAt(clock.startedAt, refreshedNow) !== currentDay) {
      setDailyNotice("The raising day changed. Review the current day's checklist before marking an action.");
      return;
    }
    setDailyNotice(patch.careKey !== undefined
      ? patch.careKey === null ? "Care schedule check cleared." : "Care schedule marked as checked for today."
      : "Marked for today. Before recalculating, update the trainer descriptions after any actions you have done. Finished feeding and story activities will not be recommended again today.");
    setView(previous => ({
      ...previous, progress: { ...progress, ...patch }, persistenceError: undefined,
      ...(patch.careKey === undefined ? { calculatedDay: null, calculation: undefined } : {}),
    }));
  };
  const saveStart = (startedAt: number | null) => {
    try {
      saveJson(RAISING_START_KEY, startedAt);
    } catch (error) {
      console.error("Unable to save the raising start time.", error);
      setStartError("Unable to save the egg start time. The previous start time is unchanged.");
      return;
    }
    setClock({ startedAt, error: null });
    setDraftStart(startedAt === null ? "" : localRaisingStart(startedAt));
    setStartError(null);
    setNow(Date.now());
    setDailyNotice(null);
    setView(previous => ({
      form: previous.form, defaultsVersion: DEFAULTS_VERSION, calculatedDay: null,
      daily: previous.daily?.startedAt === startedAt ? previous.daily : undefined,
      progress: previous.progress?.startedAt === startedAt ? previous.progress : undefined,
    }));
  };
  const saveManualStart = () => {
    let startedAt: number;
    try {
      startedAt = parseRaisingStart(draftStart, Date.now());
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Invalid egg start time.");
      return;
    }
    saveStart(startedAt);
  };
  const toggleAbility = (key: "desiredAbilities" | "knownAbilities", name: string) =>
    update({ [key]: form[key].includes(name) ? form[key].filter(entry => entry !== name) : [...form[key], name] });
  const riding = plan ? ridingEstimate(plan.result, plan.finalAbilities.includes("Gallop"), plan.finalAbilities.includes("Canter")) : null;
  const schedule = view.daily?.startedAt === clock.startedAt && view.daily.plannedDay <= currentDay ? view.daily : undefined;
  const today = schedule?.days.find(step => step.day === currentDay);
  const todayStory = RAISING_ABILITIES.find(ability => ability.name === today?.story);
  const care = schedule ? todayCare(schedule, currentDay) : null;
  const futureDays = plan?.days.filter(step => step.day > currentDay) ?? [];
  const canComplete = clock.startedAt !== null && !futureStart && currentDay <= LAST_RAISING_DAY && !isCalculating;
  const report = feedingReport(form, currentDay);
  const reportError = validateFeedingReport(report, currentDay);
  const updateReport = (patch: Partial<FeedingReport>) => update({ feedingReport: { ...report, ...patch, day: currentDay } });
  const feedingIsCurrent = schedule?.feedingReport?.day === currentDay
    && schedule.feedingReport.affection === report.affection && schedule.feedingReport.fullness === report.fullness
    && schedule.feedingReport.condition === report.condition && schedule.feedingInputs === feedingInputKey(form, report);

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
        <li><strong>Calculate and read the estimate.</strong> Press Calculate plan for day N below the inputs, just above the divider before Estimated plan. The button shows the current raising day. Changing an input cancels the old calculation but keeps the saved daily checklist. Start with What to do today: it shows today's food, story attempt and care to arrange with the trainer. The future timeline below covers later days through day {LAST_RAISING_DAY}. Check the ability-preparation steps and any partial-route warning too. Do not lower Discernment until the selected abilities are actually learned, even if the estimate assumes learning has finished.</li>
      </ol>
      <p><strong>Read quantities as totals, not a daily diet.</strong> Food counts mean items actually eaten, not days or one large trade. Care counts mean executed training days. Follow the dated rows and allow for hunger, health, energy, story encounters, locked plans and retirement; do not apply the whole summary at once.</p>
      <h4>How often should I check in?</h4>
      <p><strong>Recommended routine: visit the home stable and check this guide once per raising day</strong> while actively raising the bird. That is one {RAISING.settings.dayLength / 3600}-hour period from egg hand-in, not every Vana'diel day or every hour. You do not need to keep the app open.</p>
      <ol>
        <li><strong>Read the report, then plan today's remaining actions.</strong> Check health, affection, hunger and the trainer's stat descriptions. Enter those reports and press Calculate plan for day N above the Estimated plan divider. This works even when an estimate is already displayed and uses the current device time. Recalculate even if the descriptions stayed the same: the available time has changed. An unchanged description does not mean no points were gained; do not enter the forecast's numbers as measured stats or reset the egg hand-in time.</li>
        <li><strong>Use What to do today and check off finished activities.</strong> The checklist is saved on this device, so there is nothing to write down. Follow the food and story advice only if hunger, health, energy and Discernment allow. Check Feeding finished for today when you will not give any more food, and Story activities finished for today after the attempt, even if it fails. You can also check them when skipping an activity, or if you did it before opening the app. Refreshing will not recommend another completed activity that day. Mark an ability learned only when it actually succeeds.</li>
        <li><strong>Check the trainer's schedule.</strong> Care to arrange today appears only when the saved plan has a future care block to prepare. For example, on day 20 you can arrange care for day 22 onward; day 21 is already decided. Check what is already scheduled in game and only change future activities if needed, then check Care schedule checked / arranged. The app cannot see or change the trainer's schedule, and it does not feed your bird.</li>
      </ol>
      <p><strong>Check again sooner if something changes:</strong> an ability is learned, a stat description changes, illness or hunger prevents a planned action, or you change a goal. You do not need to recalculate after every individual food item; finish the day's routine first unless a change affects what is safe to do next.</p>
      <p><strong>Leaving the app open:</strong> the raising day updates automatically, and What to do today displays that day's saved instructions with fresh checkboxes. You can also use Calculate plan for day N to read the device clock immediately and replace the plan after updating your reports. It keeps your egg time, goals, learned abilities and that day's completion marks. Within the same 24-hour period, the raising day stays the same. After doing any actions, update your current reports before recalculating; checked activities are excluded from today's new estimate.</p>
      <p><strong>If you miss a day:</strong> raising time does not pause. Queued care and elapsed-day reports catch up at the next home-stable visit, but missed feeding and hands-on actions are not performed for you. Review the reports, update the guide and recalculate from the current age. Do not force-feed extra food to make up missed days.</p>
      <h4>What is a care plan?</h4>
      <p>A care plan is the daily routine you ask the stable trainer to carry out for your chocobo. You choose an activity and how many days it should run; the trainer performs it as raising days advance. Calculating a plan in this app does not queue anything in game.</p>
      <ul>
        <li><strong>Feeding:</strong> you give an item such as a Vomp Carrot. Its effects apply when eaten.</li>
        <li><strong>Care plans:</strong> the trainer performs daily training such as Carry Packages. These plans affect stats, affection and energy.</li>
        <li><strong>Hands-on activities:</strong> you choose a short, regular or long walk, tell a story, or perform another action. These use energy for encounters, stories and other effects. The Take a Walk care plan is not the same as taking a hands-on walk.</li>
      </ul>
      <p><strong>Examples:</strong> Take a Walk and Carry Packages train Strength and Endurance; Listen to Music trains Discernment and Receptivity; Exercise in a Group focuses on Endurance. Rest helps recovery instead of building stats. Availability depends on the bird's growth stage.</p>
      <p>You can queue four care-plan blocks of 1-7 days each. A plan selected on day N first affects results on day N + 2, because the next day's plan is already locked. Use the timeline's queue-by dates to arrange care with the trainer. Empty blocks refill with Basic Care. Good and poor results change the amount of training gained; keep the bird healthy and its affection up.</p>
      <h4>How often can I feed it?</h4>
      <p>You can feed more than one item in a day. Trade food to your stable trainer: up to four items can be eaten per trade, not per day. More trades are possible, but fullness is the practical limit. Each eaten item applies its own effects; negative stat changes stop at zero, with no hidden deficit.</p>
      <p>Fullness runs from 0 to 255. Eating an item while already at 224 or higher counts as force-feeding. The check happens before each item, including items in the same trade. Force-feeding flags a {RAISING.forcedFeedIllnessChance}% stomachache-onset chance at the next rollover. Feed one item at a time and check the trainer's response rather than forcing more food for faster stat gains.</p>
      <div className="raising-table-wrap"><table aria-label="Feeding from zero fullness">
        <caption>Examples starting at 0 fullness, with no other food eaten</caption>
        <thead><tr><th>Food</th><th>Fullness per item</th><th>Items before the next would be force-feeding</th></tr></thead>
        <tbody>
          <tr><th scope="row">Vomp Carrot</th><td>+64</td><td>4</td></tr>
          <tr><th scope="row">Zegham Carrot</th><td>+96</td><td>3</td></tr>
        </tbody>
      </table></div>
      <p>These are not fixed daily rations. A partly full bird can eat fewer items before force-feeding. Three Zegham Carrots give +6 Discernment, +6 Receptivity, -6 Strength and -6 Endurance before caps and floors.</p>
      <p><strong>Getting hungry again:</strong> a newly hatched chick starts full. Chicks lose fullness at the daily update according to energy spent; adolescent and adult birds reset to starving at rollover in the pinned model. Raising days last 24 Earth hours, anchored to egg hand-in rather than midnight or the shorter Vana'diel day. Reports are processed when visiting the home stable. Eggs cannot be fed.</p>
      <p><strong>Calculator food totals are not days:</strong> a result of 80 Zegham Carrots means 80 items actually eaten, not 80 days. Food totals include both training and affection meals. Follow each day's order, one item per trade: mixed trades are reordered by the game. Check hunger between items and stop at completely full.</p>
      <p><strong>Affection and stat training together:</strong> the search compares single foods and two-food mixtures, aiming to keep affection in the highest band ({AFFECTION_TARGET}-255) while meeting your chosen build. It does not automatically feed Azouph Greens: training carrots also raise affection, while greens, suitable pastes or Cupid Worms can help with recovery. Stat losses and the shared stat cap still apply. Random food bonuses are not credited as guaranteed gains.</p>
      <p><strong>Today's reports matter:</strong> select the trainer's current hunger and affection descriptions and the bird's condition. Calculate becomes available when all required fields are valid. These three fields reset on a new raising day. The estimate uses the lowest affection and highest fullness in those descriptions, so it does not assume extra feeding capacity. Eggs cannot eat. Future chick meals assume only the displayed care plans, with no extra hunger from walks; actual activity and illness can change the amount. Recheck reports each day rather than forcing the future ration.</p>
      <h4>One timeline through day 128</h4>
      <p>The planner includes today's unfinished feeding and story actions, then the days through day {LAST_RAISING_DAY}. Today's care gains are already included in the reports you enter, so the model does not add them again. Day 0 is egg hand-in. Basic Care covers the egg stage; chick plans can be queued after hatching, and more plans become available at adolescence and adulthood. New care takes effect no earlier than two days after it is selected. Tomorrow's already-locked plan is assumed to be Basic Care with no random stat gain; update the reports at your next visit rather than treating that assumption as a change to the trainer's schedule.</p>
      <p><strong>Before day 64:</strong> the calculation includes care-plan gains and losses, balancing early training against the stats you want to keep. <strong>Days 64-128:</strong> care-plan stat losses stop automatically. Food penalties do not stop: Vomp Carrots still lower Discernment and Receptivity. You no longer choose one period or the other. Day 129 starts retirement: raising ends, but you can keep using the registered riding bird. Keep the retirement registration card and re-register its final stats.</p>
      <p className="raising-small">This is a conditional training scenario, not a guaranteed or optimal schedule. Care rows show the assumed good-day roll and its source-model chance; you cannot choose that roll in game, and poor days can halve changes. Food and care affection changes are included. Basic Care's random stat gains, random food bonuses, medical treatment and unscheduled activities are not simulated. Future days assume a healthy bird with enough energy for the listed story. Story acquisition is not timed by the calculator. A partial route is not proof that the goal is impossible. These rules come from the pinned source, and live settings may differ.</p>
    </details>
    <p>Save your egg hand-in time, choose a build preset, then enter today's trainer reports before feeding and stories. Calculate to fill What to do today, and check off activities as you finish them. Your checklist is saved on this device; the future timeline runs through day {LAST_RAISING_DAY}.</p>
    <p className="raising-small">The trainer reports ranges, not exact points. Poor is the default assumption, not a report read from the game. An SS goal starts at 224; 255 is the raw maximum. Minimum final points are goals you choose, not numbers you need to read from your bird.</p>
    <div className="raising-controls">
      <label>Egg hand-in date and time (local)<input style={styles.input} type="datetime-local" step={1}
        value={draftStart} onChange={event => { setDraftStart(event.target.value); setStartError(null); }} /></label>
      <button style={styles.buttonCompact} type="button" onClick={() => saveStart(Date.now())}>Use current time</button>
      <button style={styles.buttonCompact} type="button" onClick={saveManualStart}>Save start time</button>
      {(clock.startedAt !== null || clock.error) && <button style={styles.buttonCompact} type="button" onClick={() => saveStart(null)}>Clear start time</button>}
    </div>
    {startError && <p role="alert" className="raising-loss">{startError}</p>}
    <p role="status">{clock.startedAt === null
      ? "No start time saved: planning a new egg at day 0."
      : <>Started {new Date(clock.startedAt).toLocaleString()}. <strong>{futureStart ? "Start time is in the future." : `Current raising day: ${currentDay}`}</strong>. {currentDay <= LAST_RAISING_DAY ? `${LAST_RAISING_DAY - currentDay} future raising days remain through day ${LAST_RAISING_DAY}.` : "Retirement has begun in the pinned settings."}</>}</p>
    <p className="raising-small">Use the time you traded the egg, not the hatch time. The clock follows {RAISING.settings.dayLength / 3600}-hour periods and is saved on this device. Enter descriptions after today's care report, before the feeding and stories you still need to do. Changing the saved egg time starts a new checklist; mark any activities already finished before calculating.</p>
    {view.persistenceError && <div>
      <p role="alert" className="raising-loss">{view.persistenceError}</p>
      <button type="button" style={styles.buttonCompact} onClick={() => setView(previous => ({ ...previous, persistenceError: undefined }))}>Save current checklist again</button>
    </div>}
    {dailyNotice && <p role="status" className="raising-notice">{dailyNotice}</p>}
    <section aria-label="Today's chocobo checklist" className="raising-today" style={styles.subCard}>
      <h4>What to do today - raising day {currentDay}</h4>
      {futureStart || clock.error ? <p role="alert">Correct the saved egg time before using today's checklist.</p>
        : currentDay > LAST_RAISING_DAY ? <p>Raising has ended. Keep the registration card and register the bird's final riding stats; there are no remaining training days.</p>
        : <>
          <p><strong>Start at the stable:</strong> read today's care report, then check your bird's health, hunger and energy. Enter the stat descriptions the trainer gives you now.</p>
          {!today ? <p>No saved instructions for today yet. Enter your current reports and calculate a plan. If you have already finished feeding or stories, check them off below first so the app will not recommend doing them again.</p>
            : <p className="raising-small">These are today's tasks from your last calculated plan. If the trainer reports different stats or your bird has learned an ability, update those details below and press Calculate plan for day {currentDay}. Feeding and story activities you already checked off stay checked.</p>}
          {currentDay < RAISING.settings.daysToChick ? <p><strong>Egg stage:</strong> check on the egg. Do not feed it or tell stories yet.</p> : <>
            <div>
              <h4>Feeding</h4>
              {progress.feedingDone ? <p>Finished for today. Refreshing will not add more training food today.</p>
                : reportError ? <p>Enter today's hunger, affection and condition below, then calculate before feeding.</p>
                : !["healthy", "tired"].includes(report.condition) ? <p>Attend to the bird's condition first. Check the health reference below for treatment; once it can eat normally, update the reports and recalculate. Medicine also uses fullness.</p>
                : !feedingIsCurrent ? <p>Calculate again using the updated reports to choose today's remaining meals.</p>
                : today?.feeding ? <>
                  <p>{today.feeding.items.length
                    ? <>Feed <strong>{feedingSummary(today.feeding.items)}</strong>, one item per trade in this order. Check hunger between items and stop at completely full. These are remaining meals, not extra food on top of anything already given.</>
                    : "No further food fits the fullness estimate. If the trainer reports more room, update hunger and recalculate."}</p>
                  <p className="raising-small">Estimated affection after feeding: {today.feeding.affectionAfter}/255, using the lower end of your report. Highest band: {AFFECTION_TARGET}-255. {today.feeding.affectionAfter < AFFECTION_TARGET ? "A full recovery does not fit today's safe feeding allowance; do not force-feed to reach it." : "Further affection gains above 255 are wasted."}</p>
                </>
                  : <p>Calculate to see today's food recommendation.</p>}
              {!progress.feedingDone && form.desiredAbilities.some(name => !form.knownAbilities.includes(name)) && <p className="raising-small">Still learning an ability? Do not follow a meal that would lower Discernment below its learning requirement. A saved estimate may assume the ability was learned; update your reports and recalculate if it was not.</p>}
              <label className="raising-exact-toggle"><input type="checkbox" checked={progress.feedingDone} disabled={!canComplete}
                onChange={event => completeToday({ feedingDone: event.target.checked })} />Feeding finished for today</label>
            </div>
            <div>
              <h4>Stories</h4>
              {progress.storyDone ? <p>Finished for today. Refreshing will not add another story attempt today.</p>
                : reportError ? <p>Enter today's hunger, affection and condition below, then calculate before planning story activities.</p>
                : report.condition !== "healthy" ? <p>Resume story activities when the bird is healthy, awake and has enough energy. Update its condition and recalculate first.</p>
                : todayStory ? form.knownAbilities.includes(todayStory.name)
                  ? <p>{todayStory.name} is already marked learned. Do not retell its story to learn it again; recalculate for the remaining abilities.</p>
                  : <>
                    <p><strong>Try to learn {todayStory.name} today.</strong> This is a separate hands-on action, not the Take a Walk or Act in a Play care plan.</p>
                    <ol aria-label={`${todayStory.name} story steps`}>
                      <li><strong>Have the {todayStory.story} story ready.</strong> This is the story's title. If you do not have it yet: {todayStory.obtain} Use hands-on walks, not the scheduled Take a Walk care plan. Long walks unlock on day {RAISING.settings.daysToAdult1}; encounters can take several walks. If you cannot get the story today, skip the attempt.</li>
                      <li><strong>Check the bird before telling the story.</strong> It must be at least day {RAISING.settings.daysToAdolescent}, healthy and awake, with at least {RAISING.actionEnergy[50]["2"]} energy even in clear weather, and a free ability slot. Keep Discernment at {todayStory.discernment} or higher ({STAT_BANDS[statRank(todayStory.discernment)].description} or better). If it is not ready, skip the attempt and update its reports.</li>
                      <li><strong>At the stable, choose Tell a Story, then {todayStory.story}.</strong> Make one attempt today. The pinned model gives an eligible attempt a {RAISING.learnChance}% chance to learn {todayStory.name}; learning is not guaranteed.</li>
                      <li><strong>Record the result.</strong> If it learns {todayStory.name}, select that ability under Already learned below. If it fails, keep the story for another day. Check Story activities finished for today after the attempt, or if you are skipping it today.</li>
                    </ol>
                  </>
                    : <p>{today ? "No story attempt is planned today. Collect the required stories through eligible walks as health and energy allow." : "Calculate to see whether a story attempt is planned today."}</p>}
              <label className="raising-exact-toggle"><input type="checkbox" checked={progress.storyDone} disabled={!canComplete}
                onChange={event => completeToday({ storyDone: event.target.checked })} />Story activities finished for today</label>
            </div>
            {care && <div>
              <h4>Care to arrange today</h4>
              <p>Check the trainer's schedule for days <strong>{care.firstDay}-{care.lastDay}</strong>: it should contain <strong>{trainingActionName({ kind: "care", id: care.careId })}</strong> for {care.count} day(s). If already correct, leave it alone; otherwise arrange those future days today. Do not restart the whole schedule.</p>
              <label className="raising-exact-toggle"><input type="checkbox" checked={progress.careKey === care.key} disabled={!canComplete}
                onChange={event => completeToday({ careKey: event.target.checked ? care.key : null })} />Care schedule checked / arranged</label>
            </div>}
            <p className="raising-small">Check feeding and stories when you are finished for the day, including when you stop early or skip them because of the bird's condition. If you already did them before opening the app, check them before calculating. Update current reports before recalculating after actions. Uncheck only to correct a mistake; that allows new recommendations for that activity.</p>
          </>}
          <p className="raising-small">{view.persistenceError ? "Saving is unavailable. The checklist currently shown may not survive restarting the app."
            : clock.startedAt === null ? "Save the egg hand-in time to record daily completion." : "Instructions and checkmarks are saved on this device. Each new raising day gets its own unchecked checklist; missed activities are not carried forward as extra feeding."}</p>
        </>}
    </section>
    <form id={formId} onSubmit={event => { event.preventDefault(); calculate(); }}>
      <div className="raising-controls">
        <label>Build preset<select style={styles.select} value={selectedPreset?.id ?? ""} onChange={event => {
          const preset = RAISING_PRESETS.find(entry => entry.id === event.target.value);
          if (preset) update({ target: statInputs(preset.target), desiredAbilities: [...preset.desiredAbilities], priority: preset.priority });
        }}>
          {RAISING_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          <option value="" disabled>Custom goals</option>
        </select></label>
      </div>
      <p className="raising-small">Presets replace your targets, desired abilities and most important stat. Current reports, exact-stat mode, already-learned abilities and egg time stay unchanged. Change any goal to customize the build.</p>
      {selectedPreset && selectedPreset.id !== "digging" && <p className="raising-notice">Community racing goal only: racing is marked disabled in the pinned public source. Confirm live availability before raising a racer. This calculator predicts training, not race wins.</p>}
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
            ? <p className="raising-small">These digging bonuses are documented in the <a href="https://wiki.phoenix-xi.com/Chocobo_digging#Digging_with_your_own_chocobo" target="_blank" rel="noreferrer">source-derived digging guide</a>. The pinned digging override does not apply personal-chocobo stats or these abilities; live behavior may differ. The preset does not change the Digging tab's calculations.</p>
            : <p className="raising-small">{preset.id === "circuit"
              ? <>The exact allocation and Elm saddle assumption come from the <a href="https://www.ffxiah.com/forum/topic/58501/demystifying-chocobo-raising-plans-and-food/2/" target="_blank" rel="noreferrer">community Circuit build discussion</a>; NPC-versus-player tradeoffs follow the <a href="https://www.ffxiah.com/forum/topic/32770/ninians-guide-to-chocobo-raising-v2/5/" target="_blank" rel="noreferrer">community racing stat discussion</a>. The ability pair follows <a href="https://www.ffxiah.com/forum/topic/32770/ninians-guide-to-chocobo-raising-v2/" target="_blank" rel="noreferrer">Ninian's community raising guide</a>. </>
              : <>The SS/B/A/C recommendation and ability pair come from <a href="https://www.ffxiah.com/forum/topic/32770/ninians-guide-to-chocobo-raising-v2/" target="_blank" rel="noreferrer">Ninian's community raising guide</a>. </>}
              Stat roles follow the <a href="https://www.bg-wiki.com/ffxi/Chocobo_Racing" target="_blank" rel="noreferrer">retail racing reference</a>. The <a href={`${RAISING.source.repository}/blob/${RAISING.source.revision}/scripts/globals/chocobo_racing.lua`} target="_blank" rel="noreferrer">pinned racing implementation</a> marks racing disabled. Treat racing advice as secondary guidance, not confirmed live-server mechanics. No saddle, racing-item or training-token bonuses are applied to training calculations.</p>}
        </section>)}
      </details>
      {currentDay >= RAISING.settings.daysToChick && currentDay <= LAST_RAISING_DAY && <section aria-label="Today's feeding reports">
        <h4>Today's hunger, affection and condition</h4>
        <div className="raising-controls">
          <label>Affection report<select style={styles.select} required value={report.affection < 0 ? "" : report.affection}
            onChange={event => updateReport({ affection: event.target.value === "" ? -1 : Number(event.target.value) })}>
            <option value="" disabled>Choose the trainer's description</option>
            {AFFECTION_REPORTS.map(entry => <option key={entry.min} value={entry.min}>{entry.label} ({entry.min}-{entry.max})</option>)}
          </select></label>
          <label>Hunger report<select style={styles.select} required value={report.fullness < 0 ? "" : report.fullness}
            onChange={event => updateReport({ fullness: event.target.value === "" ? -1 : Number(event.target.value) })}>
            <option value="" disabled>Choose the trainer's description</option>
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
        <p className="raising-small">Use the trainer's latest reports. If you already fed the bird, gave it medicine or did activities today, check its reports again afterward. Fill in all three fields to calculate; they reset on a new raising day.</p>
        <p className="raising-small">A story needs at least {RAISING.actionEnergy[50]["2"]} energy to start, even in clear weather. If the bird is healthy but cannot afford a story, choose "Healthy, but too tired for activities." The planner can still recommend food, but will skip today's story attempt.</p>
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
    </div>}
    {plan && <div className="raising-plan-result" aria-live="polite">
      <h4>Estimated plan</h4>
      <p>{useExactStats ? "Starting points (exact overrides)" : "Starting-point estimate (lower ends of the selected ranges)"}: <strong>{statSummary(input.current)}</strong>. This is a scenario, not a measurement of your bird.</p>
      <p className="raising-notice">Conditional scenario, not guaranteed results: today's care is already in your reports. Future care rows assume the displayed good-day roll ({RAISING.planStatPoints.join(" or ")} points per arrow); the listed chance is a source-model estimate, not a live guarantee. Food and care affection changes are included, but random food bonuses and Basic Care's random stat gains are not. Chick hunger assumes scheduled care only, with no extra hunger credited for today's unmeasured energy use. Actual walks, illness and recovery can change the plan. Recalculate from reports each day.</p>
      {plan.days.some(day => day.day >= RAISING.settings.daysToChick && day.feeding && day.feeding.affectionAfter < AFFECTION_TARGET)
        && <p role="status" className="raising-notice">Some days remain below the highest affection band in this estimate. Safe feeding capacity or the reported condition limits recovery. Do not force-feed; prioritize the next safe recovery meal and check actual care results.</p>}
      {plan.pending.length > 0 && <section>
        <h4>Ability preparation and learning checkpoint</h4>
        <p>Build at least <strong>{plan.threshold} Discernment</strong>, then keep it at or above that level until the selected abilities are learned. The timeline includes early care gains and food together; do not add a separate 80-carrot preparation phase.</p>
        <ol>{plan.pending.map(ability => <li key={ability.name}>
          <strong>{ability.name}: {ability.story}</strong> - requires {ability.discernment} DSC after the story's +1. {ability.obtain}
        </li>)}</ol>
        <p>Tell stories from adolescence (day {RAISING.settings.daysToAdolescent}); long walks require adulthood (day {RAISING.settings.daysToAdult1}). This scenario starts attempts no earlier than day {plan.firstStoryDay}, assuming the stories have been collected, and budgets one eligible attempt per day for {STORY_ATTEMPTS_95} days per missing ability. Each attempt has a {RAISING.learnChance}% chance; {STORY_ATTEMPTS_95} attempts gives {(storyLearningProbability(STORY_ATTEMPTS_95) * 100).toFixed(1)}% for <strong>one ability</strong>, not a guarantee or a combined chance for both.</p>
        <p>Failed attempts retain the story. Successful learning consumes it. Stop retelling a learned ability's story: that can give inspiration instead of a new ability.</p>
        <p className="raising-small">For stat arithmetic, each ability is assumed learned on the last of its {STORY_ATTEMPTS_95} reserved attempts; every attempt adds capped +1 DSC. Real learning can happen earlier or later. If a story is not yet available or the ability is still missing, do not follow later steps that lower DSC: keep feeding suitable maintenance food such as Azouph Greens, maintain the threshold, and recalculate. Mark abilities already learned to avoid reserving another full allowance.</p>
      </section>}
      {!plan.pending.length && <p>No new ability learning is required for these selections. Already-learned abilities are retained.</p>}
      <section>
        <h4>Estimated training timeline: {futureDays.length ? `days ${currentDay + 1}-${LAST_RAISING_DAY}` : "no future raising days"}</h4>
        {futureDays.some(step => step.story) && <p>Daily care and story attempts are separate tasks. The care plan trains stats; it does not teach the ability in the Story attempts column. On a story day, follow the numbered instructions under Stories in What to do today.</p>}
        {!plan.complete && <p role="alert" className="raising-loss">No complete route was found within the remaining days and this model. This does not prove the goals are impossible. Partial progress only: {plan.remaining.join("; ")}. Check the start time, trainer descriptions or exact overrides, and learned abilities, or revise your goals.</p>}
        {futureDays.length ? <div className="raising-table-wrap">
          <table aria-label="Goal training steps">
            <thead><tr><th>Raising days</th><th>Daily care / assumed roll</th><th>Food per day, in feeding order</th><th>Story attempts</th><th>Modeled stats afterward</th></tr></thead>
            <tbody>{groupTrainingDays(futureDays).map(step => <tr key={step.day}>
              <th scope="row">{step.day === step.endDay ? step.day : `${step.day}-${step.endDay}`}{clock.startedAt !== null && <span className="raising-stat-purpose">{new Date(clock.startedAt + step.day * RAISING.settings.dayLength * 1000).toLocaleDateString()}</span>}</th>
              <td>{trainingActionName({ kind: "care", id: step.careId })}<br /><span className="raising-small">{step.careId === 0 ? "No random gain assumed" : `${step.carePoints} points per arrow; queue by day ${step.day - 2}`}</span>
                {step.feeding && step.careId !== 0 && <span className="raising-stat-purpose">Good-day chance: {step.feeding.careSuccess}%{step.days > 1 ? " minimum in this block" : ""}</span>}</td>
              <td className="raising-description">{step.feeding
                ? step.feeding.items.length ? `${feedingSummary(step.feeding.items)} (${step.feeding.items.length * step.days} items total)`
                  : step.day < RAISING.settings.daysToChick ? "Egg stage" : "Full in this estimate; recheck hunger that day"
                : step.foodId === null ? "Recalculate with feeding reports" : `${step.foodCount} ${trainingActionName({ kind: "food", id: step.foodId })} (${step.foodCount * step.days} total)`}
                {step.feeding && <span className="raising-stat-purpose">Affection afterward: {step.feeding.affectionAfter}/255{step.days > 1 ? " at block end" : ""} (estimate)</span>}</td>
              <td>{step.story ? `${step.story}: ${step.firstAttempt === step.attempt ? step.attempt : `${step.firstAttempt}-${step.attempt}`}/${STORY_ATTEMPTS_95}${step.assumedLearned ? "; assumes learned at end" : ""}` : "-"}</td>
              <td>{statSummary(step.after)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p>Day {LAST_RAISING_DAY} is the last training day. Check today's checklist for any remaining actions; retirement starts on day {RAISING.settings.daysToAdult4}.</p>}
        <p><strong>{plan.foodItems} food items total, including affection meals</strong>; <strong>{plan.careDays} targeted care days</strong> ({plan.earlyCareDays} before day 64, {plan.lateCareDays} from day 64). Other days use Basic Care. Trade one item at a time in the listed order, checking hunger between items. Future adolescent/adult meals assume the daily reset to starving and no earlier food. Never add this ration on top of meals already eaten; recalculate from the latest reports. Do not force-feed at fullness 224 or higher.</p>
        <p className="raising-small">Queue care plans two days before execution in 1-7 day blocks, refilling the four-slot schedule as needed. Tomorrow's locked plan is assumed to be Basic Care. If it differs, process that day and recalculate using updated trainer descriptions or known exact points. The forecast accounts for age, not random health setbacks or the time needed to find stories. It cannot guarantee finishing by retirement.</p>
        {plan.pending.length > 0 && <p>Learn the selected abilities before lowering Discernment. Lowering it later does not erase learned abilities; avoid Lethe foods, which can forget a random ability.</p>}
      </section>
      <div className="raising-table-wrap"><table aria-label="Goal planner results">
        <thead><tr><th>Stat</th><th>Minimum goal</th><th>Estimated result</th><th>Grade</th></tr></thead>
        <tbody>{STAT_KEYS.map(key => <tr key={key}><th scope="row">{STAT_LABELS[key]}</th><td>{input.target[key]}</td>
          <td className={plan.result[key] < input.target[key] ? "raising-loss" : ""}>{plan.result[key]}</td><td>{STAT_GRADES[statRank(plan.result[key])]}</td></tr>)}</tbody>
      </table></div>
      {riding && <p>With {plan.finalAbilities.length ? plan.finalAbilities.join(" + ") : "no selected abilities"}, the modeled result gives <strong>{riding.rentalPercent}% of rental speed</strong> and <strong>{riding.minutes} minutes riding</strong>, before game-speed rounding and without racing silks. Abilities are assumed learned, not granted by this planner. Re-register your chocobo after actual stat changes.</p>}
      {plan.finalAbilities.some(name => ["Bore", "Burrow", "Treasure Finder"].includes(name)) && <p className="raising-notice">Bore, Burrow and Treasure Finder are learnable, but the active digging override in the pinned source does not apply personal-chocobo stats or these abilities. This plan does not promise improved digging results on the live server.</p>}
    </div>}
    </section>
  </section>;
}
