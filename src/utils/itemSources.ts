// src/utils/itemSources.ts — aggregates every in-app source for an item name
// (mob drops live in DropsTab's own table; this covers everything else).
import { shopsData, helmData, phoenixDigging as chocoboDigData } from "./phoenixData";
import { DIGGING, DIG_DAY_ITEMS, ORE_ZONES } from "./digging";
import guildShopsData from "../data/guildShops.json";
import bcnmData from "../data/bcnm.json";
import fishData from "../data/fish.json";
import recipesData from "../data/recipes.json";
import questsData from "../data/quests.json";
import cpItemsData from "../data/cpItems.json";
import { normalizeItemName } from "./itemLinks";
import { CLAM_ITEM_NAMES } from "../ClamTab";

export type ShopSource = { npc: string; zone: string; price: number };
export type GuildSource = { guild: string; rank: string; price: number };
export type BcnmSource = { name: string; arena: string; type: string };
export type HelmSource = { kind: string; zone: string; pct: number };
export type DigSource = { zone: string; rate: number | null; condition?: string };
export type CraftSource = { craft: string; lvl: number; hq?: boolean };
export type CpSource = { nation: string; rank: number | null; cp: number };
export type QuestSource = { name: string; zone: string | null };

export type ItemSources = {
  shops: ShopSource[];
  guild: GuildSource[];
  bcnm: BcnmSource[];
  helm: HelmSource[];
  fishing: string[];
  digging: DigSource[];
  clamming: boolean;
  craft: CraftSource[];
  cp: CpSource[];
};

type ShopRow = { n: string; zone: string; npc: string; price: number };
type GuildRow = { n: string; guild: string; price: number; rank: string };
type HelmRow = { kind: string; zone: string; n: string; pct: number };
type FishRow = { zone: string; catch: string };
type RecipeRow = { id: number; craft: string; lvl: number; era: string; ing: { n: string }[]; res: { n: string }; hq: { n: string }[]; d?: number };
type CpRow = { n: string; nation: string; rank: number | null; cp: number; lvl: number | null };
type Battlefield = {
  name: string;
  arena: string;
  type: string;
  slots: { entries: { item: string | null }[] }[];
};
type Quest = { name: string; startZone: string | null; reward: string | null };

const empty: ItemSources = {
  shops: [], guild: [], bcnm: [], helm: [], fishing: [], digging: [], clamming: false, craft: [], cp: [],
};

const index = new Map<string, ItemSources>();
/** Canonical display name per normalized key (first source encountered wins). */
const displayByNorm = new Map<string, string>();

function entry(name: string): ItemSources {
  const norm = normalizeItemName(name);
  let e = index.get(norm);
  if (!e) {
    e = { shops: [], guild: [], bcnm: [], helm: [], fishing: [], digging: [], clamming: false, craft: [], cp: [] };
    index.set(norm, e);
    displayByNorm.set(norm, name);
  }
  return e;
}

for (const r of shopsData as ShopRow[]) entry(r.n).shops.push({ npc: r.npc, zone: r.zone, price: r.price });
for (const r of guildShopsData as GuildRow[]) entry(r.n).guild.push({ guild: r.guild, rank: r.rank, price: r.price });
for (const r of cpItemsData as CpRow[]) entry(r.n).cp.push({ nation: r.nation, rank: r.rank, cp: r.cp });
for (const r of helmData as HelmRow[]) entry(r.n).helm.push({ kind: r.kind, zone: r.zone, pct: r.pct });
for (const r of chocoboDigData.entries) {
  const e = entry(r.item);
  const minimumRank = r.weights.findIndex(weight => weight > 0);
  const condition = ["rank-dependent weights", ...(minimumRank > 0 ? [`${DIGGING.ranks[minimumRank]} (${minimumRank * 10}+)`] : []), ...(r.nightOnly ? ["night 20:00-04:00"] : [])].join("; ");
  if (!e.digging.some((d) => d.zone === r.zone)) e.digging.push({ zone: r.zone, rate: null, condition });
}
for (const [day, ore] of Object.entries(DIG_DAY_ITEMS)) {
  for (const zone of ORE_ZONES) entry(ore.item).digging.push({ zone, rate: null, condition: `${day}; Journeyman (50+), active weather (including fog), waxing moon 6-21%` });
}
for (const weather of DIGGING.weather) {
  if (!weather.item) continue;
  for (const zone of new Set(chocoboDigData.entries.map(row => row.zone))) entry(weather.item).digging.push({ zone, rate: null, condition: weather.name });
}
for (const r of fishData as FishRow[]) {
  const e = entry(r.catch);
  if (!e.fishing.includes(r.zone)) e.fishing.push(r.zone);
}
for (const name of CLAM_ITEM_NAMES) entry(name).clamming = true;
for (const bf of (bcnmData as { battlefields: Battlefield[] }).battlefields) {
  for (const slot of bf.slots) {
    for (const le of slot.entries) {
      if (!le.item || le.item === "Gil") continue;
      const e = entry(le.item);
      if (!e.bcnm.some((b) => b.name === bf.name)) e.bcnm.push({ name: bf.name, arena: bf.arena, type: bf.type });
    }
  }
}
for (const r of recipesData as RecipeRow[]) {
  if (r.d === 1) continue; // desynths aren't a way to make the item
  const e = entry(r.res.n);
  const existing = e.craft.find((c) => c.craft === r.craft);
  if (!existing) e.craft.push({ craft: r.craft, lvl: r.lvl });
  else if (r.lvl < existing.lvl) existing.lvl = r.lvl;
}
// HQ-only results (Dusk Gloves +1, Baron's gear...) get their own entries; NQ pass runs first
// so items that are also a normal result keep their unflagged source.
for (const r of recipesData as RecipeRow[]) {
  if (r.d === 1) continue;
  for (const h of new Set(r.hq.map((x) => x.n))) {
    if (normalizeItemName(h) === normalizeItemName(r.res.n)) continue; // higher-quantity HQ tiers
    const e = entry(h);
    const existing = e.craft.find((c) => c.craft === r.craft);
    if (!existing) e.craft.push({ craft: r.craft, lvl: r.lvl, hq: true });
    else if (existing.hq && r.lvl < existing.lvl) existing.lvl = r.lvl;
  }
}

