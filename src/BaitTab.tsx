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
  DEFAULT_FISHING_TIMING,
  formatCatchTime,
  groupSkillupRows,
  isCityFishingZone,
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
const PLANNER_FISH = fishingPlanner.fish as Record<string, SkillupFish & { rarity: number; shellfish: boolean; item: boolean; restricted: boolean }>;
const PLANNER_BAITS = fishingPlanner.baits as Record<string, { poorFish: boolean; shellfishBait: boolean; fish: Record<string, number> }>;
const PLANNER_AREAS = fishingPlanner.areas as Record<string, { difficulty: number; hasMobs: boolean; members: string[] }>;
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
type SpotKey = "zone" | "area" | "fish" | "lvl" | "bait" | "kind" | "bite" | "hookBonus" | "vendorPriceEach" | "sharePct" | "competingCount";
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

type SkillupRow = PoolEntry & {
  catchTimeSeconds: number | null;
  targetFishPer200: number | null;
  catchBreakdown: { fish: string; size: string; catches: number | null; skillGain: number | null; included: boolean }[];
  poolKey: string;
  skillGainPer200: number | null;
  sessionCasts: number | null;
  attemptedFishPct: number;
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
  { key: "zone", label: "Zone" },
  { key: "area", label: "Area" },
  { key: "fish", label: "Target Fish" },
  { key: "lvl", label: "Lvl" },
  { key: "bait", label: "Bait" },
  { key: "kind", label: "Kind" },
  { key: "bite", label: "Bite" },
  { key: "hookBonus", label: "Hook Bonus" },
  { key: "vendorPriceEach", label: "Vendor Price" },
  { key: "sharePct", label: "Pool Share" },
  { key: "competingCount", label: "Competing" },
];

const SKILLUP_COLUMNS: { key: SkillupKey; label: string }[] = [
  { key: "skillGainPer200", label: "Est. skill gain / 200 fish" },
  { key: "catchTimeSeconds", label: "Time / 200 total fish" },
  { key: "targetFishPer200", label: "Target fish / 200 catches" },
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
  { key: "skillGainPer200", label: "Est. skill gain / 200 fish", width: "8%" },
  { key: "fish", label: "Fish", width: "10%" },
  { key: "bestVendorPrice", label: "Max NPC gross / fish", width: "12%" },
  { key: "catchTimeSeconds", label: "Time / 200 total fish", width: "10%" },
  { key: "targetFishPer200", label: "Target fish / 200 catches", width: "10%" },
  { key: "targetPct", label: "Target / cast", width: "7%" },
  { key: "landPct", label: "Land / hook", width: "7%" },
  { key: "rod", label: "Rod", width: "12%" },
  { key: "zone", label: "Location", width: "13%" },
  { key: "bait", label: "Bait", width: "11%" },
];
const CATCH_TIME_ASSUMPTIONS = "Estimated time to land 200 retained fish at this spot and bait, rounded up to a minute. Unchecked fish still bite but are canceled, as are items and monsters. Uses approximate expected skill progression; assumes 200 catches remain. Excludes fatigue stopping you early, guild rank caps, and repair / resupply downtime.";
const TARGET_COUNT_ASSUMPTIONS = "Estimated target fish among 200 retained catches, weighted by bite and landing chances over approximate skill progression. Unchecked species still bite but contribute no catches or skill. Capped retained competitors still count. Assumes you can identify the fish you intend to cancel; estimates are not guarantees.";
const SESSION_SKILL_ASSUMPTIONS = "Estimated fishing skill points gained across the pool while landing 200 retained fish. Updates skill-up rates, bite odds and landing odds at expected skill-level boundaries; a mean-progression approximation, not an exact stochastic forecast. Includes eligible completed failures; canceled fish give no skill. Ignores guild rank caps, fatigue limits and downtime.";
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

