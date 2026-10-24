import { printingEstimate, validPrice, type PrintRecipe, type PrintSettings } from "./printing";

type PriceLookup = (name: string) => number | null;

// Desynthesis mechanics: src/map/utils/synthutils.cpp in the pinned source revision
// ace1415cf5643d8d45ff72067522d97f2ccb038f (calculateDesynthResult / handleMaterialLoss).
export function desynthesisEstimate(recipe: PrintRecipe, settings: PrintSettings, buy: PriceLookup, sell: PriceLookup) {
  if (recipe.d !== 1) throw new Error("A desynthesis recipe is required.");
  const personal = { ...settings, skillMode: "character" as const };
  const sale = (name: string) => {
    const price = sell(name);
    return validPrice(price) ? { unitPrice: price } : null;
  };
  return printingEstimate(recipe, personal, buy, sale);
}

export type DesynthesisBatchMode = "input-count" | "target-output";

export function desynthesisBatchEstimate(
  recipe: PrintRecipe,
  outcomes: { n: string; q: number; probability: number }[],
  outputName: string,
  count: number,
  mode: DesynthesisBatchMode,
) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const expectedOutputPerAttempt = outcomes.reduce((total, outcome) =>
    total + (outcome.n === outputName ? outcome.q * outcome.probability : 0), 0);
  const inputQuantity = recipe.ing[0]?.q ?? 1;
  const attempts = mode === "input-count"
    ? Math.floor(safeCount / inputQuantity)
    : safeCount === 0 ? 0 : expectedOutputPerAttempt > 0 ? Math.ceil(safeCount / expectedOutputPerAttempt) : null;
  return {
    expectedOutputPerAttempt,
    attempts,
    inputsNeeded: attempts === null ? null : attempts * inputQuantity,
    expectedOutput: attempts === null ? null : attempts * expectedOutputPerAttempt,
  };
}
