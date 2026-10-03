import { catalogData, phoenixDigging as digData } from "./phoenixData";
import { DIGGING, DIG_DAY_ITEMS } from "./digging";
import { PRINT_RECIPES, printItemKey } from "./printingData";
import { normalizeItemName } from "./itemLinks";
import type { PriceSnapshot } from "./itemPriceStore";

export type PriceCatalogItem = { key: string; name: string; stack: number; crafting: boolean; digging: boolean; search: string };
const catalog = catalogData as unknown as { names: Record<string, number>; items: Record<string, { name: string; stack: number }> };
const crafting = new Set(PRINT_RECIPES.flatMap((recipe) => [recipe.res.n, ...recipe.hq.map((item) => item.n), ...recipe.ing.map((item) => item.n), `${recipe.crystal} Crystal`]).map(printItemKey));
const digNames = [...digData.entries.map((entry) => entry.item), ...Object.values(DIG_DAY_ITEMS).map(entry => entry.item), "Gysahl Greens", ...DIGGING.weather.flatMap(entry => entry.item ? [entry.item] : [])];
const digging = new Set(digNames.map(printItemKey));
const aliases = new Map<string, string[]>();
for (const [name, id] of Object.entries(catalog.names)) {
  const key = String(id);
  const names = aliases.get(key) ?? [];
  names.push(name);
  aliases.set(key, names);
}
const rows = new Map<string, PriceCatalogItem>();
const add = (name: string, stack = 1, key = printItemKey(name)) => {
  if (!rows.has(key)) rows.set(key, { key, name, stack: Math.max(1, stack), crafting: crafting.has(key), digging: digging.has(key), search: normalizeItemName([name, ...(aliases.get(key) ?? []), key].join(" ")) });
};
for (const [key, item] of Object.entries(catalog.items)) add(item.name, item.stack, key);
for (const recipe of PRINT_RECIPES) for (const name of [recipe.res.n, ...recipe.hq.map((item) => item.n), ...recipe.ing.map((item) => item.n), `${recipe.crystal} Crystal`]) add(name);
for (const name of digNames) add(name);
export const PRICE_CATALOG = [...rows.values()].sort((first, second) => first.name.localeCompare(second.name));

export function priceCatalogItems(prices: PriceSnapshot): PriceCatalogItem[] {
  const keys = new Set([...Object.keys(prices.market), ...Object.keys(prices.buy), ...Object.keys(prices.sell), ...Object.keys(prices.sellMode)]);
  const extras = [...keys].filter((key) => !rows.has(key)).map((key) => {
    const name = prices.names[key] ?? key;
    return { key, name, stack: 1, crafting: false, digging: false, search: normalizeItemName(`${name} ${key}`) };
  });
  return extras.length ? [...PRICE_CATALOG, ...extras].sort((first, second) => first.name.localeCompare(second.name)) : PRICE_CATALOG;
}