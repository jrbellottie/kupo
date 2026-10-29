import { printingEstimate, type PrintRecipe, type PrintSettings, type SalePrice } from "./printing";

export type SourceChoice = "auto" | "buy" | number;
export type SourceChoices = Record<string, SourceChoice>;
export type ChainLeaf = { key: string; name: string; quantity: number; price: number | null };
export type ChainNode = {
  key: string; name: string; price: number | null; attempts: number; leaves: ChainLeaf[];
  recipe?: PrintRecipe; yield: number; success: number; hq: number; tier: number;
  children: { node: ChainNode; quantity: number; recipeQuantity: number }[]; issue?: string;
};
export const MAX_CHAIN_DEPTH = 32;
type ChainEstimate = ReturnType<typeof printingEstimate> & {
  sources: { node: ChainNode; quantity: number }[]; leaves: ChainLeaf[];
  issues: string[];
  totalAttempts: number; seconds: number; directProfit: number | null;
};
type PriceLookup = (name: string) => number | null;
type SaleLookup = (name: string) => SalePrice;
type PrintingChain = {
  resolve: (name: string, ancestors?: string[], depth?: number) => ChainNode;
  estimate: (recipe: PrintRecipe, tier?: number) => ChainEstimate;
  options: (name: string) => PrintRecipe[];
  expectedYield: (recipe: PrintRecipe, name: string, tier?: number) => number;
  reprice: (buy: PriceLookup, sell: SaleLookup, changedBuy: string[], changedSell: string[]) => PrintingChain;
};

function combineLeaves(parts: { leaves: ChainLeaf[]; quantity: number }[]): ChainLeaf[] {
  const combined = new Map<string, ChainLeaf>();
  for (const part of parts) for (const leaf of part.leaves) {
    const prior = combined.get(leaf.key);
    combined.set(leaf.key, { ...leaf, quantity: (prior?.quantity ?? 0) + leaf.quantity * part.quantity });
  }
  return [...combined.values()].filter((leaf) => leaf.quantity > 0);
}

