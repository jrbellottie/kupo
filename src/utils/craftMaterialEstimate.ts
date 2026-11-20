import { craftSkillupAmountDistribution, craftSkillupStats } from "./craftingSkillup";

export type MaterialRecipe = {
  id: number;
  craft: string;
  lvl: number;
  crystal: string;
  ing: { n: string; q: number }[];
  res: { n: string; q: number };
  hq: { n: string; q: number }[];
  subs?: { c: string; l: number }[];
  d?: number;
};

export type CraftMaterialEstimate = {
  reachable: boolean;
  craftAttempts: number;
  desynthAttempts: number;
  totalAttempts: number;
  desynthInputs: number;
  materials: { name: string; quantity: number }[];
  breakRateAtStart: number;
  maximumSkill: number;
};

type AttemptOutcome = { success: boolean; gain: number; probability: number };
type SkillOutcomes = { outcomes: AttemptOutcome[]; successProbability: number };
type Episode = {
  transitions: Map<number, number>;
  craftAttempts: number;
  desynthAttempts: number;
  desynthInputs: number;
  materials: Map<string, number>;
};
type Expected = {
  craftAttempts: number;
  desynthAttempts: number;
  desynthInputs: number;
  materials: Map<string, number>;
};

const CRAFT_ORDER = ["Woodworking", "Smithing", "Goldsmithing", "Clothcraft", "Leathercraft", "Bonecraft", "Alchemy", "Cooking"];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const add = (map: Map<string, number>, name: string, quantity: number) =>
  map.set(name, (map.get(name) ?? 0) + quantity);

function attemptOutcomes(recipe: MaterialRecipe, skill: number, desynth: boolean, support: number): SkillOutcomes {
  const stats = craftSkillupStats(skill, recipe.lvl, desynth, support, recipe.subs?.length ?? 0);
  const successProbability = stats.successPct / 100;
  const successSkillup = stats.chanceOnSuccessPct / 100;
  const failSkillup = stats.chanceOnFailPct / 100;
  const gains = craftSkillupAmountDistribution(skill, stats.gap);
  const outcomes: AttemptOutcome[] = [];
  for (let index = 0; index < gains.length; index++) {
    const gain = index + 1;
    if (gains[index] > 0) {
      outcomes.push({ success: true, gain, probability: successProbability * successSkillup * gains[index] });
      outcomes.push({ success: false, gain, probability: (1 - successProbability) * failSkillup * gains[index] });
    }
  }
  outcomes.push({ success: true, gain: 0, probability: successProbability * (1 - successSkillup) });
  outcomes.push({ success: false, gain: 0, probability: (1 - successProbability) * (1 - failSkillup) });
  return { outcomes: outcomes.filter((outcome) => outcome.probability > 0), successProbability };
}

function expectedMaterialFraction(recipe: MaterialRecipe, skill: number, support: number, desynth: boolean): number {
  const mainStats = craftSkillupStats(skill, recipe.lvl, desynth, support, 0);
  const mainSuccess = mainStats.successPct / 100;
  const checks = [
    {
      craft: recipe.craft,
      success: mainSuccess,
      difficulty: Math.max(0, recipe.lvl - Math.floor(skill / 10) - support),
    },
    ...(recipe.subs ?? []).map((sub) => ({
      craft: sub.c,
      success: desynth ? 0.4 : 0.95,
      difficulty: 0,
    })),
  ].sort((a, b) => CRAFT_ORDER.indexOf(a.craft) - CRAFT_ORDER.indexOf(b.craft));

  let priorSuccess = 1;
  let expectedLoss = 0;
  for (const check of checks) {
    const loss = clamp(50 + 5 * check.difficulty, 20, 100) / 100;
    expectedLoss += priorSuccess * (1 - check.success) * loss;
    priorSuccess *= check.success;
  }
  return recipe.d === 2 ? priorSuccess : mainSuccess + expectedLoss;
}

function buildEpisode(
  recipe: MaterialRecipe,
  desynthRecipe: MaterialRecipe | null,
  skill: number,
  target: number,
  support: number,
  useLoop: boolean,
): Episode {
  const craft = attemptOutcomes(recipe, skill, false, support);
  const transitions = new Map<number, number>();
  const materials = new Map<string, number>();
  const craftConsumption = expectedMaterialFraction(recipe, skill, support, false);

  for (const ingredient of recipe.ing) add(materials, ingredient.n, ingredient.q * craftConsumption);
  add(materials, `${recipe.crystal} Crystal`, 1);

  let desynthAttempts = 0;
  let desynthInputs = 0;
  for (const craftOutcome of craft.outcomes) {
    const afterCraft = Math.min(target, skill + craftOutcome.gain);
    if (!useLoop || !craftOutcome.success || afterCraft >= target || !desynthRecipe) {
      const gain = afterCraft - skill;
      transitions.set(gain, (transitions.get(gain) ?? 0) + craftOutcome.probability);
      continue;
    }

    desynthAttempts += craftOutcome.probability;
    const desynth = attemptOutcomes(desynthRecipe, afterCraft, true, support);
    const desynthConsumption = expectedMaterialFraction(desynthRecipe, afterCraft, support, true);
    desynthInputs += craftOutcome.probability * (desynthRecipe.ing[0]?.q ?? 1) * desynthConsumption;
    add(materials, `${desynthRecipe.crystal} Crystal`, craftOutcome.probability);
    for (const ingredient of desynthRecipe.ing) {
      if (ingredient.n !== recipe.res.n) {
        add(materials, ingredient.n, craftOutcome.probability * ingredient.q * desynthConsumption);
      }
    }
    for (const desynthOutcome of desynth.outcomes) {
      const afterDesynth = Math.min(target, afterCraft + desynthOutcome.gain);
      const gain = afterDesynth - skill;
      transitions.set(gain, (transitions.get(gain) ?? 0) + craftOutcome.probability * desynthOutcome.probability);
    }
  }

  return {
    transitions,
    craftAttempts: 1,
    desynthAttempts,
    desynthInputs,
    materials,
  };
}

