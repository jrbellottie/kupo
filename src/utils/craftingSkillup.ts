// Exact LSB era (CRAFT_MODERN_SYSTEM = false) crafting formulas, from
// LandSandBoat/server commit e3c398b ("Adds retail skill up chance weights and era skill up rates").
// Skill values are in tenths (e.g. 45.3 skill = 453) to mirror the server.

export type CraftSkillupStats = {
  /** Recipe cap minus truncated character skill level. */
  gap: number;
  /** False when the recipe is 16+ levels above skill (synth is refused). */
  craftable: boolean;
  /** True when a skill-up roll is possible at all (era: skill below recipe cap). */
  eligible: boolean;
  /** Chance the synth completes without breaking, 0-99. */
  successPct: number;
  /** Skill-up chance on a successful synth, percent. */
  chanceOnSuccessPct: number;
  /** Skill-up chance on a broken synth, percent (0 outside the 1-5 gap window). */
  chanceOnFailPct: number;
  /** Average skill gained per skill-up, in points (e.g. 0.13). */
  avgGain: number;
  /** Expected skill points gained per synth attempt, combining success and break. */
  expectedPerSynth: number;
  /** Estimated synth attempts to gain one full level at this skill. */
  synthsPerLevel: number;
};

// Percent chance of a +0.1 through +0.5 skill up given one occurred,
// indexed by gap (recipe level - floor(skill/10)), clamped to 0-14.
const SKILLUP_AMOUNT_WEIGHTS: number[][] = [
  [85, 15, 0, 0, 0], // 0
  [85, 15, 0, 0, 0], // 1
  [85, 15, 0, 0, 0], // 2
  [80, 20, 0, 0, 0], // 3
  [80, 20, 0, 0, 0], // 4
  [70, 30, 0, 0, 0], // 5
  [70, 30, 0, 0, 0], // 6
  [60, 40, 0, 0, 0], // 7
  [60, 40, 0, 0, 0], // 8
  [50, 40, 10, 0, 0], // 9
  [40, 40, 20, 0, 0], // 10
  [40, 40, 20, 0, 0], // 11
  [15, 45, 30, 10, 0], // 12
  [10, 40, 25, 25, 0], // 13
  [0, 40, 30, 20, 10], // 14+
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Chance a normal synth completes, before mods: 95% at/below cap, then drops with the gap. */
export function synthSuccessPct(gap: number): number {
  let rate = 95;
  if (gap >= 4) rate = 80 - 10 * (gap - 3);
  else if (gap >= 1) rate = 95 - 5 * gap;
  return clamp(rate, 0, 99);
}

/** Desynth completion chance: 40% at/below cap, dropping harder with the gap. */
export function desynthSuccessPct(gap: number, bonus = 0): number {
  let rate = 40;
  if (gap >= 8) rate = 10 - (10 * (gap - 7)) / 3;
  else if (gap >= 1) rate = 40 - 5 * (gap - 1);
  return clamp(rate + bonus, 0, 100);
}

/** Era flat skill-up chance: 60% below skill 50.0, 25% at 50.0 and above. */
export function eraSkillupChance(skillTenths: number): number {
  return skillTenths < 500 ? 0.6 : 0.25;
}

/** Average gain per skill-up in points; only +0.1 can happen at skill 60.0+. */
export function averageGainPerSkillup(skillTenths: number, gap: number): number {
  if (skillTenths >= 600) return 0.1;
  const weights = SKILLUP_AMOUNT_WEIGHTS[clamp(gap, 0, 14)];
  let tenths = 0;
  for (let i = 0; i < weights.length; i++) tenths += (weights[i] / 100) * (i + 1);
  return tenths / 10;
}

/**
 * @param supportSkill Extra skill levels from image support/gear (Mod::WOOD etc.). Per LSB,
 * this only lowers the difficulty used for the break check (getSynthDifficulty); skill-up
 * eligibility, chance, the fail window and gain weights all use real skill (doSynthSkillUp).
 * @param subCrafts Number of sub-crafts on the recipe. LSB rolls the break check once per
 * involved skill (calculateSynthResult), so each sub multiplies success by its own rate —
 * 95% for synths / 40% for desynths, assuming the sub requirement is met (difficulty <= 0).
 */
export function craftSkillupStats(
  skillTenths: number,
  recipeLvl: number,
  desynth: boolean,
  supportSkill = 0,
  subCrafts = 0
): CraftSkillupStats {
  const skill = clamp(Math.round(skillTenths), 0, 1100);
  const gap = recipeLvl - Math.floor(skill / 10);
  const craftable = skill >= recipeLvl * 10 - 150;
  const eligible = craftable && gap > 0 && skill < recipeLvl * 10;

  const breakGap = gap - supportSkill;
  const mainPct = desynth ? desynthSuccessPct(breakGap) : synthSuccessPct(breakGap);
  // Independent break roll per involved sub-craft, at its at-cap rate.
  const subPct = desynth ? 40 : 95;
  const successPct = mainPct * Math.pow(subPct / 100, subCrafts);

  if (!eligible) {
    return {
      gap,
      craftable,
      eligible: false,
      successPct,
      chanceOnSuccessPct: 0,
      chanceOnFailPct: 0,
      avgGain: 0,
      expectedPerSynth: 0,
      synthsPerLevel: Infinity,
    };
  }

  const baseChance = eraSkillupChance(skill);
  // Server divides by a penalty: +1 for desynth, +1 for a broken synth.
  const successPenalty = desynth ? 2 : 1;
  const failPenalty = successPenalty + 1;
  const chanceOnSuccess = baseChance / successPenalty;
  // A broken synth can only skill up inside the 1-5 gap window.
  const failCanSkillup = gap >= 1 && gap <= 5;
  const chanceOnFail = failCanSkillup ? baseChance / failPenalty : 0;

  const avgGain = averageGainPerSkillup(skill, gap);
  const pSuccess = successPct / 100;
  const expectedPerSynth = (pSuccess * chanceOnSuccess + (1 - pSuccess) * chanceOnFail) * avgGain;

  return {
    gap,
    craftable,
    eligible: true,
    successPct,
    chanceOnSuccessPct: chanceOnSuccess * 100,
    chanceOnFailPct: chanceOnFail * 100,
    avgGain,
    expectedPerSynth,
    synthsPerLevel: expectedPerSynth > 0 ? 1 / expectedPerSynth : Infinity,
  };
}
