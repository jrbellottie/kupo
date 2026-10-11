import { RAISING } from "./chocoboRaising";

export const CHOCOBO_COLORS = ["yellow", "black", "blue", "red", "green"] as const;
export const PARASITE_WORM_ID = 2204;
export type ColorGoal = { eggId: number; wormsFed: number };
export type ColorOdds = Record<typeof CHOCOBO_COLORS[number], number>;
const genes = Array.from({ length: 125 }, (_, index) => [Math.floor(index / 25), Math.floor(index / 5) % 5, index % 5]);
const indexOf = (dna: number[]) => dna[0] * 25 + dna[1] * 5 + dna[2];

export function validateColorGoal(goal: ColorGoal): string | null {
  if (!RAISING.eggColorOdds.some(egg => egg.id === goal.eggId)) return "Choose the starting egg warmth for the non-yellow estimate. Bred or unknown eggs are not supported.";
  if (!Number.isSafeInteger(goal.wormsFed) || goal.wormsFed < 0) return "Enter a non-negative whole number of Parasite Worms actually eaten before day 19.";
  return null;
}

export function geneColor(dna: readonly number[]): number {
  if (dna.length !== 3 || dna.some(gene => !Number.isInteger(gene) || gene < 0 || gene > 4)) throw new Error("Color requires three valid genes.");
  for (const gene of dna) if (dna.filter(value => value === gene).length >= 2) return gene;
  return dna.includes(0) || !dna.includes(1) ? 0 : 1;
}

export function eggGeneDistribution(eggId: number): number[] {
  const egg = RAISING.eggColorOdds.find(egg => egg.id === eggId);
  if (!egg) throw new Error("Unknown starting egg for color calculation.");
  const distribution = Array<number>(125).fill(0);
  CHOCOBO_COLORS.forEach((color, shown) => {
    const chance = egg[color] / 100;
    distribution[indexOf([shown, shown, shown])] += chance * egg.genePatterns[0] / 100;
    const different = shown === 0 || shown === 1;
    const pairChance = chance * (egg.genePatterns[1] + (different ? 0 : egg.genePatterns[2])) / 100;
    for (let odd = 0; odd < 5; odd++) {
      if (odd === shown) continue;
      for (let slot = 0; slot < 3; slot++) {
        const dna = [shown, shown, shown];
        dna[slot] = odd;
        distribution[indexOf(dna)] += pairChance / 12;
      }
    }
    if (different) {
      const others = [0, 1, 2, 3, 4].filter(gene => gene !== shown && (shown !== 1 || gene !== 0));
      for (const second of others) for (const third of others) {
        if (second !== third) distribution[indexOf([shown, second, third])] += chance * egg.genePatterns[2] / 100 / (others.length * (others.length - 1));
      }
    }
  });
  return distribution;
}

function resetGene(distribution: number[], slot: number): number[] {
  const result = Array<number>(125).fill(0);
  distribution.forEach((probability, index) => {
    for (let color = 0; color < 5; color++) {
      const dna = [...genes[index]];
      dna[slot] = color;
      result[indexOf(dna)] += probability / 5;
    }
  });
  return result;
}

const basisCache = new Map<number, number[][]>();
function colorBasis(eggId: number): number[][] {
  const cached = basisCache.get(eggId);
  if (cached) return cached;
  const initial = eggGeneDistribution(eggId);
  const basis = Array.from({ length: 4 }, () => Array<number>(5).fill(0));
  for (let mask = 0; mask < 8; mask++) {
    let distribution = initial;
    let count = 0;
    for (let slot = 0; slot < 3; slot++) if (mask & (1 << slot)) {
      distribution = resetGene(distribution, slot);
      count++;
    }
    distribution.forEach((probability, index) => {
      basis[count][geneColor(genes[index])] += probability / (count === 1 || count === 2 ? 3 : 1);
    });
  }
  basisCache.set(eggId, basis);
  return basis;
}

export function chocoboColorOdds(eggId: number, worms: number): ColorOdds {
  const error = validateColorGoal({ eggId, wormsFed: worms });
  if (error) throw new Error(error);
  const none = worms === 0 ? 1 : 0;
  const one = (1 / 3) ** worms;
  const two = (2 / 3) ** worms;
  // Probability that exactly 0, 1, 2 or 3 distinct slots have been rerolled.
  const weights = [none, 3 * (one - none), 3 * (two - 2 * one + none), 1 - 3 * two + 3 * one - none];
  const basis = colorBasis(eggId);
  const probability = (color: number) => weights.reduce((sum, weight, count) => sum + weight * basis[count][color], 0);
  return { yellow: probability(0), black: probability(1), blue: probability(2), red: probability(3), green: probability(4) };
}

export function colorStrategy(goal: ColorGoal, maxAdditionalWorms: number) {
  const error = validateColorGoal(goal);
  if (error) throw new Error(error);
  if (!Number.isInteger(maxAdditionalWorms) || maxAdditionalWorms < 0 || maxAdditionalWorms > 60) throw new Error("The color search supports at most four items on each of the 15 chick days.");
  const options = Array.from({ length: maxAdditionalWorms + 1 }, (_, worms) => ({
    worms, odds: chocoboColorOdds(goal.eggId, goal.wormsFed + worms),
  }));
  const best = options.reduce((best, option) => option.odds.yellow < best.odds.yellow - 1e-12 ? option : best);
  return { before: options[0].odds, options, best };
}
