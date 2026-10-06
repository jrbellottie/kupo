export type SkillupRod = {
  rodId: number;
  rod: string;
  era: string;
  size: string;
  legendary: boolean;
  breakable: boolean;
  minRank: number;
  maxRank: number;
  rating: number;
  fishAttack: number;
  lgdBonusAttack: number;
  fishRecovery: number;
  fishTime: number;
  lgdBonusTime: number;
  multiplier: number;
};

export type SkillupFish = {
  fish: string;
  skillCap: number;
  ranking: number;
  size: string;
  legendary: boolean;
  item?: boolean;
};

export type RodRisk = {
  snapPct: number;
  breakPct: number;
  escapePct: number;
  landPct: number;
  skillupResolvePct: number;
};

const CITY_ZONES = new Set([
  "Aht Urhgan Whitegate",
  "Al Zahbi",
  "Bastok Markets",
  "Bastok Mines",
  "Port Bastok",
  "Heavens Tower",
  "Kazham",
  "Mhaura",
  "Nashmau",
  "Norg",
  "Southern San dOria",
  "Northern San dOria",
  "Port San dOria",
  "Rabao",
  "Selbina",
  "Tavnazian Safehold",
  "Windurst Walls",
  "Windurst Waters",
  "Windurst Woods",
  "Port Windurst",
  "Lower Jeuno",
  "Port Jeuno",
  "Upper Jeuno",
]);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const sizeRank = (size: string) => (size === "L" ? 1 : 0);

export type HookFish = SkillupFish & { hookBonus: number; rarity: number; shellfish?: boolean; moonPattern?: number };

export type FishingMoonPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function getFishingMoonPhase(moonStep: number): FishingMoonPhase {
  if (!Number.isInteger(moonStep) || moonStep < 0 || moonStep >= 200) {
    throw new RangeError("Fishing moon step must be an integer from 0 to 199");
  }
  const phase = moonStep <= 100 ? moonStep : 200 - moonStep;
  const waxing = moonStep > 0 && moonStep < 100;
  const waning = moonStep > 100;
  // Use the source's fishing thresholds, including its new-moon fallback in gaps.
  if (phase <= 5 || (phase <= 10 && waning)) return 0;
  if (phase >= 7 && phase <= 38 && waxing) return 1;
  if (phase >= 40 && phase <= 55 && waxing) return 2;
  if (phase >= 57 && phase <= 88 && waxing) return 3;
  if (phase >= 95 || (phase >= 90 && waxing)) return 4;
  if (phase >= 62 && phase <= 93 && waning) return 5;
  if (phase >= 45 && phase <= 60 && waning) return 6;
  if (phase >= 12 && phase < 43 && waning) return 7;
  return 0;
}

function moonPatternModifier(pattern: number, phase: FishingMoonPhase): number {
  if (!Number.isInteger(pattern) || pattern < 0 || pattern > 5) {
    throw new RangeError("Fishing moon pattern must be an integer from 0 to 5");
  }
  if (pattern === 0) return 1;
  // MOONPATTERN_3 divides integer phase indices in the pinned source.
  if (pattern === 3) return 1 - Math.floor(phase / 7);
  const [frequency, offset] = pattern === 1 ? [1.75, 0.1]
    : pattern === 2 ? [1.75, 3.3] : pattern === 4 ? [0.9, 3.14] : [0.9, 0];
  const angle = Math.fround(Math.fround(Math.fround(frequency) * phase) + Math.fround(offset));
  return clamp(Math.fround(Math.fround(0.5 * Math.fround(Math.cos(angle))) + 0.5), 0, 1);
}

