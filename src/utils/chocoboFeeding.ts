import { RAISING, STAT_KEYS, applyRaisingStatChanges, type RaisingStats } from "./chocoboRaising";

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
export type FeedingReport = {
  affection: number;
  fullness: number;
  condition: typeof BIRD_CONDITIONS[number]["id"] | "unknown";
  day: number;
};
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
const foodsById = new Map(FEEDING_FOODS.map(food => [food.id, food]));

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
function menus(fullness: number, chick: boolean): number[][] {
  const key = `${fullness}:${chick}`;
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
    }
  }
  const values = [...result.values()];
  menuCache.set(key, values);
  return values;
}

export function feedingOptions(stats: RaisingStats, affection: number, fullness: number, day: number, allowed = true): Meal[] {
  if (![affection, fullness].every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    || !Number.isInteger(day) || day < 0 || day >= RAISING.settings.daysToAdult4) {
    throw new Error("Feeding estimates require valid affection, fullness and raising day.");
  }
  const empty: Meal = { items: [], stats, affection, fullness };
  if (!allowed || day < RAISING.settings.daysToChick || fullness >= 224) return [empty];
  const candidates = new Map<string, Meal>();
  for (const items of menus(fullness, day < RAISING.settings.daysToAdolescent)) {
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
    const key = `${STAT_KEYS.map(key => next.stats[key]).join(",")}:${next.affection}:${next.fullness}`;
    const previous = candidates.get(key);
    const randomness = (meal: Meal) => meal.items.reduce((sum, id) => sum + feedingFood(id).random.chance, 0);
    if (!previous || items.length < previous.items.length
      || (items.length === previous.items.length && randomness(next) < randomness(previous))) candidates.set(key, next);
  }
  if (!candidates.size) throw new Error("No safe feeding menu is available for this hunger report.");
  return [...candidates.values()];
}
