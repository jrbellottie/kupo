import phoenix from "../data/phoenix.json";
import type { VanaWeekday } from "../vanadiel";

export const DIGGING = phoenix.digging;
export const DIG_RANKS = DIGGING.ranks;
export const DIG_ZONES = [...new Set(DIGGING.entries.map(entry => entry.zone))];
export const ORE_ZONES = DIGGING.oreZones;
export const DIG_DAY_ITEMS = DIGGING.ores;
export const DIG_DAILY_CAP = 100;
export const ORE_WEATHER_IDS = DIGGING.weather.map(weather => weather.id);

export type DigConditions = {
  rank: number;
  hour: number;
  moonPercent: number;
  waxing: boolean;
  day: VanaWeekday;
  weather: number;
};
export type DigReward = {
  zone: string;
  itemId: number;
  item: string;
  weight: number;
  experience: number;
  condition: string;
  share: number;
  perAttempt: number;
};
export type DigDistribution = {
  rewards: DigReward[];
  successChance: number;
  expectedExperience: number;
};
export const DIG_CATEGORIES = ["Normal", "Night", "Weather", "Elemental ore", "Bore", "Burrow", "Treasure"] as const;
export type DigCategory = typeof DIG_CATEGORIES[number];
export type DigCatalogReward = Omit<DigReward, "share" | "perAttempt" | "experience"> & {
  key: string;
  category: DigCategory;
  status: "active" | "inactive" | "reference";
  share: number | null;
  perAttempt: number | null;
  experience: number | null;
  rateConditions?: DigConditions;
};

export function nextDigReset(nowMs: number): number {
  const dayMs = 86_400_000;
  const jstOffset = 9 * 3_600_000;
  return (Math.floor((nowMs + jstOffset) / dayMs) + 1) * dayMs - jstOffset;
}

export function isElementalOreMoon(moonPercent: number, waxing: boolean): boolean {
  return waxing && moonPercent >= 6 && moonPercent < 22;
}

export function elementalOreActive(zone: string, conditions: DigConditions): boolean {
  return ORE_ZONES.includes(zone) && DIGGING.oreWeights[conditions.rank] > 0
    && ORE_WEATHER_IDS.includes(conditions.weather)
    && isElementalOreMoon(conditions.moonPercent, conditions.waxing);
}

export function diggingDistribution(zone: string, conditions: DigConditions): DigDistribution {
  const { rank, hour, moonPercent, day, weather: weatherId } = conditions;
  if (!DIG_ZONES.includes(zone) || !Number.isInteger(rank) || rank < 0 || rank >= DIG_RANKS.length
    || !Number.isFinite(hour) || hour < 0 || hour >= 24
    || !Number.isFinite(moonPercent) || moonPercent < 0 || moonPercent > 100
    || !Object.prototype.hasOwnProperty.call(DIG_DAY_ITEMS, day)
    || (weatherId !== 0 && !DIGGING.weather.some(weather => weather.id === weatherId))) {
    throw new Error("Invalid digging zone or conditions");
  }
  const night = hour >= 20 || hour < 4;
  const rewards: DigReward[] = DIGGING.entries
    .filter(entry => entry.zone === zone && entry.weights[rank] > 0 && (!entry.nightOnly || night))
    .map(entry => ({
      zone, itemId: entry.itemId, item: entry.item, weight: entry.weights[rank],
      experience: rank === 10 ? 0 : DIGGING.experiencePerItem[entry.itemRank],
      condition: entry.nightOnly ? "Night (20:00-04:00)" : "Always",
      share: 0, perAttempt: 0,
    }));
  const weather = DIGGING.weather.find(entry => entry.id === weatherId);
  if (weather?.item && weather.itemId !== null && weather.weights[rank] > 0) {
    rewards.push({
      zone, itemId: weather.itemId, item: weather.item, weight: weather.weights[rank],
      experience: rank === 10 ? 0 : DIGGING.experiencePerItem[0],
      condition: weather.name, share: 0, perAttempt: 0,
    });
  }
  if (elementalOreActive(zone, conditions)) {
    rewards.push({
      zone, ...DIG_DAY_ITEMS[day], weight: DIGGING.oreWeights[rank],
      experience: rank === 10 ? 0 : DIGGING.experiencePerItem[10],
      condition: `${day}; waxing 6-21%; weather`, share: 0, perAttempt: 0,
    });
  }
  const totalWeight = rewards.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) throw new Error(`Empty digging pool: ${zone}`);
  const successChance = DIGGING.accuracy[rank] / 100;
  for (const entry of rewards) {
    entry.share = entry.weight / totalWeight;
    entry.perAttempt = successChance * entry.share;
  }
  return {
    rewards, successChance,
    expectedExperience: rewards.reduce((sum, entry) => sum + entry.perAttempt * entry.experience, 0),
  };
}

