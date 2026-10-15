import { createPrintingChain, type SourceChoices } from "./printingChain";
import { validPrice, type PrintRecipe, type PrintSettings } from "./printing";

type PriceBook = Record<string, number>;
type PlannerState = {
  settings: PrintSettings; buy: PriceBook; sell: PriceBook; sources: SourceChoices;
  costOverrides?: PriceBook;
  vendors: boolean; modernGuilds: boolean; wotg: boolean; keyItems: boolean;
};
const changedPrices = (previous: PriceBook, next: PriceBook) => [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter((key) => previous[key] !== next[key]);

export function createPrintingPlanner(recipes: PrintRecipe[], itemKey: (name: string) => string,
  buyPrice: (name: string, book: PriceBook, vendors: boolean, modernGuilds: boolean) => number | null,
  sellPrice: (name: string, book: PriceBook) => number | null) {
  let cached: { configuration: string; buy: PriceBook; sell: PriceBook; available: PrintRecipe[]; chain: ReturnType<typeof createPrintingChain> } | undefined;
  return (state: PlannerState) => {
    const sources = { ...state.sources };
    const buyBook = { ...state.buy };
    for (const [key, price] of Object.entries(state.costOverrides ?? {})) {
      if (!validPrice(price)) throw new Error(`Invalid cost override for ${key}. Enter a non-negative gil amount.`);
      sources[key] = "buy";
      buyBook[key] = price;
    }
    const configuration = JSON.stringify([state.settings, sources, state.vendors, state.modernGuilds, state.wotg, state.keyItems]);
    const buy = (name: string) => buyPrice(name, buyBook, state.vendors, state.modernGuilds);
    const sell = (name: string) => sellPrice(name, state.sell);
    if (!cached || cached.configuration !== configuration) {
      const available = recipes.filter((recipe) => (state.wotg || recipe.era !== "WotG") && (state.keyItems || !recipe.ki));
      cached = { configuration, buy: buyBook, sell: state.sell, available, chain: createPrintingChain(available, state.settings, buy, sell, itemKey, sources) };
    } else {
      const changedBuy = changedPrices(cached.buy, buyBook);
      const changedSell = changedPrices(cached.sell, state.sell);
      if (changedBuy.length || changedSell.length) cached = { ...cached, buy: buyBook, sell: state.sell, chain: cached.chain.reprice(buy, sell, changedBuy, changedSell) };
    }
    return cached;
  };
}