export function calculateHookWeight(skill: number, fish: HookFish, rod: SkillupRod, shellfishBait = false, moonPhase?: FishingMoonPhase): number {
  if (fish.skillCap - skill > 100) return 0;
  // The source routes fish pattern 5 through pattern 4 as well.
  const pattern = fish.moonPattern === 5 ? 4 : fish.moonPattern ?? 0;
  const moon = moonPhase === undefined ? 1 : moonPatternModifier(pattern, moonPhase);
  const moonModifier = Math.fround(Math.fround(moon + 0.25) * 3);
  const modifier = Math.fround(Math.fround(Math.fround(moonModifier + 1.5) + 0.75) / 3);
  let weight = Math.floor(Math.fround(25 * modifier)) + fish.hookBonus;
  weight -= Math.min(weight, Math.floor(Math.max(0, fish.skillCap - skill) * 0.25));
  weight -= Math.min(weight, Math.floor(Math.max(0, skill - 10 - fish.skillCap) * 0.15));
  if (!rod.legendary && fish.size !== rod.size) weight -= Math.min(weight, fish.size === "S" ? 3 : 5);
  if (shellfishBait && fish.shellfish) weight += 50;
  return clamp(Math.floor(Math.fround(weight * Math.fround(fish.rarity))), 20, 120);
}

export function calculateCastOdds(
  skill: number,
  rod: SkillupRod,
  fish: HookFish[],
  options: { city: boolean; hasItems: boolean; hasMobs: boolean; difficulty: number; poorFish?: boolean; shellfishBait?: boolean; moonPhase?: FishingMoonPhase },
) {
  const weights = fish.map(member => calculateHookWeight(skill, member, rod, options.shellfishBait, options.moonPhase));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const moonWeight = (weight: number, pattern: number) => options.moonPhase === undefined
    ? weight : Math.floor(Math.fround(weight * moonPatternModifier(pattern, options.moonPhase)));
  const fishBonus = moonWeight(options.city ? 15 : 25, 4);
  let fishWeight = total ? clamp(Math.max(...weights) + fishBonus, 10, 120) : fishBonus;
  let itemWeight = options.city ? 25 + moonWeight(20, 2) : 10 + moonWeight(15, 2);
  let mobWeight = options.city ? 0 : 15 + moonWeight(15, 3);
  let nothingWeight = (options.city ? 30 + moonWeight(15, 5) : 15 + moonWeight(20, 5)) + options.difficulty * 24.5;
  if (options.poorFish) {
    fishWeight -= Math.floor(fishWeight * 0.25);
    itemWeight = fishWeight + Math.floor(fishWeight * 0.1);
    nothingWeight += Math.floor(nothingWeight * 0.25);
  }
  if (!total) { nothingWeight += Math.floor(fishWeight / 2); fishWeight = 0; }
  if (!options.hasItems) { nothingWeight += Math.floor(itemWeight / 2); itemWeight = 0; }
  if (!options.hasMobs) { nothingWeight += Math.floor(mobWeight / 2); mobWeight = 0; }
  const odds = { fishPct: 0, itemPct: 0, mobPct: 0, nothingPct: 0, targetPct: fish.map(() => 0) };
  const selections = total ? weights.map(weight => weight / total) : [1];
  for (let index = 0; index < selections.length; index++) {
    let selectedFishWeight = fishWeight;
    const member = fish[index];
    if (total && member && (rod.rodId === 17386 || rod.rodId === 17011) && skill > member.skillCap + 7) {
      const difference = skill - member.skillCap;
      const luShang = rod.rodId === 17386;
      selectedFishWeight += (luShang ? 10 : 15) + Math.floor(difference * (1 + Math.floor(difference / (luShang ? 15 : 13))) / (sizeRank(member.size) + 1));
    }
    const denominator = selectedFishWeight + itemWeight + mobWeight + nothingWeight;
    const scale = 100 * selections[index] / denominator;
    odds.fishPct += selectedFishWeight * scale;
    odds.itemPct += itemWeight * scale;
    odds.mobPct += mobWeight * scale;
    odds.nothingPct += nothingWeight * scale;
    if (total) odds.targetPct[index] = selectedFishWeight * scale;
  }
  return odds;
}

