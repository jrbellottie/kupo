import { RAISING, STAT_KEYS, applyRaisingStatChanges, type RaisingStats } from "./chocoboRaising";
import { PARASITE_WORM_ID } from "./chocoboColor";
import { validRaisingEvents, type RaisingEvent } from "./raisingEvents";

export const AFFECTION_TARGET = 224;
export const AFFECTION_REPORTS = [
  "Doesn't care", "Can endure your presence", "Slightly enjoys your company", "Likes you",
  "Likes you pretty well", "Likes you a lot", "Wants to be with you all the time", "Regards you as a parent",
].map((label, rank) => ({ label, min: rank * 32, max: rank * 32 + 31 }));
export const HUNGER_REPORTS = [
  { label: "Starving", min: 0, max: 31 },
  { label: "Quite hungry", min: 32, max: 63 },
  { label: "A little hungry", min: 64, max: 95 },
  { label: "Neither hungry nor full", min: 96, max: 159 },
  { label: "Almost full", min: 160, max: 191 },
  { label: "Quite full", min: 192, max: 223 },
  { label: "Completely full", min: 224, max: 255 },
];
export const BIRD_CONDITIONS = [
  { id: "healthy", label: "Healthy; enough energy for activities" },
  { id: "tired", label: "Healthy, but too tired for activities" },
  { id: "unwell", label: "Ill or injured; needs treatment" },
  { id: "sleeping", label: "Sleeping" },
  { id: "away", label: "Away from the stable" },
] as const;
export const BIRD_AILMENTS = [
  { id: "sick", label: "Sick / minor illness" },
  { id: "very ill", label: "Very ill / serious illness" },
  { id: "injured", label: "Injured" },
  { id: "stomachache", label: "Stomachache" },
  { id: "lonely", label: "Lonely" },
  { id: "bored", label: "Bored" },
  { id: "spoiled", label: "Spoiled" },
  { id: "lovesick", label: "Lovesick" },
] as const;
export type BirdAilment = typeof BIRD_AILMENTS[number]["id"];
export type FeedingReport = {
  affection: number;
  fullness: number;
  condition: typeof BIRD_CONDITIONS[number]["id"] | "unknown";
  day: number;
  ailments?: BirdAilment[];
  events?: RaisingEvent[];
  treatmentGiven?: boolean;
  medicineId?: number;
};
export function treatmentFoods(day: number) {
  return day < RAISING.settings.daysToChick ? [] : RAISING.foods.filter(food =>
    food.wakes || (day < RAISING.settings.daysToAdolescent ? food.chick : food).cures.length > 0);
}

export function recordMedicineEaten(report: FeedingReport, medicineId: number, day: number): FeedingReport {
  const error = validateFeedingReport(report, day);
  if (error) throw new Error(error);
  if (report.treatmentGiven || report.medicineId !== undefined) throw new Error("Treatment is already recorded today. Enter the trainer's post-treatment reports instead of applying the dose again.");
  const food = treatmentFoods(day).find(entry => entry.id === medicineId);
  if (!food) throw new Error("Choose a medicine valid for this growth stage.");
  if (report.condition === "away" || report.condition === "sleeping" && !food.wakes) {
    throw new Error("This item cannot be eaten in the reported condition. Check the trainer's report.");
  }
  const variant = day < RAISING.settings.daysToAdolescent ? food.chick : food;
  return {
    ...report, fullness: Math.min(255, report.fullness + variant.fullness),
    affection: Math.max(0, Math.min(255, report.affection + variant.affection)),
    treatmentGiven: true, medicineId,
  };
}

export function validHealthDetails(report: { ailments?: unknown; events?: unknown; treatmentGiven?: unknown; medicineId?: unknown }): boolean {
  return (report.ailments === undefined || Array.isArray(report.ailments)
    && report.ailments.every(id => BIRD_AILMENTS.some(ailment => ailment.id === id))
    && new Set(report.ailments).size === report.ailments.length)
    && validRaisingEvents(report.events)
    && (report.treatmentGiven === undefined || typeof report.treatmentGiven === "boolean")
    && (report.medicineId === undefined || RAISING.foods.some(food => food.id === report.medicineId
      && (food.wakes || food.cures.length > 0 || food.chick.cures.length > 0)));
}

export function needsHealthAttention(report: FeedingReport): boolean {
  return !["healthy", "tired"].includes(report.condition) || !!report.ailments?.length || report.treatmentGiven === true;
}

