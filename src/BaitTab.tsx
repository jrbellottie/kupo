// src/BaitTab.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { styles } from "./styles";
import { CollapsibleSection, useTableViewportHeight } from "./ScreenControls";
import { baitData, fishData, phoenixFish } from "./utils/phoenixData";
import fishingPlanner from "./data/fishingPlanner.json";
import { loadJson, saveJson } from "./utils/storage";
import { formatVendorPrice, getVendorPriceEach } from "./utils/vendorPrice";
import { getFishingVendorOptions } from "./utils/fishingVendor";
import { type Calibration, DEFAULT_CALIBRATION, getVanaNow, moonDirectionFromStep } from "./vanadiel";
import {
  SkillupFish,
  SkillupRod,
  calculateRodRisk,
  calculateSkillup,
  getRodHiddenSuccessBonus,
  calculateCastOdds,
  calculatePoolSkillup,
  calculateCatchTime,
  calculatePoolSession,
  calculateFishingFight,
  DEFAULT_FISHING_TIMING,
  formatCatchTime,
  groupSkillupRows,
  isCityFishingZone,
  getFishingMoonPhase,
} from "./utils/fishingSkillup";

type BaitEntry = {
  fish: string;
  lvl: number | null;
  size: string;
  bait: string | null;
  kind: string | null;
  bite: string | null;
  hookBonus: number | null;
  best: boolean;
  note: string | null;
};

type PoolEntry = {
  zone: string;
  area: string;
  fish: string;
  lvl: number | null;
  bait: string;
  kind: string;
  bite: string;
  hookBonus: number;
  sharePct: number;
  competing: string[];
};

type FishZoneEntry = {
  zone: string;
  area: string;
  catch: string;
  lvl: number | null;
  rarity: string;
  type: string;
};

const BAIT: BaitEntry[] = baitData as BaitEntry[];
const FISH_ZONES: FishZoneEntry[] = fishData as FishZoneEntry[];
const SKILLUP_RODS: SkillupRod[] = (fishingPlanner.rods as SkillupRod[]).filter(
  (rod) => rod.era === "TOAU" && rod.rod !== "Judges Rod" && rod.rod !== "Goldfish Basket"
);
const SKILLUP_ROD_NAMES = SKILLUP_RODS.map((rod) => rod.rod);
const PLANNER_FISH = fishingPlanner.fish as Record<string, SkillupFish & { rarity: number; shellfish: boolean; item: boolean; restricted: boolean; requiredKeyItem: number; questRestricted: boolean; moonPattern: number }>;
const PLANNER_BAITS = fishingPlanner.baits as Record<string, { poorFish: boolean; shellfishBait: boolean; fish: Record<string, number> }>;
const PLANNER_AREAS = fishingPlanner.areas as Record<string, { difficulty: number; hasMobs: boolean; members: string[]; allMembers: string[] }>;
const GUTTING_REWARDS = fishingPlanner.guttingRewards as Record<string, { gil: number; items: { itemId: number; name: string; chancePct: number; min: number; max: number }[] }>;
const normalizeFishingName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Rarity like "x0.35" → 0.35; "-" (no penalty) = 1. */
function rarityValue(rarity: string): number {
  const m = String(rarity).match(/x\s*([\d.]+)/i);
  return m ? Number(m[1]) : 1;
}

/**
 * Compute every (zone, area, fish, bait) combination with its pool share.
 * Hook weight per fish = clamp((25 + hookBonus) × rarity, 20, 120), assuming
 * neutral time/moon and adequate skill — matches the source table's model.
 * Share = target weight / total weight of all pool fish that bite that bait.
 */
function buildSpots(): PoolEntry[] {
  const baitByFish = new Map<string, BaitEntry[]>();
  for (const b of BAIT) {
    if (!b.bait || b.hookBonus === null) continue;
    const list = baitByFish.get(b.fish);
    if (list) list.push(b);
    else baitByFish.set(b.fish, [b]);
  }

  const poolMembers = new Map<string, FishZoneEntry[]>();
  for (const f of FISH_ZONES) {
    if (phoenixFish[f.catch]?.item || phoenixFish[f.catch]?.disabled) continue;
    const key = `${f.zone}|${f.area}`;
    const list = poolMembers.get(key);
    if (list) list.push(f);
    else poolMembers.set(key, [f]);
  }

  const spots: PoolEntry[] = [];

  for (const members of poolMembers.values()) {
    // All baits bitten by at least one member of this pool.
    const baitsInPool = new Set<string>();
    for (const m of members) {
      for (const row of baitByFish.get(m.catch) ?? []) baitsInPool.add(row.bait as string);
    }

    for (const baitName of baitsInPool) {
      // Everyone in this pool that bites this bait, with their hook weight.
      const biters: { member: FishZoneEntry; row: BaitEntry; weight: number }[] = [];
      for (const m of members) {
        const row = (baitByFish.get(m.catch) ?? []).find((r) => r.bait === baitName);
        if (!row) continue;
        const weight = Math.min(120, Math.max(20, Math.floor(Math.fround((25 + (row.hookBonus as number)) * Math.fround(rarityValue(m.rarity))))));
        biters.push({ member: m, row, weight });
      }

      const total = biters.reduce((sum, b) => sum + b.weight, 0);

      for (const b of biters) {
        spots.push({
          zone: b.member.zone,
          area: b.member.area,
          fish: b.member.catch,
          lvl: b.member.lvl ?? b.row.lvl,
          bait: baitName,
          kind: b.row.kind ?? "-",
          bite: b.row.bite ?? "-",
          hookBonus: b.row.hookBonus as number,
          sharePct: Math.round((1000 * b.weight) / total) / 10,
          competing: biters.filter((o) => o !== b).map((o) => o.member.catch),
        });
      }
    }
  }

  return spots;
}

const POOLS: PoolEntry[] = buildSpots();

type Mode = "affinity" | "spots" | "skillup";

type AffinityKey = "fish" | "lvl" | "size" | "bait" | "kind" | "bite" | "hookBonus" | "vendorPriceEach" | "best" | "note";
type SpotKey = "netGilPerHour" | "netGilPerDay" | "catchTimeSeconds" | "targetFishPer200" | "fish" | "vendorPriceEach" | "baitNeeded" | "rod" | "zone" | "area" | "bait" | "sharePct";
type SkillupKey =
  | "catchTimeSeconds"
  | "targetFishPer200"
  | "bestVendorPrice"
  | "skillGainPer200"
  | "fish"
  | "fishLevel"
  | "levelDifference"
  | "skillupChancePct"
  | "sharePct"
  | "landPct"
  | "fishPct"
  | "itemPct"
  | "mobPct"
  | "nothingPct"
  | "targetPct"
  | "rod"
  | "effectiveSkill"
  | "zone"
  | "area"
  | "bait";
type SortDir = "asc" | "desc";
type RodAccess = "ebisu" | "luShang" | "standard";
type FishingSaleOverride =
  | { type: "ah"; price: string }
  | { type: "recipe"; recipeId: number; tier: string };

type SkillupRow = PoolEntry & {
  catchTimeSeconds: number | null;
  targetFishPer200: number | null;
  catchBreakdown: { fish: string; size: string; level: number; catches: number | null; skillGain: number | null; included: boolean }[];
  skillGainPer200: number | null;
  poolSkillGainPer200: number | null;
  sessionCasts: number | null;
  fatigueUsed: number | null;
  baitNeeded: number | null;
  attemptedFishPct: number;
  fight: ReturnType<typeof calculateFishingFight>;
  fishLevel: number;
  levelDifference: number;
  skillupChancePct: number;
  expectedResolvedGain: number;
  expectedLandedGain: number;
  rod: string;
  effectiveSkill: number;
  landPct: number;
  snapPct: number;
  breakPct: number;
  escapePct: number;
  fishPct: number;
  itemPct: number;
  mobPct: number;
  nothingPct: number;
  targetPct: number;
  targetGain: number;
  itemHazards: string;
};

type ProfitSpotRow = PoolEntry & {
  rod: string;
  effectiveSkill: number;
  salePrice: number | null;
  saleLabel: string;
  catchTimeSeconds: number | null;
  targetFishPer200: number | null;
  grossGilPerDay: number | null;
  baitCostPerDay: number | null;
  netGilPerDay: number | null;
  netGilPerHour: number | null;
  sessionCasts: number | null;
  fatigueUsed: number | null;
  baitNeeded: number | null;
  fishPct: number;
  itemPct: number;
  mobPct: number;
  nothingPct: number;
  targetPct: number;
  fight: ReturnType<typeof calculateFishingFight>;
  risk: ReturnType<typeof calculateRodRisk>;
  catchBreakdown: { fish: string; size: string; level: number; catches: number | null; salePrice: number | null; saleLabel: string; grossGil: number | null; included: boolean }[];
};

function getFishingSaleOption(fish: string, override?: FishingSaleOverride) {
  const vendor = getFishingVendorOptions(fish);
  if (!override) return { price: vendor.rawPrice, label: "Direct NPC" };
  if (override.type === "ah") {
    const price = override.price.trim() === "" ? null : Number(override.price);
    return {
      price: price !== null && Number.isFinite(price) && price >= 0 ? price : null,
      label: "AH estimate",
    };
  }
  const recipe = vendor.recipes.find((entry) => entry.recipe.id === override.recipeId);
  const outcome = recipe?.outcomes.find((entry) => entry.tier === override.tier);
  return outcome
    ? { price: outcome.perFish, label: `${outcome.tier} ${outcome.n} (NPC / fish)` }
    : { price: null, label: "Selected recipe unavailable" };
}

function isFishingSaleOverride(value: unknown): value is FishingSaleOverride {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("type" in value)) return false;
  if (value.type === "ah") return "price" in value && typeof value.price === "string";
  return value.type === "recipe" && "recipeId" in value && typeof value.recipeId === "number" && Number.isInteger(value.recipeId)
    && "tier" in value && typeof value.tier === "string";
}

function readFishingSaleOverrides(value: unknown): Record<string, FishingSaleOverride> {
  const overrides: Record<string, FishingSaleOverride> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return overrides;
  for (const [fish, override] of Object.entries(value)) {
    if (isFishingSaleOverride(override)) overrides[fish] = override;
  }
  return overrides;
}

const AFFINITY_COLUMNS: { key: AffinityKey; label: string }[] = [
  { key: "fish", label: "Fish" },
  { key: "lvl", label: "Lvl" },
  { key: "size", label: "Size" },
  { key: "bait", label: "Bait" },
  { key: "kind", label: "Kind" },
  { key: "bite", label: "Bite" },
  { key: "hookBonus", label: "Hook Bonus" },
  { key: "vendorPriceEach", label: "Vendor Price" },
  { key: "best", label: "Best" },
  { key: "note", label: "Note" },
];

const SPOT_COLUMNS: { key: SpotKey; label: string }[] = [
  { key: "netGilPerHour", label: "Net gil / hour" },
  { key: "netGilPerDay", label: "Net gil / day" },
  { key: "catchTimeSeconds", label: "Time / day" },
  { key: "targetFishPer200", label: "Target fish / day" },
  { key: "fish", label: "Fish" },
  { key: "sharePct", label: "Pool Share" },
  { key: "vendorPriceEach", label: "Direct NPC / fish" },
  { key: "baitNeeded", label: "Bait / day" },
  { key: "zone", label: "Zone" },
  { key: "area", label: "Area" },
  { key: "bait", label: "Bait" },
  { key: "rod", label: "Rod" },
];

const SKILLUP_COLUMNS: { key: SkillupKey; label: string }[] = [
  { key: "skillGainPer200", label: "Est. fish skill gain / day" },
  { key: "catchTimeSeconds", label: "Time / day" },
  { key: "targetFishPer200", label: "Target fish / day" },
  { key: "bestVendorPrice", label: "Max NPC gross / fish" },
  { key: "fish", label: "Fish" },
  { key: "fishLevel", label: "Fish Lvl" },
  { key: "levelDifference", label: "+Lvl" },
  { key: "skillupChancePct", label: "Skill-up Chance" },
  { key: "sharePct", label: "Share of Fish Bites" },
  { key: "fishPct", label: "Fish / Cast" },
  { key: "itemPct", label: "Item / Cast" },
  { key: "mobPct", label: "Monster / Cast" },
  { key: "nothingPct", label: "Nothing / Cast" },
  { key: "targetPct", label: "Target / Cast" },
  { key: "landPct", label: "Land / Target Hook" },
  { key: "rod", label: "Rod" },
  { key: "effectiveSkill", label: "Success Skill" },
  { key: "zone", label: "Zone" },
  { key: "area", label: "Area" },
  { key: "bait", label: "Bait" },
];

const MAX_VISIBLE_ROWS = 300;
const COMPACT_SKILLUP_COLUMNS: { key: SkillupKey; label: string; width: string }[] = [
  { key: "skillGainPer200", label: "Est. fish skill gain / day", width: "8%" },
  { key: "fish", label: "Fish", width: "10%" },
  { key: "bestVendorPrice", label: "Max NPC gross / fish", width: "12%" },
  { key: "catchTimeSeconds", label: "Time / day", width: "10%" },
  { key: "targetFishPer200", label: "Target fish / day", width: "10%" },
  { key: "targetPct", label: "Target / cast", width: "7%" },
  { key: "landPct", label: "Land / hook", width: "7%" },
  { key: "rod", label: "Rod", width: "12%" },
  { key: "zone", label: "Location", width: "13%" },
  { key: "bait", label: "Bait", width: "11%" },
];
const DAILY_LIMIT_ASSUMPTIONS = "Assumes a fresh day: 200 retained fish or 20,000 fatigue, whichever comes first. Landings and completed failures spend fatigue, including skill-gap penalties and rod discounts. Lures cancel bad feelings (including false alarms) but complete other fish fights, including epic catches; lures can be lost. Consumable bait completes fish fights, including natural snaps. Cancellations cost time but give no catches, skill or fatigue. Expanded catch planning assumes all key-item and quest prerequisites are met.";
const CATCH_TIME_ASSUMPTIONS = `Estimated active fishing time until the daily limit at this spot and bait, rounded up to a minute. ${DAILY_LIMIT_ASSUMPTIONS} Unchecked fish still bite but are canceled, as are items and monsters. Uses approximate expected skill progression. Excludes guild rank caps, travel, waiting for fishing windows, and repair / resupply downtime.`;
const TARGET_COUNT_ASSUMPTIONS = `Estimated target fish per day, weighted by bite and landing chances over approximate skill progression. ${DAILY_LIMIT_ASSUMPTIONS} Fish selections apply across the entire planner table, including every location, bait and rod. Unchecked species still bite but contribute no catches, skill or fatigue. Capped retained competitors still count. Assumes you can identify the fish you intend to cancel; estimates are not guarantees.`;
const SESSION_SKILL_ASSUMPTIONS = `Estimated fishing skill points gained across the pool before the daily limit. ${DAILY_LIMIT_ASSUMPTIONS} Updates skill-up rates, bite odds, landing odds and fatigue costs at expected skill-level boundaries; a mean-progression approximation, not an exact stochastic forecast. Includes eligible completed failures; canceled fish give no skill. Ignores guild rank caps and downtime.`;
const BAIT_UI_KEY = "ffxi_bait_ui_v1";

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null && v !== ""))].sort((a, b) =>
    a.localeCompare(b)
  );
}