export function isCityFishingZone(zone: string): boolean {
  return CITY_ZONES.has(zone.replace(/'/g, ""));
}

export function getRodHiddenSuccessBonus(_rodName: string): number {
  return 0;
}

export function calculateRodRisk(effectiveSkill: number, fish: SkillupFish, rod: SkillupRod): RodRisk {
  let snapPenalty = !rod.legendary && sizeRank(fish.size) > sizeRank(rod.size) ? 2 : 0;
  let snapBonus = 0;
  if (fish.legendary) {
    if (rod.legendary) snapBonus = 1;
    else snapPenalty += 3;
  }
  const durability = (rod.maxRank + snapBonus - snapPenalty) & 255;
  const snapPct = fish.ranking > durability
    ? Math.min(55, (fish.ranking - durability) * 19)
    : 0;

  let breakPct = 0;
  if (rod.breakable) {
    let breakPenalty = 0;
    let breakBonus = 0;
    if (!rod.legendary && sizeRank(fish.size) > sizeRank(rod.size)) breakPenalty = 2;
    else if (rod.legendary && fish.size === "L") breakBonus = 1;
    if (!rod.legendary && fish.legendary) breakPenalty = 5;
    const threshold = rod.maxRank + breakBonus;
    breakPct = fish.ranking > threshold
      ? Math.min(20, (fish.ranking - threshold + breakPenalty) * 10)
      : 0;
  }

  let sizeChance = 0;
  if (!rod.legendary && sizeRank(fish.size) > sizeRank(rod.size) && fish.ranking > rod.maxRank) {
    sizeChance = clamp(50 + fish.skillCap - effectiveSkill, 0, 50);
  } else if (!rod.legendary && sizeRank(fish.size) < sizeRank(rod.size)) {
    sizeChance = Math.min(90, Math.floor(Math.fround(fish.skillCap * Math.fround(1.8))));
  }
  const lowSkillChance = fish.item ? 0 : effectiveSkill + 50 <= fish.skillCap ? 100
    : effectiveSkill + 7 < fish.skillCap ? Math.floor(Math.fround((fish.skillCap - effectiveSkill - 7) * Math.fround(0.8))) : 0;
  const escapePct = clamp(Math.max(sizeChance, lowSkillChance), 0, 100);

  const landPct = 100 * (1 - escapePct / 100) * (1 - snapPct / 100) * (1 - breakPct / 100);
  return { snapPct, breakPct, escapePct, landPct, skillupResolvePct: 100 - escapePct };
}

export type FishingTiming = { fishSeconds: number; otherSeconds: number };
export const DEFAULT_FISHING_TIMING: FishingTiming = { fishSeconds: 30, otherSeconds: 20 };

export function calculateCatchTime({ fishPct, targetPct, landPct }: { fishPct: number; targetPct: number; landPct: number }, timing: FishingTiming = DEFAULT_FISHING_TIMING): number | null {
  if (![fishPct, targetPct, landPct].every(value => Number.isFinite(value) && value >= 0 && value <= 100)
    || targetPct > fishPct || targetPct === 0 || landPct === 0) return null;
  if (![timing.fishSeconds, timing.otherSeconds].every(value => Number.isFinite(value) && value > 0)) return null;
  const averageCastSeconds = timing.fishSeconds * fishPct / 100 + timing.otherSeconds * (1 - fishPct / 100);
  const targetLandedPerCast = targetPct / 100 * landPct / 100;
  return 200 * averageCastSeconds / targetLandedPerCast;
}

export function calculatePoolCatch(
  effectiveSkill: number, rod: SkillupRod, fish: HookFish[], targetPct: number[], fishPct: number,
  timing: FishingTiming = DEFAULT_FISHING_TIMING,
) {
  const landedPct = fish.map((member, index) => targetPct[index] * calculateRodRisk(effectiveSkill, member, rod).landPct / 100);
  const totalLandedPct = landedPct.reduce((sum, value) => sum + value, 0);
  const valid = targetPct.length === fish.length && targetPct.every(value => Number.isFinite(value) && value >= 0 && value <= 100)
    && Number.isFinite(fishPct) && fishPct >= 0 && fishPct <= 100
    && Math.abs(targetPct.reduce((sum, value) => sum + value, 0) - fishPct) < 1e-8
    && totalLandedPct > 0;
  return {
    catchTimeSeconds: valid ? calculateCatchTime({ fishPct, targetPct: Math.min(fishPct, totalLandedPct), landPct: 100 }, timing) : null,
    catches: landedPct.map(value => valid ? 200 * value / totalLandedPct : null),
  };
}

export function formatCatchTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Not catchable";
  const minutes = Math.ceil(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function calculateFishingFight(skill: number, fish: SkillupFish, rod: SkillupRod, baitKind = "Bait", allowEpicLures = false) {
  const risk = calculateRodRisk(skill, fish, rod);
  const warning = fishingWarningOdds(risk);
  const cancelBad = baitKind === "Lure" && !(allowEpicLures && fish.size === "L");
  if (cancelBad && fish.size === "L") return { attemptedPct: 0, landPct: 0, skillupResolvePct: 0 };
  return {
    attemptedPct: cancelBad ? 100 * (1 - warning.bad) : 100,
    landPct: cancelBad ? risk.landPct - 100 * warning.badLand : risk.landPct,
    skillupResolvePct: cancelBad ? risk.skillupResolvePct - 100 * warning.bad : risk.skillupResolvePct,
  };
}

export function calculatePoolSession({ baseSkill, bonusSkill, zone, rod, fish, options, baitKind = "Bait", allowEpicLures = false, excludedFish = [], timing = DEFAULT_FISHING_TIMING }: {
  baseSkill: number; bonusSkill: number; zone: string; rod: SkillupRod; fish: HookFish[];
  options: Parameters<typeof calculateCastOdds>[3]; baitKind?: string; allowEpicLures?: boolean; excludedFish?: string[]; timing?: FishingTiming;
}) {
  const excluded = new Set(excludedFish);
  const retained = fish.map(member => !excluded.has(member.fish));
  const catches = fish.map(() => 0);
  const gains = fish.map(() => 0);
  const unavailable = { skillGain: null, catchTimeSeconds: null, casts: null, fatigueUsed: null, baitNeeded: baitKind === "Lure" ? 1 : null, catches: fish.map(() => null), gains: fish.map(() => null) };
  if (![baseSkill, bonusSkill].every(value => Number.isFinite(value) && value >= 0) || baseSkill > 200
    || ![timing.fishSeconds, timing.otherSeconds].every(value => Number.isFinite(value) && value > 0)) return unavailable;
  let skill = baseSkill;
  let remaining = 200;
  let fatigueUsed = 0;
  let baitNeeded = baitKind === "Lure" ? 1 : 0;
  let seconds = 0;
  let casts = 0;
  for (let stage = 0; stage < 250 && remaining > 1e-8 && fatigueUsed < 20000 - 1e-8; stage++) {
    const currentSkill = Math.floor(skill + 1e-9);
    const effectiveSkill = currentSkill + bonusSkill + getRodHiddenSuccessBonus(rod.rod);
    const odds = calculateCastOdds(effectiveSkill, rod, fish, options);
    const poolGains = calculatePoolSkillup(currentSkill, effectiveSkill, zone, rod, fish, odds.targetPct, baitKind, allowEpicLures);
    const fights = fish.map(member => calculateFishingFight(effectiveSkill, member, rod, baitKind, allowEpicLures));
    const attempted = fish.map((_member, index) => retained[index]
      ? odds.targetPct[index] / 100 * fights[index].attemptedPct / 100 : 0);
    const landed = fish.map((_member, index) => retained[index]
      ? odds.targetPct[index] / 100 * fights[index].landPct / 100 : 0);
    const perCastGains = poolGains.gains.map((gain, index) => retained[index] ? gain / 100 : 0);
    const landedPerCast = landed.reduce((sum, value) => sum + value, 0);
    const gainPerCast = perCastGains.reduce((sum, value) => sum + value, 0);
    const fatiguePerCast = fish.reduce((sum, member, index) => {
      if (!retained[index]) return sum;
      const failedPerCast = attempted[index] - landed[index];
      return sum + landed[index] * fishingFatigue(effectiveSkill, member, rod)
        + failedPerCast * fishingFatigue(effectiveSkill, member, rod, true);
    }, 0);
    if (landedPerCast <= 0) return unavailable;
    const castsToFinish = remaining / landedPerCast;
    const castsToFatigue = fatiguePerCast > 0 ? (20000 - fatigueUsed) / fatiguePerCast : Infinity;
    const castsToNextSkill = gainPerCast > 0 ? (currentSkill + 1 - skill) / gainPerCast : Infinity;
    const stageCasts = Math.min(castsToFinish, castsToFatigue, castsToNextSkill);
    const attemptedFishPct = 100 * attempted.reduce((sum, value) => sum + value, 0);
    seconds += stageCasts * (timing.fishSeconds * attemptedFishPct / 100 + timing.otherSeconds * (1 - attemptedFishPct / 100));
    casts += stageCasts;
    if (baitKind !== "Lure") {
      const escapesPerCast = fish.reduce((sum, _member, index) => sum + (retained[index]
        ? odds.targetPct[index] / 100 * (1 - fights[index].skillupResolvePct / 100) : 0), 0);
      baitNeeded += stageCasts * Math.max(0, 1 - odds.nothingPct / 100 - escapesPerCast);
    }
    for (let index = 0; index < fish.length; index++) {
      catches[index] += landed[index] * stageCasts;
      gains[index] += perCastGains[index] * stageCasts;
    }
    remaining -= landedPerCast * stageCasts;
    fatigueUsed += fatiguePerCast * stageCasts;
    skill = stageCasts === castsToNextSkill ? currentSkill + 1 : skill + gainPerCast * stageCasts;
  }
  if (remaining > 1e-8 && fatigueUsed < 20000 - 1e-8) return unavailable;
  return { skillGain: skill - baseSkill, catchTimeSeconds: seconds, casts, fatigueUsed, baitNeeded, catches, gains };
}

type SkillupGroupRow = {
  zone: string;
  fish: string;
  rod: string;
  targetGain: number;
  targetPct: number;
  fishPct: number;
  landPct: number;
  escapePct: number;
  snapPct: number;
  breakPct: number;
  effectiveSkill: number;
  catchTimeSeconds?: number | null;
  targetFishPer200?: number | null;
  skillGainPer200?: number | null;
};

export function groupSkillupRows<Row extends SkillupGroupRow>(rows: Row[]) {
  const groups = new Map<string, { key: string; rows: Row[] }>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.zone, row.fish, row.rod, row.targetGain, row.targetPct,
      row.fishPct, row.landPct, row.escapePct, row.snapPct, row.breakPct, row.effectiveSkill,
      row.catchTimeSeconds, row.targetFishPer200, row.skillGainPer200,
    ]);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key, rows: [row] });
  }
  return [...groups.values()];
}

