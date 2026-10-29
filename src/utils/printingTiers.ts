import { HQ_GAPS, type PrintRecipe } from "./printing";
import type { createPrintingChain } from "./printingChain";

export const PRINT_SKILL_CAP = 106;
type Chain = ReturnType<typeof createPrintingChain>;
type Estimate = ReturnType<Chain["estimate"]>;
const comparisons = new WeakMap<Chain, Map<PrintRecipe, Estimate[]>>();

export function reachablePrintTiers(recipe: PrintRecipe): number[] {
  return HQ_GAPS.flatMap((gap, tier) => [recipe.lvl, ...(recipe.subs ?? []).map((sub) => sub.l)].every((cap) => cap + gap <= PRINT_SKILL_CAP) ? [tier] : []);
}

export function printOutcomeSkillRequirements(recipe: PrintRecipe, outcomeIndex: number, bonuses: Record<string, number> = {}) {
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 1 || outcomeIndex > 3) {
    throw new Error("HQ outcome index must be 1, 2 or 3.");
  }
  const gap = HQ_GAPS[outcomeIndex - 1];
  return [{ craft: recipe.craft, cap: recipe.lvl }, ...(recipe.subs ?? []).map((sub) => ({ craft: sub.c, cap: sub.l }))]
    .map(({ craft, cap }) => {
      const bonus = Math.max(0, Math.min(30, Number.isFinite(bonuses[craft]) ? bonuses[craft] : 0));
      const effective = cap + gap;
      return { craft, level: Math.ceil(Math.max(0, effective - bonus)), effective, bonus, reachable: effective <= PRINT_SKILL_CAP };
    });
}

export function printTierComparisons(chain: Chain, recipe: PrintRecipe): Estimate[] {
  let recipes = comparisons.get(chain);
  if (!recipes) {
    recipes = new Map();
    comparisons.set(chain, recipes);
  }
  let result = recipes.get(recipe);
  if (!result) {
    result = reachablePrintTiers(recipe).map((tier) => chain.estimate(recipe, tier));
    recipes.set(recipe, result);
  }
  return result;
}

export function selectPrintTier(comparisons: Estimate[], selectedTier?: number): Estimate | undefined {
  const selected = comparisons.find((comparison) => comparison.tier === selectedTier);
  if (selected) return selected;
  if (!comparisons.some((comparison) => comparison.gilPerHour !== null)) {
    return comparisons.reduce<Estimate | undefined>((highest, candidate) =>
      !highest || candidate.tier > highest.tier ? candidate : highest, undefined);
  }
  return comparisons.reduce<Estimate | undefined>((best, candidate) =>
    !best || (candidate.gilPerHour ?? -Infinity) > (best.gilPerHour ?? -Infinity) ? candidate : best, undefined);
}