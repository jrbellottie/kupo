import phoenix from "../data/phoenix.json";

export const HELM_KINDS = ["Mining", "Harvesting", "Excavation", "Logging"] as const;
export type HelmKind = typeof HELM_KINDS[number];
export type HelmDrop = { itemId: number; name: string; weight: number; dailyCap: number | null };
export type HelmZone = {
  kind: HelmKind; zone: string; zoneId: number; toolId: number; tool: string;
  obtainRate: number; breakRate: number; minLevel: number;
  relocateRate: number; respawnTime: number; campMultiplier: number;
  depletion: { max: number; pool: number[] } | null;
  points: number[][]; drops: HelmDrop[];
};
export type HelmScenario = {
  level: number; nq: number; hq: number; camped: boolean; inventoryFull: boolean;
  depleted: number; daily: Record<string, number>; day: number;
};
export const HELM_DEFAULTS: HelmScenario = { level: 75, nq: 0, hq: 0, camped: false, inventoryFull: false, depleted: 0, daily: {}, day: 0 };
export const HELM_SOURCE = phoenix.helmSource;
export const HELM_ZONES = phoenix.helmZones as HelmZone[];
export const HELM_GEAR = phoenix.helmGear.filter(gear => /^(Field|Worker) (Boots|Hose|Tunica|Gloves)$/.test(gear.name));
export const HELM_DAYS = ["Firesday", "Earthsday", "Watersday", "Windsday", "Iceday", "Lightningday", "Lightsday", "Darksday"];
export const HELM_ROCKS = [
  { itemId: 769, name: "Red Rock" }, { itemId: 771, name: "Yellow Rock" },
  { itemId: 770, name: "Blue Rock" }, { itemId: 772, name: "Green Rock" },
  { itemId: 773, name: "Translucent Rock" }, { itemId: 774, name: "Purple Rock" },
  { itemId: 776, name: "White Rock" }, { itemId: 775, name: "Black Rock" },
];

export function helmAvailable(zone: HelmZone, includeWotg: boolean): boolean {
  return !zone.zone.startsWith("Abyssea ") && (includeWotg || !zone.zone.endsWith(" S"));
}

export function helmZoneKey(zone: HelmZone): string { return `${zone.kind}:${zone.zoneId}`; }
export function helmMapKey(zone: string): string { return zone.toLowerCase().replace(/[^a-z0-9]/g, ""); }
export function helmZoneName(zone: string): string {
  return zone.replace(/ S$/, " (S)").replace("Ifrits", "Ifrit's").replace(" Of ", " of ");
}
export function helmCount(value: number, max = 9999): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0;
}

export function helmRates(zone: HelmZone, scenario: HelmScenario) {
  const weights = zone.drops.map(drop => {
    let weight = drop.weight;
    if (drop.dailyCap !== null) {
      const count = helmCount(scenario.daily[drop.itemId] ?? 0);
      weight = count >= drop.dailyCap ? 0 : Math.floor(weight / (count + 1));
    }
    if (zone.depletion?.pool.includes(drop.itemId)) {
      const count = helmCount(scenario.depleted, zone.depletion.max);
      weight = Math.floor(weight * (zone.depletion.max - count) / zone.depletion.max);
    }
    return weight;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const success = scenario.level >= zone.minLevel && !scenario.inventoryFull && total > 0 ? zone.obtainRate / 100 : 0;
  const gear = zone.kind === "Excavation" ? 1 : 0.893 ** helmCount(scenario.nq) * 0.843 ** helmCount(scenario.hq);
  const breakChance = Math.min(1, zone.breakRate / 100 * gear * (scenario.camped ? zone.campMultiplier : 1));
  const drops = zone.drops.map((drop, index) => {
    const rock = drop.itemId === 769 ? HELM_ROCKS[helmCount(scenario.day, 7)] : null;
    const share = total > 0 ? weights[index] / total : 0;
    return { ...drop, ...(rock ?? {}), sourceItemId: drop.itemId, effectiveWeight: weights[index], share, perAttempt: share * success };
  });
  return { drops, success, nothing: 1 - success, breakChance, itemAndBreak: success * breakChance, relocateChance: success * zone.relocateRate / 100 };
}