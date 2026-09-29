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

export type HookFish = SkillupFish & { hookBonus: number; rarity: number; shellfish?: boolean };

export function calculateHookWeight(skill: number, fish: HookFish, rod: SkillupRod, shellfishBait = false): number {
  if (fish.skillCap - skill > 100) return 0;
  let weight = 50 + fish.hookBonus;
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
  options: { city: boolean; hasItems: boolean; hasMobs: boolean; difficulty: number; poorFish?: boolean; shellfishBait?: boolean },
) {
  const weights = fish.map(member => calculateHookWeight(skill, member, rod, options.shellfishBait));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let fishWeight = total ? clamp(Math.max(...weights) + (options.city ? 15 : 25), 10, 120) : (options.city ? 15 : 25);
  let itemWeight = options.city ? 45 : 25;
  let mobWeight = options.city ? 0 : 30;
  let nothingWeight = (options.city ? 45 : 35) + options.difficulty * 24.5;
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

export function calculateCatchTime({ fishPct, targetPct, landPct }: { fishPct: number; targetPct: number; landPct: number }): number | null {
  if (![fishPct, targetPct, landPct].every(value => Number.isFinite(value) && value >= 0 && value <= 100)
    || targetPct > fishPct || targetPct === 0 || landPct === 0) return null;
  const averageCastSeconds = 30 * fishPct / 100 + 12 * (1 - fishPct / 100);
  const targetLandedPerCast = targetPct / 100 * landPct / 100;
  return 200 * averageCastSeconds / targetLandedPerCast;
}

export function formatCatchTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Not catchable";
  const minutes = Math.ceil(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
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
};

export function groupSkillupRows<Row extends SkillupGroupRow>(rows: Row[]) {
  const groups = new Map<string, { key: string; rows: Row[] }>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.zone, row.fish, row.rod, row.targetGain, row.targetPct,
      row.fishPct, row.landPct, row.escapePct, row.snapPct, row.breakPct, row.effectiveSkill,
    ]);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key, rows: [row] });
  }
  return [...groups.values()];
}

export function calculatePoolSkillup(
  baseSkill: number, effectiveSkill: number, zone: string, rod: SkillupRod,
  fish: HookFish[], targetPct: number[],
) {
  const gains = fish.map((member, index) => {
    const skillup = calculateSkillup(baseSkill, member.skillCap, zone, rod.rod);
    const risk = calculateRodRisk(effectiveSkill, member, rod);
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
