import phoenix from "../data/phoenix.json";
import { GUILD_COLORS } from "./guilds";
import { getVanaNow, nextEarthMsForVanaDailySchedule, type Calibration, type VanaWeekday } from "../vanadiel";
import type { EarthTimer } from "../types";
import { guildOpeningStatus, SELLING_GUILDS } from "./guildSelling";
import { pad2, uid } from "./time";

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

export type GuildDecayTimerSchedule = {
  targetEarthMs: number;
  forecastDays: number;
  openingWeekday: VanaWeekday;
  openingHour: number;
  closingHour: number;
  closedWeekday: VanaWeekday | null;
  fireWeekday: VanaWeekday;
  fireHour: number;
  fireMinute: number;
};

export type GuildDecayBuyPlan = {
  currentStockMin: number;
  currentStockMax: number;
  refreshCount: number;
  stockAtTargetWithoutPurchase: number;
  maxItemsToBuy: number | null;
};

export const GUILD_DECAY_PREVIEW_DAYS = 60;
export const GUILD_DECAY_MAX_TIMER_DAYS = 10_000;
const VANA_HOUR_MS = 3_600 * 40;
const VANA_DAY_MS = 86_400 * 40;

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

export function guildDecayBuyPlanByEarthTime(
  offer: GuildDecayOffer,
  selection: GuildDecaySelection,
  nowEarthMs: number,
  targetEarthMs: number,
  cal: Calibration,
): GuildDecayBuyPlan {
  const error = guildDecayInputError(offer, selection);
  if (error) throw new Error(error);
  if (!Number.isFinite(targetEarthMs) || targetEarthMs <= nowEarthMs) {
    throw new Error("Choose a future local date and time.");
  }

  const nextRefreshAt = nextEarthMsForVanaDailySchedule({
    nowEarthMs,
    cal,
    departureMinutes: [0],
    offsetHours: 0,
  });
  const refreshCount = targetEarthMs < nextRefreshAt
    ? 0
    : Math.floor((targetEarthMs - nextRefreshAt) / VANA_DAY_MS) + 1;
  const stockEstimate = selection.inputMode === "currentPrice"
    ? inferGuildStockFromPrice(offer, selection.currentPrice)
    : null;
  const currentStockMin = stockEstimate?.minStock ?? guildDecayStartingStock(offer, selection);
  const currentStockMax = stockEstimate?.maxStock ?? currentStockMin;
  const stockAtTargetWithoutPurchase = Math.min(
    offer.targetStock,
    currentStockMin + offer.restockRate * refreshCount,
  );
  const maxItemsToBuy = stockAtTargetWithoutPurchase < offer.targetStock
    ? null
    : Math.min(currentStockMin, Math.max(
      0,
      currentStockMin + offer.restockRate * refreshCount - offer.targetStock,
    ));

  return {
    currentStockMin,
    currentStockMax,
    refreshCount,
    stockAtTargetWithoutPurchase,
    maxItemsToBuy,
  };
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

export function guildDecayTimerSchedule(
  offer: GuildDecayOffer,
  days: number,
  nowMs: number,
  cal: Calibration,
  offsetVanaHours: number,
  holidays: boolean,
): GuildDecayTimerSchedule {
  if (!Number.isSafeInteger(days) || days < 1 || days > GUILD_DECAY_MAX_TIMER_DAYS) {
    throw new Error(`Days must be a whole number from 1 to ${GUILD_DECAY_MAX_TIMER_DAYS}.`);
  }
  const offsetVanaMinutes = Math.round(offsetVanaHours * 60);
  if (!Number.isFinite(offsetVanaHours) || offsetVanaHours < 0 || offsetVanaHours > 23
    || Math.abs(offsetVanaHours * 60 - offsetVanaMinutes) > 1e-8) {
    throw new Error("Invalid guild opening timer offset.");
  }

  const shop = SELLING_GUILDS.find(entry =>
    entry.guild === offer.guild && entry.merchants.some(merchant => merchant.name === offer.npc));
  if (!shop) throw new Error(`No guild opening schedule is available for ${offer.npc}.`);

  const firstDayBoundary = nextEarthMsForVanaDailySchedule({
    nowEarthMs: nowMs,
    cal,
    departureMinutes: [0],
    offsetHours: 0,
  });
  const targetDayBoundary = firstDayBoundary + (days - 1) * VANA_DAY_MS;
  const [openingHour, closingHour] = shop.hours;
  const firstOpeningAt = targetDayBoundary + openingHour * VANA_HOUR_MS;
  const openingStatus = guildOpeningStatus(shop, targetDayBoundary - 1, cal, holidays);
  const skippedDayMs = openingStatus.nextOpenAt - firstOpeningAt;
  const skippedDays = Math.round(skippedDayMs / VANA_DAY_MS);
  if (skippedDays < 0 || Math.abs(skippedDayMs - skippedDays * VANA_DAY_MS) > 1) {
    throw new Error(`Unable to resolve the next opening for ${offer.npc}.`);
  }

  const opening = getVanaNow(openingStatus.nextOpenAt, cal);
  const targetEarthMs = openingStatus.nextOpenAt - offsetVanaMinutes * 60 * 40;
  const fireTime = getVanaNow(targetEarthMs, cal);
  return {
    targetEarthMs,
    forecastDays: days + skippedDays,
    openingWeekday: opening.weekday,
    openingHour,
    closingHour,
    closedWeekday: skippedDays > 0 ? getVanaNow(targetDayBoundary, cal).weekday : null,
    fireWeekday: fireTime.weekday,
    fireHour: fireTime.hour,
    fireMinute: fireTime.minute,
  };
}

export function createGuildDecayTimer(
  offer: GuildDecayOffer,
  selection: GuildDecaySelection,
  days: number,
  nowMs: number,
  cal: Calibration,
  offsetVanaHours: number,
  holidays: boolean,
  timerPhase: "offset" | "opening" = "offset",
): EarthTimer {
  if (days < 1) {
    throw new Error("A timer can only be set for a future game day.");
  }
  const schedule = guildDecayTimerSchedule(offer, days, nowMs, cal, offsetVanaHours, holidays);
  const price = guildPriceAfterDays(offer, selection, Math.min(schedule.forecastDays, GUILD_DECAY_MAX_TIMER_DAYS));
  const guildColor = Object.entries(GUILD_COLORS).find(([guildId]) => guildId === offer.guild.toUpperCase())?.[1];
  if (!guildColor) throw new Error(`No timer color is configured for ${offer.guild}.`);

  const holidayNote = schedule.closedWeekday
    ? `; closed on ${schedule.closedWeekday}, moved to ${schedule.openingWeekday} opening`
    : "";
  const timerDescription = timerPhase === "opening" ? "shop opening alarm" : "pre-opening reminder";
  return {
    id: `guild-decay:${offer.guild}:${offer.itemId}:${offer.npc}:${uid()}`,
    kind: "EARTH_TIME",
    label: `${offer.guild} — ${offer.n} at ${offer.npc}: ${price.toLocaleString()} gil after ${schedule.forecastDays} Vana'diel ${schedule.forecastDays === 1 ? "day" : "days"}${holidayNote}; ${timerDescription}; fires ${schedule.fireWeekday} ${pad2(schedule.fireHour)}:${pad2(schedule.fireMinute)} Vana'diel`,
    enabled: true,
    createdAtMs: nowMs,
    accentColor: guildColor,
    targetEarthMs: schedule.targetEarthMs,
    rawInput: new Date(schedule.targetEarthMs).toISOString(),
    repeatDaily: false,
  };
}

export function createGuildDecayTimers(
  offer: GuildDecayOffer,
  selection: GuildDecaySelection,
  days: number,
  nowMs: number,
  cal: Calibration,
  offsetVanaHours: number,
  holidays: boolean,
): EarthTimer[] {
  const timers: EarthTimer[] = [];
  if (offsetVanaHours > 0) {
    timers.push(createGuildDecayTimer(offer, selection, days, nowMs, cal, offsetVanaHours, holidays, "offset"));
  }
  timers.push(createGuildDecayTimer(offer, selection, days, nowMs, cal, 0, holidays, "opening"));
  return timers;
}