export function calculatePoolSkillup(
  baseSkill: number, effectiveSkill: number, zone: string, rod: SkillupRod,
  fish: HookFish[], targetPct: number[], baitKind = "Bait", allowEpicLures = false,
) {
  const gains = fish.map((member, index) => {
    const skillup = calculateSkillup(baseSkill, member.skillCap, zone, rod.rod);
    const risk = calculateFishingFight(effectiveSkill, member, rod, baitKind, allowEpicLures);
    return skillup.expectedGainPerTargetHook * targetPct[index] * risk.skillupResolvePct / 100;
  });
  return { gains, totalGain: gains.reduce((sum, gain) => sum + gain, 0) };
}

export function calculateSkillup(baseSkill: number, fishLevel: number, zone: string, rodName: string) {
  const skill = clamp(Math.floor(baseSkill), 0, 200);
  const difference = fishLevel - skill;
  if (difference < 1 || difference > 50) {
    return { eligible: false, difference, chancePct: 0, expectedGainPerTargetHook: 0 };
  }

  const normalPdf = Math.exp(-0.5 * Math.pow((difference - 11) / 5, 2)) / (5 * Math.sqrt(2 * Math.PI));
  const distanceModifier = Math.floor(200 * normalPdf);
  const maxChance = Math.max(
    4,
    distanceModifier + Math.trunc((100 - skill) / 10) - Math.floor(skill / 10)
  );

  let skillRoll = 90;
  if (!isCityFishingZone(zone)) skillRoll -= 10;
  if (skill < 50) skillRoll -= 20 - Math.floor(skill / 3);
  if (skill < 50 && rodName.startsWith("Lu Shang's Fishing Rod")) skillRoll += 20;
  skillRoll = Math.max(1, skillRoll);

  const chancePct = Math.min(100, (100 * maxChance) / skillRoll);
  const expectedGainWhenSuccessful = difference >= 10 ? 0.10625 : 0.1;
  return {
    eligible: true,
    difference,
    chancePct,
    expectedGainPerTargetHook: (chancePct / 100) * expectedGainWhenSuccessful,
  };
}

