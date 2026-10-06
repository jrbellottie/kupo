import data from "../data/gardening.json";

export const GARDENING = data;
export type GardenRecipe = typeof data.recipes[number];
export type GardenSeed = typeof data.seeds[number];
export type GardenResult = GardenRecipe["results"][number];
export type GardenOutcome = GardenResult & { rolls: number; chance: number; quantities: number[]; expected: number };
export type GardenTiming = {
  minDays: number;
  maxDays: number;
  windows: { label: string; crystal: number; earliest: number; latest: number; duration: number }[];
};
export const GARDEN_SEEDS = new Map(data.seeds.map(seed => [seed.id, seed]));
export const GARDEN_POTS = new Map(data.pots.map(pot => [pot.id, pot]));
export const GARDEN_CRYSTALS = new Map(data.crystals.map(crystal => [crystal.id, crystal]));

export function gardenSeed(id: number): GardenSeed {
  const seed = GARDEN_SEEDS.get(id);
  if (!seed) throw new Error(`Unknown gardening seed ${id}.`);
  return seed;
}

export function crystalName(id: number | null): string {
  if (id === null) return "Not needed";
  const crystal = GARDEN_CRYSTALS.get(id);
  if (!crystal) throw new Error(`Unknown gardening crystal ${id}.`);
  return crystal.name;
}

export function gardenTiming(recipe: GardenRecipe): GardenTiming {
  const seed = gardenSeed(recipe.seedId);
  let minDays = 0;
  let maxDays = 0;
  let previousFed = false;
  const windows: GardenTiming["windows"] = [];
  for (const stage of seed.stages) {
    if (stage.id === 4 || stage.id === 7) {
      const crystal = stage.id === 4 || seed.feeds === 1 ? recipe.first : recipe.second;
      if (crystal === null) throw new Error(`Missing second feed in ${recipe.id}.`);
      windows.push({ label: `Feed ${windows.length + 1}`, crystal, earliest: minDays, latest: maxDays, duration: stage.days });
      // Feeding advances immediately; skipping requires waiting out the whole stage.
      if (crystal === 0) minDays += stage.days;
      maxDays += stage.days;
      previousFed = crystal !== 0;
    } else {
      const duration = previousFed ? stage.fedDays : stage.days;
      minDays += duration;
      maxDays += duration;
      previousFed = false;
    }
  }
  return { minDays, maxDays, windows };
}

export function gardenBaseStrength(recipe: GardenRecipe): number {
  const seed = gardenSeed(recipe.seedId);
  const common = seed.feeds === 2 ? recipe.second : recipe.first;
  if (common === null) throw new Error(`Missing common feed in ${recipe.id}.`);
  const elements = Array<number>(9).fill(0);
  elements[common] += 10;
  if (seed.feeds === 2) elements[recipe.first] += 10;
  elements[seed.affinity] += 10;
  const score = (element: number) => element === 0 ? Math.max(...elements) : elements[element];
  return score(common) + (seed.feeds === 2 ? score(recipe.first) : 0);
}

export function gardenHarvest(recipe: GardenRecipe, plantingRoll: number) {
  if (!Number.isInteger(plantingRoll) || plantingRoll < 0 || plantingRoll > 32) throw new Error("Planting roll must be a whole number from 0 to 32.");
  const base = gardenBaseStrength(recipe);
  const strength = base + Math.trunc((100 - base) * plantingRoll / 32);
  let cumulative = 0;
  let selected = recipe.results[recipe.results.length - 1];
  if (!selected) throw new Error(`Recipe ${recipe.id} has no results.`);
  for (const result of recipe.results) {
    cumulative += result.weight;
    if (strength < cumulative) {
      selected = result;
      break;
    }
  }
  // Match float32 bucket arithmetic and truncation in the source's quantity calculation.
  const percentage = Math.fround((strength - (cumulative - selected.weight)) / selected.weight);
  const quantity = percentage >= 1 ? selected.max
    : Math.trunc(Math.fround(selected.min + Math.fround(percentage * (1 + selected.max - selected.min))));
  return { result: selected, quantity, strength };
}