export function healthGuidance(report: FeedingReport, day: number) {
  if (!validHealthDetails(report)) throw new Error("Select valid ailments, report events and treatment status.");
  const chick = day < RAISING.settings.daysToAdolescent;
  const remedies = (report.ailments ?? []).map(id => {
    const ailment = BIRD_AILMENTS.find(entry => entry.id === id);
    if (!ailment) throw new Error(`Unknown chocobo ailment: ${id}.`);
    const foods = RAISING.foods.filter(food => (chick ? food.chick : food).cures.includes(id))
      .sort((a, b) => (chick ? a.chick : a).cures.length - (chick ? b.chick : b).cures.length);
    return { ...ailment, foods };
  });
  const matchingMedicine = remedies[0]?.foods.find(food =>
    remedies.every(ailment => (chick ? food.chick : food).cures.includes(ailment.id)));
  const canForceFeedRemedy = day >= RAISING.settings.daysToChick && report.fullness >= 224
    && !report.treatmentGiven && !!matchingMedicine
    && !["away", "sleeping", "unknown"].includes(report.condition);
  const messages: string[] = [];
  const canTreat = day >= RAISING.settings.daysToChick && report.condition !== "away"
    && report.condition !== "unknown" && Number.isInteger(report.fullness) && report.fullness >= 0
    && report.fullness < 224 && !report.treatmentGiven;
  if (day < RAISING.settings.daysToChick) messages.push("Eggs cannot be fed medicine. Check the trainer's report after hatching.");
  else if (report.condition === "away") messages.push("The bird is away: you cannot feed or treat it at the stable. Check with the trainer for its return; do not buy or feed a medicine as a guaranteed return remedy.");
  else if (report.treatmentGiven) messages.push("Treatment already given today: do not repeat it just because the condition is still reported. Most cures wait for the next raising-day update. Recheck health and hunger with the trainer then; clear this mark only to correct an entry mistake.");
  else if (report.fullness >= 224) messages.push(canForceFeedRemedy
    ? `Completely full: medicine counts as food. Optional tradeoff: one ${matchingMedicine.name} alone matches the reported ailment${remedies.length > 1 ? "s" : ""} and queues their cure for the next raising-day update, but force-feeding carries a ${RAISING.forcedFeedIllnessChance}% chance of a stomachache then. Rest instead has a 50% cure roll per bad condition. You can force-feed the matching remedy or wait until there is feeding room; recheck the trainer's report either way.`
    : `Completely full: do not feed medicine, worms or other food now. Medicine also counts as food. Force-feeding carries a ${RAISING.forcedFeedIllnessChance}% stomachache chance at the next update. Wait for a safe feeding opportunity and recheck the trainer's report; do not force-feed an unverified remedy.`);
  else if (!Number.isInteger(report.fullness) || report.fullness < 0 || report.condition === "unknown") messages.push("Check the trainer's hunger and condition reports before giving medicine.");
  else if (report.condition === "sleeping") {
    const tonic = RAISING.foods.find(food => food.wakes);
    if (!tonic) throw new Error("The waking medicine is missing.");
    const variant = chick ? tonic.chick : tonic;
    messages.push(`Sleeping birds refuse other foods. ${tonic.name} is the immediate waking item; it adds ${variant.fullness} fullness and changes affection by ${variant.affection}. If choosing to wake the bird, trade it alone once, then recheck reports before any other treatment. Waiting for the trainer's next report avoids the tonic's affection cost.`);
  }
  else if (remedies.length) messages.push("There is room for one treatment item under the reported fullness estimate. Choose one matching remedy below, trade one item alone, then recheck hunger. Alternatives are not a shopping list or a combined dose. Do not repeat doses to chase an immediate cure.");
  if (report.condition === "unwell" && !remedies.length) messages.push("Ill or injured is not specific enough to choose a medicine. Select the exact ailment or ailments the trainer reported below.");
  if (report.condition === "tired") messages.push("Low energy alone is not an illness diagnosis. Skip energy-costing activities until enough energy is available; do not give illness medicine solely for tiredness.");
  if (report.treatmentGiven && report.fullness >= 224) messages.push(`The bird is completely full: no additional medicine or food now. A forcing-itself-to-eat message indicates force-feeding, with a ${RAISING.forcedFeedIllnessChance}% stomachache chance at the next update. This does not mean a stomachache is guaranteed; do not feed another remedy to undo the dose.`);
  if (needsHealthAttention(report)) messages.push("Health comes before the training forecast. Skip today's stat/worm meals and story attempts while addressing these reports. Future training assumes recovery, not a predicted cure date. Listen to Music is stat training, not treatment.");
  if (report.ailments?.includes("spoiled")) messages.push("For spoiled behavior, Scold is a non-food option from the chick stage, but costs energy and lowers affection by 10. Use it only if the bird is awake, present and able to act.");
  if (report.ailments?.includes("bored")) messages.push("For boredom, Compete with Others is an alternative from adolescence after meeting the rivals, if the bird has enough energy. It queues a boredom cure even on a loss; wins are needed for the Happy Chocobo story, not the cure.");
  const careActions: string[] = [];
  if (day >= RAISING.settings.daysToChick && !report.treatmentGiven) {
    if (report.ailments?.includes("spoiled")) careActions.push(`Spoiled: Scold is a non-food alternative; it clears spoiled behavior and costs ${RAISING.actionEnergy[51]["2"]}+ energy to start and 10 affection. Use only when present and fit for the activity, not in addition to medicine just to repeat treatment.`);
    if (report.ailments?.includes("bored")) careActions.push(day < RAISING.settings.daysToAdolescent
      ? `Bored: use the matching remedy; Compete with Others is not available until day ${RAISING.settings.daysToAdolescent}.`
      : `Bored: alternatively, Compete with Others after meeting the rivals on a regular walk (${RAISING.actionEnergy[52]["2"]}+ energy, healthy and awake). This queues a cure for the next report even on a loss.`);
    if (report.ailments?.includes("lonely")) careActions.push("Lonely: after treatment, rebuild affection with safe planned meals. Low affection can trigger loneliness or running away; Watch Over does not boost affection.");
    if (report.condition === "sleeping") careActions.push(`Sleeping: wait for the next raising-day report, or Scold if the trainer allows it and at least ${RAISING.actionEnergy[51]["2"]} energy is available. Scold wakes the bird and costs 10 affection; do not combine waking remedies. Rest can put it back to sleep.`);
    if (report.condition === "away") careActions.push("Ran away: check the next raising-day report for its return. No food or hands-on care is possible while away; queued days still pass without training. After it returns, check affection and hunger rather than making up missed meals.");
  }
  const ailmentNames = remedies.map(ailment => ailment.label).join(", ");
  const treatmentAction = canTreat && report.condition !== "sleeping" && matchingMedicine
    ? `Give 1 ${matchingMedicine.name}, alone, for ${ailmentNames}; recheck hunger. The cure normally waits for the next raising-day update; do not repeat the dose.`
    : messages[0] ?? "Check the trainer's current health report.";
  return {
    remedies, messages, careActions, canTreat: canTreat && report.condition !== "sleeping",
    canForceFeedRemedy, treatmentAction,
  };
}
export type FeedingEstimate = {
  items: number[];
  affectionBefore: number;
  affectionAfter: number;
  fullnessBefore: number;
  fullnessAfter: number;
  careSuccess: number;
};
export const FEEDING_FOODS = RAISING.foods.filter(food =>
  (food.category === "Food" || food.category === "Training") && !food.forgetsAbility && !food.rerollGene
  && !food.wakes && !food.random.eitherWay
  && (food.affection > 0 || food.chick.affection > 0 || STAT_KEYS.some(key => food.stats[key] > 0)));
