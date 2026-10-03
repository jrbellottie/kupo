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
