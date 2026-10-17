import furnishingData from "../data/moghancements.json";
import recipesData from "../data/recipes.json";
import { normalizeItemName } from "./itemLinks";

type EffectData = {
  id: number;
  enumName: string;
  category: string;
  label: string;
  description: string;
  pairedBaseId?: number;
  pairedMegaId?: number;
};

type RecipeData = {
  id: number;
  craft: string;
  lvl: number;
  crystal: string;
  ing: { n: string; q: number }[];
  res: { n: string; q: number };
  hq: { n: string; q: number }[];
  d?: number;
};

export type CraftingOption = {
  recipeId: number;
  craft: string;
  level: number;
  crystal: string;
  ingredients: { name: string; quantity: number }[];
  quality: "NQ" | "HQ";
};

export type Furniture = {
  id: number;
  name: string;
  storage: number;
  moghancementId: number;
  elementId: number;
  element: string;
  aura: number;
  placement: number;
  sizeX: number;
  sizeY: number;
  height: number;
  effectLabel: string;
  recipes: CraftingOption[];
};

export type Moghancement = EffectData;

export type PlannedFurniture = {
  furniture: Furniture;
  purpose: "Moghancement source" | "Guild signboard" | "Guild stall" | "Aura support";
};

export type FurniturePlan = {
  pieces: PlannedFurniture[];
  totalAura: number;
  totalStorage: number;
  effectiveStorage: number;
  targetAura: number;
  targetReached: boolean;
  storageTarget: number;
  storageTargetReached: boolean;
  dominantElementAura: number;
  otherElementAura: number;
};

export const MAX_FURNITURE_STORAGE = 80;

const source = furnishingData as {
  source: { repository: string; revision: string };
  elements: { id: number; name: string }[];
  effects: EffectData[];
  furniture: Omit<Furniture, "element" | "effectLabel" | "recipes">[];
};

const recipes = recipesData as RecipeData[];
const effectsById = new Map(source.effects.map(effect => [effect.id, effect]));
const recipeOptionsByItem = new Map<string, CraftingOption[]>();

function addRecipeOption(itemName: string, recipe: RecipeData, quality: "NQ" | "HQ") {
  const key = normalizeItemName(itemName);
  const options = recipeOptionsByItem.get(key) ?? [];
  if (!options.some(option => option.recipeId === recipe.id && option.quality === quality)) {
    options.push({
      recipeId: recipe.id,
      craft: recipe.craft,
      level: recipe.lvl,
      crystal: recipe.crystal,
      ingredients: recipe.ing.map(item => ({ name: item.n, quantity: item.q })),
      quality,
    });
    recipeOptionsByItem.set(key, options);
  }
}

for (const recipe of recipes) {
  if (recipe.d === 1) continue;
  addRecipeOption(recipe.res.n, recipe, "NQ");
  for (const result of recipe.hq) addRecipeOption(result.n, recipe, "HQ");
}

export const ELEMENTS = source.elements;

export const MOGHANCEMENTS = source.effects
  .filter(effect => effect.id !== 0)
  .filter(effect => effect.pairedBaseId !== undefined
    ? source.furniture.some(item => item.moghancementId === effect.pairedBaseId)
      && source.furniture.some(item => item.moghancementId === effect.pairedMegaId)
    : source.furniture.some(item => item.moghancementId === effect.id))
  .sort((a, b) => a.label.localeCompare(b.label));

export const FURNITURE: Furniture[] = source.furniture.map(item => {
  const effect = effectsById.get(item.moghancementId);
  const element = source.elements.find(candidate => candidate.id === item.elementId);
  if (!element) throw new Error(`Unknown furnishing element ${item.elementId} for ${item.name}`);
  return {
    ...item,
    element: element.name,
    effectLabel: effect?.label ?? "No Moghancement",
    recipes: [...(recipeOptionsByItem.get(normalizeItemName(item.name)) ?? [])]
      .sort((a, b) => a.level - b.level || a.craft.localeCompare(b.craft) || a.quality.localeCompare(b.quality)),
  };
});

export const AURA_TIERS = [
  { id: "faint", label: "Faint", minimum: 1 },
  { id: "powerful", label: "Powerful", minimum: 51 },
  { id: "overwhelming", label: "Overwhelming", minimum: 101 },
] as const;

export function auraTier(aura: number): string {
  if (aura >= 101) return "Overwhelming";
  if (aura >= 51) return "Powerful";
  if (aura >= 1) return "Faint";
  return "None";
}

function comparePlans(
  first: FurniturePlan,
  second: FurniturePlan,
  targetAura: number,
  storageTarget: number,
): number {
  if (first.targetReached !== second.targetReached) return first.targetReached ? -1 : 1;
  if (!first.targetReached && first.totalAura !== second.totalAura) return second.totalAura - first.totalAura;
  if (first.storageTargetReached !== second.storageTargetReached) return first.storageTargetReached ? -1 : 1;
  if (!first.storageTargetReached && first.totalStorage !== second.totalStorage) return second.totalStorage - first.totalStorage;
  if (first.pieces.length !== second.pieces.length) return first.pieces.length - second.pieces.length;
  const firstStorageOverage = first.totalStorage - storageTarget;
  const secondStorageOverage = second.totalStorage - storageTarget;
  if (first.storageTargetReached && firstStorageOverage !== secondStorageOverage) {
    return firstStorageOverage - secondStorageOverage;
  }
  const firstAuraOverage = first.totalAura - targetAura;
  const secondAuraOverage = second.totalAura - targetAura;
  if (firstAuraOverage !== secondAuraOverage) return firstAuraOverage - secondAuraOverage;
  return first.pieces[0].furniture.name.localeCompare(second.pieces[0].furniture.name);
}

