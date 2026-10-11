import snapshot from "../data/phoenix.json";
import { normalizeItemName } from "./itemLinks";
import { getVanaNow, nextEarthMsForVanaDailySchedule, type Calibration } from "../vanadiel";
import { WEEKDAYS } from "./weekday";
import type { EarthTimer } from "../types";

export type GuildSellStock = {
  itemId: number;
  item: string;
  initial: number;
  maxStock: number;
  targetStock: number;
  restockRate: number;
  baseSell: number;
  sellPrice: number | null;
  hidden: boolean;
};
export type SellingGuild = {
  pool: string;
  guild: string;
  merchants: { name: string; zones: string[] }[];
  hours: number[];
  holiday: number | null;
  ferry: boolean;
  stock: GuildSellStock[];
};

export const SELLING_GUILDS: SellingGuild[] = snapshot.guildSelling;
export const SELLING_GUILD_NAMES = [...new Set(SELLING_GUILDS.map(shop => shop.guild))].sort();
export const SOURCE_GUILD_SHOP_HOLIDAYS = snapshot.guildShopHolidays;
// Confirmed live behavior overrides the public source's disabled-holidays default.
export const DEFAULT_GUILD_SHOP_HOLIDAYS = true;

export function guildOpeningStatus(shop: SellingGuild, nowMs: number, cal: Calibration, holidays: boolean) {
  const [openHour, closeHour] = shop.hours;
  if (shop.hours.length !== 2 || !Number.isInteger(openHour) || !Number.isInteger(closeHour)
    || openHour < 0 || openHour >= closeHour || closeHour > 24
    || (shop.holiday !== null && (!Number.isInteger(shop.holiday) || !WEEKDAYS[shop.holiday]))) {
    throw new Error("Invalid guild opening hours or holiday.");
  }
  const now = getVanaNow(nowMs, cal);
  const holiday = holidays && shop.holiday !== null ? WEEKDAYS[shop.holiday] : null;
  const isHoliday = now.weekday === holiday;
  const isOpen = !isHoliday && now.hour >= openHour && now.hour < closeHour;
  const nextOpening = (after: number) => nextEarthMsForVanaDailySchedule({
    nowEarthMs: after, cal, departureMinutes: [openHour * 60], offsetHours: 0,
  });
  let nextOpenAt = nextOpening(nowMs);
  if (getVanaNow(nextOpenAt, cal).weekday === holiday) nextOpenAt = nextOpening(nextOpenAt);
  const closeAt = isOpen ? nextEarthMsForVanaDailySchedule({
    nowEarthMs: nowMs, cal, departureMinutes: [(closeHour * 60) % 1440], offsetHours: 0,
  }) : null;
  return { isOpen, isHoliday, nextOpenAt, closeAt };
}

export function guildOpeningTimerId(shop: SellingGuild, nextOpenAt: number) {
  return `guild-opening:${shop.pool}:${nextOpenAt}`;
}

export function createGuildOpeningTimer(shop: SellingGuild, nowMs: number, cal: Calibration, holidays: boolean): EarthTimer {
  const { nextOpenAt } = guildOpeningStatus(shop, nowMs, cal, holidays);
  const locations = [...new Set(shop.merchants.flatMap(npc => npc.zones))].join(" / ");
  return {
    id: guildOpeningTimerId(shop, nextOpenAt), kind: "EARTH_TIME",
    label: `${shop.guild} guild opens: ${locations} (${shop.merchants.map(npc => npc.name).join(" / ")})`,
    enabled: true, createdAtMs: nowMs, targetEarthMs: nextOpenAt,
    rawInput: new Date(nextOpenAt).toISOString(), repeatDaily: false,
  };
}

export function guildSellPrice(stock: GuildSellStock, openingStock: number): number {
  if (!Number.isInteger(openingStock) || openingStock < 0 || openingStock > stock.maxStock) {
    throw new Error("Guild opening stock must be a whole number within the stock cap.");
  }
  if (stock.sellPrice !== null) return stock.sellPrice;
  const index = Math.floor(200 * openingStock / stock.maxStock);
  return Math.floor(stock.baseSell * (600 - index) / 400);
}

export function guildSaleScenarios(stock: GuildSellStock) {
  const freshStock = Math.min(stock.initial, stock.targetStock);
  const freshCapacity = stock.maxStock - freshStock;
  const freshPrice = guildSellPrice(stock, freshStock);
  const dailyCapacity = stock.maxStock - stock.targetStock;
  const dailyPrice = guildSellPrice(stock, stock.targetStock);
  return {
    emptyCapacity: stock.maxStock,
    emptyPrice: guildSellPrice(stock, 0),
    freshStock, freshCapacity, freshPrice, freshGil: freshCapacity * freshPrice,
    dailyStock: stock.targetStock, dailyCapacity, dailyPrice, dailyGil: dailyCapacity * dailyPrice,
    trimPercent: dailyCapacity / stock.maxStock * 100,
  };
}

export function findGuildSellItems(query: string, guild = "", includeFerries = true) {
  const search = normalizeItemName(query);
  const items = new Map<number, string>();
  for (const shop of SELLING_GUILDS) {
    if ((guild && shop.guild !== guild) || (!includeFerries && shop.ferry)) continue;
    for (const stock of shop.stock) {
      if (normalizeItemName(stock.item).includes(search)) items.set(stock.itemId, stock.item);
    }
  }
  return [...items].map(([itemId, item]) => ({ itemId, item })).sort((a, b) => a.item.localeCompare(b.item));
}

export function guildSellRows(itemId: number, guild = "", includeFerries = true) {
  return SELLING_GUILDS.flatMap(shop => {
    if ((guild && shop.guild !== guild) || (!includeFerries && shop.ferry)) return [];
    const stock = shop.stock.find(item => item.itemId === itemId);
    return stock ? [{ shop, stock, ...guildSaleScenarios(stock) }] : [];
  });
}

export function totalGuildSales(rows: ReturnType<typeof guildSellRows>) {
  return rows.reduce((total, row) => ({
    emptyCapacity: total.emptyCapacity + row.emptyCapacity,
    freshCapacity: total.freshCapacity + row.freshCapacity,
    freshGil: total.freshGil + row.freshGil,
    dailyCapacity: total.dailyCapacity + row.dailyCapacity,
    dailyGil: total.dailyGil + row.dailyGil,
  }), { emptyCapacity: 0, freshCapacity: 0, freshGil: 0, dailyCapacity: 0, dailyGil: 0 });
}