export function createPrintingChain(recipes: PrintRecipe[], settings: PrintSettings, buy: PriceLookup, sell: SaleLookup, itemKey: (name: string) => string, choices: SourceChoices = {}, preferVendor: (name: string) => boolean = () => false): PrintingChain {
  const byOutput = new Map<string, PrintRecipe[]>();
  const consumers = new Map<string, Set<string>>();
  const stats = new Map(recipes.map((recipe) => [recipe.id, printingEstimate(recipe, settings, () => null, () => 0)]));
  for (const recipe of recipes) {
    if (recipe.d === 1) continue;
    for (const key of new Set([recipe.res, ...recipe.hq].map((item) => itemKey(item.n)))) {
      byOutput.set(key, [...(byOutput.get(key) ?? []), recipe]);
      if (key === itemKey("Distilled Water") || choices[key] === "buy" || (typeof choices[key] === "number" && choices[key] !== recipe.id)) continue;
      for (const input of stats.get(recipe.id)!.inputs) {
        const inputKey = itemKey(input.name);
        const outputs = consumers.get(inputKey) ?? new Set<string>();
        outputs.add(key);
        consumers.set(inputKey, outputs);
      }
    }
  }
  const options = (name: string) => itemKey(name) === itemKey("Distilled Water") ? [] : byOutput.get(itemKey(name)) ?? [];
  const expectedYield = (recipe: PrintRecipe, name: string, tier?: number) => {
    const estimate = tier === undefined ? stats.get(recipe.id)! : printingEstimate(recipe, settings, () => null, () => 0, tier);
    return estimate.outcomes.reduce((total, outcome) => total + (itemKey(outcome.n) === itemKey(name) ? outcome.probability * outcome.q : 0), 0);
  };
  const priceChain = (buy: PriceLookup, sell: SaleLookup, cache = new Map<string, ChainNode>(), estimates = new Map<PrintRecipe, Map<number | undefined, ChainEstimate>>()): PrintingChain => {
    const resolve = (name: string, ancestors: string[] = [], depth = MAX_CHAIN_DEPTH): ChainNode => {
      const key = itemKey(name);
      const choice = choices[key] ?? "auto";
      const cacheKey = JSON.stringify([key, depth, ancestors]);
      const cached = cache.get(cacheKey);
      if (cached) return cached;
      const purchased: ChainNode = { key, name, price: buy(name), attempts: 0, leaves: [{ key, name, quantity: 1, price: buy(name) }], yield: 1, success: 1, hq: 0, tier: -1, children: [] };
      if (choice === "buy" || key === itemKey("Distilled Water") || (choice === "auto" && purchased.price !== null && preferVendor(name))) return purchased;
      if (options(name).length && (ancestors.includes(key) || depth === 0)) {
        return { ...purchased, price: null, issue: ancestors.includes(key) ? "Circular ingredient chain: choose Buy to stop this branch" : `More than ${MAX_CHAIN_DEPTH} ingredient stages: choose Buy to stop this branch` };
      }
      const craftNodes: ChainNode[] = [];
      for (const recipe of options(name)) {
        if (typeof choice === "number" && recipe.id !== choice) continue;
        const estimate = stats.get(recipe.id)!;
        const output = expectedYield(recipe, name);
        const divisor = output > 0 ? output : Math.max(...[recipe.res, ...recipe.hq].filter((item) => itemKey(item.n) === key).map((item) => item.q), 1);
        const children = estimate.inputs.map((input) => ({
          node: resolve(input.name, [...ancestors, key], depth - 1),
          quantity: input.quantity * (input.crystal ? 1 : estimate.consumption),
          recipeQuantity: input.quantity,
        }));
        const issue = !estimate.eligible || estimate.success <= 0 || output <= 0
          ? "Ingredient recipe unavailable at current skills or HQ yield"
          : children.find((child) => child.node.issue)?.node.issue;
        const cost = children.every((child) => child.node.price !== null) ? children.reduce((total, child) => total + child.quantity * child.node.price!, 0) : null;
        craftNodes.push({ key, name, recipe, price: issue || cost === null ? null : cost / divisor,
          attempts: (1 + children.reduce((total, child) => total + child.quantity * child.node.attempts, 0)) / divisor,
          leaves: combineLeaves(children.map((child) => ({ leaves: child.node.leaves, quantity: child.quantity / divisor }))),
          yield: output, success: estimate.success, hq: estimate.hq, tier: estimate.tier, children, issue });
      }
      const known = craftNodes.filter((node) => node.price !== null && !node.issue)
        .sort((first, second) => first.price! - second.price! || first.attempts - second.attempts);
      const unresolved = craftNodes.filter((node) => !node.issue).sort((first, second) => first.leaves.filter((leaf) => leaf.price === null).length - second.leaves.filter((leaf) => leaf.price === null).length || first.attempts - second.attempts);
      const result = known[0] ?? unresolved[0] ?? craftNodes[0] ?? (choice === "auto" ? purchased : { ...purchased, price: null, issue: "Selected recipe unavailable at these skills or filters" });
      cache.set(cacheKey, result);
      return result;
    };
    const estimate = (recipe: PrintRecipe, tier?: number) => {
      const cached = estimates.get(recipe)?.get(tier);
      if (cached) return cached;
      const blocked = [itemKey(recipe.res.n), ...recipe.hq.map((item) => itemKey(item.n))];
      const direct = printingEstimate(recipe, settings, buy, sell, tier);
      const sources = direct.inputs.map((input) => ({ node: resolve(input.name, blocked), quantity: input.quantity * (input.crystal ? 1 : direct.consumption) }));
      const sourceMap = new Map(sources.map((source) => [source.node.key, source.node]));
      const result = printingEstimate(recipe, settings, (name) => sourceMap.get(itemKey(name))?.price ?? null, sell, tier);
      const leaves = combineLeaves(sources.map((source) => ({ leaves: source.node.leaves, quantity: source.quantity })));
      const issues = [...new Set(sources.flatMap((source) => source.node.issue ? [source.node.issue] : []))];
      const totalAttempts = 1 + sources.reduce((total, source) => total + source.quantity * source.node.attempts, 0);
      const seconds = totalAttempts * (3600 / direct.attemptsPerHour);
      const combined = { ...result, eligible: result.eligible && !issues.length, sources, leaves, issues, totalAttempts, seconds,
        directProfit: direct.profit, gilPerHour: result.profit === null || issues.length ? null : result.profit * 3600 / seconds,
        attemptsPerHour: 3600 / seconds };
      const tiers = estimates.get(recipe) ?? new Map<number | undefined, ChainEstimate>();
      tiers.set(tier, combined);
      estimates.set(recipe, tiers);
      return combined;
    };
    const reprice: PrintingChain["reprice"] = (nextBuy, nextSell, changedBuy, changedSell) => {
      const affected = new Set(changedBuy);
      for (const key of affected) for (const output of consumers.get(key) ?? []) affected.add(output);
      const sales = new Set(changedSell);
      const nextCache = new Map([...cache].filter(([, node]) => !affected.has(node.key)));
      const nextEstimates = new Map([...estimates].filter(([recipe]) =>
        ![...recipe.ing.map((input) => input.n), `${recipe.crystal} Crystal`].some((name) => affected.has(itemKey(name))) &&
        ![recipe.res, ...recipe.hq].some((output) => sales.has(itemKey(output.n))))
        .map(([recipe, tiers]) => [recipe, new Map(tiers)]));
      return priceChain(nextBuy, nextSell, nextCache, nextEstimates);
    };
    return { resolve, estimate, options, expectedYield, reprice };
  };
  return priceChain(buy, sell);
}

export function chainTierCosts(node: ChainNode, settings: PrintSettings, itemKey: (name: string) => string) {
  if (!node.recipe) return [];
  const recipe = node.recipe;
  return [0, 1, 2, 3].map((tier) => {
    const estimate = printingEstimate(recipe, settings, (name) => node.children.find((child) => child.node.key === itemKey(name))?.node.price ?? null, () => 0, tier);
    const output = estimate.outcomes.reduce((total, outcome) => total + (itemKey(outcome.n) === node.key ? outcome.probability * outcome.q : 0), 0);
    return { tier, hq: estimate.hq, yield: output, price: output > 0 && estimate.cost !== null ? estimate.cost / output : null };
  });
}

export function chainBatchAllocation(node: ChainNode, parentQuantity: number, itemKey: (name: string) => string) {
  if (!node.recipe || itemKey(node.recipe.res.n) !== node.key || node.recipe.res.q <= 0) return null;
  const output = node.recipe.res.q;
  const fraction = parentQuantity / output;
  const inputs = node.children.map((child) => ({ name: child.node.name, quantity: child.recipeQuantity,
    allocatedQuantity: child.recipeQuantity * fraction,
    allocatedCost: child.node.price === null ? null : child.node.price * child.recipeQuantity * fraction }));
  return { output, parentQuantity, fraction, inputs };
}