export const PLANNER_FEEDING_FOODS = [...FEEDING_FOODS, ...RAISING.foods.filter(food => food.id === PARASITE_WORM_ID)];
const foodsById = new Map(PLANNER_FEEDING_FOODS.map(food => [food.id, food]));

export function feedingFood(id: number) {
  const food = foodsById.get(id);
  if (!food) throw new Error(`Unsupported feeding food: ${id}.`);
  return food;
}

export function feedingSummary(items: readonly number[]): string {
  const groups: { id: number; count: number }[] = [];
  for (const id of items) {
    const last = groups.at(-1);
    if (last?.id === id) last.count++;
    else groups.push({ id, count: 1 });
  }
  return groups.map(group => `${group.count} ${feedingFood(group.id).name}`).join(", then ");
}

export function validateFeedingReport(report: FeedingReport, day: number): string | null {
  if (!validHealthDetails(report)) return "Select valid ailments, report events and treatment status.";
  if (!Number.isInteger(report.affection) || report.affection < 0 || report.affection > 255) return "Select the trainer's affection report.";
  if (!Number.isInteger(report.fullness) || report.fullness < 0 || report.fullness > 255) return "Select the trainer's hunger report.";
  if (!BIRD_CONDITIONS.some(entry => entry.id === report.condition)) return "Select the bird's condition and activity readiness.";
  if (report.day !== day) return `Enter current hunger, affection and condition reports for raising day ${day}.`;
  return null;
}