export default function BaitTab({ mode: activeMode, onModeChange }: { mode?: Mode; onModeChange?: (mode: Mode) => void } = {}) {
  const rodsDropdownRef = useRef<HTMLDetailsElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const resultsHeight = useTableViewportHeight(resultsRef);
  const [expandedSkillupKey, setExpandedSkillupKey] = useState<string | null>(null);
  const [expandedVendorKey, setExpandedVendorKey] = useState<string | null>(null);
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
    sSortKey: SpotKey;
    sSortDir: SortDir;
    uSkill: string;
    uFishSeconds: string;
    uOtherSeconds: string;
    uExcludedFish: Record<string, string[]>;
    uBonusSkill: string;
    uSelectedRods: string[];
    uIncludeCop: boolean;
    uIncludeToau: boolean;
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
    sSortKey: "sharePct",
    sSortDir: "desc",
    uSkill: "1",
    uFishSeconds: String(DEFAULT_FISHING_TIMING.fishSeconds),
    uOtherSeconds: String(DEFAULT_FISHING_TIMING.otherSeconds),
    uExcludedFish: {},
    uBonusSkill: "5",
    uSelectedRods: SKILLUP_ROD_NAMES,
    uIncludeCop: true,
    uIncludeToau: true,
    uGlobal: "",
    uFish: "",
    uZone: "",
    uBait: "",
    uMinShare: "",
    uMaxTimeHours: "",
    uSortKey: "skillGainPer200",
    uSortDir: "desc",
  };

  const loaded = loadJson<Partial<BaitUiState> & { uRodAccess?: RodAccess }>(BAIT_UI_KEY, {});
  const legacySelectedRods = SKILLUP_RODS.filter((rod) => {
    if (loaded.uRodAccess === "standard") return !rod.legendary;
    if (loaded.uRodAccess === "luShang") return !rod.rod.startsWith("Ebisu Fishing Rod");
    return true;
  }).map((rod) => rod.rod);
  const initialUi: BaitUiState = {
    ...defaultUi,
    ...loaded,
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
  const [sSortKey, setSSortKey] = useState<SpotKey>(initialUi.sSortKey);
  const [sSortDir, setSSortDir] = useState<SortDir>(initialUi.sSortDir);

  // ---- Practical skill-up combinations ----
  const [uSkill, setUSkill] = useState(initialUi.uSkill);
  const [uFishSeconds, setUFishSeconds] = useState(initialUi.uFishSeconds);
  const [uOtherSeconds, setUOtherSeconds] = useState(initialUi.uOtherSeconds);
  const [uExcludedFish, setUExcludedFish] = useState(initialUi.uExcludedFish ?? {});
  function togglePoolFish(poolKey: string, fish: string) {
    setUExcludedFish(previous => {
      const excluded = previous[poolKey] ?? [];
      const next = { ...previous };
      const updated = excluded.includes(fish) ? excluded.filter(name => name !== fish) : [...excluded, fish];
      if (updated.length) next[poolKey] = updated;
      else delete next[poolKey];
      return next;
    });
  }
  const fishSeconds = Number(uFishSeconds) > 0 && Number.isFinite(Number(uFishSeconds)) ? Number(uFishSeconds) : DEFAULT_FISHING_TIMING.fishSeconds;
  const otherSeconds = Number(uOtherSeconds) > 0 && Number.isFinite(Number(uOtherSeconds)) ? Number(uOtherSeconds) : DEFAULT_FISHING_TIMING.otherSeconds;
  const catchTimeAssumptions = `${CATCH_TIME_ASSUMPTIONS} Full cast-to-next-cast estimates: ${fishSeconds}s per retained fish attempt (including failures), ${otherSeconds}s per canceled fish or non-fish cast. Includes waiting, reeling / canceling, and recasting; these timings are estimates, not verified game constants.`;
  const [uBonusSkill, setUBonusSkill] = useState(initialUi.uBonusSkill);
  const [uSelectedRods, setUSelectedRods] = useState(initialUi.uSelectedRods);
  const [uIncludeCop, setUIncludeCop] = useState(initialUi.uIncludeCop);
  const [uIncludeToau, setUIncludeToau] = useState(initialUi.uIncludeToau);
  const [uGlobal, setUGlobal] = useState(initialUi.uGlobal);
  const [uFish, setUFish] = useState(initialUi.uFish);
  const [uZone, setUZone] = useState(initialUi.uZone);
  const [uBait, setUBait] = useState(initialUi.uBait);
  const [uMinShare, setUMinShare] = useState(initialUi.uMinShare);
  const [uMaxTimeHours, setUMaxTimeHours] = useState(initialUi.uMaxTimeHours);
  const [uSortKey, setUSortKey] = useState<SkillupKey>(initialUi.uSortKey);
  const [uSortDir, setUSortDir] = useState<SortDir>(initialUi.uSortDir);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const activeSearch = mode === "affinity" ? aGlobal : mode === "spots" ? sGlobal : uGlobal;

  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
    setSelectedRowKey(null);
    setExpandedSkillupKey(null);
    setExpandedVendorKey(null);
    setExpandedSkillupGroups(new Set());
  }, [mode, activeSearch, uMaxTimeHours]);

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
      setSSortDir(key === "sharePct" || key === "hookBonus" || key === "vendorPriceEach" ? "desc" : "asc");
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
    setSSortKey("sharePct");
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
    sSoloOnly;

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
    const g = sGlobal.trim().toLowerCase();
    const fq = sFish.trim().toLowerCase();
    const aq = sArea.trim().toLowerCase();
    const bq = sBait.trim().toLowerCase();
    const minShare = sMinShare.trim() === "" ? null : Number(sMinShare);

    const filtered = POOLS.filter((p) => {
      if (sZone && p.zone !== sZone) return false;
      if (sKind && p.kind !== sKind) return false;
      if (sBite && p.bite !== sBite) return false;
      if (sSoloOnly && p.sharePct < 100) return false;
      if (fq && !p.fish.toLowerCase().includes(fq)) return false;
      if (aq && !p.area.toLowerCase().includes(aq)) return false;
      if (bq && !p.bait.toLowerCase().includes(bq)) return false;
      if (minShare !== null && Number.isFinite(minShare) && p.sharePct < minShare) return false;

      if (g) {
        const hay = [
          p.zone,
          p.area,
          p.fish,
          p.lvl === null ? "" : String(p.lvl),
          p.bait,
          p.kind,
          p.bite,
          `${p.sharePct}%`,
          p.competing.join(", "),
        ]
          .join(" | ")
          .toLowerCase();
        if (!hay.includes(g)) return false;
      }
      return true;
    });

    return filtered.sort((x, y) => {
      let cmp = 0;
      if (sSortKey === "lvl") {
        const xv = x.lvl;
        const yv = y.lvl;
        if (xv === null && yv === null) cmp = 0;
        else if (xv === null) return 1;
        else if (yv === null) return -1;
        else cmp = xv - yv;
      } else if (sSortKey === "sharePct" || sSortKey === "hookBonus") {
        cmp = x[sSortKey] - y[sSortKey];
      } else if (sSortKey === "vendorPriceEach") {
        const xv = getVendorPriceEach(x.fish);
        const yv = getVendorPriceEach(y.fish);
        if (xv === null && yv === null) cmp = 0;
        else if (xv === null) return 1;
        else if (yv === null) return -1;
        else cmp = xv - yv;
      } else if (sSortKey === "competingCount") {
        cmp = x.competing.length - y.competing.length;
      } else {
        cmp = x[sSortKey].localeCompare(y[sSortKey]);
      }
      if (cmp === 0) {
        // Tie-break: higher share first, then higher hook bonus, then fewer competitors.
        cmp = y.sharePct - x.sharePct;
        if (cmp !== 0) return cmp;
        cmp = y.hookBonus - x.hookBonus;
        if (cmp !== 0) return cmp;
        return x.competing.length - y.competing.length;
      }
      return sSortDir === "asc" ? cmp : -cmp;
    });
  }, [sGlobal, sFish, sZone, sArea, sBait, sKind, sBite, sMinShare, sSoloOnly, sSortKey, sSortDir]);

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
    const estimates = new Map<string, {
      fishPct: number; itemPct: number; mobPct: number; nothingPct: number;
      targetPct: number[]; names: string[]; gains: number[]; totalGain: number; itemHazards: string;
      catchTimeSeconds: number | null; catches: (number | null)[];
      catchBreakdown: SkillupRow["catchBreakdown"];
      skillGain: number | null; casts: number | null; attemptedFishPct: number;
    }>();
    for (const pool of POOLS) {
      if (pool.lvl === null) continue;
      const fish = PLANNER_FISH[pool.fish];
      if (!fish) continue;
      const areaKey = `${normalizeFishingName(pool.zone)}|${normalizeFishingName(pool.area)}`;
      const poolKey = `${areaKey}|${pool.bait}`;
      const excludedFish = uExcludedFish[poolKey] ?? [];
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
        if (!skillup.eligible) continue;

        const estimateKey = `${areaKey}|${pool.bait}|${rod.rod}`;
        let estimate = estimates.get(estimateKey);
        if (!estimate) {
          const members = area.members.map(name => PLANNER_FISH[name]).filter(member => member && !member.item && bait.fish[member.fish] !== undefined)
            .map(member => ({ ...member, hookBonus: bait.fish[member.fish] }));
          const items = area.members.map(name => PLANNER_FISH[name]).filter(member => member?.item);
          const options = {
            city: isCityFishingZone(pool.zone), hasItems: items.length > 0, hasMobs: area.hasMobs,
            difficulty: area.difficulty, poorFish: bait.poorFish, shellfishBait: bait.shellfishBait,
          };
          const odds = calculateCastOdds(effectiveSkill, rod, members, options);
          const gains = calculatePoolSkillup(baseSkill, effectiveSkill, pool.zone, rod, members, odds.targetPct);
          const session = calculatePoolSession({ baseSkill, bonusSkill, zone: pool.zone, rod, fish: members, options, excludedFish, timing: { fishSeconds, otherSeconds } });
          const retainedGains = gains.gains.map((gain, index) => excludedFish.includes(members[index].fish) ? 0 : gain);
          const itemHazards = items.filter(item => calculateRodRisk(effectiveSkill, item, rod).breakPct > 0).map(item => item.fish).join(", ");
          estimate = {
            ...odds, ...session, gains: retainedGains, totalGain: retainedGains.reduce((sum, gain) => sum + gain, 0), names: members.map(member => member.fish), itemHazards,
            attemptedFishPct: odds.targetPct.reduce((sum, value, index) => sum + (excludedFish.includes(members[index].fish) ? 0 : value), 0),
            catchBreakdown: members.map((member, index) => ({
              fish: member.fish, size: member.size, included: !excludedFish.includes(member.fish),
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
          poolKey,
          skillGainPer200: estimate.skillGain,
          sessionCasts: estimate.casts,
          attemptedFishPct: estimate.attemptedFishPct,
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
    uSkill,
    fishSeconds,
    otherSeconds,
    uExcludedFish,
    uBonusSkill,
    uSelectedRods,
    uIncludeCop,
    uIncludeToau,
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
              ? "Best Fishing Spots (Pool Share)"
              : "Fishing Skill-up Planner"}
        </h3>
        <div style={styles.sub}>
          {mode === "skillup"
            ? `${skillupGroups.length.toLocaleString()} location groups / ${skillupResults.length.toLocaleString()} combinations`
            : `${results.length.toLocaleString()} of ${(mode === "affinity" ? BAIT.length : POOLS.length).toLocaleString()} entries`}
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
              {textFilter("Search everything", sGlobal, setSGlobal, "e.g. moat carp", 240)}
              {textFilter("Target fish", sFish, setSFish, "e.g. carp")}
              {selectFilter("Zone", sZone, setSZone, POOL_ZONES, 200)}
              {textFilter("Area", sArea, setSArea, "e.g. whole zone", 160)}
              {textFilter("Bait", sBait, setSBait, "e.g. lugworm", 160)}
              {selectFilter("Kind", sKind, setSKind, KINDS, 120)}
              {selectFilter("Bite", sBite, setSBite, POOL_BITES, 140)}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ ...styles.field, width: 120 }}>
                <div style={styles.label}>Min share %</div>
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
                100% pools only (no competition)
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
              Lists every zone/area/bait combination for each fish. Pool Share = your target&apos;s estimated share of
              bites on that bait in that spot (neutral time/moon, adequate skill).{" "}
              <span style={shareColor(100)}>100%</span> = only your target bites it there;{" "}
              <span style={shareColor(70)}>60–99%</span> = minor competition; <span style={shareColor(30)}>&lt;60%</span>{" "}
              = crowded pool. A lower-share bait can still be the practical pick if it&apos;s cheaper or easier to get
              (e.g. Meatball vs Drill Calamary for Gugrusaurus).
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
              <div style={{ display: "flex", gap: 14, alignItems: "center", minHeight: 32 }}>
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
              <label style={{ ...styles.field, width: 200, maxWidth: "100%" }} title="Maximum estimated time to land 200 retained fish, including failed attempts and canceled casts. Blank means no limit.">
                <span style={styles.label}>Max time / 200 fish (hours)</span>
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
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {SPOT_COLUMNS.map((col) => {
                    const active = col.key === sSortKey;
                    return (
                      <th
                        key={col.key}
                        style={{ ...thStyle, ...(active ? { color: "#8af6b0" } : {}) }}
                        onClick={() => onSpotHeader(col.key)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}
                        {active ? (sSortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
                  <th style={{ ...thStyle, cursor: "default" }}>Competing Fish</th>
                </tr>
              </thead>
              <tbody>
                {visibleCount === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={SPOT_COLUMNS.length + 1}>
                      No matches. Try clearing some filters.
                    </td>
                  </tr>
                ) : (
                  spotResults.slice(0, MAX_VISIBLE_ROWS).map((p, i) => {
                    const rowKey = `spots|${p.zone}|${p.area}|${p.fish}|${p.bait}|${i}`;
                    const selected = selectedRowKey === rowKey;
                    return (
                    <tr
                      key={rowKey}
                      onClick={() => setSelectedRowKey(rowKey)}
                      style={{ ...clickableRowStyle, ...(selected ? selectedRowStyle : {}) }}
                      title="Click to highlight this row"
                    >
                      <td style={tdStyle}>{p.zone}</td>
                      <td style={tdStyle}>{p.area}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{p.fish}</td>
                      <td style={tdStyle}>{p.lvl ?? "-"}</td>
                      <td style={tdStyle}>{p.bait}</td>
                      <td style={tdStyle}>{p.kind}</td>
                      <td style={tdStyle}>{p.bite}</td>
                      <td style={tdStyle}>+{p.hookBonus}</td>
                      <td style={tdStyle}>{formatVendorPrice(getVendorPriceEach(p.fish))}</td>
                      <td style={{ ...tdStyle, ...shareColor(p.sharePct) }}>{p.sharePct}%</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>{p.competing.length}</td>
                      <td style={{ ...tdStyle, opacity: 0.85, whiteSpace: "normal", minWidth: 200 }}>
                        {p.competing.length > 0 ? p.competing.join(", ") : "—"}
                      </td>
                    </tr>
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
                        title={column.key === "skillGainPer200" ? SESSION_SKILL_ASSUMPTIONS : column.key === "catchTimeSeconds" ? catchTimeAssumptions : column.key === "targetFishPer200" ? TARGET_COUNT_ASSUMPTIONS : `Sort by ${column.label}`}
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
                        title={group ? "Expand or collapse sublocations and baits" : "Click to highlight this row"}
                      >
                        <td style={{ ...skillupCellStyle, padding: nested ? "6px 4px 6px 24px" : "6px 4px", ...(nested ? { boxShadow: "inset 2px 0 rgba(138,246,176,0.25)" } : {}) }}>
                          <button
                            type="button"
                            aria-label={group ? `${expanded ? "Hide" : "Show"} ${group.rows.length} location and bait combinations for ${row.zone}, ${row.fish}, ${row.rod}` : `${expanded ? "Hide" : "Show"} catch odds and risks for ${row.fish}, ${row.rod}, ${row.zone}, ${row.area}, ${row.bait}`}
                            aria-expanded={expanded}
                            aria-controls={group ? undefined : `skillup-details-${index}`}
                            title={group ? "Sublocations and baits" : expanded ? "Hide catch odds and risks" : "Show catch odds and risks"}
                            onClick={event => { event.stopPropagation(); if (group) toggleSkillupGroup(group.key, expanded); else setExpandedSkillupKey(expanded ? null : detailKey); }}
                            style={{ ...styles.buttonCompact, display: "grid", placeItems: "center", width: 28, height: 28, padding: 0 }}
                          >
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                        <td style={{ ...skillupCellStyle, color: "#8af6b0", fontWeight: 800, ...(nested ? { paddingLeft: 26 } : {}) }} title={SESSION_SKILL_ASSUMPTIONS}>
                          {row.skillGainPer200 === null ? "Not catchable" : `+${row.skillGainPer200.toFixed(2)}`}
                        </td>
                        <td style={skillupCellStyle}><strong>{row.fish}</strong><div style={{ opacity: 0.65, fontSize: 12 }}>Lvl {row.fishLevel} (+{row.levelDifference})</div>{row.catchBreakdown.some(member => member.fish === row.fish && !member.included) && <div style={{ opacity: 0.65, fontSize: 12 }}>Canceled</div>}</td>
                        <td style={skillupCellStyle}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                            <button type="button" aria-label={`${vendorExpanded ? "Hide" : "Show"} NPC prices and recipes for ${row.fish}`}
                              aria-expanded={vendorExpanded} aria-controls={`skillup-vendor-${index}`} title="NPC prices and recipes"
                              onClick={event => { event.stopPropagation(); setExpandedVendorKey(vendorExpanded ? null : rowKey); }}
                              style={{ ...styles.buttonCompact, display: "grid", placeItems: "center", flexShrink: 0, width: 28, height: 28, padding: 0 }}>
                              {vendorExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            <div title="Best direct sale or in-era NQ recipe gross proceeds per fish, before costs">
                              <strong>{vendor.bestPrice === null ? "Unknown" : `${formatVendorPrice(Math.round(vendor.bestPrice))} gil`}</strong>
                              <div style={{ opacity: 0.65, fontSize: 12 }}>{vendor.bestName === row.fish ? "Direct sale" : vendor.bestName}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...skillupCellStyle, fontWeight: 700, fontVariantNumeric: "tabular-nums" }} title={catchTimeAssumptions}>{formatCatchTime(row.catchTimeSeconds)}</td>
                        <td style={{ ...skillupCellStyle, fontWeight: 700, fontVariantNumeric: "tabular-nums" }} title={TARGET_COUNT_ASSUMPTIONS}>{row.targetFishPer200 === null ? "Not catchable" : row.targetFishPer200.toFixed(1)}</td>
                        <td style={skillupCellStyle}>{row.targetPct.toFixed(1)}%</td>
                        <td style={skillupCellStyle}>
                          {row.landPct.toFixed(1)}%
                          {itemHazards && <div style={{ color: "#ff9c7a", fontSize: 12 }} title={itemHazards}>Item break risk</div>}
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
                              ["Est. skill gain / 200 fish", row.skillGainPer200 === null ? "Not catchable" : `+${row.skillGainPer200.toFixed(2)}`],
                              ["Est. ending skill", row.skillGainPer200 === null ? "Not catchable" : (Number(uSkill) + row.skillGainPer200).toFixed(2)],
                              ["Time / 200 total fish", formatCatchTime(row.catchTimeSeconds)],
                              ["Target fish / 200 catches", row.targetFishPer200 === null ? "Not catchable" : row.targetFishPer200.toFixed(1)],
                              ["Time / 200 target fish (starting skill, ignores daily limit)", formatCatchTime(calculateCatchTime({ fishPct: row.attemptedFishPct, targetPct: row.catchBreakdown.find(member => member.fish === row.fish)?.included ? row.targetPct : 0, landPct: row.landPct }, { fishSeconds, otherSeconds }))],
                              ["Estimated casts / 200 fish", row.sessionCasts === null ? "Not catchable" : Math.ceil(row.sessionCasts).toLocaleString()],
                              ["Average cast time", row.sessionCasts && row.catchTimeSeconds ? `${(row.catchTimeSeconds / row.sessionCasts).toFixed(1)}s` : "Not catchable"],
                            ].map(([label, value]) => <div key={label}><dt style={{ opacity: 0.65, fontSize: 12 }}>{label}</dt><dd style={{ margin: "4px 0 0", fontWeight: 700 }}>{value}</dd></div>)}
                          </dl>
                          <div style={{ fontWeight: 700, marginBottom: 8 }} title="Modeled outcomes per 100 target-fish hooks when the fight is completed. These are final probabilities, not conditional rolls; early releases and minigame failures are excluded.">Actual outcomes per target hook</div>
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
                            <div style={{ fontWeight: 700, marginBottom: 8 }} title={TARGET_COUNT_ASSUMPTIONS}>Expected catch breakdown / 200 fish</div>
                            <table aria-label={`Expected catch breakdown for ${row.fish}, ${row.rod}, ${row.zone}, ${row.area}, ${row.bait}`} style={{ width: "100%", borderCollapse: "collapse" }}>
                              <thead><tr>
                                <th scope="col" style={{ ...skillupCellStyle, textAlign: "left" }}>Fish</th>
                                <th scope="col" style={{ ...skillupCellStyle, textAlign: "left" }}>Size</th>
                                <th scope="col" style={{ ...skillupCellStyle, textAlign: "right" }}>Expected catches</th>
                                <th scope="col" style={{ ...skillupCellStyle, textAlign: "right" }} title={SESSION_SKILL_ASSUMPTIONS}>Est. skill gain</th>
                              </tr></thead>
                              <tbody>{row.catchBreakdown.map(member => <tr key={member.fish}>
                                <td style={{ ...skillupCellStyle, ...(member.fish === row.fish ? { color: "#8af6b0", fontWeight: 700 } : {}) }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} title={member.included ? "Retain this fish" : "Cancel this fish when it bites"}>
                                    <input type="checkbox" aria-label={`Retain ${member.fish}`} checked={member.included} onChange={() => togglePoolFish(row.poolKey, member.fish)} />
                                    <span style={{ textDecoration: member.included ? undefined : "line-through", opacity: member.included ? 1 : 0.6 }}>{member.fish}{member.fish === row.fish ? " (target)" : ""}</span>
                                  </label>
                                </td>
                                <td style={skillupCellStyle}>{member.size === "L" ? "Large" : "Small"}</td>
                                <td style={{ ...skillupCellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{member.catches === null ? "Not catchable" : member.catches.toFixed(1)}</td>
                                <td style={{ ...skillupCellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{member.skillGain === null ? "Not catchable" : `+${member.skillGain.toFixed(2)}`}</td>
                              </tr>)}</tbody>
                              <tfoot><tr>
                                <th scope="row" colSpan={2} style={{ ...skillupCellStyle, textAlign: "left" }}>Total</th>
                                <td style={{ ...skillupCellStyle, textAlign: "right", fontWeight: 700 }}>{row.skillGainPer200 === null ? "Not catchable" : "200.0"}</td>
                                <td style={{ ...skillupCellStyle, textAlign: "right", fontWeight: 700 }}>{row.skillGainPer200 === null ? "Not catchable" : `+${row.skillGainPer200.toFixed(2)}`}</td>
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