export function fishingFatigue(skill: number, fish: SkillupFish, rod: SkillupRod, failed = false): number {
  const cost = failed && fish.skillCap >= skill + 40 ? 1000
    : fish.legendary ? (["Gugrusaurus", "Lik", "Matsya", "Abaia"].includes(fish.fish) ? 780 : 140)
      : (fish.size === "L" ? 50 : 25) * (fish.skillCap >= skill + 17 ? 4 : 1);
  return Math.floor(cost * (rod.rod.startsWith("Ebisu") ? 85 : rod.rod.startsWith("Lu Shang's") ? 95 : 100) / 100);
}

export function fishingWarningOdds(risk: RodRisk) {
  const escape = risk.escapePct / 100;
  const snap = (1 - escape) * risk.snapPct / 100;
  const land = risk.landPct / 100;
  const falseTerrible = Math.floor(risk.breakPct / 2) / 100;
  const falseBad = Math.floor(risk.snapPct / 2) / 100;
  const badLand = land * (1 - falseTerrible) * falseBad;
  return { snap, badLand, bad: snap + badLand, finishLand: land * (1 - falseTerrible) * (1 - falseBad), escape };
}

export function calculateSnapPlan(options: {
  baseSkill: number; bonusSkill: number; zone: string; rod: SkillupRod;
  fish: HookFish[]; weights: number[]; landed: number; fatigueUsed: number; reserve: number;
}) {
  const { baseSkill, bonusSkill, zone, rod, fish, weights, landed, fatigueUsed, reserve } = options;
  const skill = Math.floor(baseSkill) + Math.floor(bonusSkill);
  const remaining = Math.max(0, 200 - landed);
  const budget = Math.max(0, 20000 - fatigueUsed - reserve);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const rows = fish.map((member, index) => {
    const share = totalWeight > 0 ? weights[index] / totalWeight : 0;
    const risk = calculateRodRisk(skill, member, rod);
    const warning = fishingWarningOdds(risk);
    const skillup = calculateSkillup(baseSkill, member.skillCap, zone, rod.rod);
    return { fish: member.fish, level: member.skillCap, share, risk, warning, skillup,
      cost: fishingFatigue(skill, member, rod), failedCost: fishingFatigue(skill, member, rod, true) };
  });
  const sum = (get: (row: typeof rows[number]) => number) => rows.reduce((total, row) => total + row.share * get(row), 0);
  const bad = sum(row => row.warning.bad);
  const badLand = sum(row => row.warning.badLand);
  const finishLand = sum(row => row.warning.finishLand);
  const badLandingChance = bad > 0 ? badLand / bad : 0;
  const badCost = bad > 0 ? sum(row => row.warning.snap * row.failedCost + row.warning.badLand * row.cost) / bad : 0;
  const finishCostPerLand = finishLand > 0
    ? sum(row => row.warning.finishLand * row.cost + row.warning.escape * row.failedCost) / finishLand : 0;
  const baselineCost = remaining * finishCostPerLand;
  const invalid = ![baseSkill, bonusSkill, landed, fatigueUsed, reserve, ...weights].every(Number.isFinite)
    || baseSkill < 0 || baseSkill > 110 || bonusSkill < 0 || bonusSkill > 8
    || landed < 0 || landed > 200 || fatigueUsed < 0 || fatigueUsed > 20000 || reserve < 0 || reserve > 20000
    || weights.length !== fish.length || weights.some(weight => weight < 0);
  const status = invalid ? "Invalid settings"
    : remaining === 0 ? "Daily catch limit reached"
      : !totalWeight ? "No fish for this bait and location"
        : fish.some(member => member.size === "L") ? "Large-fish pool: epic messages prevent this warning-only plan"
          : !finishLand ? "No landing route with these settings"
            : baselineCost > budget ? "Insufficient fatigue to finish 200 with this reserve"
              : !bad || !sum(row => row.warning.snap) ? "No natural snaps in this pool"
                : !sum(row => row.warning.bad * Number(row.skillup.eligible)) ? "No eligible snap skill-ups in this pool" : "Ready";
  const incrementalCost = badCost - badLandingChance * finishCostPerLand;
  const maximumByLandings = badLandingChance > 0 ? Math.max(0, remaining - 1) / badLandingChance : Infinity;
  const maximumByFatigue = incrementalCost > 0 ? Math.max(0, budget - baselineCost) / incrementalCost : Infinity;
  const badFights = status === "Ready" ? Math.floor(Math.min(maximumByLandings, maximumByFatigue)) : 0;
  const accidentalLandings = badFights * badLandingChance;
  const finishLandings = remaining - accidentalLandings;
  const finishScale = finishLand > 0 ? finishLandings / finishLand : 0;
  const badScale = bad > 0 ? badFights / bad : 0;
  const eligible = sum(row => row.warning.bad * Number(row.skillup.eligible)) * badScale
    + sum(row => row.warning.finishLand * Number(row.skillup.eligible)) * finishScale;
  const baselineOpportunities = finishLand > 0
    ? remaining * sum(row => row.warning.finishLand * Number(row.skillup.eligible)) / finishLand : 0;
  const expectedGain = sum(row => row.warning.bad * row.skillup.expectedGainPerTargetHook) * badScale
    + sum(row => row.warning.finishLand * row.skillup.expectedGainPerTargetHook) * finishScale;
  return { status, rows, remaining, budget, badLandingChance, badCost, finishCostPerLand, baselineCost,
    badFights, accidentalLandings, snaps: badFights - accidentalLandings, finishLandings,
    opportunities: eligible, extraOpportunities: eligible - baselineOpportunities, expectedGain,
    fatigueProjected: badFights * badCost + finishLandings * finishCostPerLand,
    finishFailures: finishScale * sum(row => row.warning.escape) };
}