export function diggingEstimate(distribution: DigDistribution, greensCost: number, price: (item: string) => number) {
  if (!Number.isFinite(greensCost) || greensCost < 0) throw new Error("Invalid Gysahl Greens cost");
  const attempts = DIG_DAILY_CAP / distribution.successChance;
  const gross = distribution.rewards.reduce((sum, entry) => sum + entry.perAttempt * price(entry.item), 0) * attempts;
  return { attempts, greens: Math.ceil(attempts), net: gross - attempts * greensCost, experience: distribution.expectedExperience * attempts };
}

export function diggingCatalog(zone: string, conditions: DigConditions, includeConditional = false) {
  const distribution = diggingDistribution(zone, conditions);
  const oreCondition = (day: string) => `${day}; Journeyman (50+); waxing moon 6-21%; active weather (including fog)`;
  const rows: DigCatalogReward[] = distribution.rewards.map(entry => {
    const category: DigCategory = entry.condition === "Always" ? "Normal"
      : entry.condition.startsWith("Night") ? "Night"
        : entry.condition.includes("waxing") ? "Elemental ore" : "Weather";
    return {
      ...entry, key: `${zone}:${category}:${entry.itemId}`, category, status: "active",
      condition: category === "Elemental ore" ? oreCondition(conditions.day) : entry.condition,
    };
  });
  if (!includeConditional) return { distribution, rows };
  const keys = new Set(rows.map(entry => entry.key));
  const add = (entry: Pick<DigReward, "itemId" | "item" | "condition">, category: DigCategory, status: "inactive" | "reference", rateConditions?: DigConditions) => {
    const key = `${zone}:${category}:${entry.itemId}`;
    if (keys.has(key)) return;
    keys.add(key);
    const estimate = rateConditions ? diggingDistribution(zone, rateConditions).rewards.find(reward => reward.itemId === entry.itemId) : undefined;
    rows.push({
      ...entry, zone, key, category, status, weight: estimate?.weight ?? 0, experience: null,
      share: estimate?.share ?? null, perAttempt: estimate?.perAttempt ?? null,
      rateConditions: estimate ? rateConditions : undefined,
    });
  };
  for (const entry of DIGGING.entries.filter(entry => entry.zone === zone)) {
    add({
      ...entry, condition: entry.nightOnly ? "Night (20:00-04:00)" : "Rank with a nonzero item weight",
    }, entry.nightOnly ? "Night" : "Normal", "inactive", entry.nightOnly ? { ...conditions, hour: 20 } : conditions);
  }
  for (const weather of DIGGING.weather) {
    if (weather.itemId !== null && weather.item !== null) {
      add({ itemId: weather.itemId, item: weather.item, condition: weather.name }, "Weather", "inactive", { ...conditions, weather: weather.id });
    }
  }
  if (ORE_ZONES.includes(zone)) {
    for (const [day, ore] of Object.entries(DIG_DAY_ITEMS)) {
      add({ ...ore, condition: oreCondition(day) }, "Elemental ore", "inactive", {
        ...conditions, day: day as keyof typeof DIG_DAY_ITEMS, waxing: true, moonPercent: 6,
        weather: ORE_WEATHER_IDS.includes(conditions.weather) ? conditions.weather : ORE_WEATHER_IDS[0],
      });
    }
  }
  for (const entry of DIGGING.referenceLayers.filter(entry => entry.zone === zone)) {
    const category = entry.layer;
    if (category !== "Bore" && category !== "Burrow" && category !== "Treasure") {
      throw new Error(`Unknown digging reference layer: ${category}`);
    }
    const requirement = category === "Treasure" ? "Base treasure layer (not the Treasure Finder ability)"
      : `Registered personal chocobo with ${category}`;
    add({
      ...entry,
      condition: `${requirement}; ${DIG_RANKS[entry.minimumRank]} (${entry.minimumRank * 10}+) in base source. Not applied by the pinned override; live availability unverified.`,
    }, category, "reference");
  }
  return { distribution, rows };
}

export function matchesDiggingSearch(entry: DigCatalogReward, query: string) {
  const search = query.trim().toLowerCase();
  return entry.item.toLowerCase().includes(search)
    || ` ${entry.category} ${entry.condition}`.toLowerCase().includes(` ${search}`);
}
