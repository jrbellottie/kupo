import { printingEstimate, type PrintRecipe, type PrintSettings } from "./printing";

export const PRINT_QUANTITY_SECONDS_PER_SYNTH = 22;
export type PrintQuantityInput = { key: string; name: string; perAttempt: number; crystal: boolean };
export type PrintQuantityOutput = { key: string; name: string; perAttempt: number };
export type PrintQuantityPlan = { eligible: boolean; success: number; inputs: PrintQuantityInput[]; outputs: PrintQuantityOutput[] };

export function printingQuantityPlan(recipe: PrintRecipe, settings: PrintSettings, itemKey: (name: string) => string): PrintQuantityPlan {
  const estimate = printingEstimate(recipe, settings, () => null, () => 0);
  const inputs = new Map<string, PrintQuantityInput>();
  for (const input of estimate.inputs) {
    const key = itemKey(input.name);
    const existing = inputs.get(key);
    inputs.set(key, {
      key,
      name: existing?.name ?? input.name,
      perAttempt: (existing?.perAttempt ?? 0) + input.quantity * (input.crystal ? 1 : estimate.consumption),
      crystal: input.crystal || existing?.crystal === true,
    });
  }
  const outputs = new Map<string, PrintQuantityOutput>();
  for (const outcome of estimate.outcomes) {
    if (outcome.probability <= 0) continue;
    const key = itemKey(outcome.n);
    const existing = outputs.get(key);
    outputs.set(key, {
      key,
      name: existing?.name ?? outcome.n,
      perAttempt: (existing?.perAttempt ?? 0) + outcome.probability * outcome.q,
    });
  }
  return { eligible: estimate.eligible, success: estimate.success, inputs: [...inputs.values()], outputs: [...outputs.values()] };
}

export function printAttemptsForOutput(quantity: number, expectedOutputPerAttempt: number): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(expectedOutputPerAttempt) || expectedOutputPerAttempt <= 0) return null;
  const attempts = Math.ceil(quantity / expectedOutputPerAttempt);
  return Number.isFinite(attempts) ? attempts : null;
}

export function printAttemptsFromMaterials(inputs: PrintQuantityInput[], available: Record<string, number>): number | null {
  if (!inputs.length) return null;
  const limits = inputs.map((input) => {
    const amount = available[input.key];
    const quantity = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    return input.perAttempt > 0 ? quantity / input.perAttempt : Infinity;
  });
  const attempts = Math.floor(Math.min(...limits));
  return Number.isFinite(attempts) ? Math.max(0, attempts) : null;
}

export function printQuantityDurationSeconds(attempts: number | null): number | null {
  return attempts === null || !Number.isFinite(attempts) ? null : attempts * PRINT_QUANTITY_SECONDS_PER_SYNTH;
}

export function printQuantityStacks(quantity: number, stackSize: number): number | null {
  if (!Number.isFinite(quantity) || !Number.isFinite(stackSize) || stackSize <= 1) return null;
  return Number((Math.max(0, quantity) / stackSize).toFixed(4));
}

export function printQuantityFromStacks(stacks: number, stackSize: number): number {
  if (!Number.isFinite(stacks) || !Number.isFinite(stackSize) || stackSize <= 1) return 0;
  return Math.min(1_000_000_000, Math.max(0, Math.round(stacks * stackSize)));
}