export function careSuccessChance(stats: RaisingStats, affection: number, careId: number): number {
  const care = RAISING.plans.find(entry => entry.id === careId);
  if (!care) throw new Error(`Unsupported care plan: ${careId}.`);
  const ranks = care.successStats.map(field => {
    if (field === "affection") return Math.floor(affection / 32);
    const key = STAT_KEYS.find(key => key === field);
    if (!key) throw new Error(`Unsupported care success stat: ${field}.`);
    return Math.floor(stats[key] / 32);
  });
  return Math.max(5, Math.min(95, 60 + Math.floor(affection / 32) * 5
    + Math.floor(ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length * 3) - care.difficulty * 5));
}

type Meal = { items: number[]; stats: RaisingStats; affection: number; fullness: number };
const menuCache = new Map<string, number[][]>();
function menus(fullness: number, chick: boolean, worms: boolean): number[][] {
  const key = `${fullness}:${chick}:${worms}`;
  const cached = menuCache.get(key);
  if (cached) return cached;
  const result = new Map<string, number[]>();
  const add = (items: number[]) => {
    let filled = fullness;
    for (const id of items) {
      if (filled >= 224) return;
      const food = feedingFood(id);
      filled = Math.min(255, filled + (chick ? food.chick.fullness : food.fullness));
    }
    if (filled >= 224) result.set(items.join(","), items);
  };
  const foods = FEEDING_FOODS.filter(food => (chick ? food.chick.affection : food.affection) > 0);
  // Compare single foods and ordered two-food mixtures; never treat one mixed trade as ordered.
  for (const first of foods) {
    for (let count = 1; count <= 4; count++) {
      const prefix = Array<number>(count).fill(first.id);
      add(prefix);
      for (const second of foods) {
        if (first.id === second.id) continue;
        for (let rest = 1; count + rest <= 4; rest++) add([...prefix, ...Array<number>(rest).fill(second.id)]);
      }
      if (worms) {
        const wormFoods = [...foods, feedingFood(PARASITE_WORM_ID)];
        const visit = (items: number[], filled: number) => {
          if (filled >= 224) {
            add(items);
            return;
          }
          if (items.length === 4) return;
          for (const food of wormFoods) visit([...items, food.id], Math.min(255, filled + food.chick.fullness));
        };
        visit([], fullness);
      }
    }
  }
  const values = [...result.values()];
  menuCache.set(key, values);
  return values;
}

export function feedingOptions(stats: RaisingStats, affection: number, fullness: number, day: number, allowed = true, allowWorms = false): Meal[] {
  if (![affection, fullness].every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    || !Number.isInteger(day) || day < 0 || day >= RAISING.settings.daysToAdult4) {
    throw new Error("Feeding estimates require valid affection, fullness and raising day.");
  }
  const empty: Meal = { items: [], stats, affection, fullness };
  if (!allowed || day < RAISING.settings.daysToChick || fullness >= 224) return [empty];
  const candidates = new Map<string, Meal>();
  const chick = day < RAISING.settings.daysToAdolescent;
  for (const items of menus(fullness, chick, allowWorms && chick)) {
    let next = { ...empty };
    for (const id of items) {
      const food = feedingFood(id);
      const variant = day < RAISING.settings.daysToAdolescent ? food.chick : food;
      next = {
        items, stats: applyRaisingStatChanges(next.stats, food.stats),
        affection: Math.min(255, next.affection + variant.affection),
        fullness: Math.min(255, next.fullness + variant.fullness),
      };
    }
    const key = `${STAT_KEYS.map(key => next.stats[key]).join(",")}:${next.affection}:${next.fullness}:${items.filter(id => id === PARASITE_WORM_ID).length}`;
    const previous = candidates.get(key);
    const randomness = (meal: Meal) => meal.items.reduce((sum, id) => sum + feedingFood(id).random.chance, 0);
    if (!previous || items.length < previous.items.length
      || (items.length === previous.items.length && randomness(next) < randomness(previous))) candidates.set(key, next);
  }
  if (!candidates.size) throw new Error("No safe feeding menu is available for this hunger report.");
  return [...candidates.values()];
}