/**
 * Expected material requirements to reach a target skill. Skill-up rolls are
 * modeled as a Markov process at each tenth of skill, so changing rates as
 * skill approaches the recipe cap are included rather than held constant.
 */
export function estimateCraftMaterials(
  recipe: MaterialRecipe,
  currentSkillTenths: number,
  targetSkillTenths: number,
  supportSkill = 0,
  desynthRecipe: MaterialRecipe | null = null,
): CraftMaterialEstimate {
  const current = clamp(Math.round(currentSkillTenths), 0, 1100);
  const target = clamp(Math.round(targetSkillTenths), 0, 1100);
  const support = clamp(Math.round(supportSkill), 0, 30);
  const useLoop = desynthRecipe !== null;
  const maximumSkill = Math.min(recipe.lvl, useLoop ? desynthRecipe.lvl : recipe.lvl);
  const breakRateAtStart = 100 - craftSkillupStats(current, recipe.lvl, false, support, recipe.subs?.length ?? 0).successPct;

  if (target <= current) {
    return { reachable: true, craftAttempts: 0, desynthAttempts: 0, totalAttempts: 0, desynthInputs: 0, materials: [], breakRateAtStart, maximumSkill };
  }
  if (target > maximumSkill * 10 || !craftSkillupStats(current, recipe.lvl, false, support, recipe.subs?.length ?? 0).craftable) {
    return { reachable: false, craftAttempts: Infinity, desynthAttempts: Infinity, totalAttempts: Infinity, desynthInputs: 0, materials: [], breakRateAtStart, maximumSkill };
  }
  if (useLoop && (desynthRecipe.d !== 1 || desynthRecipe.ing[0]?.n !== recipe.res.n || desynthRecipe.craft !== recipe.craft)) {
    return { reachable: false, craftAttempts: Infinity, desynthAttempts: Infinity, totalAttempts: Infinity, desynthInputs: 0, materials: [], breakRateAtStart, maximumSkill };
  }

  const expected = new Array<Expected>(target + 1);
  expected[target] = { craftAttempts: 0, desynthAttempts: 0, desynthInputs: 0, materials: new Map() };
  for (let skill = target - 1; skill >= current; skill--) {
    const episode = buildEpisode(recipe, desynthRecipe, skill, target, support, useLoop);
    const progressProbability = [...episode.transitions].reduce((sum, [gain, probability]) => sum + (gain > 0 ? probability : 0), 0);
    if (progressProbability <= 0) {
      return { reachable: false, craftAttempts: Infinity, desynthAttempts: Infinity, totalAttempts: Infinity, desynthInputs: 0, materials: [], breakRateAtStart, maximumSkill };
    }

    const value: Expected = {
      craftAttempts: episode.craftAttempts,
      desynthAttempts: episode.desynthAttempts,
      desynthInputs: episode.desynthInputs,
      materials: new Map(episode.materials),
    };
    for (const [gain, probability] of episode.transitions) {
      if (gain <= 0) continue;
      const next = expected[Math.min(target, skill + gain)];
      const weighted = probability;
      value.craftAttempts += weighted * next.craftAttempts;
      value.desynthAttempts += weighted * next.desynthAttempts;
      value.desynthInputs += weighted * next.desynthInputs;
      for (const [name, quantity] of next.materials) add(value.materials, name, weighted * quantity);
    }
    value.craftAttempts /= progressProbability;
    value.desynthAttempts /= progressProbability;
    value.desynthInputs /= progressProbability;
    for (const [name, quantity] of value.materials) value.materials.set(name, quantity / progressProbability);
    expected[skill] = value;
  }

  const result = expected[current];
  return {
    reachable: true,
    craftAttempts: result.craftAttempts,
    desynthAttempts: result.desynthAttempts,
    totalAttempts: result.craftAttempts + result.desynthAttempts,
    desynthInputs: result.desynthInputs,
    materials: [...result.materials].map(([name, quantity]) => ({ name, quantity })),
    breakRateAtStart,
    maximumSkill,
  };
}