const KINDS = uniqueSorted(BAIT.map((b) => b.kind));
const BITES = uniqueSorted(BAIT.map((b) => b.bite));
const POOL_ZONES = uniqueSorted(POOLS.map((p) => p.zone));
const POOL_BITES = uniqueSorted(POOLS.map((p) => p.bite));

const COP_LOCKED_ZONES = new Set(["Lufaise Meadows", "Misareaux Coast"]);
const TOAU_LOCKED_ZONES = new Set([
  "Aht Urhgan Whitegate",
  "Al Zahbi",
  "Arrapago Reef",
  "Aydeewa Subterrane",
  "Bhaflau Thickets",
  "Caedarva Mire",
  "Mamook",
  "Mount Zhayolm",
  "Nashmau",
  "Open sea route to Al Zahbi",
  "Silver Sea route to Al Zahbi",
  "Silver Sea route to Nashmau",
  "Talacca Cove",
  "Wajaom Woodlands",
]);

const optionBaseStyle: React.CSSProperties = {
  backgroundColor: "#0c0c0c",
  color: "#eaeaea",
};

const thStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: "#161616",
  color: "#eaeaea",
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 800,
  borderBottom: "1px solid #444",
  cursor: "pointer",
  userSelect: "none",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  whiteSpace: "nowrap",
};

const selectedRowStyle: React.CSSProperties = {
  background: "rgba(138, 246, 176, 0.12)",
  outline: "1px solid #8af6b0",
  outlineOffset: "-1px",
};

const clickableRowStyle: React.CSSProperties = {
  cursor: "pointer",
};

function shareColor(pct: number | null): React.CSSProperties {
  if (pct === null) return {};
  if (pct >= 100) return { color: "#8af6b0", fontWeight: 800 };
  if (pct >= 60) return { color: "#D8B04B", fontWeight: 700 };
  return { color: "#ff9c7a", fontWeight: 700 };
}

