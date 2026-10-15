import phoenix from "../data/phoenix.json";
import { nextEarthMsForVanaDailySchedule, type Calibration } from "../vanadiel";
import type { EarthTimer } from "../types";

type SourceGuildOffer = (typeof phoenix.guildOffers)[number];

export type GuildDecayOffer = SourceGuildOffer & { guild: string };
export type GuildDecayInputMode = "itemsBought" | "currentPrice";

export type GuildDecaySelection = {
  guild: string;
  item: string;
  npc: string;
  inputMode: GuildDecayInputMode;
  quantityBought: number;
  currentPrice: number;
};

export type GuildDecayDay = {
  day: number;
  stock: number;
  price: number;
};

export type GuildStockEstimate = {
  enteredPrice: number;
  sourcePrice: number;
  estimatedStock: number;
  minStock: number;
  maxStock: number;
  matchCount: number;
  exact: boolean;
};

export const GUILD_DECAY_PREVIEW_DAYS = 60;
export const GUILD_DECAY_MAX_TIMER_DAYS = 10_000;

export const GUILD_DECAY_OFFERS: GuildDecayOffer[] = phoenix.guildOffers.filter(
  (offer): offer is GuildDecayOffer => typeof offer.guild === "string" && offer.stocked,
);

export function guildPriceAtStock(offer: GuildDecayOffer, stock: number): number {
  if (!Number.isInteger(stock) || stock < 0 || stock > offer.maxStock) {
    throw new Error("Guild shop stock must be a whole number within the item stock cap.");
  }

  const priceFloor = offer.priceFloor ?? offer.maxStock * 0.75;
  if (priceFloor <= 0) return offer.buyMax;

  const knee = (2 / 3) * priceFloor;
  if (stock <= knee) {
    return Math.floor((offer.buyMax * (125 - Math.floor((150 * stock) / priceFloor))) / 125);
  }
  return Math.floor(
    (offer.buyMax * (200 - Math.floor((100 * (stock - knee)) / (offer.maxStock - knee)))) / 1000,
  );
}

export function inferGuildStockFromPrice(offer: GuildDecayOffer, currentPrice: number): GuildStockEstimate {
  if (!Number.isSafeInteger(currentPrice) || currentPrice < 0 || currentPrice > 1_000_000_000) {
    throw new Error("Current price must be a whole number from 0 to 1,000,000,000 gil.");
  }

  const curve = Array.from({ length: offer.targetStock + 1 }, (_, stock) => ({
    stock,
    price: guildPriceAtStock(offer, stock),
  }));
  const nearestDifference = Math.min(...curve.map(entry => Math.abs(entry.price - currentPrice)));
  const nearest = curve.filter(entry => Math.abs(entry.price - currentPrice) === nearestDifference);
  const estimatedStock = Math.max(...nearest.map(entry => entry.stock));
  return {
    enteredPrice: currentPrice,
    sourcePrice: guildPriceAtStock(offer, estimatedStock),
    estimatedStock,
    minStock: Math.min(...nearest.map(entry => entry.stock)),
    maxStock: estimatedStock,
    matchCount: nearest.length,
    exact: guildPriceAtStock(offer, estimatedStock) === currentPrice,
  };
}

export function guildDecayInputError(offer: GuildDecayOffer | undefined, selection: GuildDecaySelection): string | null {
  if (!offer) return "Choose a guild item and shop.";
  if (selection.inputMode === "itemsBought"
    && (!Number.isSafeInteger(selection.quantityBought) || selection.quantityBought < 0 || selection.quantityBought > offer.targetStock)) {
    return `Items bought must be a whole number from 0 to ${offer.targetStock}.`;
  }
  if (selection.inputMode === "currentPrice"
    && (!Number.isSafeInteger(selection.currentPrice) || selection.currentPrice < 0 || selection.currentPrice > 1_000_000_000)) {
    return "Current price must be a whole number from 0 to 1,000,000,000 gil.";
  }
  return null;
}

export function guildDecayStartingStock(offer: GuildDecayOffer, selection: GuildDecaySelection): number {
  if (selection.inputMode === "itemsBought") return offer.targetStock - selection.quantityBought;
  return inferGuildStockFromPrice(offer, selection.currentPrice).estimatedStock;
}

export function guildDecayStartingPrice(offer: GuildDecayOffer, selection: GuildDecaySelection): number {
  return selection.inputMode === "itemsBought" ? offer.price : selection.currentPrice;
}

export function guildPriceAfterDays(offer: GuildDecayOffer, selection: GuildDecaySelection, days: number): number {
  const error = guildDecayInputError(offer, selection);
  if (error) throw new Error(error);
  if (!Number.isSafeInteger(days) || days < 0 || days > GUILD_DECAY_MAX_TIMER_DAYS) {
    throw new Error(`Days must be a whole number from 0 to ${GUILD_DECAY_MAX_TIMER_DAYS}.`);
  }

  if (days === 0) return guildDecayStartingPrice(offer, selection);
  const stock = Math.min(offer.targetStock, guildDecayStartingStock(offer, selection) + offer.restockRate * days);
  return guildPriceAtStock(offer, stock);
}

export function guildDecayPreview(offer: GuildDecayOffer, selection: GuildDecaySelection) {
  const error = guildDecayInputError(offer, selection);
  if (error) throw new Error(error);

  const days: GuildDecayDay[] = [];
  const startingStock = guildDecayStartingStock(offer, selection);
  const stockToRestore = offer.targetStock - startingStock;
  if (stockToRestore <= 0 || offer.restockRate === 0) return { days, capped: false };

  const dayCount = Math.ceil(stockToRestore / offer.restockRate);
  const previewDays = Math.min(dayCount, GUILD_DECAY_PREVIEW_DAYS);
  for (let day = 1; day <= previewDays; day += 1) {
    const stock = Math.min(offer.targetStock, startingStock + offer.restockRate * day);
    days.push({ day, stock, price: guildPriceAtStock(offer, stock) });
  }
  return { days, capped: dayCount > GUILD_DECAY_PREVIEW_DAYS };
}

export function createGuildDecayTimer(
  offer: GuildDecayOffer,
  selection: GuildDecaySelection,
  days: number,
  nowMs: number,
  cal: Calibration,
  offsetHours: number,
): EarthTimer {
  const price = guildPriceAfterDays(offer, selection, days);
  if (days < 1) {
    throw new Error("A timer can only be set for a future game day.");
  }

  const firstDayBoundary = nextEarthMsForVanaDailySchedule({
    nowEarthMs: nowMs,
    cal,
    departureMinutes: [0],
    offsetHours,
  });
  const targetEarthMs = firstDayBoundary + (days - 1) * 86_400 * 40;
  return {
    id: `guild-decay:${offer.guild}:${offer.itemId}:${offer.npc}:${targetEarthMs}`,
    kind: "EARTH_TIME",
    label: `${offer.guild} — ${offer.n} at ${offer.npc}: ${price.toLocaleString()} gil after ${days} Vana'diel ${days === 1 ? "day" : "days"}`,
    enabled: true,
    createdAtMs: nowMs,
    targetEarthMs,
    rawInput: new Date(targetEarthMs).toISOString(),
    repeatDaily: false,
  };
}
