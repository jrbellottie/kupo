import { desynthSuccessPct, synthSuccessPct } from "./craftingSkillup";

export const PRINT_CRAFTS = ["Woodworking", "Smithing", "Goldsmithing", "Clothcraft", "Leathercraft", "Bonecraft", "Alchemy", "Cooking"];
export const HQ_GAPS = [0, 11, 31, 51];
export const DEFAULT_HQ_RATES = [1.5625, 6.25, 25, 50];
export const printGil = (amount: number | null) => amount === null ? "Needs price" : amount.toLocaleString(undefined, { maximumFractionDigits: 1 });
export const printUnits = (amount: number) => amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
export const printPct = (amount: number) => `${(amount * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
export const printTone = (amount: number | null) => amount === null ? "print-muted" : amount > 0 ? "print-profit" : amount < 0 ? "print-loss" : "";
export type PrintRecipe = { id: number; craft: string; lvl: number; crystal: string; era: string; ing: { n: string; q: number }[]; res: { n: string; q: number }; hq: { n: string; q: number }[]; subs?: { c: string; l: number }[]; d?: number; ki?: boolean };
export type PrintSettings = { skillMode?: "at-cap" | "character"; lossMode?: "skill" | "fixed"; lossDefaultVersion?: number; skills: Record<string, number>; bonuses: Record<string, number>; hqRates: number[]; lossPct: number; seconds: number; overhead: number; sellMultiplier: number; successBonus: number; desynthSuccessBonus?: number; desynthHqRate?: number };
export type PrintSettingsUpdate = Partial<PrintSettings> | ((current: PrintSettings) => Partial<PrintSettings>);
export const DEFAULT_PRINT_SETTINGS: PrintSettings = { skillMode: "at-cap", lossMode: "skill", skills: {}, bonuses: {}, hqRates: DEFAULT_HQ_RATES, lossPct: 50, lossDefaultVersion: 1, seconds: 21, overhead: 0, sellMultiplier: 100, successBonus: 0, desynthSuccessBonus: 0, desynthHqRate: 60 };
export function restorePrintSettings(saved: Partial<PrintSettings> = {}): PrintSettings {
  return { ...DEFAULT_PRINT_SETTINGS, ...saved, skillMode: saved.skillMode ?? "at-cap",
    lossMode: saved.lossMode ?? (saved.lossPct === undefined ? "skill" : "fixed"), lossDefaultVersion: 1,
    lossPct: saved.lossDefaultVersion === undefined && saved.lossPct === 100 ? DEFAULT_PRINT_SETTINGS.lossPct : saved.lossPct ?? DEFAULT_PRINT_SETTINGS.lossPct };
}
export type PricedInput = { name: string; quantity: number; price: number | null; crystal: boolean };
export type SalePrice = number | null | { unitPrice: number };
export const validPrice = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function printingChances(recipe: PrintRecipe, settings: PrintSettings, tierOverride?: number) {
  const required = [{ c: recipe.craft, l: recipe.lvl }, ...(recipe.subs ?? [])];
  const requirements = required.map(({ c, l }) => {
    if (settings.skillMode === "at-cap") {
      const effective = l + HQ_GAPS[tierOverride ?? 0];
      return { craft: c, cap: l, skill: effective, effective, gap: effective - l, eligible: true };
    }
    const skill = Math.floor(clamp(settings.skills[c] ?? 0, 0, 110));
    const effective = skill + clamp(settings.bonuses[c] ?? 0, 0, 30);
    return { craft: c, cap: l, skill, effective, gap: effective - l, eligible: skill >= l - 15 };
  });
  const eligible = requirements.every((requirement) => requirement.eligible);
  const limitingGap = Math.min(...requirements.map((requirement) => requirement.gap));
  const actualTier = limitingGap < 0 ? -1 : limitingGap < 11 ? 0 : limitingGap < 31 ? 1 : limitingGap < 51 ? 2 : 3;
  const tier = tierOverride ?? actualTier;
  const desynth = recipe.d === 1;
  const skillSuccess = requirements.map((requirement) => {
    if (tierOverride === undefined || desynth) {
      const difficulty = -requirement.gap;
      if (desynth) return desynthSuccessPct(difficulty, settings.desynthSuccessBonus ?? 0) / 100;
      const base = difficulty >= 4 ? 80 - 10 * (difficulty - 3) : synthSuccessPct(difficulty);
      return clamp(base + settings.successBonus, 0, 99) / 100;
    }
    return clamp(95 + settings.successBonus, 0, 99) / 100;
  });
  const success = skillSuccess.reduce((chance, value) => chance * value, 1);
  const hq = desynth ? clamp(settings.desynthHqRate ?? 60, 0, 80) / 100
    : tier < 0 ? 0 : clamp(settings.hqRates[tier] ?? DEFAULT_HQ_RATES[tier], 0, 80) / 100;
  const distribution = desynth ? [1 - hq, hq / 2, hq / 3, hq / 6]
    : tier <= 0 ? [1 - hq, hq, 0, 0] : tier === 1 ? [1 - hq, hq * 0.75, hq * 0.25, 0] : [1 - hq, hq * 0.75, hq * 0.1875, hq * 0.0625];
  return { eligible, requirements, limitingGap, tier, success, skillSuccess, hq, distribution };
}

export function isPrintRecipeAvailable(recipe: PrintRecipe, settings: PrintSettings): boolean {
  const chances = printingChances(recipe, settings);
  return chances.eligible && chances.success > 0;
}

export function printingEstimate(recipe: PrintRecipe, settings: PrintSettings, buy: (name: string) => number | null, sell: (name: string) => SalePrice, tierOverride?: number) {
  const chances = printingChances(recipe, settings, tierOverride);
  const outcomes = [recipe.res, ...Array.from({ length: 3 }, (_, index) => recipe.hq[index] ?? recipe.res)].map((item, index) => {
    const sale = sell(item.n);
    const quoted = sale !== null && typeof sale === "object";
    const price = quoted ? sale.unitPrice : sale;
    const adjusted = validPrice(price) ? price * clamp(settings.sellMultiplier, 0, 1000) / 100 : null;
    // Quotes can be fractional unit prices from stacks; only NPC base payouts round down.
    const payout = adjusted === null ? null : quoted ? adjusted : Math.floor(adjusted);
    return { ...item, price: payout, probability: chances.success * chances.distribution[index], conditional: chances.distribution[index] };
  });
  const missingSales = outcomes.filter((item) => item.probability > 0 && item.price === null).map((item) => item.n);
  const revenue = missingSales.length ? null : outcomes.reduce((total, item) => total + item.probability * item.q * (item.price ?? 0), 0);
  let priorSuccess = 1;
  let expectedLoss = 0;
  // The first failed craft roll determines the material-loss difficulty.
  const craftOrder = chances.requirements.map((requirement, index) => ({ ...requirement, index }))
    .sort((a, b) => PRINT_CRAFTS.indexOf(a.craft) - PRINT_CRAFTS.indexOf(b.craft));
  for (const requirement of craftOrder) {
    const success = chances.skillSuccess[requirement.index];
    const difficulty = tierOverride !== undefined && recipe.d !== 1 ? 0 : Math.max(0, -requirement.gap);
    const loss = settings.lossMode === "skill" ? clamp(50 + 5 * difficulty, 20, 100) : clamp(settings.lossPct, 0, 100);
    expectedLoss += priorSuccess * (1 - success) * loss / 100;
    priorSuccess *= success;
  }
  const consumption = chances.success + (recipe.d === 2 ? 0 : expectedLoss);
  const inputs: PricedInput[] = [
    ...recipe.ing.map((item) => ({ name: item.n, quantity: item.q, price: buy(item.n), crystal: false })),
    { name: `${recipe.crystal} Crystal`, quantity: 1, price: buy(`${recipe.crystal} Crystal`), crystal: true },
  ];
  const missing = inputs.filter((input) => !validPrice(input.price)).map((input) => input.name);
  const knownCost = inputs.reduce((total, input) => total + (input.price ?? 0) * input.quantity * (input.crystal ? 1 : consumption), 0);
  const cost = missing.length ? null : knownCost;
  const upfront = missing.length ? null : inputs.reduce((total, input) => total + (input.price ?? 0) * input.quantity, 0);
  const profit = revenue !== null && cost !== null ? revenue - cost : null;
  const attemptsPerHour = 3600 / (clamp(settings.seconds, 1, 3600) + clamp(settings.overhead, 0, 3600));
  const ceilings = inputs.map((input, index) => {
    const others = inputs.filter((_, otherIndex) => otherIndex !== index);
    const otherCost = others.reduce((total, other) => total + (other.price ?? 0) * other.quantity * (other.crystal ? 1 : consumption), 0);
    const factor = input.quantity * (input.crystal ? 1 : consumption);
    const maximum = revenue !== null && factor > 0 && others.every((other) => validPrice(other.price)) ? (revenue - otherCost) / factor : null;
    return { ...input, maximum };
  });
  const crystalPrice = inputs[inputs.length - 1].price;
  const materialBudget = revenue !== null && validPrice(crystalPrice) && consumption > 0 ? (revenue - crystalPrice) / consumption : null;
  return { ...chances, outcomes, inputs, missing, missingSales, revenue, cost, upfront, knownCost, profit, gilPerHour: profit === null ? null : profit * attemptsPerHour, attemptsPerHour, consumption, ceilings, materialBudget };
}