export function calculateSnapTime(plan: ReturnType<typeof calculateSnapPlan>, fishPct: number) {
  if (plan.status !== "Ready" || !Number.isFinite(fishPct) || fishPct <= 0 || fishPct > 100) return null;
  const fishChance = fishPct / 100;
  const badPerCast = fishChance * plan.rows.reduce((sum, row) => sum + row.share * row.warning.bad, 0);
  const finishLandPerCast = fishChance * plan.rows.reduce((sum, row) => sum + row.share * row.warning.finishLand, 0);
  if (badPerCast <= 0 || finishLandPerCast <= 0) return null;
  const snapCasts = plan.badFights / badPerCast;
  const finishCasts = plan.finishLandings / finishLandPerCast;
  const casts = snapCasts + finishCasts;
  const cancelledOrEmpty = Math.max(0, casts - plan.badFights - plan.finishLandings - plan.finishFailures);
  const snapSeconds = snapCasts * 15 + plan.accidentalLandings * 20;
  const finishSeconds = finishCasts * 15 + plan.finishLandings * 20;
  return { casts, snapCasts, finishCasts, cancelledOrEmpty, snapSeconds, finishSeconds, seconds: snapSeconds + finishSeconds };
}

export function calculateSnapBait(plan: ReturnType<typeof calculateSnapPlan>, odds: { fishPct: number; nothingPct: number }) {
  const time = calculateSnapTime(plan, odds.fishPct);
  if (!time || !Number.isFinite(odds.nothingPct) || odds.nothingPct < 0
    || odds.nothingPct > 100 || odds.fishPct + odds.nothingPct > 100 + 1e-8) return null;
  return Math.max(0, time.casts * (1 - odds.nothingPct / 100) - plan.finishFailures);
}
