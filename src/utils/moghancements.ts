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
  rare: boolean;
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
  quantity: number;
  purpose?: "Moghancement source" | "Guild signboard" | "Guild stall" | "Aura support" | "Storage support";
};

export type FurniturePlan = {
  pieces: PlannedFurniture[];
  totalPieces: number;
  totalAura: number;
  totalStorage: number;
  effectiveStorage: number;
  targetAura: number;
  targetReached: boolean;
  storageTarget: number;
  storageTargetReached: boolean;
  dominantElementAura: number;
  otherElementAura: number;
  effectPresent: boolean;
  effectDominant: boolean;
  elementDominant: boolean;
};

export const MAX_FURNITURE_STORAGE = 80;
export function furnitureQuantityOptionsMaximum(furniture: Furniture, selectedQuantity = 0): number {
  return furniture.rare ? 1 : Math.max(30, selectedQuantity + 10);
}

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

export function evaluateFurnitureSetup(
  pieces: PlannedFurniture[],
  effect: Moghancement,
  elementId: number,
  targetAura: number,
  storageTarget = MAX_FURNITURE_STORAGE,
): FurniturePlan {
  const elementAura = new Map<number, number>();
  const quantities = new Map<number, number>();
  let totalStorage = 0;
  let totalPieces = 0;
  for (const { furniture, quantity } of pieces) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`Invalid furniture quantity for ${furniture.name}: ${quantity}`);
    }
    const combinedQuantity = (quantities.get(furniture.id) ?? 0) + quantity;
    if (furniture.rare && combinedQuantity > 1) {
      throw new Error(`Only one ${furniture.name} can be placed because it is Rare`);
    }
    quantities.set(furniture.id, combinedQuantity);
    totalPieces += quantity;
    totalStorage += furniture.storage * quantity;
    elementAura.set(furniture.elementId, (elementAura.get(furniture.elementId) ?? 0) + furniture.aura * quantity);
  }
  const paired = effect.pairedBaseId !== undefined && effect.pairedMegaId !== undefined;
  const sourceIds = paired ? [effect.pairedBaseId, effect.pairedMegaId] : [effect.id];
  const effectPresent = paired
    ? pieces.some(({ furniture }) => furniture.moghancementId === effect.pairedBaseId && /signboard/i.test(furniture.name))
      && pieces.some(({ furniture }) => furniture.moghancementId === effect.pairedMegaId && /stall/i.test(furniture.name))
    : pieces.some(({ furniture }) => furniture.moghancementId === effect.id && furniture.elementId === elementId);
  const targetFurniture = pieces.map(piece => piece.furniture).filter(item => item.elementId === elementId);
  const highestAura = Math.max(0, ...targetFurniture.map(item => item.aura));
  const strongest = targetFurniture.filter(item => item.aura === highestAura);
  // Copies add elemental aura, but do not strengthen an item's individual effect priority.
  const winningEffectId = Math.max(0, ...strongest.map(item => item.moghancementId));
  const effectDominant = effectPresent && highestAura > 0
    && sourceIds.includes(winningEffectId);
  const totalAura = elementAura.get(elementId) ?? 0;
  const otherElementAura = Math.max(0, ...[...elementAura].filter(([id]) => id !== elementId).map(([, aura]) => aura));
  const elementDominant = totalAura > otherElementAura;
  return {
    pieces,
    totalPieces,
    totalAura,
    totalStorage,
    effectiveStorage: Math.min(totalStorage, MAX_FURNITURE_STORAGE),
    targetAura,
    targetReached: totalAura >= targetAura && elementDominant && effectDominant,
    storageTarget,
    storageTargetReached: totalStorage >= storageTarget,
    dominantElementAura: totalAura,
    otherElementAura,
    effectPresent,
    effectDominant,
    elementDominant,
  };
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
  if (first.totalPieces !== second.totalPieces) return first.totalPieces - second.totalPieces;
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
  effect: Moghancement,
  elementId: number,
  targetAura: number,
  storageTarget: number,
): FurniturePlan | null {
  const highestSourceAura = Math.max(
    0,
    ...effectFurniture.filter(item => item.elementId === elementId).map(item => item.aura),
  );
  if (highestSourceAura === 0) return null;
  const highestSourceEffectId = Math.max(
    ...effectFurniture.filter(item => item.elementId === elementId && item.aura === highestSourceAura).map(item => item.moghancementId),
  );

  const pieces = fixedPieces.map(piece => ({ ...piece }));
  const elementAura = new Map<number, number>();
  let totalStorage = 0;
  const addPiece = (furniture: Furniture, purpose: PlannedFurniture["purpose"]) => {
    const existing = pieces.find(piece => piece.furniture.id === furniture.id);
    if (existing) existing.quantity++;
    else pieces.push({ furniture, purpose, quantity: 1 });
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
  const canAdd = (item: Furniture) => !item.rare || !pieces.some(piece => piece.furniture.id === item.id);
  const sameElementSupports = FURNITURE
    .filter(item => item.elementId === elementId && item.aura > 0
      && (item.aura < highestSourceAura
        || (item.aura === highestSourceAura && item.moghancementId <= highestSourceEffectId)))
    .sort((a, b) => b.aura - a.aura || b.storage - a.storage || a.name.localeCompare(b.name));

  while (
    (currentElementAura() < targetAura || currentElementAura() <= strongestOtherAura())
    && sameElementSupports.length > 0
  ) {
    const support = sameElementSupports.find(canAdd);
    if (!support) break;
    addPiece(support, "Aura support");
  }

  while (totalStorage < storageTarget) {
    const next = FURNITURE
      .filter(canAdd)
      .filter(item => item.storage > 0)
      .filter(item => {
        if (item.elementId === elementId) return item.aura < highestSourceAura
          || (item.aura === highestSourceAura && item.moghancementId <= highestSourceEffectId);
        return (elementAura.get(item.elementId) ?? 0) + item.aura < currentElementAura();
      })
      .sort((a, b) => b.storage - a.storage
        || Number(b.elementId === elementId) - Number(a.elementId === elementId)
        || b.aura - a.aura
        || a.name.localeCompare(b.name))[0];
    if (!next) break;
    addPiece(next, "Storage support");
  }

  return evaluateFurnitureSetup(pieces, effect, elementId, targetAura, storageTarget);
}

export function calculateFurniturePlan(
  effect: Moghancement,
  elementId: number,
  targetAura: number,
  storageTarget = MAX_FURNITURE_STORAGE,
): FurniturePlan | null {
  if (!Number.isInteger(targetAura) || targetAura < 1
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
          { furniture: signboard, purpose: "Guild signboard" as const, quantity: 1 },
          { furniture: stall, purpose: "Guild stall" as const, quantity: 1 },
        ];
        if (!fixed.some(piece => piece.furniture.elementId === elementId)) continue;
        const plan = makePlan(fixed, fixed.map(piece => piece.furniture), effect, elementId, targetAura, storageTarget);
        if (plan) plans.push(plan);
      }
    }
  } else {
    const anchors = FURNITURE.filter(item =>
      item.moghancementId === effect.id && item.elementId === elementId && item.aura > 0,
    );
    plans = anchors.flatMap(anchor => {
      const plan = makePlan(
        [{ furniture: anchor, purpose: "Moghancement source", quantity: 1 }],
        [anchor],
        effect,
        elementId,
        targetAura,
        storageTarget,
      );
      return plan ? [plan] : [];
    });
  }
  return plans.sort((a, b) => comparePlans(a, b, targetAura, storageTarget))[0] ?? null;
}
