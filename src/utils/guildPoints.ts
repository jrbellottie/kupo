import phoenix from "../data/phoenix.json";
import { normalizeItemName } from "./itemLinks";

export function itemsToCapGuildPoints(pointsPerItem: number, dailyCap: number): number {
  if (!Number.isInteger(pointsPerItem) || pointsPerItem <= 0 || !Number.isInteger(dailyCap) || dailyCap <= 0) {
    throw new Error("Guild-point values and daily caps must be positive integers");
  }
  return Math.ceil(dailyCap / pointsPerItem);
}

const byName = new Map<string, { guild: string; count: number; offers: { points: number; cap: number }[] }>();
for (const entry of phoenix.guildPoints) {
  const key = normalizeItemName(entry.item);
  const count = itemsToCapGuildPoints(entry.points, entry.maxPoints);
  const previous = byName.get(key);
  if (previous && (previous.guild !== entry.guild || previous.count !== count)) {
    throw new Error(`Ambiguous guild-point quantity for ${entry.item}`);
  }
  const offers = previous?.offers ?? [];
  if (!offers.some(offer => offer.points === entry.points && offer.cap === entry.maxPoints)) {
    offers.push({ points: entry.points, cap: entry.maxPoints });
  }
  offers.sort((a, b) => a.cap - b.cap || a.points - b.points);
  byName.set(key, { guild: entry.guild, count, offers });
}

export function getGuildPointItemsToCap(item: string, guild?: string): number | null {
  const entry = byName.get(normalizeItemName(item));
  return entry && (!guild || entry.guild === guild) ? entry.count : null;
}

export function getGuildPointDailyCaps(item: string, guild?: string): readonly number[] {
  const entry = byName.get(normalizeItemName(item));
  return entry && (!guild || entry.guild === guild) ? [...new Set(entry.offers.map(offer => offer.cap))] : [];
}

export function formatGuildPointCap(item: string, guild?: string): string {
  const entry = byName.get(normalizeItemName(item));
  if (!entry || (guild && entry.guild !== guild)) return "-";
  return entry.offers.map(({ points, cap }) =>
    `${points.toLocaleString()} / ${cap.toLocaleString()} (${(cap / points).toLocaleString(undefined, { maximumFractionDigits: 2 })} items)`
  ).join(" or ");
}
