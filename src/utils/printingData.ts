import recipeData from "../data/recipes.json";
import { catalogData, shopsData, PHOENIX_SOURCE } from "./phoenixData";
import guildData from "../data/guildShops.json";
import { normalizeItemName } from "./itemLinks";
import { validPrice, type PrintRecipe } from "./printing";

type Item = { name: string; sell: number; stack: number; flags: number };
const catalog = catalogData as unknown as { names: Record<string, number>; items: Record<string, Item>; source: { revision: string } };
export const PRINT_RECIPES = (recipeData as PrintRecipe[]).filter((recipe) => recipe.d !== 1 && printItemKey(recipe.res.n) !== printItemKey("Distilled Water"));
export const DESYNTH_RECIPES = (recipeData as PrintRecipe[]).filter((recipe) => recipe.d === 1);
export const PRINT_PRICE_REVISION = PHOENIX_SOURCE.revision;
export type PrintOffer = { price: number; npc?: string; zone?: string; guild?: string; rank?: string };
export type PriceBook = Record<string, number>;
export function printItemKey(name: string): string { return String(catalog.names[normalizeItemName(name)] ?? normalizeItemName(name)); }
export function printItem(name: string): Item | undefined { return catalog.items[printItemKey(name)]; }
const offers = new Map<string, PrintOffer[]>();
const add = (name: string, offer: PrintOffer) => {
  const key = printItemKey(name);
  const entries = offers.get(key) ?? [];
  if (!entries.some((entry) => entry.price === offer.price && entry.npc === offer.npc && entry.zone === offer.zone && entry.guild === offer.guild)) entries.push(offer);
  offers.set(key, entries);
};
for (const row of shopsData) add(row.n, { price: row.price, npc: row.npc, zone: row.zone });
for (const row of guildData) add(row.n, { price: row.price, guild: row.guild, rank: row.rank });
for (const entries of offers.values()) entries.sort((first, second) => first.price - second.price);
export function printOffers(name: string): PrintOffer[] { return offers.get(printItemKey(name)) ?? []; }
export function printVendorPrice(name: string, modernGuilds = false): number | null {
  return printOffers(name).find((offer) => modernGuilds || !offer.guild)?.price ?? null;
}
export function printBuyPrice(name: string, overrides: PriceBook, useVendors = true, modernGuilds = false): number | null {
  const price = overrides[printItemKey(name)];
  if (validPrice(price)) return price;
  return useVendors ? printVendorPrice(name, modernGuilds) : null;
}
export function printSellPrice(name: string, overrides: PriceBook): number | null {
  const price = overrides[printItemKey(name)];
  if (validPrice(price)) return price;
  const item = printItem(name);
  return item ? (item.flags & 0x1000 ? 0 : item.sell) : null;
}
export const PRINT_MATERIALS = [...new Map(PRINT_RECIPES.flatMap((recipe) => [...recipe.ing.map((item) => item.n), `${recipe.crystal} Crystal`]).map((name) => [printItemKey(name), name])).values()].sort();
export const PRINT_EXAMPLES = ["Shihei", "Tsurara", "Mahogany Pole", "Ebony Pole", "Darksteel Pick"];