export function gardenOutcomes(recipe: GardenRecipe): GardenOutcome[] {
  const counts = new Map<number, { rolls: number; quantities: Set<number>; total: number }>();
  for (let roll = 0; roll <= 32; roll++) {
    const harvest = gardenHarvest(recipe, roll);
    const entry = counts.get(harvest.result.id) ?? { rolls: 0, quantities: new Set<number>(), total: 0 };
    entry.rolls++;
    entry.quantities.add(harvest.quantity);
    entry.total += harvest.quantity;
    counts.set(harvest.result.id, entry);
  }
  return recipe.results.map(result => {
    const entry = counts.get(result.id);
    return {
      ...result, rolls: entry?.rolls ?? 0, chance: (entry?.rolls ?? 0) / 33,
      quantities: [...(entry?.quantities ?? [])].sort((a, b) => a - b),
      expected: (entry?.total ?? 0) / 33,
    };
  });
}

export const GARDEN_ROWS = GARDENING.recipes.flatMap(recipe => {
  const seed = gardenSeed(recipe.seedId);
  const timing = gardenTiming(recipe);
  return gardenOutcomes(recipe).map(outcome => ({ recipe, seed, timing, outcome }));
});
export type GardenRow = typeof GARDEN_ROWS[number];
export type GardenFilters = {
  query: string;
  result: string;
  pot: string;
  seed: string;
  first: string;
  second: string;
  includeUnreachable: boolean;
  sort: "chance" | "time" | "item" | "seed";
};
export const DEFAULT_GARDEN_FILTERS: GardenFilters = {
  query: "", result: "", pot: "", seed: "", first: "", second: "", includeUnreachable: false, sort: "chance",
};
const searchText = (text: string) => text.toLowerCase().replace(/['’]/g, "").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();

export function filterGardenRows(filters: GardenFilters): GardenRow[] {
  if (filters.pot && !GARDEN_POTS.has(Number(filters.pot))) throw new Error("Unknown gardening pot filter.");
  const potText = filters.pot ? GARDEN_POTS.get(Number(filters.pot))!.name : GARDENING.pots.map(pot => pot.name).join(" ");
  const words = searchText(filters.query).split(" ").filter(Boolean);
  const resultQuery = searchText(filters.result);
  const rows = GARDEN_ROWS.filter(row => {
    if (!filters.includeUnreachable && row.outcome.rolls === 0) return false;
    if (filters.seed && row.seed.id !== Number(filters.seed)) return false;
    if (filters.first !== "" && row.recipe.first !== Number(filters.first)) return false;
    if (filters.second === "single" && row.recipe.second !== null) return false;
    if (filters.second !== "" && filters.second !== "single" && row.recipe.second !== Number(filters.second)) return false;
    if (!searchText(row.outcome.name).includes(resultQuery)) return false;
    const text = searchText([row.outcome.name, row.seed.name, crystalName(row.recipe.first), crystalName(row.recipe.second), potText].join(" "));
    return words.every(word => text.includes(word));
  });
  return rows.sort((a, b) => {
    const primary = filters.sort === "chance" ? b.outcome.chance - a.outcome.chance
      : filters.sort === "time" ? a.timing.minDays - b.timing.minDays
      : filters.sort === "seed" ? a.seed.name.localeCompare(b.seed.name)
      : a.outcome.name.localeCompare(b.outcome.name);
    return primary || a.timing.minDays - b.timing.minDays || a.outcome.name.localeCompare(b.outcome.name) || a.outcome.id - b.outcome.id;
  });
}

export function gardenDuration(vanaDays: number): string {
  const minutes = Math.round(vanaDays * GARDENING.daySeconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const remainder = minutes % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", remainder ? `${remainder}m` : ""].filter(Boolean).join(" ") || "0m";
}

export function gardenDurationRange(timing: Pick<GardenTiming, "minDays" | "maxDays">): string {
  return timing.minDays === timing.maxDays ? gardenDuration(timing.minDays) : `${gardenDuration(timing.minDays)} - ${gardenDuration(timing.maxDays)}`;
}

export function gardenQuantity(outcome: GardenOutcome): string {
  if (!outcome.quantities.length) return "Not reachable";
  const first = outcome.quantities[0];
  const last = outcome.quantities[outcome.quantities.length - 1];
  return first === last ? String(first) : `${first}-${last}`;
}