export default function BaitTab({ cal = DEFAULT_CALIBRATION, mode: activeMode, onModeChange }: { cal?: Calibration; mode?: Mode; onModeChange?: (mode: Mode) => void } = {}) {
  const rodsDropdownRef = useRef<HTMLDetailsElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const resultsHeight = useTableViewportHeight(resultsRef);
  const [expandedSkillupKey, setExpandedSkillupKey] = useState<string | null>(null);
  const [expandedVendorKey, setExpandedVendorKey] = useState<string | null>(null);
  const [expandedSpotKey, setExpandedSpotKey] = useState<string | null>(null);
  const [expandedSkillupGroups, setExpandedSkillupGroups] = useState<Set<string>>(() => new Set());
  function toggleSkillupGroup(key: string, expanded: boolean) {
    if (expanded) setExpandedSkillupKey(null);
    setExpandedSkillupGroups(previous => {
      const next = new Set(previous);
      if (expanded) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const skillupCellStyle: React.CSSProperties = { ...tdStyle, whiteSpace: "normal", overflowWrap: "anywhere", verticalAlign: "top" };

  type BaitUiState = {
    mode: Mode;
    aGlobal: string;
    aFish: string;
    aBait: string;
    aKind: string;
    aBite: string;
    aBestOnly: boolean;
    aLvlMin: string;
    aLvlMax: string;
    aSortKey: AffinityKey;
    aSortDir: SortDir;
    sGlobal: string;
    sFish: string;
    sZone: string;
    sArea: string;
    sBait: string;
    sKind: string;
    sBite: string;
    sMinShare: string;
    sSoloOnly: boolean;
    sSkill: string;
    sBonusSkill: string;
    sSelectedRods: string[];
    sFishSeconds: string;
    sOtherSeconds: string;
    sIncludeCop: boolean;
    sIncludeToau: boolean;
    sExcludedFish: string[];
    sSaleOverrides: Record<string, FishingSaleOverride>;
    sSortKey: SpotKey;
    sSortDir: SortDir;
    uSkill: string;
    uFishSeconds: string;
    uOtherSeconds: string;
    uExcludedFish: string[];
    uBonusSkill: string;
    uSelectedRods: string[];
    uIncludeCop: boolean;
    uIncludeToau: boolean;
    uIncludeAllFish: boolean;
    uGlobal: string;
    uFish: string;
    uZone: string;
    uBait: string;
    uMinShare: string;
    uMaxTimeHours: string;
    uSortKey: SkillupKey;
    uSortDir: SortDir;
  };

  const defaultUi: BaitUiState = {
    mode: "affinity",
    aGlobal: "",
    aFish: "",
    aBait: "",
    aKind: "",
    aBite: "",
    aBestOnly: false,
    aLvlMin: "",
    aLvlMax: "",
    aSortKey: "fish",
    aSortDir: "asc",
    sGlobal: "",
    sFish: "",
    sZone: "",
    sArea: "",
    sBait: "",
    sKind: "",
    sBite: "",
    sMinShare: "",
    sSoloOnly: false,
    sSkill: "1",
    sBonusSkill: "0",
    sSelectedRods: SKILLUP_ROD_NAMES,
    sFishSeconds: String(DEFAULT_FISHING_TIMING.fishSeconds),
    sOtherSeconds: String(DEFAULT_FISHING_TIMING.otherSeconds),
    sIncludeCop: true,
    sIncludeToau: true,
    sExcludedFish: [],
    sSaleOverrides: {},
    sSortKey: "netGilPerHour",
    sSortDir: "desc",
    uSkill: "1",
    uFishSeconds: String(DEFAULT_FISHING_TIMING.fishSeconds),
    uOtherSeconds: String(DEFAULT_FISHING_TIMING.otherSeconds),
    uExcludedFish: [],
    uBonusSkill: "5",
    uSelectedRods: SKILLUP_ROD_NAMES,
    uIncludeCop: true,
    uIncludeToau: true,
    uIncludeAllFish: false,
    uGlobal: "",
    uFish: "",
    uZone: "",
    uBait: "",
    uMinShare: "",
    uMaxTimeHours: "",
    uSortKey: "skillGainPer200",
    uSortDir: "desc",
  };

  const loaded = loadJson<Omit<Partial<BaitUiState>, "uExcludedFish"> & {
    uRodAccess?: RodAccess; uExcludedFish?: string[] | Record<string, string[]>;
  }>(BAIT_UI_KEY, {});
  const legacySelectedRods = SKILLUP_RODS.filter((rod) => {
    if (loaded.uRodAccess === "standard") return !rod.legendary;
    if (loaded.uRodAccess === "luShang") return !rod.rod.startsWith("Ebisu Fishing Rod");
    return true;
  }).map((rod) => rod.rod);
  const initialUi: BaitUiState = {
    ...defaultUi,
    ...loaded,
    uExcludedFish: Array.isArray(loaded.uExcludedFish)
      ? loaded.uExcludedFish
      : [...new Set(Object.values(loaded.uExcludedFish ?? {}).flat())],
    mode:
      loaded.mode === "spots"
        ? "spots"
        : loaded.mode === "skillup"
            ? "skillup"
          : "affinity",
    aSortKey: AFFINITY_COLUMNS.some((c) => c.key === loaded.aSortKey)
      ? (loaded.aSortKey as AffinityKey)
      : defaultUi.aSortKey,
    aSortDir: loaded.aSortDir === "desc" ? "desc" : "asc",
    sSortKey: SPOT_COLUMNS.some((c) => c.key === loaded.sSortKey)
      ? (loaded.sSortKey as SpotKey)
      : defaultUi.sSortKey,
    sSortDir: loaded.sSortDir === "asc" ? "asc" : "desc",
    sExcludedFish: Array.isArray(loaded.sExcludedFish) ? loaded.sExcludedFish : defaultUi.sExcludedFish,
    sSaleOverrides: readFishingSaleOverrides(loaded.sSaleOverrides),
    sSelectedRods: Array.isArray(loaded.sSelectedRods)
      ? loaded.sSelectedRods.filter((rod) => SKILLUP_ROD_NAMES.includes(rod))
      : defaultUi.sSelectedRods,
    uSelectedRods: Array.isArray(loaded.uSelectedRods)
      ? loaded.uSelectedRods.filter((rod) => SKILLUP_ROD_NAMES.includes(rod))
      : legacySelectedRods,
    uSortKey: SKILLUP_COLUMNS.some((c) => c.key === loaded.uSortKey)
      ? (loaded.uSortKey as SkillupKey)
      : defaultUi.uSortKey,
    uSortDir: loaded.uSortDir === "asc" ? "asc" : "desc",
  };

  const [savedMode, setSavedMode] = useState<Mode>(initialUi.mode);
  const mode = activeMode ?? savedMode;
  function setMode(next: Mode) {
    setSavedMode(next);
    onModeChange?.(next);
  }

  // ---- Affinity (Fish x Bait) filters ----
  const [aGlobal, setAGlobal] = useState(initialUi.aGlobal);
  const [aFish, setAFish] = useState(initialUi.aFish);
  const [aBait, setABait] = useState(initialUi.aBait);
  const [aKind, setAKind] = useState(initialUi.aKind);
  const [aBite, setABite] = useState(initialUi.aBite);
  const [aBestOnly, setABestOnly] = useState(initialUi.aBestOnly);
  const [aLvlMin, setALvlMin] = useState(initialUi.aLvlMin);
  const [aLvlMax, setALvlMax] = useState(initialUi.aLvlMax);
  const [aSortKey, setASortKey] = useState<AffinityKey>(initialUi.aSortKey);
  const [aSortDir, setASortDir] = useState<SortDir>(initialUi.aSortDir);

  // ---- Best-spot (pool) filters ----
  const [sGlobal, setSGlobal] = useState(initialUi.sGlobal);
  const [sFish, setSFish] = useState(initialUi.sFish);
  const [sZone, setSZone] = useState(initialUi.sZone);
  const [sArea, setSArea] = useState(initialUi.sArea);
  const [sBait, setSBait] = useState(initialUi.sBait);
  const [sKind, setSKind] = useState(initialUi.sKind);
  const [sBite, setSBite] = useState(initialUi.sBite);
  const [sMinShare, setSMinShare] = useState(initialUi.sMinShare);
  const [sSoloOnly, setSSoloOnly] = useState(initialUi.sSoloOnly);
  const [sSkill, setSSkill] = useState(initialUi.sSkill);
  const [sBonusSkill, setSBonusSkill] = useState(initialUi.sBonusSkill);
  const [sSelectedRods, setSSelectedRods] = useState(initialUi.sSelectedRods);
  const [sFishSeconds, setSFishSeconds] = useState(initialUi.sFishSeconds);
  const [sOtherSeconds, setSOtherSeconds] = useState(initialUi.sOtherSeconds);
  const [sIncludeCop, setSIncludeCop] = useState(initialUi.sIncludeCop);
  const [sIncludeToau, setSIncludeToau] = useState(initialUi.sIncludeToau);
  const [sExcludedFish, setSExcludedFish] = useState(initialUi.sExcludedFish);
  const [sSaleOverrides, setSSaleOverrides] = useState(initialUi.sSaleOverrides);
  const [sAhPriceDrafts, setSAhPriceDrafts] = useState<Record<string, string>>({});
  const spotFishSeconds = Number(sFishSeconds) > 0 && Number.isFinite(Number(sFishSeconds)) ? Number(sFishSeconds) : DEFAULT_FISHING_TIMING.fishSeconds;
  const spotOtherSeconds = Number(sOtherSeconds) > 0 && Number.isFinite(Number(sOtherSeconds)) ? Number(sOtherSeconds) : DEFAULT_FISHING_TIMING.otherSeconds;
  const spotTiming = useMemo(
    () => ({ fishSeconds: spotFishSeconds, otherSeconds: spotOtherSeconds }),
    [spotFishSeconds, spotOtherSeconds]
  );
  const [sSortKey, setSSortKey] = useState<SpotKey>(initialUi.sSortKey);
  const [sSortDir, setSSortDir] = useState<SortDir>(initialUi.sSortDir);

  // ---- Practical skill-up combinations ----
  const [uSkill, setUSkill] = useState(initialUi.uSkill);
  const [uFishSeconds, setUFishSeconds] = useState(initialUi.uFishSeconds);
  const [uOtherSeconds, setUOtherSeconds] = useState(initialUi.uOtherSeconds);
  const [uExcludedFish, setUExcludedFish] = useState(initialUi.uExcludedFish);
  function togglePoolFish(fish: string) {
    setUExcludedFish(previous => previous.includes(fish)
      ? previous.filter(name => name !== fish) : [...previous, fish]);
  }
  const fishSeconds = Number(uFishSeconds) > 0 && Number.isFinite(Number(uFishSeconds)) ? Number(uFishSeconds) : DEFAULT_FISHING_TIMING.fishSeconds;
  const otherSeconds = Number(uOtherSeconds) > 0 && Number.isFinite(Number(uOtherSeconds)) ? Number(uOtherSeconds) : DEFAULT_FISHING_TIMING.otherSeconds;
  const catchTimeAssumptions = `${CATCH_TIME_ASSUMPTIONS} Full cast-to-next-cast estimates: ${fishSeconds}s per retained fish attempt (including failures), ${otherSeconds}s per canceled fish or non-fish cast. Includes waiting, reeling / canceling, and recasting; these timings are estimates, not verified game constants.`;
  const [uBonusSkill, setUBonusSkill] = useState(initialUi.uBonusSkill);
  const [uSelectedRods, setUSelectedRods] = useState(initialUi.uSelectedRods);
  const [uIncludeCop, setUIncludeCop] = useState(initialUi.uIncludeCop);
  const [uIncludeToau, setUIncludeToau] = useState(initialUi.uIncludeToau);
  const [uIncludeAllFish, setUIncludeAllFish] = useState(initialUi.uIncludeAllFish);
  const [uGlobal, setUGlobal] = useState(initialUi.uGlobal);
  const [uFish, setUFish] = useState(initialUi.uFish);
  const [uZone, setUZone] = useState(initialUi.uZone);
  const [uBait, setUBait] = useState(initialUi.uBait);
  const [uMinShare, setUMinShare] = useState(initialUi.uMinShare);
  const [uMaxTimeHours, setUMaxTimeHours] = useState(initialUi.uMaxTimeHours);
  const [uSortKey, setUSortKey] = useState<SkillupKey>(initialUi.uSortKey);
  const [uSortDir, setUSortDir] = useState<SortDir>(initialUi.uSortDir);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [moonSnapshot, setMoonSnapshot] = useState(() => getVanaNow(Date.now(), cal));
  useEffect(() => {
    setMoonSnapshot(getVanaNow(Date.now(), cal));
  }, [cal, mode]);
  const moonPhase = getFishingMoonPhase(moonSnapshot.moonStep);
  const activeSearch = mode === "affinity" ? aGlobal : mode === "spots" ? sGlobal : uGlobal;

  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
    setSelectedRowKey(null);
    setExpandedSkillupKey(null);
    setExpandedVendorKey(null);
    setExpandedSpotKey(null);
    setExpandedSkillupGroups(new Set());
  }, [mode, activeSearch, uMaxTimeHours, sSkill, sBonusSkill, sSelectedRods, sFishSeconds, sOtherSeconds, sIncludeCop, sIncludeToau]);

  useEffect(() => {
    function onDocumentPointerDown(event: PointerEvent) {
      const dropdown = rodsDropdownRef.current;
      if (!dropdown || !dropdown.open) return;
      if (!dropdown.contains(event.target as Node)) {
        dropdown.open = false;
      }
    }

    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, []);

  useEffect(() => {
    saveJson(BAIT_UI_KEY, {
      mode,
      aGlobal,
      aFish,
      aBait,
      aKind,
      aBite,
      aBestOnly,
      aLvlMin,
      aLvlMax,
      aSortKey,
      aSortDir,
      sGlobal,
      sFish,
      sZone,
      sArea,
      sBait,
      sKind,
      sBite,
      sMinShare,
      sSoloOnly,
      sSkill,
      sBonusSkill,
      sSelectedRods,
      sFishSeconds,
      sOtherSeconds,
      sIncludeCop,
      sIncludeToau,
      sExcludedFish,
      sSaleOverrides,
      sSortKey,
      sSortDir,
      uSkill,
      uFishSeconds,
      uOtherSeconds,
      uExcludedFish,
      uBonusSkill,
      uSelectedRods,
      uIncludeCop,
      uIncludeToau,
      uIncludeAllFish,
      uGlobal,
      uFish,
      uZone,
      uBait,
      uMinShare,
      uMaxTimeHours,
      uSortKey,
      uSortDir,
    } satisfies BaitUiState);
  }, [
    mode,
    aGlobal,
    aFish,
    aBait,
    aKind,
    aBite,
    aBestOnly,
    aLvlMin,
    aLvlMax,
    aSortKey,
    aSortDir,
    sGlobal,
    sFish,
    sZone,
    sArea,
    sBait,
    sKind,
    sBite,
    sMinShare,
    sSoloOnly,
    sSkill,
    sBonusSkill,
    sSelectedRods,
    sFishSeconds,
    sOtherSeconds,
    sIncludeCop,
    sIncludeToau,
    sExcludedFish,
    sSaleOverrides,
    sSortKey,
    sSortDir,
    uSkill,
    uFishSeconds,
    uOtherSeconds,
    uExcludedFish,
    uBonusSkill,
    uSelectedRods,
    uIncludeCop,
    uIncludeToau,
    uIncludeAllFish,
    uGlobal,
    uFish,
    uZone,
    uBait,
    uMinShare,
    uMaxTimeHours,
    uSortKey,
    uSortDir,
  ]);

  function onAffinityHeader(key: AffinityKey) {
    if (key === aSortKey) setASortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setASortKey(key);
      setASortDir(key === "hookBonus" || key === "vendorPriceEach" || key === "best" ? "desc" : "asc");
    }
  }

  function onSpotHeader(key: SpotKey) {
    if (key === sSortKey) setSSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSSortKey(key);
      setSSortDir(
        key === "netGilPerHour" || key === "netGilPerDay" || key === "targetFishPer200" ||
        key === "vendorPriceEach" || key === "baitNeeded" || key === "sharePct"
          ? "desc"
          : "asc"
      );
    }
  }

  function onSkillupHeader(key: SkillupKey) {
    if (key === uSortKey) setUSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setUSortKey(key);
      setUSortDir(
        key === "skillGainPer200" ||
          key === "targetFishPer200" ||
          key === "bestVendorPrice" ||
          key === "targetPct" ||
          key === "fishLevel" ||
          key === "levelDifference" ||
          key === "skillupChancePct" ||
          key === "sharePct" ||
          key === "landPct" ||
          key === "effectiveSkill"
          ? "desc"
          : "asc"
      );
    }
  }

  function clearAffinityFilters() {
    setAGlobal("");
    setAFish("");
    setABait("");
    setAKind("");
    setABite("");
    setABestOnly(false);
    setALvlMin("");
    setALvlMax("");
  }

  function clearSpotFilters() {
    setSGlobal("");
    setSFish("");
    setSZone("");
    setSArea("");
    setSBait("");
    setSKind("");
    setSBite("");
    setSMinShare("");
    setSSoloOnly(false);
    setSIncludeCop(true);
    setSIncludeToau(true);
    setSSortKey("netGilPerHour");
    setSSortDir("desc");
  }

  function clearSkillupFilters() {
    setUGlobal("");
    setUFish("");
    setUZone("");
    setUBait("");
    setUMinShare("");
    setUMaxTimeHours("");
    setUIncludeCop(true);
    setUIncludeToau(true);
    setUSortKey("skillGainPer200");
    setUSortDir("desc");
  }

  function toggleSkillupRod(rodName: string) {
    setUSelectedRods((selected) =>
      selected.includes(rodName)
        ? selected.filter((name) => name !== rodName)
        : [...selected, rodName]
    );
  }

  function toggleSpotRod(rodName: string) {
    setSSelectedRods((selected) =>
      selected.includes(rodName)
        ? selected.filter((name) => name !== rodName)
        : [...selected, rodName]
    );
  }

  function toggleSpotPoolFish(fish: string) {
    setSExcludedFish((excluded) =>
      excluded.includes(fish)
        ? excluded.filter((name) => name !== fish)
        : [...excluded, fish]
    );
  }

  function clearSpotSaleDraft(fish: string) {
    setSAhPriceDrafts((previous) => {
      const next = { ...previous };
      delete next[fish];
      return next;
    });
  }

  function resetSpotDirectPrice(fish: string) {
    setSSaleOverrides((previous) => {
      const next = { ...previous };
      delete next[fish];
      return next;
    });
    clearSpotSaleDraft(fish);
  }

  function applySpotAhPrice(fish: string) {
    const current = sSaleOverrides[fish];
    const priceText = sAhPriceDrafts[fish] ?? (current?.type === "ah" ? current.price : "");
    const price = Number(priceText);
    if (priceText.trim() === "" || !Number.isFinite(price) || price < 0) return;
    setSSaleOverrides((previous) => ({ ...previous, [fish]: { type: "ah", price: priceText } }));
  }

  function selectSpotRecipePrice(fish: string, recipeId: number, tier: string) {
    setSSaleOverrides((previous) => ({ ...previous, [fish]: { type: "recipe", recipeId, tier } }));
    clearSpotSaleDraft(fish);
  }

  /** Carry current affinity filters into the best-spot finder and switch views. */
  function findBestSpots() {
    setSFish(aFish.trim() !== "" ? aFish : aGlobal);
    setSBait(aBait);
    setSZone("");
    setSArea("");
    setSKind(aKind);
    setSBite("");
    setSGlobal("");
    setSMinShare("");
    setSSoloOnly(false);
    setSSortKey("netGilPerHour");
    setSSortDir("desc");
    setMode("spots");
  }

  const affinityActive =
    aGlobal.trim() !== "" ||
    aFish.trim() !== "" ||
    aBait.trim() !== "" ||
    aKind !== "" ||
    aBite !== "" ||
    aBestOnly ||
    aLvlMin.trim() !== "" ||
    aLvlMax.trim() !== "";

  const spotActive =
    sGlobal.trim() !== "" ||
    sFish.trim() !== "" ||
    sZone !== "" ||
    sArea.trim() !== "" ||
    sBait.trim() !== "" ||
    sKind !== "" ||
    sBite !== "" ||
    sMinShare.trim() !== "" ||
    sSoloOnly ||
    !sIncludeCop ||
    !sIncludeToau;

  const skillupFilterActive =
    uGlobal.trim() !== "" ||
    uFish.trim() !== "" ||
    uZone !== "" ||
    uBait.trim() !== "" ||
    uMinShare.trim() !== "" ||
    uMaxTimeHours.trim() !== "" ||
    !uIncludeCop ||
    !uIncludeToau;

  const affinityResults = useMemo(() => {
    const g = aGlobal.trim().toLowerCase();
    const fq = aFish.trim().toLowerCase();
    const bq = aBait.trim().toLowerCase();
    const min = aLvlMin.trim() === "" ? null : Number(aLvlMin);
    const max = aLvlMax.trim() === "" ? null : Number(aLvlMax);

    const filtered = BAIT.filter((b) => {
      if (aKind && b.kind !== aKind) return false;
      if (aBite && b.bite !== aBite) return false;
      if (aBestOnly && !b.best) return false;
      if (fq && !b.fish.toLowerCase().includes(fq)) return false;
      if (bq && !(b.bait ?? "").toLowerCase().includes(bq)) return false;
      if (min !== null && Number.isFinite(min) && (b.lvl === null || b.lvl < min)) return false;
      if (max !== null && Number.isFinite(max) && (b.lvl === null || b.lvl > max)) return false;

      if (g) {
        const hay = [
          b.fish,
          b.lvl === null ? "" : String(b.lvl),
          b.size,
          b.bait ?? "",
          b.kind ?? "",
          b.bite ?? "",
          b.hookBonus === null ? "" : String(b.hookBonus),
          b.best ? "best" : "",
          b.note ?? "",
        ]
          .join(" | ")
          .toLowerCase();
        if (!hay.includes(g)) return false;
      }
      return true;
    });

    return filtered.sort((x, y) => {
      let cmp = 0;
      if (aSortKey === "lvl" || aSortKey === "hookBonus") {
        const xv = x[aSortKey];
        const yv = y[aSortKey];
        if (xv === null && yv === null) cmp = 0;
        else if (xv === null) return 1;
        else if (yv === null) return -1;
        else cmp = xv - yv;
      } else if (aSortKey === "vendorPriceEach") {
        const xv = getVendorPriceEach(x.fish);
        const yv = getVendorPriceEach(y.fish);
        if (xv === null && yv === null) cmp = 0;
        else if (xv === null) return 1;
        else if (yv === null) return -1;
        else cmp = xv - yv;
      } else if (aSortKey === "best") {
        cmp = Number(x.best) - Number(y.best);
      } else {
        cmp = ((x[aSortKey] ?? "") as string).localeCompare((y[aSortKey] ?? "") as string);
      }
      return aSortDir === "asc" ? cmp : -cmp;
    });
  }, [aGlobal, aFish, aBait, aKind, aBite, aBestOnly, aLvlMin, aLvlMax, aSortKey, aSortDir]);

  const spotResults = useMemo(() => {
    const baseSkill = Number(sSkill);
    const bonusSkill = Math.max(0, Math.min(8, Math.floor(Number(sBonusSkill) || 0)));
    if (!Number.isFinite(baseSkill) || baseSkill < 0 || baseSkill > 200) return [];

    const g = sGlobal.trim().toLowerCase();
    const fq = sFish.trim().toLowerCase();
    const aq = sArea.trim().toLowerCase();
    const bq = sBait.trim().toLowerCase();
    const minShare = sMinShare.trim() === "" ? null : Number(sMinShare);
    const selectedRodNames = new Set(sSelectedRods);
    const availableRods = SKILLUP_RODS.filter((rod) => selectedRodNames.has(rod.rod));
    const estimates = new Map<string, {
      names: string[];
      odds: ReturnType<typeof calculateCastOdds>;
      session: ReturnType<typeof calculatePoolSession>;
      effectiveSkill: number;
    }>();
    const rows: ProfitSpotRow[] = [];

    for (const pool of POOLS) {
      if (pool.lvl === null) continue;
      if (sZone && pool.zone !== sZone) continue;
      if (sKind && pool.kind !== sKind) continue;
      if (sBite && pool.bite !== sBite) continue;
      if (fq && !pool.fish.toLowerCase().includes(fq)) continue;
      if (aq && !pool.area.toLowerCase().includes(aq)) continue;
      if (bq && !pool.bait.toLowerCase().includes(bq)) continue;
      if (!sIncludeCop && COP_LOCKED_ZONES.has(pool.zone)) continue;
      if (!sIncludeToau && TOAU_LOCKED_ZONES.has(pool.zone)) continue;

      const areaKey = `${normalizeFishingName(pool.zone)}|${normalizeFishingName(pool.area)}`;
      const area = PLANNER_AREAS[areaKey];
      const bait = PLANNER_BAITS[pool.bait];
      const fish = PLANNER_FISH[pool.fish];
      if (!area || !bait || !fish) continue;

      for (const rod of availableRods) {
        const effectiveSkill = Math.floor(baseSkill) + bonusSkill + getRodHiddenSuccessBonus(rod.rod);
        const estimateKey = `${areaKey}|${pool.bait}|${pool.kind}|${rod.rod}|${effectiveSkill}`;
        let estimate = estimates.get(estimateKey);
        if (!estimate) {
          const members = area.allMembers
            .map((name) => PLANNER_FISH[name])
            .filter((member) => member && !member.item && !phoenixFish[member.fish]?.disabled && bait.fish[member.fish] !== undefined)
            .map((member) => ({ ...member, hookBonus: bait.fish[member.fish] }));
          const items = area.allMembers
            .map((name) => PLANNER_FISH[name])
            .filter((member) => member?.item);
          if (members.length === 0) continue;

          const options = {
            city: isCityFishingZone(pool.zone),
            hasItems: items.length > 0,
            hasMobs: area.hasMobs,
            difficulty: area.difficulty,
            poorFish: bait.poorFish,
            shellfishBait: bait.shellfishBait,
            moonPhase,
          };
          const odds = calculateCastOdds(effectiveSkill, rod, members, options);
          const session = calculatePoolSession({
            baseSkill,
            bonusSkill,
            zone: pool.zone,
            rod,
            fish: members,
            options,
            baitKind: pool.kind,
            excludedFish: sExcludedFish,
            timing: spotTiming,
            trackSkillProgress: false,
          });
          estimate = { names: members.map((member) => member.fish), odds, session, effectiveSkill };
          estimates.set(estimateKey, estimate);
        }

        const targetIndex = estimate.names.indexOf(pool.fish);
        if (targetIndex < 0) continue;
        const targetCatches = estimate.session.catches[targetIndex];
        if (targetCatches === null || targetCatches === undefined || targetCatches <= 0) continue;
        const targetPct = estimate.odds.targetPct[targetIndex];
        const fishPct = estimate.odds.fishPct;
        const sharePct = fishPct > 0 ? (100 * targetPct) / fishPct : 0;
        if (sSoloOnly && sharePct < 100) continue;
        if (minShare !== null && Number.isFinite(minShare) && sharePct < minShare) continue;

        const catchBreakdown = estimate.names.map((name, index) => {
          const catches = estimate.session.catches[index];
          const sale = getFishingSaleOption(name, sSaleOverrides[name]);
          return {
            fish: name,
            size: PLANNER_FISH[name]?.size ?? "-",
            level: PLANNER_FISH[name]?.skillCap ?? 0,
            catches,
            salePrice: sale.price,
            saleLabel: sale.label,
            grossGil: catches === 0 ? 0 : catches === null || sale.price === null ? null : catches * sale.price,
            included: !sExcludedFish.includes(name),
          };
        });
        const grossGilPerDay = catchBreakdown.every((entry) => entry.catches === 0 || entry.grossGil !== null)
          ? catchBreakdown.reduce((total, entry) => total + (entry.grossGil ?? 0), 0)
          : null;
        const baitNeeded = estimate.session.baitNeeded;
        const baitCostPerDay = pool.kind === "Lure"
          ? 0
          : baitNeeded === null
            ? null
            : (() => {
                const price = getFishingVendorOptions(pool.bait).rawPrice;
                return price === null ? null : baitNeeded * price;
              })();
        const netGilPerDay = grossGilPerDay === null || baitCostPerDay === null
          ? null
          : grossGilPerDay - baitCostPerDay;
        const catchTimeSeconds = estimate.session.catchTimeSeconds;
        const sale = getFishingSaleOption(pool.fish, sSaleOverrides[pool.fish]);
        const risk = calculateRodRisk(estimate.effectiveSkill, fish, rod);
        const candidate: ProfitSpotRow = {
          ...pool,
          rod: rod.rod,
          effectiveSkill: estimate.effectiveSkill,
          salePrice: sale.price,
          saleLabel: sale.label,
          catchTimeSeconds,
          targetFishPer200: targetCatches,
          grossGilPerDay,
          baitCostPerDay,
          netGilPerDay,
          netGilPerHour: netGilPerDay === null || catchTimeSeconds === null || catchTimeSeconds <= 0
            ? null
            : (netGilPerDay * 3600) / catchTimeSeconds,
          sessionCasts: estimate.session.casts,
          fatigueUsed: estimate.session.fatigueUsed,
          baitNeeded,
          fishPct,
          itemPct: estimate.odds.itemPct,
          mobPct: estimate.odds.mobPct,
          nothingPct: estimate.odds.nothingPct,
          targetPct,
          fight: calculateFishingFight(estimate.effectiveSkill, fish, rod, pool.kind),
          risk,
          catchBreakdown,
        };

        if (g) {
          const haystack = [
            candidate.fish, candidate.zone, candidate.area, candidate.bait, candidate.rod,
            candidate.kind, candidate.bite, candidate.competing.join(", "),
          ].join(" | ").toLowerCase();
          if (!haystack.includes(g)) continue;
        }
        rows.push(candidate);
      }
    }

    const numericKeys: SpotKey[] = [
      "netGilPerHour", "netGilPerDay", "catchTimeSeconds", "targetFishPer200",
      "vendorPriceEach", "baitNeeded", "sharePct",
    ];
    const numericValue = (row: ProfitSpotRow): number | null => {
      switch (sSortKey) {
        case "netGilPerHour": return row.netGilPerHour;
        case "netGilPerDay": return row.netGilPerDay;
        case "catchTimeSeconds": return row.catchTimeSeconds;
        case "targetFishPer200": return row.targetFishPer200;
        case "vendorPriceEach": return row.salePrice;
        case "baitNeeded": return row.baitNeeded;
        case "sharePct": return row.sharePct;
        default: return null;
      }
    };
    return rows.sort((first, second) => {
      let comparison = 0;
      if (numericKeys.includes(sSortKey)) {
        const firstValue = numericValue(first);
        const secondValue = numericValue(second);
        if (firstValue === null && secondValue !== null) return 1;
        if (secondValue === null && firstValue !== null) return -1;
        comparison = Number(firstValue ?? 0) - Number(secondValue ?? 0);
      } else {
        const textValue = (row: ProfitSpotRow) => sSortKey === "zone" ? row.zone
          : sSortKey === "area" ? row.area
            : sSortKey === "fish" ? row.fish
              : sSortKey === "bait" ? row.bait
                : row.rod;
        comparison = textValue(first).localeCompare(textValue(second));
      }
      if (comparison === 0) comparison = (second.netGilPerHour ?? 0) - (first.netGilPerHour ?? 0);
      return sSortDir === "asc" ? comparison : -comparison;
    });
  }, [
    moonPhase, sSkill, sBonusSkill, sSelectedRods, sExcludedFish, sSaleOverrides, spotTiming, sIncludeCop, sIncludeToau,
    sGlobal, sFish, sZone, sArea, sBait, sKind, sBite, sMinShare, sSoloOnly, sSortKey, sSortDir,
  ]);

  const skillupResults = useMemo(() => {
    const baseSkill = Number(uSkill);
    const bonusSkill = Math.max(0, Math.min(8, Math.floor(Number(uBonusSkill) || 0)));
    if (!Number.isFinite(baseSkill) || baseSkill < 0 || baseSkill > 200) return [];

    const globalQuery = uGlobal.trim().toLowerCase();
    const fishQuery = uFish.trim().toLowerCase();
    const baitQuery = uBait.trim().toLowerCase();
    const minimumShare = uMinShare.trim() === "" ? null : Number(uMinShare);
    const maximumHours = uMaxTimeHours.trim() === "" ? null : Number(uMaxTimeHours);
    const maximumSeconds = maximumHours !== null && Number.isFinite(maximumHours) && maximumHours >= 0 ? maximumHours * 3600 : null;

    const selectedRodNames = new Set(uSelectedRods);
    const availableRods = SKILLUP_RODS.filter((rod) => selectedRodNames.has(rod.rod));

    const rows: SkillupRow[] = [];
    const excludedFish = uExcludedFish;
    const estimates = new Map<string, {
      fishPct: number; itemPct: number; mobPct: number; nothingPct: number;
      targetPct: number[]; names: string[]; gains: number[]; totalGain: number; itemHazards: string;
      catchTimeSeconds: number | null; catches: (number | null)[];
      catchBreakdown: SkillupRow["catchBreakdown"];
      skillGain: number | null; casts: number | null; fatigueUsed: number | null; baitNeeded: number | null; attemptedFishPct: number;
    }>();
    for (const pool of POOLS) {
      if (pool.lvl === null) continue;
      const fish = PLANNER_FISH[pool.fish];
      if (!fish) continue;
      const areaKey = `${normalizeFishingName(pool.zone)}|${normalizeFishingName(pool.area)}`;
      const area = PLANNER_AREAS[areaKey];
      const bait = PLANNER_BAITS[pool.bait];
      if (!area || !bait) continue;
      if (!uIncludeCop && COP_LOCKED_ZONES.has(pool.zone)) continue;
      if (!uIncludeToau && TOAU_LOCKED_ZONES.has(pool.zone)) continue;
      if (uZone && pool.zone !== uZone) continue;
      if (fishQuery && !pool.fish.toLowerCase().includes(fishQuery)) continue;
      if (baitQuery && !pool.bait.toLowerCase().includes(baitQuery)) continue;

      for (const rod of availableRods) {
        const hiddenRodSkill = getRodHiddenSuccessBonus(rod.rod);
        const effectiveSkill = Math.floor(baseSkill) + bonusSkill + hiddenRodSkill;
        const skillup = calculateSkillup(baseSkill, fish.skillCap, pool.zone, rod.rod);
        if (!uIncludeAllFish && (!skillup.eligible || fish.restricted)) continue;

        const estimateKey = `${areaKey}|${pool.bait}|${rod.rod}`;
        let estimate = estimates.get(estimateKey);
        if (!estimate) {
          const areaMembers = uIncludeAllFish ? area.allMembers : area.members;
          const members = areaMembers.map(name => PLANNER_FISH[name]).filter(member => member && !member.item && bait.fish[member.fish] !== undefined)
            .map(member => ({ ...member, hookBonus: bait.fish[member.fish] }));
          const items = areaMembers.map(name => PLANNER_FISH[name]).filter(member => member?.item);
          const options = {
            city: isCityFishingZone(pool.zone), hasItems: items.length > 0, hasMobs: area.hasMobs,
            difficulty: area.difficulty, poorFish: bait.poorFish, shellfishBait: bait.shellfishBait,
            moonPhase,
          };
          const odds = calculateCastOdds(effectiveSkill, rod, members, options);
          const gains = calculatePoolSkillup(baseSkill, effectiveSkill, pool.zone, rod, members, odds.targetPct, pool.kind);
          const session = calculatePoolSession({ baseSkill, bonusSkill, zone: pool.zone, rod, fish: members, options, baitKind: pool.kind, excludedFish, timing: { fishSeconds, otherSeconds } });
          const retainedGains = gains.gains.map((gain, index) => excludedFish.includes(members[index].fish) ? 0 : gain);
          const itemHazards = items.filter(item => calculateRodRisk(effectiveSkill, item, rod).breakPct > 0).map(item => item.fish).join(", ");
          estimate = {
            ...odds, ...session, gains: retainedGains, totalGain: retainedGains.reduce((sum, gain) => sum + gain, 0), names: members.map(member => member.fish), itemHazards,
            attemptedFishPct: odds.targetPct.reduce((sum, value, index) => sum + (excludedFish.includes(members[index].fish) ? 0
              : value * calculateFishingFight(effectiveSkill, members[index], rod, pool.kind).attemptedPct / 100), 0),
            catchBreakdown: members.map((member, index) => ({
              fish: member.fish, size: member.size, level: member.skillCap, included: !excludedFish.includes(member.fish),
              catches: excludedFish.includes(member.fish) ? 0 : session.catches[index],
              skillGain: excludedFish.includes(member.fish) ? 0 : session.gains[index],
            })),
          };
          estimates.set(estimateKey, estimate);
        }
        if (maximumSeconds !== null && (estimate.catchTimeSeconds === null || !Number.isFinite(estimate.catchTimeSeconds) || estimate.catchTimeSeconds > maximumSeconds)) continue;
        const targetIndex = estimate.names.indexOf(pool.fish);
        if (targetIndex < 0) continue;
        const targetPct = estimate.targetPct[targetIndex];
        const sharePct = estimate.fishPct ? 100 * targetPct / estimate.fishPct : 0;
        if (minimumShare !== null && Number.isFinite(minimumShare) && sharePct < minimumShare) continue;
        const risk = calculateRodRisk(effectiveSkill, fish, rod);
        const expectedResolvedGain = skillup.expectedGainPerTargetHook * targetPct;
        const expectedLandedGain = estimate.totalGain;
        const candidate: SkillupRow = {
          ...pool,
          catchTimeSeconds: estimate.catchTimeSeconds,
          targetFishPer200: excludedFish.includes(pool.fish) ? 0 : estimate.catches[targetIndex],
          catchBreakdown: estimate.catchBreakdown,
          skillGainPer200: estimate.catchBreakdown.find(member => member.fish === pool.fish)?.skillGain ?? null,
          poolSkillGainPer200: estimate.skillGain,
          sessionCasts: estimate.casts,
          fatigueUsed: estimate.fatigueUsed,
          baitNeeded: estimate.baitNeeded,
          attemptedFishPct: estimate.attemptedFishPct,
          fight: calculateFishingFight(effectiveSkill, fish, rod, pool.kind),
          sharePct,
          fishPct: estimate.fishPct,
          itemPct: estimate.itemPct,
          mobPct: estimate.mobPct,
          nothingPct: estimate.nothingPct,
          targetPct,
          targetGain: estimate.gains[targetIndex],
          itemHazards: estimate.itemHazards,
          fishLevel: fish.skillCap,
          levelDifference: skillup.difference,
          skillupChancePct: skillup.chancePct,
          expectedResolvedGain,
          expectedLandedGain,
          rod: rod.rod,
          effectiveSkill,
          landPct: risk.landPct,
          snapPct: risk.snapPct,
          breakPct: risk.breakPct,
          escapePct: risk.escapePct,
        };

        if (globalQuery) {
          const haystack = [
            candidate.fish,
            candidate.zone,
            candidate.area,
            candidate.bait,
            candidate.rod,
            candidate.kind,
            candidate.bite,
          ]
            .join(" | ")
            .toLowerCase();
          if (!haystack.includes(globalQuery)) continue;
        }
        rows.push(candidate);
      }
    }

    return rows.sort((a, b) => {
      let comparison = 0;
      if (uSortKey === "catchTimeSeconds" || uSortKey === "targetFishPer200" || uSortKey === "skillGainPer200") {
        if (a[uSortKey] === null && b[uSortKey] !== null) return 1;
        if (b[uSortKey] === null && a[uSortKey] !== null) return -1;
        comparison = (a[uSortKey] ?? 0) - (b[uSortKey] ?? 0);
      } else if (uSortKey === "bestVendorPrice") {
        const first = getFishingVendorOptions(a.fish).bestPrice;
        const second = getFishingVendorOptions(b.fish).bestPrice;
        if (first === null && second !== null) return 1;
        if (second === null && first !== null) return -1;
        comparison = (first ?? 0) - (second ?? 0);
      } else if (
        uSortKey === "fishLevel" ||
        uSortKey === "levelDifference" ||
        uSortKey === "skillupChancePct" ||
        uSortKey === "sharePct" ||
        uSortKey === "landPct" ||
        uSortKey === "fishPct" ||
        uSortKey === "itemPct" ||
        uSortKey === "mobPct" ||
        uSortKey === "nothingPct" ||
        uSortKey === "targetPct" ||
        uSortKey === "effectiveSkill"
      ) {
        comparison = a[uSortKey] - b[uSortKey];
      } else {
        comparison = a[uSortKey].localeCompare(b[uSortKey]);
      }
      if (comparison === 0) return (b.skillGainPer200 ?? -1) - (a.skillGainPer200 ?? -1);
      return uSortDir === "asc" ? comparison : -comparison;
    });
  }, [
    moonPhase,
    uSkill,
    fishSeconds,
    otherSeconds,
    uExcludedFish,
    uBonusSkill,
    uSelectedRods,
    uIncludeCop,
    uIncludeToau,
    uIncludeAllFish,
    uGlobal,
    uFish,
    uZone,
    uBait,
    uMinShare,
    uMaxTimeHours,
    uSortKey,
    uSortDir,
  ]);

  const skillupGroups = useMemo(() => groupSkillupRows(skillupResults), [skillupResults]);
  const visibleSkillupRows = useMemo(() => {
    const entries: { row: SkillupRow; group?: { key: string; rows: SkillupRow[] }; nested: boolean }[] = [];
    const visibleGroups = skillupGroups.slice(0, MAX_VISIBLE_ROWS);
    const editedGroup = expandedSkillupKey ? skillupGroups.find(group => group.rows.some(row => `${row.zone}|${row.area}|${row.fish}|${row.bait}|${row.rod}` === expandedSkillupKey)) : undefined;
    if (editedGroup && !visibleGroups.includes(editedGroup)) visibleGroups[visibleGroups.length - 1] = editedGroup;
    for (const group of visibleGroups) {
      if (group.rows.length === 1) entries.push({ row: group.rows[0], nested: false });
      else {
        entries.push({ row: group.rows[0], group, nested: false });
        if (expandedSkillupGroups.has(group.key) || group.rows.some(row => `${row.zone}|${row.area}|${row.fish}|${row.bait}|${row.rod}` === expandedSkillupKey)) {
          entries.push(...group.rows.map(row => ({ row, nested: true })));
        }
      }
    }
    return entries;
  }, [skillupGroups, expandedSkillupGroups, expandedSkillupKey]);

  const results = mode === "affinity" ? affinityResults : mode === "spots" ? spotResults : skillupGroups;
  const visibleCount = Math.min(results.length, MAX_VISIBLE_ROWS);

  const selectFilter = (
    label: string,
    value: string,
    setter: (v: string) => void,
    options: string[],
    width = 170
  ) => (
    <div style={{ ...styles.field, width }}>
      <div style={styles.label}>{label}</div>
      <select style={styles.selectCompact} value={value} onChange={(e) => setter(e.target.value)}>
        <option value="" style={optionBaseStyle}>
          Any
        </option>
        {options.map((o) => (
          <option key={o} value={o} style={optionBaseStyle}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );

  const textFilter = (
    label: string,
    value: string,
    setter: (v: string) => void,
    placeholder: string,
    width = 200
  ) => (
    <div style={{ ...styles.field, width }}>
      <div style={styles.label}>{label}</div>
      <input
        style={styles.inputCompact}
        value={value}
        onChange={(e) => setter(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <section style={styles.card}>
      <div style={styles.titleRow}>
        <h3 style={styles.h3}>
          {mode === "affinity"
            ? "Bait Affinity (Fish × Bait)"
            : mode === "spots"
              ? "Best Fishing Spots (Gil & Time)"
              : "Fishing Skill-up Planner"}
        </h3>
        <div style={styles.sub}>
          {mode === "skillup"
            ? `${skillupGroups.length.toLocaleString()} location groups / ${skillupResults.length.toLocaleString()} combinations`
            : mode === "spots"
              ? `${spotResults.length.toLocaleString()} calculated fishing combinations`
              : `${results.length.toLocaleString()} of ${BAIT.length.toLocaleString()} entries`}
          {results.length > MAX_VISIBLE_ROWS ? ` (showing first ${MAX_VISIBLE_ROWS} — refine filters)` : ""}
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
        {activeMode === undefined && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            style={mode === "affinity" ? styles.buttonPrimaryCompact : styles.buttonCompact}
            onClick={() => setMode("affinity")}
          >
            Bait list
          </button>
          <button
            style={mode === "spots" ? styles.buttonPrimaryCompact : styles.buttonCompact}
            onClick={() => setMode("spots")}
          >
            Best spots
          </button>
          <button
            style={mode === "skillup" ? styles.buttonPrimaryCompact : styles.buttonCompact}
            onClick={() => setMode("skillup")}
          >
            Skill-up planner
          </button>
        </div>}

        <CollapsibleSection kind="search" style={mode === "skillup" ? styles.subCard : undefined}>
        {mode === "affinity" ? (
          <div style={styles.subCard}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              {textFilter("Search everything", aGlobal, setAGlobal, "e.g. moat carp", 240)}
              {textFilter("Fish", aFish, setAFish, "e.g. carp")}
              {textFilter("Bait", aBait, setABait, "e.g. lugworm")}
              {selectFilter("Kind", aKind, setAKind, KINDS, 130)}
              {selectFilter("Bite", aBite, setABite, BITES, 140)}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ ...styles.field, width: 90 }}>
                <div style={styles.label}>Lvl min</div>
                <input
                  style={styles.inputCompact}
                  type="number"
                  inputMode="numeric"
                  value={aLvlMin}
                  onChange={(e) => setALvlMin(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div style={{ ...styles.field, width: 90 }}>
                <div style={styles.label}>Lvl max</div>
                <input
                  style={styles.inputCompact}
                  type="number"
                  inputMode="numeric"
                  value={aLvlMax}
                  onChange={(e) => setALvlMax(e.target.value)}
                  placeholder="120"
                />
              </div>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  height: 32,
                  fontSize: 13,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <input type="checkbox" checked={aBestOnly} onChange={(e) => setABestOnly(e.target.checked)} />
                Best bait only
              </label>

              <button
                style={{ ...styles.buttonCompact, ...(affinityActive ? {} : styles.buttonDisabled) }}
                onClick={clearAffinityFilters}
                disabled={!affinityActive}
              >
                Clear filters
              </button>

              <button
                style={styles.buttonPrimaryCompact}
                onClick={findBestSpots}
                title="Find the zones/areas where the filtered fish is easiest to target (fewest competing fish on the same bait)"
              >
                Find best spot →
              </button>
            </div>

            <div style={{ marginTop: 8, ...styles.sub }}>
              “Best” here = highest hook bonus for that fish. Use “Find best spot” to factor in pool competition —
              where other fish steal bites on the same bait.
            </div>
          </div>
        ) : mode === "spots" ? (
          <div style={styles.subCard}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ ...styles.field, width: 115 }}>
                <div style={styles.label}>Fishing skill</div>
                <input style={styles.inputCompact} type="number" min={0} max={200} step={1} value={sSkill}
                  onChange={(event) => setSSkill(event.target.value)} placeholder="e.g. 75" />
              </div>
              <div style={{ ...styles.field, width: 150 }}>
                <div style={styles.label}>Gear/support +skill (0–8)</div>
                <input style={styles.inputCompact} type="number" min={0} max={8} step={1} value={sBonusSkill}
                  onChange={(event) => setSBonusSkill(event.target.value)} placeholder="0" />
              </div>
              <div style={{ ...styles.field, width: 230, position: "relative" }}>
                <div style={styles.label}>Rods to compare</div>
                <details ref={rodsDropdownRef} style={{ position: "relative" }}>
                  <summary style={{ ...styles.selectCompact, boxSizing: "border-box", cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center" }}>
                    {sSelectedRods.length === 0 ? "No rods selected" : `${sSelectedRods.length} rod${sSelectedRods.length === 1 ? "" : "s"} selected`}
                  </summary>
                  <div style={{ position: "absolute", zIndex: 20, top: "calc(100% + 4px)", left: 0, width: 280, maxHeight: 330,
                    overflowY: "auto", padding: 10, border: "1px solid rgba(255,255,255,0.22)", borderRadius: 8,
                    background: "#111", boxShadow: "0 10px 30px rgba(0,0,0,0.55)" }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <button type="button" style={styles.buttonCompact} onClick={() => setSSelectedRods(SKILLUP_ROD_NAMES)}>Select all</button>
                      <button type="button" style={styles.buttonCompact} onClick={() => setSSelectedRods([])}>None</button>
                    </div>
                    <div style={{ display: "grid", gap: 7 }}>
                      {SKILLUP_RODS.map((rod) => <label key={rod.rodId} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                        <input type="checkbox" checked={sSelectedRods.includes(rod.rod)} onChange={() => toggleSpotRod(rod.rod)} />
                        <span>{rod.rod}</span>
                      </label>)}
                    </div>
                  </div>
                </details>
              </div>
              <label style={{ ...styles.field, width: 145 }} title="Estimated full cycle from starting a fish cast to starting the next cast, including waiting, fighting, reeling and recasting.">
                <span style={styles.label}>Fish cast cycle (s)</span>
                <input aria-label="Fish cast cycle (s)" style={styles.inputCompact} type="number" min={1} step={1} value={sFishSeconds}
                  onChange={(event) => setSFishSeconds(event.target.value)} onBlur={() => setSFishSeconds(String(spotFishSeconds))} />
              </label>
              <label style={{ ...styles.field, width: 155 }} title="Estimated full cycle for canceled fish, items, monsters or no bites, including waiting, canceling and recasting.">
                <span style={styles.label}>Other cast cycle (s)</span>
                <input aria-label="Other cast cycle (s)" style={styles.inputCompact} type="number" min={1} step={1} value={sOtherSeconds}
                  onChange={(event) => setSOtherSeconds(event.target.value)} onBlur={() => setSOtherSeconds(String(spotOtherSeconds))} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={sIncludeCop} onChange={(event) => setSIncludeCop(event.target.checked)} /> CoP areas
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={sIncludeToau} onChange={(event) => setSIncludeToau(event.target.checked)} /> ToAU areas
              </label>
            </div>
            {(sSkill.trim() === "" || !Number.isFinite(Number(sSkill)) || Number(sSkill) < 0 || Number(sSkill) > 200) &&
              <div role="alert" style={{ color: "#ff9c7a", fontSize: 13, marginTop: 8 }}>Enter a fishing skill from 0 to 200 to calculate spot estimates.</div>}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              {textFilter("Search everything", sGlobal, setSGlobal, "fish, rod, zone, bait", 230)}
              {textFilter("Fish", sFish, setSFish, "any fish, any level", 180)}
              {selectFilter("Zone", sZone, setSZone, POOL_ZONES, 190)}
              {textFilter("Area", sArea, setSArea, "e.g. whole zone", 150)}
              {textFilter("Bait / lure", sBait, setSBait, "e.g. lugworm", 150)}
              {selectFilter("Kind", sKind, setSKind, KINDS, 115)}
              {selectFilter("Bite", sBite, setSBite, POOL_BITES, 130)}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ ...styles.field, width: 120 }}>
                <div style={styles.label}>Min pool share %</div>
                <input
                  style={styles.inputCompact}
                  type="number"
                  inputMode="numeric"
                  value={sMinShare}
                  onChange={(e) => setSMinShare(e.target.value)}
                  placeholder="e.g. 80"
                />
              </div>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  height: 32,
                  fontSize: 13,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <input type="checkbox" checked={sSoloOnly} onChange={(e) => setSSoloOnly(e.target.checked)} />
                100% target bites
              </label>

              <button
                style={{ ...styles.buttonCompact, ...(spotActive ? {} : styles.buttonDisabled) }}
                onClick={clearSpotFilters}
                disabled={!spotActive}
              >
                Clear filters
              </button>
            </div>

            <div style={{ marginTop: 8, ...styles.sub }}>
              Sort by net gil per hour or day to compare money; sort by time or target catches for speed. Daily estimates stop at 200 landed fish or 20,000 fatigue, whichever comes first, using your entered skill without skill progression. Direct NPC prices are the default; AH prices can be entered and recipe output values selected per fish. Net estimates subtract consumable bait costs but do not include auction fees or recipe ingredients and synthesis failures. One reusable lure is counted, with replacement after loss excluded. All fishing prerequisites are assumed met.
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ ...styles.field, width: 120 }}>
                <div style={styles.label}>Base fishing skill</div>
                <input
                  style={styles.inputCompact}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={200}
                  step={1}
                  value={uSkill}
                  onChange={(event) => setUSkill(event.target.value)}
                  placeholder="e.g. 1"
                />
              </div>
              <div style={{ ...styles.field, width: 155 }}>
                <div style={styles.label}>Gear/support +skill (0–8)</div>
                <input
                  style={styles.inputCompact}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={8}
                  step={1}
                  value={uBonusSkill}
                  onChange={(event) => setUBonusSkill(event.target.value)}
                  placeholder="5"
                />
              </div>
              <div style={{ ...styles.field, width: 240, position: "relative" }}>
                <div style={styles.label}>Rods to compare</div>
                <details ref={rodsDropdownRef} style={{ position: "relative" }}>
                  <summary
                    style={{
                      ...styles.selectCompact,
                      boxSizing: "border-box",
                      cursor: "pointer",
                      listStyle: "none",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {uSelectedRods.length === 0
                      ? "No rods selected"
                      : `${uSelectedRods.length} rod${uSelectedRods.length === 1 ? "" : "s"} selected`}
                  </summary>
                  <div
                    style={{
                      position: "absolute",
                      zIndex: 20,
                      top: "calc(100% + 4px)",
                      left: 0,
                      width: 280,
                      maxHeight: 330,
                      overflowY: "auto",
                      padding: 10,
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: 8,
                      background: "#111",
                      boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <button style={styles.buttonCompact} onClick={() => setUSelectedRods(SKILLUP_ROD_NAMES)}>
                        Select all
                      </button>
                      <button style={styles.buttonCompact} onClick={() => setUSelectedRods([])}>
                        None
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: 7 }}>
                      {SKILLUP_RODS.map((rod) => (
                        <label
                          key={rod.rodId}
                          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}
                        >
                          <input
                            type="checkbox"
                            checked={uSelectedRods.includes(rod.rod)}
                            onChange={() => toggleSkillupRod(rod.rod)}
                          />
                          <span>{rod.rod}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </details>
              </div>
              <label style={{ ...styles.field, width: 150 }} title="Estimated full cycle from starting a fish cast to starting the next cast, including waiting, fighting, failures, reeling and recasting.">
                <span style={styles.label}>Fish cast cycle (s)</span>
                <input aria-label="Fish cast cycle (s)" style={styles.inputCompact} type="number" min={1} step={1}
                  value={uFishSeconds} placeholder={String(DEFAULT_FISHING_TIMING.fishSeconds)}
                  onChange={event => setUFishSeconds(event.target.value)} onBlur={() => setUFishSeconds(String(fishSeconds))} />
              </label>
              <label style={{ ...styles.field, width: 160 }} title="Estimated full cycle for canceled fish, items, monsters or no bites, including waiting, canceling and recasting. Not an extra delay after a fish cast.">
                <span style={styles.label}>Cancel / non-fish cycle (s)</span>
                <input aria-label="Cancel / non-fish cycle (s)" style={styles.inputCompact} type="number" min={1} step={1}
                  value={uOtherSeconds} placeholder={String(DEFAULT_FISHING_TIMING.otherSeconds)}
                  onChange={event => setUOtherSeconds(event.target.value)} onBlur={() => setUOtherSeconds(String(otherSeconds))} />
              </label>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", minHeight: 32 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}
                  title="General catch planning, including legendary, capped and prerequisite-gated fish. Assumes all fishing prerequisites are met; disabled fish remain excluded. Lures complete fish fights, including epic catches, in either mode and can be lost. Existing search, rod and area filters still apply.">
                  <input type="checkbox" checked={uIncludeAllFish} onChange={event => {
                    setUIncludeAllFish(event.target.checked);
                    setUSortKey(event.target.checked ? "targetFishPer200" : "skillGainPer200");
                    setUSortDir("desc");
                  }} />
                  Include all catchable fish
                </label>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 13,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  <input type="checkbox" checked={uIncludeCop} onChange={(event) => setUIncludeCop(event.target.checked)} />
                  CoP
                </label>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 13,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={uIncludeToau}
                    onChange={(event) => setUIncludeToau(event.target.checked)}
                  />
                  ToAU
                </label>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              {textFilter("Fish", uFish, setUFish, "e.g. carp", 170)}
              {textFilter("Bait", uBait, setUBait, "e.g. lugworm", 170)}
              {selectFilter("Zone", uZone, setUZone, POOL_ZONES, 200)}
              {textFilter("Search everything", uGlobal, setUGlobal, "fish, rod, zone, bait", 240)}
              <div style={{ ...styles.field, width: 120 }}>
                <div style={styles.label}>Min share %</div>
                <input
                  style={styles.inputCompact}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  value={uMinShare}
                  onChange={(event) => setUMinShare(event.target.value)}
                  placeholder="e.g. 50"
                />
              </div>
              <label style={{ ...styles.field, width: 200, maxWidth: "100%" }} title="Maximum estimated time to reach 200 retained fish or 20,000 fatigue, including failed attempts and canceled casts. Blank means no limit.">
                <span style={styles.label}>Max time / day (hours)</span>
                <input
                  style={styles.inputCompact}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={uMaxTimeHours}
                  onChange={(event) => setUMaxTimeHours(event.target.value)}
                  placeholder="No limit"
                />
              </label>
              <button
                style={{ ...styles.buttonCompact, ...(skillupFilterActive ? {} : styles.buttonDisabled) }}
                onClick={clearSkillupFilters}
                disabled={!skillupFilterActive}
              >
                Clear filters
              </button>
            </div>

          </div>
        )}
        </CollapsibleSection>

        {(mode === "skillup" || mode === "spots") && <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, fontSize: 13 }}>
          <span>Moon snapshot: {moonDirectionFromStep(moonSnapshot.moonStep)} {moonSnapshot.moonPercent}% ({moonSnapshot.moonPhaseName})</span>
          <button type="button" style={styles.buttonCompact} onClick={() => setMoonSnapshot(getVanaNow(Date.now(), cal))}>Recalculate with current moon</button>
        </div>}
        {mode === "skillup" && <details style={{ fontSize: 13, opacity: 0.85 }}>
          <summary style={{ cursor: "pointer" }}>Planning assumptions</summary>
          <p>Moon is sampled when this planner opens or you select Recalculate with current moon. The snapshot stays fixed as you change settings and throughout the projected session. Moon affects fish preferences and fish/item/monster/no-bite odds, not the direct skill-up roll. Time of day, season and weather remain neutral; cast timings remain your estimates. Live conditions can differ.</p>
          <p>{SESSION_SKILL_ASSUMPTIONS}</p>
          <p>{catchTimeAssumptions}</p>
          <p>{TARGET_COUNT_ASSUMPTIONS}</p>
          <p>Consumable bait needed until the daily limit, rounded up. Includes landings, natural snaps, rod breaks, and canceled fish, items and monsters; excludes no bites and pre-rolled escapes. Lures: 1 reusable lure. No replacement spares or supply buffer included.</p>
          <p>Outcomes before cancellations are modeled per 100 target-fish hooks if every fight is completed, before lure-policy cancellations. These are final probabilities, not conditional rolls; minigame failures are excluded. Fish level is the fishing skill cap.</p>
        </details>}

        <div
          ref={resultsRef}
          style={{
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 12,
            overflow: "auto",
            maxHeight: resultsHeight ?? "62vh",
            background: "rgba(255,255,255,0.015)",
          }}
        >
          {mode === "affinity" ? (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {AFFINITY_COLUMNS.map((col) => {
                    const active = col.key === aSortKey;
                    return (
                      <th
                        key={col.key}
                        style={{ ...thStyle, ...(active ? { color: "#8af6b0" } : {}) }}
                        onClick={() => onAffinityHeader(col.key)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}
                        {active ? (aSortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleCount === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={AFFINITY_COLUMNS.length}>
                      No matches. Try clearing some filters.
                    </td>
                  </tr>
                ) : (
                  affinityResults.slice(0, MAX_VISIBLE_ROWS).map((b, i) => {
                    const rowKey = `affinity|${b.fish}|${b.bait}|${i}`;
                    const selected = selectedRowKey === rowKey;
                    return (
                    <tr
                      key={rowKey}
                      onClick={() => setSelectedRowKey(rowKey)}
                      style={{ ...clickableRowStyle, ...(selected ? selectedRowStyle : {}) }}
                      title="Click to highlight this row"
                    >
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{b.fish}</td>
                      <td style={tdStyle}>{b.lvl ?? "-"}</td>
                      <td style={tdStyle}>{b.size}</td>
                      <td style={tdStyle}>{b.bait ?? "—"}</td>
                      <td style={tdStyle}>{b.kind ?? "-"}</td>
                      <td style={tdStyle}>{b.bite ?? "-"}</td>
                      <td style={tdStyle}>{b.hookBonus !== null ? `+${b.hookBonus}` : "-"}</td>
                      <td style={tdStyle}>{formatVendorPrice(getVendorPriceEach(b.fish))}</td>
                      <td style={{ ...tdStyle, ...(b.best ? { color: "#8af6b0", fontWeight: 800 } : {}) }}>
                        {b.best ? "BEST" : ""}
                      </td>
                      <td style={{ ...tdStyle, opacity: 0.85 }}>{b.note ?? ""}</td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : mode === "spots" ? (
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1330 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, cursor: "default", padding: 4 }} aria-label="Details" />
                  {SPOT_COLUMNS.map((col) => {
                    const active = col.key === sSortKey;
                    return (
                      <th
                        key={col.key}
                        style={{ ...thStyle, ...(active ? { color: "#8af6b0" } : {}) }}
                        onClick={() => onSpotHeader(col.key)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.key === "vendorPriceEach" && Object.keys(sSaleOverrides).length > 0 ? "Selected sale / fish" : col.label}
                        {active ? (sSortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleCount === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={SPOT_COLUMNS.length + 1}>
                      No estimates. Choose at least one rod, enter a valid skill, or broaden the filters.
                    </td>
                  </tr>
                ) : (
                  spotResults.slice(0, MAX_VISIBLE_ROWS).map((p, i) => {
                    const rowKey = `spots|${p.zone}|${p.area}|${p.fish}|${p.bait}|${p.rod}|${i}`;
                    const selected = selectedRowKey === rowKey;
                    const expanded = expandedSpotKey === rowKey;
                    const vendorExpanded = expandedVendorKey === rowKey;
                    const vendor = getFishingVendorOptions(p.fish);
                    const saleOverride = sSaleOverrides[p.fish];
                    const saleDraft = sAhPriceDrafts[p.fish] ?? (saleOverride?.type === "ah" ? saleOverride.price : "");
                    const saleDraftNumber = Number(saleDraft);
                    const validAhDraft = saleDraft.trim() !== "" && Number.isFinite(saleDraftNumber) && saleDraftNumber >= 0;
                    const gutting = GUTTING_REWARDS[p.fish];
                    const snapOutcomePct = ((100 - p.risk.escapePct) * p.risk.snapPct) / 100;
                    const breakOutcomePct = ((100 - p.risk.escapePct) * (100 - p.risk.snapPct) * p.risk.breakPct) / 10000;
                    return (
                      <React.Fragment key={rowKey}>
                        <tr onClick={() => setSelectedRowKey(rowKey)} style={{ ...clickableRowStyle, ...(selected ? selectedRowStyle : {}) }}>
                          <td style={{ ...tdStyle, padding: 4 }}>
                            <button type="button" aria-label={`${expanded ? "Hide" : "Show"} money and catch details for ${p.fish}`}
                              aria-expanded={expanded} aria-controls={`spot-details-${i}`}
                              onClick={(event) => { event.stopPropagation(); setExpandedSpotKey(expanded ? null : rowKey); }}
                              style={{ ...styles.buttonCompact, display: "grid", placeItems: "center", width: 28, height: 28, padding: 0 }}>
                              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          </td>
                          {SPOT_COLUMNS.map((column) => {
                            if (column.key === "netGilPerHour" || column.key === "netGilPerDay") {
                              const value = column.key === "netGilPerHour" ? p.netGilPerHour : p.netGilPerDay;
                              return <td key={column.key} style={{ ...tdStyle, fontWeight: 800, color: value !== null && value >= 0 ? "#8af6b0" : undefined }}>
                                {value === null ? "Unknown" : `${formatVendorPrice(Math.round(value))} gil`}
                              </td>;
                            }
                            if (column.key === "catchTimeSeconds") return <td key={column.key} style={{ ...tdStyle, fontWeight: 700 }}>{formatCatchTime(p.catchTimeSeconds)}</td>;
                            if (column.key === "targetFishPer200") return <td key={column.key} style={tdStyle}>{p.targetFishPer200?.toFixed(1) ?? "Not catchable"}</td>;
                            if (column.key === "vendorPriceEach") return <td key={column.key} style={tdStyle}>
                              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                                <button type="button" aria-label={`${vendorExpanded ? "Hide" : "Show"} sale price options and recipes for ${p.fish}`}
                                  aria-expanded={vendorExpanded} aria-controls={`spot-vendor-${i}`}
                                  onClick={(event) => { event.stopPropagation(); setExpandedVendorKey(vendorExpanded ? null : rowKey); }}
                                  style={{ ...styles.buttonCompact, display: "grid", placeItems: "center", flexShrink: 0, width: 26, height: 26, padding: 0 }}>
                                  {vendorExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                </button>
                                <div><strong>{p.salePrice === null ? "Unknown" : `${formatVendorPrice(Math.round(p.salePrice))} gil`}</strong>
                                  <div style={{ opacity: 0.65, fontSize: 12 }}>{p.saleLabel}</div></div>
                              </div>
                            </td>;
                            if (column.key === "baitNeeded") return <td key={column.key} style={tdStyle}>
                              {p.baitNeeded === null ? "Unknown" : p.kind === "Lure" ? "1 reusable lure" : `${p.baitNeeded.toFixed(1)} ${p.bait}`}
                              <div style={{ opacity: 0.65, fontSize: 12 }}>{p.kind === "Lure" ? "loss not estimated" : p.baitCostPerDay === null ? "cost unknown" : `${formatVendorPrice(Math.round(p.baitCostPerDay))} gil/day`}</div>
                            </td>;
                            if (column.key === "fish") return <td key={column.key} style={tdStyle}>
                              <strong>{p.fish}</strong><div style={{ opacity: 0.65, fontSize: 12 }}>Lvl {p.lvl ?? "-"}</div>
                              {PLANNER_FISH[p.fish]?.restricted && <div style={{ color: "#ffc77d", fontSize: 12 }}>Prerequisites required</div>}
                            </td>;
                            if (column.key === "sharePct") return <td key={column.key} style={{ ...tdStyle, ...shareColor(p.sharePct) }}>{p.sharePct.toFixed(1)}%</td>;
                            if (column.key === "zone") return <td key={column.key} style={tdStyle}>{p.zone}</td>;
                            return <td key={column.key} style={tdStyle}>{p[column.key]}</td>;
                          })}
                        </tr>
                        {vendorExpanded && <tr id={`spot-vendor-${i}`}>
                          <td colSpan={SPOT_COLUMNS.length + 1} style={{ ...skillupCellStyle, padding: "12px 16px", background: "rgba(255,255,255,0.035)" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                              <strong>{p.fish}: direct NPC sale {vendor.rawPrice === null ? "unknown" : `${formatVendorPrice(vendor.rawPrice)} gil each`}</strong>
                              <span style={{ opacity: 0.7, fontSize: 12 }}>Direct NPC is the default. AH values are estimates; recipe values use NPC output sales before ingredient costs and synthesis failures.</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                              <label style={{ ...styles.field, width: 190 }}>
                                <span style={styles.label}>AH price / fish (gil)</span>
                                <input aria-label={`AH price per fish for ${p.fish}`} style={styles.inputCompact} type="number" min={0} step="any"
                                  value={saleDraft}
                                  placeholder="Enter AH price"
                                  aria-invalid={saleDraft !== "" && !validAhDraft}
                                  onChange={(event) => setSAhPriceDrafts((previous) => ({ ...previous, [p.fish]: event.target.value }))} />
                              </label>
                              <button type="button" style={styles.buttonCompact} disabled={!validAhDraft} onClick={() => applySpotAhPrice(p.fish)}>
                                Use AH price
                              </button>
                              <button type="button" style={styles.buttonCompact} disabled={!saleOverride} onClick={() => resetSpotDirectPrice(p.fish)}>
                                Use direct NPC price
                              </button>
                              <span style={{ fontSize: 13 }}>Selected: <strong>{p.saleLabel}</strong> — {p.salePrice === null ? "Unknown" : `${formatVendorPrice(Math.round(p.salePrice))} gil / fish`}</span>
                              {((sAhPriceDrafts[p.fish] !== undefined && !validAhDraft) || (saleOverride?.type === "ah" && p.salePrice === null)) &&
                                <span role="alert" style={{ color: "#ff9c7a", fontSize: 12 }}>Enter a valid non-negative AH price per fish.</span>}
                            </div>
                            {gutting && <div style={{ marginTop: 12 }}>
                              <strong>Zaldon trade rewards / fish (not included in estimates)</strong>
                              <div style={{ marginTop: 4, fontSize: 13 }}>Selbina / Inside the Belly / {formatVendorPrice(gutting.gil)} gil</div>
                              <table style={{ width: "100%", maxWidth: 620, borderCollapse: "collapse", marginTop: 8 }} aria-label={`Zaldon rewards for ${p.fish}`}>
                                <thead><tr>{["Item", "Quantity", "Chance / trade"].map((label) => <th key={label} scope="col" style={skillupCellStyle}>{label}</th>)}</tr></thead>
                                <tbody>{gutting.items.map((item, rewardIndex) => <tr key={`${item.itemId}-${rewardIndex}`}>
                                  <td style={skillupCellStyle}>{item.name}</td>
                                  <td style={skillupCellStyle}>{item.min === item.max ? item.min : `${item.min}-${item.max}`}</td>
                                  <td style={skillupCellStyle}>{item.chancePct}%</td>
                                </tr>)}</tbody>
                              </table>
                            </div>}
                            {vendor.recipes.length === 0 ? <div style={{ marginTop: 10, opacity: 0.7 }}>No direct synthesis recipes.</div> :
                              <div style={{ overflowX: "auto", marginTop: 12 }}>
                                <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }} aria-label={`NPC recipe prices for ${p.fish}`}>
                                  <thead><tr>{["Recipe / requirements", "Ingredients", "Output", "NPC / item", "NPC / synth", "NPC / fish", "Use in estimate"].map((label) =>
                                    <th key={label} scope="col" style={{ ...thStyle, cursor: "default", whiteSpace: "normal" }}>{label}</th>)}</tr></thead>
                                  <tbody>{vendor.recipes.flatMap(({ recipe, outcomes }) => outcomes.map((outcome, outcomeIndex) => <tr key={`${recipe.id}-${outcome.tier}`}>
                                    {outcomeIndex === 0 && <td rowSpan={outcomes.length} style={skillupCellStyle}><strong>{recipe.res.n}</strong><div>{recipe.craft} {recipe.lvl}</div>
                                      {recipe.subs?.map((sub) => <div key={sub.c}>{sub.c} {sub.l}</div>)}
                                      {recipe.ki && <div>Key item required</div>}
                                      {recipe.era && <div>{recipe.era}{recipe.era === "WotG" ? " (out of era)" : ""}</div>}
                                    </td>}
                                    {outcomeIndex === 0 && <td rowSpan={outcomes.length} style={skillupCellStyle}><div>1 x {recipe.crystal} Crystal</div>{recipe.ing.map((item, itemIndex) => <div key={itemIndex}>{item.q} x {item.n}</div>)}</td>}
                                    <td style={skillupCellStyle}>{outcome.tier}: {outcome.q} x {outcome.n}</td>
                                    {[outcome.price, outcome.total, outcome.perFish].map((price, priceIndex) =>
                                      <td key={priceIndex} style={skillupCellStyle}>{price === null ? "Unknown" : `${formatVendorPrice(Math.round(price))} gil`}</td>)}
                                    <td style={skillupCellStyle}>
                                      <button type="button" style={styles.buttonCompact} disabled={outcome.perFish === null}
                                        aria-pressed={saleOverride?.type === "recipe" && saleOverride.recipeId === recipe.id && saleOverride.tier === outcome.tier}
                                        onClick={() => selectSpotRecipePrice(p.fish, recipe.id, outcome.tier)}>
                                        {saleOverride?.type === "recipe" && saleOverride.recipeId === recipe.id && saleOverride.tier === outcome.tier
                                          ? "Selected" : "Use price"}
                                      </button>
                                    </td>
                                  </tr>))}</tbody>
                                </table>
                              </div>}
                          </td>
                        </tr>}
                        {expanded && <tr id={`spot-details-${i}`}>
                          <td colSpan={SPOT_COLUMNS.length + 1} style={{ ...skillupCellStyle, padding: "12px 16px", background: "rgba(255,255,255,0.035)" }}>
                            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px 20px", margin: "0 0 12px" }}>
                              {[
                                ["Fishing skill", String(sSkill)],
                                ["Effective success skill", String(p.effectiveSkill)],
                                ["Fight policy", p.kind === "Lure" ? "Cancel bad feelings; complete other fights" : "Complete fights, including snaps"],
                                ["Fish / cast", `${p.fishPct.toFixed(1)}%`],
                                ["Item / cast", `${p.itemPct.toFixed(1)}%`],
                                ["Monster / cast", `${p.mobPct.toFixed(1)}%`],
                                ["Nothing / cast", `${p.nothingPct.toFixed(1)}%`],
                                ["Target / cast", `${p.targetPct.toFixed(1)}%`],
                                ["Share of fish bites", `${p.sharePct.toFixed(1)}%`],
                                ["Canceled / target hook", `${(100 - p.fight.attemptedPct).toFixed(1)}%`],
                                ["Planned land / target hook", `${p.fight.landPct.toFixed(1)}%`],
                                ["Casts / day", p.sessionCasts?.toFixed(1) ?? "Unknown"],
                                ["Fatigue / day", p.fatigueUsed?.toFixed(0) ?? "Unknown"],
                                ["Time / day", formatCatchTime(p.catchTimeSeconds)],
                                ["Target fish / day", p.targetFishPer200?.toFixed(1) ?? "Unknown"],
                                ["Bait cost / day", p.baitCostPerDay === null ? "Unknown" : `${formatVendorPrice(Math.round(p.baitCostPerDay))} gil`],
                                ["Gross sale value / day", p.grossGilPerDay === null ? "Unknown" : `${formatVendorPrice(Math.round(p.grossGilPerDay))} gil`],
                                ["Net gil / day", p.netGilPerDay === null ? "Unknown" : `${formatVendorPrice(Math.round(p.netGilPerDay))} gil`],
                              ].map(([label, value]) => <div key={label}><dt style={{ opacity: 0.65, fontSize: 12 }}>{label}</dt><dd style={{ margin: "3px 0 0", fontWeight: 700 }}>{value}</dd></div>)}
                            </dl>
                            <strong>Outcomes before cancellations / target hook</strong>
                            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px 20px", margin: "8px 0 14px" }}>
                              {[
                                ["Landed", `${p.risk.landPct.toFixed(1)}%`],
                                ["Escape", `${p.risk.escapePct.toFixed(1)}%`],
                                ["Line snap", `${snapOutcomePct.toFixed(1)}%`],
                                ["Rod break", `${breakOutcomePct.toFixed(1)}%`],
                              ].map(([label, value]) => <div key={label}><dt style={{ opacity: 0.65, fontSize: 12 }}>{label}</dt><dd style={{ margin: "3px 0 0", fontWeight: 700 }}>{value}</dd></div>)}
                            </dl>
                            <strong>Expected catch breakdown / day</strong>
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", maxWidth: 900, borderCollapse: "collapse", marginTop: 6 }}>
                                <thead><tr>{["Fish", "Size", "Fish level", "Expected catches", "Sale / fish", "Expected proceeds"].map((label) =>
                                  <th key={label} scope="col" style={{ ...thStyle, cursor: "default" }}>{label}</th>)}</tr></thead>
                                <tbody>{p.catchBreakdown.map((entry) => <tr key={entry.fish}>
                                  <td style={skillupCellStyle}>
                                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                                      <input type="checkbox" aria-label={`Retain ${entry.fish}`} checked={entry.included}
                                        onChange={() => toggleSpotPoolFish(entry.fish)} />
                                      <span style={{ textDecoration: entry.included ? undefined : "line-through", opacity: entry.included ? 1 : 0.6 }}>
                                        {entry.fish}{entry.fish === p.fish ? " (target)" : ""}
                                      </span>
                                    </label>
                                  </td>
                                  <td style={skillupCellStyle}>{entry.size}</td>
                                  <td style={skillupCellStyle}>{entry.level}</td>
                                  <td style={skillupCellStyle}>{entry.catches?.toFixed(1) ?? "Unknown"}</td>
                                  <td style={skillupCellStyle}>
                                    {entry.salePrice === null ? "Unknown" : `${formatVendorPrice(Math.round(entry.salePrice))} gil`}
                                    <div style={{ opacity: 0.65, fontSize: 12 }}>{entry.saleLabel}</div>
                                  </td>
                                  <td style={skillupCellStyle}>{entry.grossGil === null ? "Unknown" : `${formatVendorPrice(Math.round(entry.grossGil))} gil`}</td>
                                </tr>)}</tbody>
                                <tfoot><tr>
                                  <th scope="row" colSpan={3} style={{ ...skillupCellStyle, textAlign: "left" }}>Total</th>
                                  <td style={{ ...skillupCellStyle, fontWeight: 700 }}>{p.catchBreakdown.reduce((total, entry) => total + (entry.catches ?? 0), 0).toFixed(1)}</td>
                                  <td style={skillupCellStyle}>—</td>
                                  <td style={{ ...skillupCellStyle, fontWeight: 700 }}>{p.grossGilPerDay === null ? "Unknown" : `${formatVendorPrice(Math.round(p.grossGilPerDay))} gil`}</td>
                                </tr></tfoot>
                              </table>
                            </div>
                            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                              Unchecked fish still take bites and are canceled; they add no catches, fatigue, or sale value. Their bait use and cancellation time are still estimated.
                            </div>
                          </td>
                        </tr>}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1050, tableLayout: "fixed" }} aria-label="Fishing skill-up combinations">
              <colgroup>
                <col style={{ width: 56 }} />
                {COMPACT_SKILLUP_COLUMNS.map(column => <col key={column.key} style={{ width: column.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...thStyle, cursor: "default", padding: 4 }} aria-label="Details" />
                  {COMPACT_SKILLUP_COLUMNS.map((column) => {
                    const active = column.key === uSortKey;
                    return (
                      <th
                        key={column.key}
                        style={{ ...thStyle, whiteSpace: "normal", overflowWrap: "anywhere", ...(active ? { color: "#8af6b0" } : {}) }}
                        onClick={() => onSkillupHeader(column.key)}
                      >
                        {column.label}
                        {active ? (uSortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleCount === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={COMPACT_SKILLUP_COLUMNS.length + 1}>
                      No eligible combinations. Check the base skill, rod access, or filters.
                    </td>
                  </tr>
                ) : (
                  visibleSkillupRows.map(({ row, group, nested }, index) => {
                    const rowKey = group ? `group|${group.key}` : `skillup|${row.zone}|${row.area}|${row.fish}|${row.bait}|${row.rod}`;
                    const selected = selectedRowKey === rowKey;
                    const vendor = getFishingVendorOptions(row.fish);
                    const gutting = GUTTING_REWARDS[row.fish];
                    const vendorExpanded = expandedVendorKey === rowKey;
                    const detailKey = `${row.zone}|${row.area}|${row.fish}|${row.bait}|${row.rod}`;
                    const expanded = group ? expandedSkillupGroups.has(group.key) || group.rows.some(member => `${member.zone}|${member.area}|${member.fish}|${member.bait}|${member.rod}` === expandedSkillupKey) : expandedSkillupKey === detailKey;
                    const areas = group ? [...new Set(group.rows.map(member => member.area))] : [];
                    const baits = group ? [...new Set(group.rows.map(member => member.bait))] : [];
                    const itemHazards = group ? [...new Set(group.rows.map(member => member.itemHazards).filter(Boolean))].join("; ") : row.itemHazards;
                    return (
                      <React.Fragment key={rowKey}>
                      <tr
                        onClick={() => group ? toggleSkillupGroup(group.key, expanded) : setSelectedRowKey(rowKey)}
                        style={{ ...clickableRowStyle, ...(group ? { background: "rgba(255,255,255,0.045)" } : nested ? { background: "rgba(138,246,176,0.035)" } : {}), ...(selected ? selectedRowStyle : {}) }}
                      >
                        <td style={{ ...skillupCellStyle, padding: nested ? "6px 4px 6px 24px" : "6px 4px", ...(nested ? { boxShadow: "inset 2px 0 rgba(138,246,176,0.25)" } : {}) }}>
                          <button
                            type="button"
                            aria-label={group ? `${expanded ? "Hide" : "Show"} ${group.rows.length} location and bait combinations for ${row.zone}, ${row.fish}, ${row.rod}` : `${expanded ? "Hide" : "Show"} catch odds and risks for ${row.fish}, ${row.rod}, ${row.zone}, ${row.area}, ${row.bait}`}
                            aria-expanded={expanded}
                            aria-controls={group ? undefined : `skillup-details-${index}`}
                            onClick={event => { event.stopPropagation(); if (group) toggleSkillupGroup(group.key, expanded); else setExpandedSkillupKey(expanded ? null : detailKey); }}
                            style={{ ...styles.buttonCompact, display: "grid", placeItems: "center", width: 28, height: 28, padding: 0 }}
                          >
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                        <td style={{ ...skillupCellStyle, color: "#8af6b0", fontWeight: 800, ...(nested ? { paddingLeft: 26 } : {}) }}>
                          {row.skillGainPer200 === null ? "Not catchable" : `+${row.skillGainPer200.toFixed(2)}`}
                        </td>
                        <td style={skillupCellStyle}><strong>{row.fish}</strong><div style={{ opacity: 0.65, fontSize: 12 }}>Lvl {row.fishLevel} ({row.levelDifference >= 0 ? "+" : ""}{row.levelDifference})</div>{PLANNER_FISH[row.fish]?.restricted && <div style={{ color: "#ffc77d", fontSize: 12 }}>Prerequisites required</div>}{row.catchBreakdown.some(member => member.fish === row.fish && !member.included) && <div style={{ opacity: 0.65, fontSize: 12 }}>Canceled</div>}</td>
                        <td style={skillupCellStyle}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                            <button type="button" aria-label={`${vendorExpanded ? "Hide" : "Show"} NPC prices and recipes for ${row.fish}`}
                              aria-expanded={vendorExpanded} aria-controls={`skillup-vendor-${index}`}
                              onClick={event => { event.stopPropagation(); setExpandedVendorKey(vendorExpanded ? null : rowKey); }}
                              style={{ ...styles.buttonCompact, display: "grid", placeItems: "center", flexShrink: 0, width: 28, height: 28, padding: 0 }}>
                              {vendorExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            <div>
                              <strong>{vendor.bestPrice === null ? "Unknown" : `${formatVendorPrice(Math.round(vendor.bestPrice))} gil`}</strong>
                              <div style={{ opacity: 0.65, fontSize: 12 }}>{vendor.bestName === row.fish ? "Direct sale" : vendor.bestName}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...skillupCellStyle, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatCatchTime(row.catchTimeSeconds)}</td>
                        <td style={{ ...skillupCellStyle, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{row.targetFishPer200 === null ? "Not catchable" : row.targetFishPer200.toFixed(1)}</td>
                        <td style={skillupCellStyle}>{row.targetPct.toFixed(1)}%</td>
                        <td style={skillupCellStyle}>
                          {row.landPct.toFixed(1)}%
                          {itemHazards && <div style={{ color: "#ff9c7a", fontSize: 12 }}>Item break risk</div>}
                        </td>
                        <td style={{ ...skillupCellStyle, fontWeight: 700 }}>{row.rod}</td>
                        <td style={{ ...skillupCellStyle, ...(nested ? { paddingLeft: 26 } : {}) }}>
                          {group ? <><strong>{row.zone}</strong><div style={{ opacity: 0.65, fontSize: 12 }}>{areas.length === 1 ? areas[0] : `${areas.length} sublocations`} / {group.rows.length} combinations</div></>
                            : nested ? row.area : <>{row.zone}<div style={{ opacity: 0.65, fontSize: 12 }}>{row.area}</div></>}
                        </td>
                        <td style={skillupCellStyle}>{group ? baits.length === 1 ? baits[0] : `${baits.length} baits` : row.bait}</td>
                      </tr>
                      {vendorExpanded && <tr id={`skillup-vendor-${index}`}>
                        <td colSpan={COMPACT_SKILLUP_COLUMNS.length + 1} style={{ ...skillupCellStyle, padding: "12px 16px", background: "rgba(255,255,255,0.035)" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                            <strong>{row.fish}: direct NPC sale {vendor.rawPrice === null ? "unknown" : `${formatVendorPrice(vendor.rawPrice)} gil each`}</strong>
                            <span style={{ opacity: 0.7, fontSize: 12 }}>Gross proceeds, before crystal / ingredient costs and synthesis failures. Best: in-era NQ only.</span>
                          </div>
                          {gutting && <div style={{ marginTop: 12 }}>
                            <strong>Zaldon trade rewards / fish</strong>
                            <div style={{ marginTop: 4, fontSize: 13 }}>Selbina / Inside the Belly / {formatVendorPrice(gutting.gil)} gil</div>
                            <table style={{ width: "100%", maxWidth: 620, borderCollapse: "collapse", marginTop: 8 }} aria-label={`Zaldon rewards for ${row.fish}`}>
                              <thead><tr>{["Item", "Quantity", "Chance / trade"].map(label => <th key={label} scope="col" style={skillupCellStyle}>{label}</th>)}</tr></thead>
                              <tbody>{gutting.items.map((item, rewardIndex) => <tr key={`${item.itemId}-${rewardIndex}`}>
                                <td style={skillupCellStyle}>{item.name}</td>
                                <td style={skillupCellStyle}>{item.min === item.max ? item.min : `${item.min}-${item.max}`}</td>
                                <td style={skillupCellStyle}>{item.chancePct}%</td>
                              </tr>)}</tbody>
                            </table>
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Requires quest access. Public-source rates, not guaranteed rewards or verified live-server rates. Separate from sale and synthesis proceeds.</div>
                          </div>}
                          {vendor.recipes.length === 0 ? <div style={{ marginTop: 10, opacity: 0.7 }}>No direct synthesis recipes.</div> :
                            <div style={{ overflowX: "auto", marginTop: 12 }}>
                              <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse" }} aria-label={`NPC recipe prices for ${row.fish}`}>
                                <thead><tr>{["Recipe / requirements", "Ingredients", "Output", "NPC / item", "NPC / synth", "NPC / fish"].map(label =>
                                  <th key={label} scope="col" style={{ ...thStyle, cursor: "default", whiteSpace: "normal" }}>{label}</th>)}</tr></thead>
                                <tbody>{vendor.recipes.flatMap(({ recipe, outcomes }) => outcomes.map((outcome, outcomeIndex) => <tr key={`${recipe.id}-${outcome.tier}`}>
                                  {outcomeIndex === 0 && <td rowSpan={outcomes.length} style={skillupCellStyle}><strong>{recipe.res.n}</strong><div>{recipe.craft} {recipe.lvl}</div>
                                    {recipe.subs?.map(sub => <div key={sub.c}>{sub.c} {sub.l}</div>)}
                                    {recipe.ki && <div>Key item required</div>}
                                    {recipe.era && <div>{recipe.era}{recipe.era === "WotG" ? " (out of era)" : ""}</div>}
                                  </td>}
                                  {outcomeIndex === 0 && <td rowSpan={outcomes.length} style={skillupCellStyle}><div>1 x {recipe.crystal} Crystal</div>{recipe.ing.map((item, itemIndex) => <div key={itemIndex}>{item.q} x {item.n}</div>)}</td>}
                                  <td style={skillupCellStyle}>{outcome.tier}: {outcome.q} x {outcome.n}</td>
                                  {[outcome.price, outcome.total, outcome.perFish].map((price, priceIndex) => <td key={priceIndex} style={skillupCellStyle}>{price === null ? "Unknown" : `${formatVendorPrice(Math.round(price))} gil`}</td>)}
                                </tr>))}</tbody>
                              </table>
                            </div>}
                        </td>
                      </tr>}
                      {!group && expanded && <tr id={`skillup-details-${index}`}>
                        <td colSpan={COMPACT_SKILLUP_COLUMNS.length + 1} style={{ ...skillupCellStyle, padding: "12px 16px", background: "rgba(255,255,255,0.035)" }}>
                          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px 20px", margin: "0 0 12px" }}>
                            {[
                              ["Fish / cast", `${row.fishPct.toFixed(1)}%`],
                              ["Item / cast", `${row.itemPct.toFixed(1)}%`],
                              ["Monster / cast", `${row.mobPct.toFixed(1)}%`],
                              ["Nothing / cast", `${row.nothingPct.toFixed(1)}%`],
                              ["Target / cast", `${row.targetPct.toFixed(1)}%`],
                              ["Share of fish bites", `${row.sharePct.toFixed(1)}%`],
                              ["Skill-up chance", `${row.skillupChancePct.toFixed(1)}%`],
                              ["Success skill", String(row.effectiveSkill)],
                              ["Fight policy", row.kind === "Lure" ? "Cancel bad feelings; complete all other fights" : "Complete fights, including snaps"],
                              ["Fishing prerequisites", PLANNER_FISH[row.fish]?.restricted ? "Key item / quest required; assumed met" : "None in snapshot"],
                              ["Canceled / target hook", `${(100 - row.fight.attemptedPct).toFixed(1)}%`],
                              ["Planned land / target hook", `${row.fight.landPct.toFixed(1)}%`],
                              ["Est. fish skill gain / day", row.skillGainPer200 === null ? "Not catchable" : `+${row.skillGainPer200.toFixed(2)}`],
                              ["Pool skill gain / day", row.poolSkillGainPer200 === null ? "Not catchable" : `+${row.poolSkillGainPer200.toFixed(2)}`],
                              ["Est. ending skill (pool)", row.poolSkillGainPer200 === null ? "Not catchable" : (Number(uSkill) + row.poolSkillGainPer200).toFixed(2)],
                              ["Time / day", formatCatchTime(row.catchTimeSeconds)],
                              ["Target fish / day", row.targetFishPer200 === null ? "Not catchable" : row.targetFishPer200.toFixed(1)],
                              ["Est. fatigue / 20,000", row.fatigueUsed === null ? "Not catchable" : Math.round(row.fatigueUsed).toLocaleString()],
                              ["Daily limit", row.fatigueUsed === null ? "Not catchable" : row.fatigueUsed >= 20000 - 1e-8 ? "20,000 fatigue" : "200 catches"],
                              ["Time / 200 target fish (starting skill, ignores daily limit)", formatCatchTime(calculateCatchTime({ fishPct: row.attemptedFishPct, targetPct: row.catchBreakdown.find(member => member.fish === row.fish)?.included ? row.targetPct * row.fight.attemptedPct / 100 : 0, landPct: row.fight.attemptedPct > 0 ? 100 * row.fight.landPct / row.fight.attemptedPct : 0 }, { fishSeconds, otherSeconds }))],
                              ["Estimated casts / day", row.sessionCasts === null ? "Not catchable" : Math.ceil(row.sessionCasts).toLocaleString()],
                              ["Est. bait required", row.baitNeeded === null ? "Not catchable" : Math.ceil(row.baitNeeded).toLocaleString()],
                              ["Average cast time", row.sessionCasts && row.catchTimeSeconds ? `${(row.catchTimeSeconds / row.sessionCasts).toFixed(1)}s` : "Not catchable"],
                            ].map(([label, value]) => <div key={label}><dt style={{ opacity: 0.65, fontSize: 12 }}>{label}</dt><dd style={{ margin: "4px 0 0", fontWeight: 700 }}>{value}</dd></div>)}
                          </dl>
                          <div style={{ fontWeight: 700, marginBottom: 8 }}>Outcomes before cancellations / target hook</div>
                          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px 20px", margin: "0 0 12px" }}>
                            {[
                              ["Landed", row.landPct],
                              ["Escape", row.escapePct],
                              ["Line snap", (1 - row.escapePct / 100) * row.snapPct],
                              ["Rod break", (1 - row.escapePct / 100) * (1 - row.snapPct / 100) * row.breakPct],
                            ].map(([label, value]) => <div key={label}><dt style={{ opacity: 0.65, fontSize: 12 }}>{label}</dt><dd style={{ margin: "4px 0 0", fontWeight: 700 }}>{Number(value).toFixed(1)}%</dd></div>)}
                          </dl>
                          {row.itemHazards && <div style={{ color: "#ff9c7a", marginTop: 6 }}>Item rod-break hazards: {row.itemHazards}</div>}
                          <div style={{ marginTop: 16, maxWidth: 620 }}>
                            <div style={{ fontWeight: 700, marginBottom: 8 }}>Expected catch breakdown / day</div>
                            <table aria-label={`Expected catch breakdown for ${row.fish}, ${row.rod}, ${row.zone}, ${row.area}, ${row.bait}`} style={{ width: "100%", borderCollapse: "collapse" }}>
                              <thead><tr>
                                <th scope="col" style={{ ...skillupCellStyle, textAlign: "left" }}>Fish</th>
                                <th scope="col" style={{ ...skillupCellStyle, textAlign: "left" }}>Size</th>
                                <th scope="col" style={{ ...skillupCellStyle, textAlign: "right" }}>Fish level</th>
                                <th scope="col" style={{ ...skillupCellStyle, textAlign: "right" }}>Expected catches</th>
                                <th scope="col" style={{ ...skillupCellStyle, textAlign: "right" }}>Est. skill gain</th>
                              </tr></thead>
                              <tbody>{row.catchBreakdown.map(member => <tr key={member.fish}>
                                <td style={{ ...skillupCellStyle, ...(member.fish === row.fish ? { color: "#8af6b0", fontWeight: 700 } : {}) }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                                    <input type="checkbox" aria-label={`Retain ${member.fish}`} checked={member.included} onChange={() => togglePoolFish(member.fish)} />
                                    <span style={{ textDecoration: member.included ? undefined : "line-through", opacity: member.included ? 1 : 0.6 }}>{member.fish}{member.fish === row.fish ? " (target)" : ""}</span>
                                  </label>
                                </td>
                                <td style={skillupCellStyle}>{member.size === "L" ? "Large" : "Small"}</td>
                                <td style={{ ...skillupCellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{member.level}</td>
                                <td style={{ ...skillupCellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{member.catches === null ? "Not catchable" : member.catches.toFixed(1)}</td>
                                <td style={{ ...skillupCellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{member.skillGain === null ? "Not catchable" : `+${member.skillGain.toFixed(2)}`}</td>
                              </tr>)}</tbody>
                              <tfoot><tr>
                                <th scope="row" colSpan={3} style={{ ...skillupCellStyle, textAlign: "left" }}>Total</th>
                                <td style={{ ...skillupCellStyle, textAlign: "right", fontWeight: 700 }}>{row.skillGainPer200 === null ? "Not catchable" : row.catchBreakdown.reduce((sum, member) => sum + (member.catches ?? 0), 0).toFixed(1)}</td>
                                <td style={{ ...skillupCellStyle, textAlign: "right", fontWeight: 700 }}>{row.poolSkillGainPer200 === null ? "Not catchable" : `+${row.poolSkillGainPer200.toFixed(2)}`}</td>
                              </tr></tfoot>
                            </table>
                          </div>
                        </td>
                      </tr>}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
