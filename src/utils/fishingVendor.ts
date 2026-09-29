import { PRINT_RECIPES, printItemKey, printSellPrice } from "./printingData";
import { getVendorPriceEach } from "./vendorPrice";

const recipesByIngredient = new Map<string, typeof PRINT_RECIPES>();
for (const recipe of PRINT_RECIPES) {
  for (const key of new Set(recipe.ing.map(item => printItemKey(item.n)))) {
    const recipes = recipesByIngredient.get(key) ?? [];
    recipes.push(recipe);
    recipesByIngredient.set(key, recipes);
  }
}

function buildFishingVendorOptions(fish: string) {
  const key = printItemKey(fish);
  const rawPrice = getVendorPriceEach(fish) ?? printSellPrice(fish, {});
  const recipes = (recipesByIngredient.get(key) ?? []).map(recipe => {
    const fishQuantity = recipe.ing.reduce((total, item) => total + (printItemKey(item.n) === key ? item.q : 0), 0);
    const outcomes = [recipe.res, ...recipe.hq].map((item, index) => {
      const price = printSellPrice(item.n, {});
      const total = price === null ? null : price * item.q;
      return { ...item, tier: index === 0 ? "NQ" : `HQ${index}`, price, total, perFish: total === null ? null : total / fishQuantity };
    });
    return { recipe, fishQuantity, outcomes };
  }).sort((first, second) => (second.outcomes[0].perFish ?? -1) - (first.outcomes[0].perFish ?? -1) || first.recipe.id - second.recipe.id);
  let bestPrice = rawPrice;
  let bestName = fish;
  for (const { recipe, outcomes } of recipes) {
    const price = outcomes[0].perFish;
    if (recipe.era !== "WotG" && price !== null && (bestPrice === null || price > bestPrice)) {
      bestPrice = price;
      bestName = recipe.res.n;
    }
  }
  return { rawPrice, bestPrice, bestName, recipes };
}

const cache = new Map<string, ReturnType<typeof buildFishingVendorOptions>>();
export function getFishingVendorOptions(fish: string) {
  let result = cache.get(fish);
  if (!result) {
    result = buildFishingVendorOptions(fish);
    cache.set(fish, result);
  }
  return result;
}