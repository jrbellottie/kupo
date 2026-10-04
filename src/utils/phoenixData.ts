import baseCatalog from "../data/itemInfo.json";
import baseShops from "../data/shops.json";
import phoenix from "../data/phoenix.json";
import baseFish from "../data/fish.json";
import baseRodFish from "../data/rodFish.json";
import baseBait from "../data/bait.json";

type EconomyItem = { sell: number; stack: number; flags: number; name?: string; category?: number };
export type ItemMetadata = {
  name: string; stack: number; sell: number; flags: number; category: number;
  equipment?: { level: number; itemLevel: number; jobs: number; slots: number; shieldSize: number };
  weapon?: { skill: number; damage: number; delay: number; damageType: number; hits: number };
  modifiers?: number[][];
  usable?: { maxCharges: number; activation: number; useDelay: number; reuseDelay: number; aoe: number };
  furnishing?: { storage: number; element: number; aura: number; size_x: number; size_y: number };
  latents?: { mod: number; value: number; condition: number; param: number; note: string }[];
  spell?: { id: number; available: false } | { id: number; available: true; jobs: number[]; mpCost: number; castTime: number; recastTime: number };
  puppet?: { slot: number; element: number };
  expEffect?: { bonus: number; duration: number; cap: number };
};
const overrides = phoenix.items as Record<string, EconomyItem>;
const detailOverrides = phoenix.itemDetails as Record<string, Partial<ItemMetadata>>;
const baseItems: Record<string, ItemMetadata> = baseCatalog.items;
const extraItems = Object.fromEntries(Object.entries(overrides).filter(([, item]) => item.name).map(([id, item]) => [id, { category: 0, ...item, name: item.name! }]));
export const catalogData = {
  ...baseCatalog,
  names: { ...baseCatalog.names, ...Object.fromEntries(Object.entries(extraItems).map(([id, item]) => [item.name.toLowerCase(), Number(id)])) } as Record<string, number>,
  items: { ...Object.fromEntries(Object.entries(baseItems).map(([id, item]) => [id, { ...item, ...overrides[id], ...detailOverrides[id] }])), ...extraItems } as Record<string, ItemMetadata>,
};
export const PHOENIX_GUILD_NPCS = new Set(phoenix.guildNpcs);
export const shopsData = [...baseShops.filter(row => !PHOENIX_GUILD_NPCS.has(row.npc) && row.npc !== "Valeriano"), ...phoenix.guildOffers.filter(row => row.stocked), ...phoenix.valerianoOffers];
export const helmData = phoenix.helm;
export const phoenixDigging = phoenix.digging;
export const PHOENIX_SOURCE = phoenix.source;
export const phoenixFish = phoenix.fishing as Record<string, { skillCap: number; item: boolean; disabled: boolean }>;
export const fishData = baseFish.map(row => ({ ...row, lvl: phoenixFish[row.catch]?.skillCap ?? row.lvl }));
export const rodFishData = baseRodFish.map(row => ({ ...row, skillCap: phoenixFish[row.fish]?.skillCap ?? row.skillCap }));
export const baitData = baseBait.map(row => ({ ...row, lvl: phoenixFish[row.fish]?.skillCap ?? row.lvl }));