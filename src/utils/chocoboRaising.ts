import snapshot from "../data/chocoboRaising.json";

export const STAT_KEYS = ["strength", "endurance", "discernment", "receptivity"] as const;
export type StatKey = typeof STAT_KEYS[number];
export type RaisingStats = Record<StatKey, number>;
export type RaisingFood = Omit<typeof snapshot.foods[number], "random"> & {
  random: { fields: readonly string[]; chance: number; eitherWay: boolean };
};
export const RAISING: Omit<typeof snapshot, "foods"> & { foods: RaisingFood[] } = snapshot;
export const STAT_LABELS: Record<StatKey, string> = {
  strength: "Strength", endurance: "Endurance", discernment: "Discernment", receptivity: "Receptivity",
};
export const STAT_GRADES = ["F", "E", "D", "C", "B", "A", "S", "SS"];
export const STAT_BANDS = ["Poor", "Substandard", "A bit deficient", "Average", "Better than average", "Impressive", "Outstanding", "First-class"].map((description, rank) => ({
  description, grade: STAT_GRADES[rank], min: rank * 32, max: rank * 32 + 31,
}));
export const signed = (value: number) => value > 0 ? `+${value}` : String(value);

export function statRank(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error("Stats must be whole points from 0 to 255.");
  return Math.floor(value / 32);
}

export function foodStatText(food: RaisingFood, key: StatKey): string {
  if (food.random.fields.includes(key)) {
    const chance = food.random.chance / food.random.fields.length;
    return `${food.random.eitherWay ? "+/-" : "+"}${RAISING.foodStatPoints} (${chance}%${food.random.eitherWay ? ", equal +/- odds" : ""})`;
  }
  return food.stats[key] === 0 ? "-" : signed(food.stats[key]);
}

export function foodEffects(food: RaisingFood, chick: boolean): string {
  const variant = chick ? food.chick : food;
  const effects: string[] = [];
  if (variant.cures.length) effects.push(`Cures ${variant.cures.join(", ")} at the next rollover.`);
  if (food.wakes) effects.push("Wakes immediately; only this tonic is consumed in a mixed trade.");
  if (food.rerollGene) effects.push("Rerolls one color gene. Before adolescence it can change color; later it only affects breeding.");
  if (food.forgetsAbility) effects.push("Forgets one randomly selected learned ability.");
  if (food.random.fields.length) effects.push(`One random stat roll per item (${food.random.chance}% trigger); not separate rolls for each stat.`);
  if (food.energy) effects.push("Energy caps at 100.");
  if (food.id === 5607) effects.push("Physical training: faster/longer rides, but less Discernment for learning stories.");
  if (food.id === 5608) effects.push("Mental training: helps reach story thresholds, at the cost of physical stats.");
  return effects.join(" ") || "Fullness and affection only; no direct stat or ability gain.";
}

export const PROJECTION_FOODS = RAISING.foods.filter(food =>
  food.random.chance === 0 && STAT_KEYS.some(key => food.stats[key] !== 0));

export function applyRaisingStatChanges(initial: RaisingStats, changes: RaisingStats): RaisingStats {
  const result = { ...initial };
  // The source applies STR before END before DSC before RCP, including at the total cap.
  for (const key of STAT_KEYS) {
    let change = Math.floor(changes[key] * (changes[key] > 0 ? RAISING.settings.statPositiveMultiplier : RAISING.settings.statNegativeMultiplier));
    if (change > 0) {
      const total = STAT_KEYS.reduce((sum, field) => sum + result[field], 0);
      change = Math.min(change, Math.max(0, RAISING.settings.statGrowthCap - total));
    }
    result[key] = Math.max(0, Math.min(255, result[key] + change));
  }
  return result;
}

export function validateFoodProjection(stats: RaisingStats, days: number, dailyItems: number): string | null {
  if (!Number.isInteger(days) || days < 1 || days > 128) return "Enter 1 to 128 feeding days.";
  if (!Number.isInteger(dailyItems) || dailyItems < 1 || dailyItems > 4) return "This scenario models one trade per day: enter 1 to 4 items.";
  if (STAT_KEYS.some(key => !Number.isInteger(stats[key]) || stats[key] < 0 || stats[key] > 255)) return "Starting stats must be whole points from 0 to 255.";
  if (STAT_KEYS.reduce((sum, key) => sum + stats[key], 0) > RAISING.settings.statGrowthCap) return `Starting stats cannot exceed ${RAISING.settings.statGrowthCap} total points.`;
  return null;
}

export function projectFoodOnly(food: RaisingFood, initial: RaisingStats, days: number, dailyItems: number) {
  const error = validateFoodProjection(initial, days, dailyItems);
  if (error) throw new Error(error);
  if (!PROJECTION_FOODS.some(entry => entry.id === food.id)) throw new Error("Choose a deterministic training food for this projection.");
  let result = { ...initial };
  const nominal = { strength: 0, endurance: 0, discernment: 0, receptivity: 0 };
  for (let item = 0; item < days * dailyItems; item++) {
    for (const key of STAT_KEYS) {
      nominal[key] += Math.floor(food.stats[key] * (food.stats[key] > 0 ? RAISING.settings.statPositiveMultiplier : RAISING.settings.statNegativeMultiplier));
    }
    result = applyRaisingStatChanges(result, food.stats);
  }
  return { result, nominal, items: days * dailyItems };
}

export function ridingEstimate(stats: RaisingStats, gallop: boolean, canter: boolean) {
  const settings = RAISING.settings;
  return {
    rentalPercent: Math.min(settings.ridingSpeedCap, settings.ridingSpeedBase + settings.ridingSpeedPerRank * (statRank(stats.strength) + Number(gallop))),
    minutes: Math.min(settings.ridingTimeCap, settings.ridingTimeBase + settings.ridingTimePerRank * (statRank(stats.endurance) + Number(canter))),
  };
}

export function carePlanRange(plan: typeof RAISING.plans[number], key: StatKey): string {
  if (plan.id === 0) return "0 or +1";
  const arrows = plan.arrows[key];
  if (!arrows) return "-";
  const [low, high] = RAISING.planStatPoints;
  return arrows > 0 ? `+${arrows * low} to +${arrows * high}` : `${arrows * high} to ${arrows * low}`;
}