function makePlan(
  fixedPieces: PlannedFurniture[],
  effectFurniture: Furniture[],
  elementId: number,
  targetAura: number,
  storageTarget: number,
  maxPieces: number,
): FurniturePlan | null {
  if (fixedPieces.length > maxPieces) return null;
  const highestSourceAura = Math.max(
    0,
    ...effectFurniture.filter(item => item.elementId === elementId).map(item => item.aura),
  );
  if (highestSourceAura === 0) return null;

  const pieces = [...fixedPieces];
  const pieceIds = new Set(fixedPieces.map(piece => piece.furniture.id));
  const elementAura = new Map<number, number>();
  let totalStorage = 0;
  const addPiece = (furniture: Furniture, purpose: PlannedFurniture["purpose"]) => {
    pieces.push({ furniture, purpose });
    pieceIds.add(furniture.id);
    totalStorage += furniture.storage;
    elementAura.set(furniture.elementId, (elementAura.get(furniture.elementId) ?? 0) + furniture.aura);
  };
  for (const piece of fixedPieces) {
    totalStorage += piece.furniture.storage;
    elementAura.set(
      piece.furniture.elementId,
      (elementAura.get(piece.furniture.elementId) ?? 0) + piece.furniture.aura,
    );
  }
  const currentElementAura = () => elementAura.get(elementId) ?? 0;
  const strongestOtherAura = () => Math.max(
    0,
    ...[...elementAura].filter(([id]) => id !== elementId).map(([, aura]) => aura),
  );
  const sameElementSupports = FURNITURE
    .filter(item => item.elementId === elementId && item.aura > 0 && item.aura <= highestSourceAura && !pieceIds.has(item.id))
    .sort((a, b) => b.aura - a.aura || b.storage - a.storage || a.name.localeCompare(b.name));

  while (
    (currentElementAura() < targetAura || currentElementAura() <= strongestOtherAura())
    && pieces.length < maxPieces
    && sameElementSupports.length > 0
  ) {
    const support = sameElementSupports.shift()!;
    if (pieceIds.has(support.id)) continue;
    addPiece(support, "Aura support");
  }

  while (totalStorage < storageTarget && pieces.length < maxPieces) {
    const next = FURNITURE
      .filter(item => !pieceIds.has(item.id))
      .filter(item => {
        if (item.elementId === elementId) return item.aura <= highestSourceAura;
        return (elementAura.get(item.elementId) ?? 0) + item.aura < currentElementAura();
      })
      .sort((a, b) => b.storage - a.storage
        || Number(b.elementId === elementId) - Number(a.elementId === elementId)
        || b.aura - a.aura
        || a.name.localeCompare(b.name))[0];
    if (!next) break;
    addPiece(next, "Aura support");
  }

  const totalAura = currentElementAura();
  const otherElementAura = strongestOtherAura();
  return {
    pieces,
    totalAura,
    totalStorage,
    effectiveStorage: Math.min(totalStorage, MAX_FURNITURE_STORAGE),
    targetAura,
    targetReached: totalAura >= targetAura && totalAura > otherElementAura,
    storageTarget,
    storageTargetReached: totalStorage >= storageTarget,
    dominantElementAura: totalAura,
    otherElementAura,
  };
}

export function calculateFurniturePlan(
  effect: Moghancement,
  elementId: number,
  targetAura: number,
  maxPieces = 10,
  storageTarget = MAX_FURNITURE_STORAGE,
): FurniturePlan | null {
  if (!Number.isInteger(maxPieces) || maxPieces < 1
    || !Number.isInteger(storageTarget) || storageTarget < 1 || storageTarget > MAX_FURNITURE_STORAGE) return null;

  let plans: FurniturePlan[];
  if (effect.pairedBaseId !== undefined && effect.pairedMegaId !== undefined) {
    const signboards = FURNITURE.filter(item =>
      item.moghancementId === effect.pairedBaseId && /signboard/i.test(item.name),
    );
    const stalls = FURNITURE.filter(item =>
      item.moghancementId === effect.pairedMegaId && /stall/i.test(item.name),
    );
    plans = [];
    for (const signboard of signboards) {
      for (const stall of stalls) {
        const fixed = [
          { furniture: signboard, purpose: "Guild signboard" as const },
          { furniture: stall, purpose: "Guild stall" as const },
        ];
        if (!fixed.some(piece => piece.furniture.elementId === elementId)) continue;
        const plan = makePlan(fixed, fixed.map(piece => piece.furniture), elementId, targetAura, storageTarget, maxPieces);
        if (plan) plans.push(plan);
      }
    }
  } else {
    const anchors = FURNITURE.filter(item =>
      item.moghancementId === effect.id && item.elementId === elementId && item.aura > 0,
    );
    plans = anchors.flatMap(anchor => {
      const plan = makePlan(
        [{ furniture: anchor, purpose: "Moghancement source" }],
        [anchor],
        elementId,
        targetAura,
        storageTarget,
        maxPieces,
      );
      return plan ? [plan] : [];
    });
  }
  return plans.sort((a, b) => comparePlans(a, b, targetAura, storageTarget))[0] ?? null;
}