export function getItemSources(name: string): ItemSources {
  return index.get(normalizeItemName(name)) ?? empty;
}

const recipesByIngredient = new Map<string, RecipeRow[]>();
for (const recipe of recipesData as RecipeRow[]) {
  for (const ingredient of new Set(recipe.ing.map((item) => normalizeItemName(item.n)))) {
    const recipes = recipesByIngredient.get(ingredient) ?? [];
    recipes.push(recipe);
    recipesByIngredient.set(ingredient, recipes);
  }
}

export function recipesUsingItem(name: string): readonly RecipeRow[] {
  return recipesByIngredient.get(normalizeItemName(name)) ?? [];
}

export type SourceBadge = { label: string; color: string };

const BADGE_COLORS: Record<string, string> = {
  Craft: "#8af6b0",
  Shop: "#D8B04B",
  Guild: "#D8B04B",
  BCNM: "#7ec4e8",
  Fish: "#9ad1ff",
  Dig: "#e8c47e",
  Clam: "#9ad1ff",
  Harvest: "#a8e87e",
  Log: "#a8e87e",
  Mine: "#a8e87e",
  Excavate: "#a8e87e",
  CP: "#e8a2c0",
  Quest: "#c9a2ff",
};

const HELM_BADGE: Record<string, string> = {
  Harvesting: "Harvest",
  Logging: "Log",
  Mining: "Mine",
  Excavation: "Excavate",
};

export function sourceBadges(name: string): SourceBadge[] {
  const s = getItemSources(name);
  const out: SourceBadge[] = [];
  const add = (label: string) => out.push({ label, color: BADGE_COLORS[label] ?? "#9aa0b8" });
  if (s.craft.length) add("Craft");
  if (s.shops.length) add("Shop");
  if (s.guild.length) add("Guild");
  if (s.bcnm.length) add("BCNM");
  for (const kind of [...new Set(s.helm.map((h) => h.kind))]) add(HELM_BADGE[kind] ?? kind);
  if (s.fishing.length) add("Fish");
  if (s.digging.length) add("Dig");
  if (s.clamming) add("Clam");
  if (s.cp.length) add("CP");
  return out;
}

/** All items with a non-drop source, for synthesizing rows in the Items table. */
export function allSourcedItems(): { norm: string; display: string }[] {
  return [...index.keys()].map((norm) => ({ norm, display: displayByNorm.get(norm)! }));
}

// Quest reward matches are substring scans over ~2.5MB of text — computed on
// demand per item and memoized.
const questCache = new Map<string, QuestSource[]>();

const ALL_QUESTS: Quest[] = (() => {
  const data = questsData as unknown as { quests?: Quest[]; missions?: Quest[] };
  return [...(data.quests ?? []), ...(data.missions ?? [])];
})();

export function questRewardsFor(name: string): QuestSource[] {
  const norm = normalizeItemName(name);
  const cached = questCache.get(norm);
  if (cached) return cached;
  const needle = norm;
  const out: QuestSource[] = [];
  for (const q of ALL_QUESTS) {
    if (q.reward && q.reward.toLowerCase().includes(needle)) {
      out.push({ name: q.name, zone: q.startZone });
      if (out.length >= 8) break;
    }
  }
  questCache.set(norm, out);
  return out;
}
