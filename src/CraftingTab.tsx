// src/CraftingTab.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { styles } from "./styles";
import { CollapsibleSection, useTableViewportHeight } from "./ScreenControls";
import recipesData from "./data/recipes.json";
import { loadJson, saveJson } from "./utils/storage";
import { craftSkillupStats } from "./utils/craftingSkillup";
import { estimateCraftMaterials } from "./utils/craftMaterialEstimate";
import { CraftingLevels } from "./ProfitControls";
import { createPrintingChain, type ChainNode } from "./utils/printingChain";
import { printItem, printItemKey } from "./utils/printingData";
import { AH_CRAFT_CATEGORY, CRAFT_COLORS } from "./utils/craftColors";
import { usePrintSettings } from "./utils/printSettingsStore";
import { formatGuildPointCap, getGuildPointItemsToCap } from "./utils/guildPoints";
import { findableName, normalizeItemName } from "./utils/itemLinks";
import { getPurification, purificationMatches } from "./utils/purification";
import { navigateToTab, peekNavQuery, peekNavRecipeId, hasBackTab, goBackTab, peekBackTabSeq, nextNavSeq } from "./utils/tabNav";
import { captureScrollPosition, restoreScrollPosition, type ScrollPosition } from "./utils/scrollPosition";
import { rememberTabState, peekRestoredTabState } from "./utils/tabNav";
import GuildSellingTab, { type GuildTimerControls } from "./GuildSellingTab";
import { WEEKDAY_COLORS } from "./utils/weekday";
import "./PrintingTab.css";

type RecipeItem = { n: string; q: number };
type RecipeSub = { c: string; l: number };
type Recipe = {
  id: number;
  craft: string;
  lvl: number;
  crystal: string;
  era: string;
  ing: RecipeItem[];
  res: RecipeItem;
  hq: RecipeItem[];
  subs?: RecipeSub[];
  /** 1 = desynthesis, 2 = no material loss on break */
  d?: number;
  ki?: boolean;
};

const RECIPES: Recipe[] = recipesData as Recipe[];
const ItemInfo = React.lazy(() => import("./ItemInfo"));
const detailItems = new Map<number, string>();

function RecipeItemDetails({ recipe }: { recipe: Recipe }) {
  const [item, setItem] = useState(detailItems.get(recipe.id) ?? recipe.res.n);
  const recipeNames = [recipe.res.n, ...recipe.hq.map((result) => result.n), ...recipe.ing.map((ingredient) => ingredient.n), `${recipe.crystal} Crystal`];
  const names = [...new Set(recipeNames.flatMap((name) => {
    const exchange = getPurification(name);
    return exchange ? [name, exchange.result, exchange.abjuration] : [name];
  }))];
  const selectItem = (name: string) => { detailItems.set(recipe.id, name); setItem(name); };
  return (
    <div className="item-detail-panel" style={{ display: "grid", gap: 12, padding: 12, minWidth: 0 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        Item details
        <select value={item} onChange={(event) => selectItem(event.target.value)} style={{ ...styles.select, maxWidth: "100%" }}>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <React.Suspense fallback={<strong>{item}</strong>}>
        <ItemInfo key={item} name={item} onSelectName={selectItem} />
      </React.Suspense>
    </div>
  );
}

const CRAFTS = [
  "Alchemy",
  "Bonecraft",
  "Clothcraft",
  "Cooking",
  "Goldsmithing",
  "Leathercraft",
  "Smithing",
  "Woodworking",
];

const CRYSTAL_OPTIONS = ["Fire", "Ice", "Wind", "Earth", "Lightning", "Water", "Light", "Dark"];
const CRYSTAL_COLORS: Record<(typeof CRYSTAL_OPTIONS)[number], string> = {
  Fire: WEEKDAY_COLORS.Firesday,
  Ice: WEEKDAY_COLORS.Iceday,
  Wind: WEEKDAY_COLORS.Windsday,
  Earth: WEEKDAY_COLORS.Earthsday,
  Lightning: WEEKDAY_COLORS.Lightningday,
  Water: WEEKDAY_COLORS.Watersday,
  Light: WEEKDAY_COLORS.Lightsday,
  Dark: WEEKDAY_COLORS.Darksday,
};
const ERA_OPTIONS = ["Base", "RotZ", "CoP", "ToAU", "WotG"];

type Mode = "recipes" | "planner" | "calculator" | "guilds";
type SortDir = "asc" | "desc";
type RecipeKey = "res" | "craft" | "lvl" | "crystal" | "era" | "gpItemsToCap";
type PlannerKey =
  | "expectedPerSynth"
  | "res"
  | "lvl"
  | "gap"
  | "successPct"
  | "chanceOnSuccessPct"
  | "avgGain"
  | "synthsPerLevel"
  | "crystal"
  | "era";

type PlannerRow = {
  recipe: Recipe;
  gap: number;
  successPct: number;
  chanceOnSuccessPct: number;
  chanceOnFailPct: number;
  avgGain: number;
  expectedPerSynth: number;
  synthsPerLevel: number;
};

const RECIPE_COLUMNS: { key: RecipeKey; label: string }[] = [
  { key: "res", label: "Result" },
  { key: "gpItemsToCap", label: "GP" },
  { key: "craft", label: "Craft" },
  { key: "lvl", label: "Lvl" },
  { key: "crystal", label: "Crystal" },
  { key: "era", label: "Era" },
];

const PLANNER_COLUMNS: { key: PlannerKey; label: string }[] = [
  { key: "expectedPerSynth", label: "Expected Skill / Synth" },
  { key: "res", label: "Recipe" },
  { key: "lvl", label: "Cap" },
  { key: "gap", label: "+Lvl" },
  { key: "successPct", label: "Success" },
  { key: "chanceOnSuccessPct", label: "Skill-up Chance" },
  { key: "avgGain", label: "Avg Gain" },
  { key: "synthsPerLevel", label: "Synths / Level" },
  { key: "crystal", label: "Crystal" },
  { key: "era", label: "Era" },
];

const MAX_VISIBLE_ROWS = 300;
const CRAFTING_UI_KEY = "ffxi_crafting_ui_v1";

const RANK_UP_COLOR = "#7fd4ff";

// Guild rank-up test items per craft, from LSB guild_master.lua testItemTable
// (tests at skill 8/18/28/38/48/58/68/78/88; the rank-10 Expert items are post-era recipes).
const RANK_UP_ITEMS: Record<string, Set<string>> = {
  Woodworking: new Set([
    "workbench", "maple table", "harp", "traversiere", "rose wand",
    "kaman", "ebony wand", "commode", "mythic pole",
  ]),
  Smithing: new Set([
    "xiphos", "aspis", "bilbo", "war pick", "mythril pick",
    "darksteel falchion", "bascinet", "bastard sword", "celata",
  ]),
  Goldsmithing: new Set([
    "copper hairpin", "brass hairpin", "silver hairpin", "chain gorget", "mythril ring",
    "mythril gorget", "mythril breastplate", "torque", "colichemarde",
  ]),
  Clothcraft: new Set([
    "cape", "cotton cape", "heko obi", "feather collar", "wool bracers",
    "red cape", "wool doublet", "silk cloak", "arhat's hakama",
  ]),
  Leathercraft: new Set([
    "rabbit mantle", "lizard cesti", "dhalmel mantle", "magic belt", "cuir bouilli",
    "raptor jerkin", "battle boots", "tiger gloves", "coeurl mask",
  ]),
  Bonecraft: new Set([
    "shell ring", "bone ring", "beetle earring", "horn ring", "carapace gorget",
    "astragalos", "bone patas", "coral hairpin", "coral bangles",
  ]),
  Alchemy: new Set([
    "animal glue", "poison potion", "blinding potion", "firesand", "fire sword",
    "hi-potion", "acid kukri", "x-potion", "bloody sword",
  ]),
  Cooking: new Set([
    "salmon sub", "pea soup", "vegetable gruel", "meat mithkabob", "apple pie",
    "yagudo drink", "raisin bread", "whitefish stew", "seafood stew",
  ]),
};

const isRankUpItem = (craft: string, resultName: string) =>
  RANK_UP_ITEMS[craft]?.has(resultName.toLowerCase()) ?? false;

const optionBaseStyle: React.CSSProperties = {
  backgroundColor: "#0c0c0c",
  color: "#eaeaea",
};

const plannerToggleStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 32,
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function CraftIngredientBreakdown({ node, quantity }: { node: ChainNode; quantity: number }) {
  const required = Math.ceil(Math.max(0, quantity));
  const recipe = node.recipe;
  if (!recipe || !Number.isFinite(node.yield) || node.yield <= 0) {
    return (
      <li>
        {formatMaterialAmount(node.name, required)} — {node.issue ?? "buy or obtain; no usable recipe at these skills"}
      </li>
    );
  }

  const attempts = Math.ceil(required / node.yield);
  return (
    <li>
      <details>
        <summary>
          {formatMaterialAmount(node.name, required)} — about {attempts} {recipe.craft} synths (cap {recipe.lvl})
        </summary>
        {node.issue && <div style={{ ...styles.sub, color: "#ff9c7a", marginTop: 6 }}>{node.issue}</div>}
        {node.children.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 22 }}>
            {node.children.map((child) => (
              <CraftIngredientBreakdown
                key={child.node.key}
                node={child.node}
                quantity={child.quantity * attempts}
              />
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

function formatMaterialAmount(name: string, quantity: number): React.ReactNode {
  const item = printItem(name);
  const stackSize = item?.stack ?? 1;
  const crystal = CRYSTAL_OPTIONS.find((element) => name === `${element} Crystal`);
  const craft = item ? AH_CRAFT_CATEGORY[item.category] : undefined;
  const color = crystal ? CRYSTAL_COLORS[crystal] : craft ? CRAFT_COLORS[craft] : undefined;
  const itemName = <span style={color ? { color } : undefined}>{name}</span>;
  if (stackSize <= 1) return <>{quantity} × {itemName}</>;
  const stacks = Math.ceil(quantity / stackSize);
  return <>{quantity} × {itemName} ({stacks} stacks of {stackSize})</>;
}

const thStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  // Above row cells that form stacking contexts (opacity < 1 tds).
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

function successColor(pct: number): React.CSSProperties {
  if (pct >= 90) return { color: "#8af6b0", fontWeight: 700 };
  if (pct >= 70) return { color: "#D8B04B", fontWeight: 700 };
  return { color: "#ff9c7a", fontWeight: 700 };
}

function eraLabel(era: string): string {
  return era === "" ? "Base" : era;
}

const ingredientLinkStyle: React.CSSProperties = {
  color: "#8af6b0",
  cursor: "pointer",
  textDecoration: "underline",
  textDecorationColor: "rgba(138,246,176,0.35)",
  textUnderlineOffset: 2,
};

const dropLinkStyle: React.CSSProperties = {
  color: "#7ec4e8",
  cursor: "pointer",
  textDecoration: "underline",
  textDecorationColor: "rgba(126,196,232,0.35)",
  textUnderlineOffset: 2,
};

type SearchSnapshot = {
  scroll: ScrollPosition;
  selectedRowKey: string | null;
  seq: number;
  mode: Mode;
  rGlobal: string;
  rResult: string;
  rIngredient: string;
  rCraft: string;
  rCrystal: string;
  rEra: string;
  rLvlMin: string;
  rLvlMax: string;
  rIncludeDesynth: boolean;
};

// Survives tab switches (component unmounts); intentionally not persisted across restarts.
let sessionSearchHistory: SearchSnapshot[] = [];

function hqText(recipe: Recipe): string {
  const allSame = recipe.hq.every((h) => h.n === recipe.res.n);
  if (allSame) return recipe.hq.map((h, i) => `HQ${i + 1}: x${h.q}`).join(" / ");
  return recipe.hq.map((h, i) => `HQ${i + 1}: ${h.n}${h.q > 1 ? ` x${h.q}` : ""}`).join(" / ");
}

function subsText(recipe: Recipe): string {
  if (!recipe.subs || recipe.subs.length === 0) return "—";
  return recipe.subs.map((s) => `${s.c} ${s.l}`).join(", ");
}

function badges(recipe: Recipe): string {
  const parts: string[] = [];
  if (recipe.d === 1) parts.push("Desynth");
  if (recipe.d === 2) parts.push("No-loss");
  if (recipe.ki) parts.push("Key Item");
  return parts.join(" · ");
}

/** Name match tolerant of LSB's missing punctuation ("Barons Saio" vs "baron's saio"). */
function nameMatches(name: string, q: string, qNorm: string): boolean {
  return name.toLowerCase().includes(q) || normalizeItemName(name).includes(qNorm) || purificationMatches(name, qNorm);
}

function recipeMatchesText(recipe: Recipe, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  const qn = normalizeItemName(needle);
  if (nameMatches(recipe.res.n, q, qn)) return true;
  if (recipe.craft.toLowerCase().includes(q)) return true;
  if (recipe.crystal.toLowerCase().includes(q)) return true;
  if (eraLabel(recipe.era).toLowerCase().includes(q)) return true;
  if (recipe.ing.some((i) => nameMatches(i.n, q, qn))) return true;
  if (recipe.hq.some((h) => nameMatches(h.n, q, qn))) return true;
  return false;
}

/** Parse "45.3" style skill input into server tenths; empty/invalid → null. */
function parseSkillTenths(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 110) return null;
  return Math.round(value * 10);
}

type CraftingUiState = {
  mode: Mode;
  includeWotg: boolean;
  rGlobal: string;
  rResult: string;
  rIngredient: string;
  rCraft: string;
  rCrystal: string;
  rEra: string;
  rLvlMin: string;
  rLvlMax: string;
  rIncludeDesynth: boolean;
  rSortKey: RecipeKey;
  rSortDir: SortDir;
  pCraft: string;
  pSkill: string;
  pSupport: string;
  pGearMain: boolean;
  pGearSub: boolean;
  pMogh: boolean;
  pGlobal: string;
  pIngredient: string;
  pMinSuccess: string;
  pLvlMin: string;
  pLvlMax: string;
  pIncludeDesynth: boolean;
  pHideKeyItem: boolean;
  pSortKey: PlannerKey;
  pSortDir: SortDir;
  calcSkill: string;
  calcTarget: string;
  calcCraft: string;
  calcSearch: string;
  calcRecipeId: string;
  calcSupport: boolean;
  calcSupportStrength: string;
  calcLoop: boolean;
};

const defaultUi: CraftingUiState = {
  mode: "planner",
  includeWotg: false,
  rGlobal: "",
  rResult: "",
  rIngredient: "",
  rCraft: "",
  rCrystal: "",
  rEra: "",
  rLvlMin: "",
  rLvlMax: "",
  rIncludeDesynth: false,
  rSortKey: "lvl",
  rSortDir: "asc",
  pCraft: "Cooking",
  pSkill: "0",
  pSupport: "0",
  pGearMain: false,
  pGearSub: false,
  pMogh: false,
  pGlobal: "",
  pIngredient: "",
  pMinSuccess: "",
  pLvlMin: "",
  pLvlMax: "",
  pIncludeDesynth: false,
  pHideKeyItem: false,
  pSortKey: "expectedPerSynth",
  pSortDir: "desc",
  calcSkill: "0",
  calcTarget: "",
  calcCraft: "",
  calcSearch: "",
  calcRecipeId: "",
  calcSupport: false,
  calcSupportStrength: "3",
  calcLoop: false,
};

export default function CraftingTab(timerControls: GuildTimerControls) {
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const resultsHeight = useTableViewportHeight(resultsRef);
  const restored = peekRestoredTabState<{ ui: CraftingUiState; selectedRowKey: string | null }>("crafting");
  const initialUi = useMemo(() => {
    if (restored) return restored.ui;
    const loaded = loadJson<Partial<CraftingUiState>>(CRAFTING_UI_KEY, {});
    const navQuery = peekNavQuery("crafting");
    const linkedRecipe = RECIPES.find((recipe) => recipe.id === peekNavRecipeId());
    const navOverride: Partial<CraftingUiState> = navQuery
      ? {
          mode: "recipes",
          rGlobal: "",
          rResult: navQuery,
          rIngredient: "",
          rCraft: "",
          rCrystal: "",
          rEra: "",
          rLvlMin: "",
          rLvlMax: "",
          ...(linkedRecipe ? {
            rResult: linkedRecipe.res.n,
            rCraft: linkedRecipe.craft,
            rCrystal: linkedRecipe.crystal,
            rEra: linkedRecipe.era || "Base",
            rLvlMin: String(linkedRecipe.lvl),
            rLvlMax: String(linkedRecipe.lvl),
            rIncludeDesynth: linkedRecipe.d === 1,
            includeWotg: linkedRecipe.era === "WotG" || loaded.includeWotg === true,
          } : {}),
        }
      : {};
    return { ...defaultUi, ...loaded, ...navOverride };
  }, []);

  const [mode, setMode] = useState<Mode>(initialUi.mode === "guilds" ? "guilds" : initialUi.mode === "recipes" ? "recipes" : initialUi.mode === "calculator" ? "calculator" : "planner");
  const [includeWotg, setIncludeWotg] = useState(initialUi.includeWotg);

  const [rGlobal, setRGlobal] = useState(initialUi.rGlobal);
  const [rResult, setRResult] = useState(initialUi.rResult);
  const [rIngredient, setRIngredient] = useState(initialUi.rIngredient);
  const [rCraft, setRCraft] = useState(initialUi.rCraft);
  const [rCrystal, setRCrystal] = useState(initialUi.rCrystal);
  const [rEra, setREra] = useState(initialUi.rEra);
  const [rLvlMin, setRLvlMin] = useState(initialUi.rLvlMin);
  const [rLvlMax, setRLvlMax] = useState(initialUi.rLvlMax);
  const [rIncludeDesynth, setRIncludeDesynth] = useState(initialUi.rIncludeDesynth);
  const [rSortKey, setRSortKey] = useState<RecipeKey>(initialUi.rSortKey);
  const [rSortDir, setRSortDir] = useState<SortDir>(initialUi.rSortDir);

  const [pCraft, setPCraft] = useState(CRAFTS.includes(initialUi.pCraft) ? initialUi.pCraft : "Cooking");
  const [pSkill, setPSkill] = useState(initialUi.pSkill);
  const [pSupport, setPSupport] = useState(["0", "1", "3"].includes(initialUi.pSupport) ? initialUi.pSupport : "0");
  const [pGearMain, setPGearMain] = useState(initialUi.pGearMain);
  const [pGearSub, setPGearSub] = useState(initialUi.pGearSub);
  const [pMogh, setPMogh] = useState(initialUi.pMogh);
  const [pGlobal, setPGlobal] = useState(initialUi.pGlobal);
  const [pIngredient, setPIngredient] = useState(initialUi.pIngredient);
  const [pMinSuccess, setPMinSuccess] = useState(initialUi.pMinSuccess);
  const [pLvlMin, setPLvlMin] = useState(initialUi.pLvlMin);
  const [pLvlMax, setPLvlMax] = useState(initialUi.pLvlMax);
  const [pIncludeDesynth, setPIncludeDesynth] = useState(initialUi.pIncludeDesynth);
  const [pHideKeyItem, setPHideKeyItem] = useState(initialUi.pHideKeyItem);
  const [pSortKey, setPSortKey] = useState<PlannerKey>(initialUi.pSortKey);
  const [pSortDir, setPSortDir] = useState<SortDir>(initialUi.pSortDir);
  const [calcSkill, setCalcSkill] = useState(initialUi.calcSkill);
  const [calcTarget, setCalcTarget] = useState(initialUi.calcTarget);
  const [calcCraft, setCalcCraft] = useState(initialUi.calcCraft);
  const [calcSearch, setCalcSearch] = useState(initialUi.calcSearch);
  const [calcRecipeId, setCalcRecipeId] = useState(initialUi.calcRecipeId);
  const [calcSupport, setCalcSupport] = useState(initialUi.calcSupport);
  const [calcSupportStrength, setCalcSupportStrength] = useState(initialUi.calcSupportStrength);
  const [calcLoop, setCalcLoop] = useState(initialUi.calcLoop);
  const [ingredientCraftSettings, updateIngredientCraftSettings] = usePrintSettings();

  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(restored?.selectedRowKey ?? null);

  useEffect(() => {
    const ui = {
      mode,
      includeWotg,
      rGlobal,
      rResult,
      rIngredient,
      rCraft,
      rCrystal,
      rEra,
      rLvlMin,
      rLvlMax,
      rIncludeDesynth,
      rSortKey,
      rSortDir,
      pCraft,
      pSkill,
      pSupport,
      pGearMain,
      pGearSub,
      pMogh,
      pGlobal,
      pIngredient,
      pMinSuccess,
      pLvlMin,
      pLvlMax,
      pIncludeDesynth,
      pHideKeyItem,
      pSortKey,
      pSortDir,
      calcSkill,
      calcTarget,
      calcCraft,
      calcSearch,
      calcRecipeId,
      calcSupport,
      calcSupportStrength,
      calcLoop,
    } satisfies CraftingUiState;
    saveJson(CRAFTING_UI_KEY, ui);
    rememberTabState("crafting", { ui, selectedRowKey });
  }, [
    selectedRowKey,
    mode, includeWotg,
    rGlobal, rResult, rIngredient, rCraft, rCrystal, rEra, rLvlMin, rLvlMax, rIncludeDesynth, rSortKey, rSortDir,
    pCraft, pSkill, pSupport, pGearMain, pGearSub, pMogh, pGlobal, pIngredient, pMinSuccess, pLvlMin, pLvlMax, pIncludeDesynth, pHideKeyItem, pSortKey, pSortDir,
    calcSkill, calcTarget, calcCraft, calcSearch, calcRecipeId, calcSupport, calcSupportStrength, calcLoop,
  ]);

  const eraFiltered = useMemo(
    () => RECIPES.filter((r) => includeWotg || r.era !== "WotG"),
    [includeWotg]
  );

  function onRecipeHeader(key: RecipeKey) {
    if (key === rSortKey) {
      setRSortDir(rSortDir === "asc" ? "desc" : "asc");
    } else {
      setRSortKey(key);
      setRSortDir(key === "lvl" ? "asc" : "asc");
    }
  }

  function onPlannerHeader(key: PlannerKey) {
    if (key === pSortKey) {
      setPSortDir(pSortDir === "asc" ? "desc" : "asc");
    } else {
      setPSortKey(key);
      setPSortDir(
        key === "expectedPerSynth" || key === "successPct" || key === "chanceOnSuccessPct" || key === "avgGain"
          ? "desc"
          : "asc"
      );
    }
  }

  const recipeFilterActive =
    rGlobal !== "" || rResult !== "" || rIngredient !== "" || rCraft !== "" || rCrystal !== "" ||
    rEra !== "" || rLvlMin !== "" || rLvlMax !== "" || rIncludeDesynth;

  function clearRecipeFilters() {
    setRGlobal("");
    setRResult("");
    setRIngredient("");
    setRCraft("");
    setRCrystal("");
    setREra("");
    setRLvlMin("");
    setRLvlMax("");
    setRIncludeDesynth(false);
  }

  const plannerFilterActive =
    pGlobal !== "" || pIngredient !== "" || pMinSuccess !== "" || pLvlMin !== "" || pLvlMax !== "" ||
    pIncludeDesynth || pHideKeyItem;

  function clearPlannerFilters() {
    setPGlobal("");
    setPIngredient("");
    setPMinSuccess("");
    setPLvlMin("");
    setPLvlMax("");
    setPIncludeDesynth(false);
    setPHideKeyItem(false);
  }

  const craftableTargets = useMemo(() => {
    const map = new Map<string, string>(); // normalized name -> result name to search for
    for (const r of eraFiltered) map.set(normalizeItemName(r.res.n), r.res.n);
    // HQ results (e.g. "Gold Earring +1") resolve to their base recipe.
    for (const r of eraFiltered) {
      if (r.d === 1) continue;
      for (const h of r.hq) {
        const norm = normalizeItemName(h.n);
        if (!map.has(norm)) map.set(norm, r.res.n);
      }
    }
    return map;
  }, [eraFiltered]);

  /** Name to search for if this ingredient is craftable, else null. */
  function ingredientTarget(name: string): string | null {
    return craftableTargets.get(normalizeItemName(name)) ?? null;
  }

  const [searchHistory, setSearchHistory] = useState<SearchSnapshot[]>(sessionSearchHistory);

  function updateHistory(next: SearchSnapshot[]) {
    sessionSearchHistory = next;
    setSearchHistory(next);
  }

  function searchForIngredient(target: string) {
    updateHistory([
      ...searchHistory,
      { seq: nextNavSeq(), scroll: captureScrollPosition(), selectedRowKey, mode, rGlobal, rResult, rIngredient, rCraft, rCrystal, rEra, rLvlMin, rLvlMax, rIncludeDesynth },
    ]);
    clearRecipeFilters();
    setRResult(target);
    setMode("recipes");
  }

  function searchDropsFor(target: string) {
    navigateToTab("drops", target, "crafting");
  }

  const canGoBack = searchHistory.length > 0 || hasBackTab();

  function goBack() {
    const prev = searchHistory[searchHistory.length - 1];
    // Pop whichever navigation happened most recently: in-tab search or cross-tab jump.
    if (prev && prev.seq > peekBackTabSeq()) {
      updateHistory(searchHistory.slice(0, -1));
      setMode(prev.mode);
      setRGlobal(prev.rGlobal);
      setRResult(prev.rResult);
      setRIngredient(prev.rIngredient);
      setRCraft(prev.rCraft);
      setRCrystal(prev.rCrystal);
      setREra(prev.rEra);
      setRLvlMin(prev.rLvlMin);
      setRLvlMax(prev.rLvlMax);
      setRIncludeDesynth(prev.rIncludeDesynth);
      setSelectedRowKey(prev.selectedRowKey);
      restoreScrollPosition(prev.scroll);
      return;
    }
    if (hasBackTab()) goBackTab();
  }

  /** Result cell: links to the Items tab when the item has a findable source. */
  const renderResult = (recipe: Recipe, rankUp: boolean) => {
    const label = `${recipe.res.n}${recipe.res.q > 1 ? ` x${recipe.res.q}` : ""}`;
    const target = findableName(recipe.res.n);
    if (!target) return label;
    return (
      <span
        style={{
          cursor: "pointer",
          textDecoration: "underline",
          textDecorationColor: rankUp ? "rgba(127,212,255,0.35)" : "rgba(255,255,255,0.25)",
          textUnderlineOffset: 2,
        }}
        title={`Find every source of ${target}`}
        onClick={(e) => {
          e.stopPropagation();
          searchDropsFor(target);
        }}
      >
        {label}
      </span>
    );
  };

  /** HQ Results cell: distinct HQ items link to the Items tab like the NQ result does. */
  const renderHqResults = (recipe: Recipe) => {
    if (recipe.hq.every((h) => h.n === recipe.res.n)) return hqText(recipe);
    return recipe.hq.map((h, i) => {
      const label = `${h.n}${h.q > 1 ? ` x${h.q}` : ""}`;
      const gpCount = h.n === recipe.res.n ? null : getGuildPointItemsToCap(h.n);
      const target = h.n === recipe.res.n ? null : findableName(h.n);
      return (
        <React.Fragment key={i}>
          {i > 0 ? " / " : ""}
          {`HQ${i + 1}: `}
          {target ? (
            <span
              style={{ color: "#7ec4e8", cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(126,196,232,0.6)", textUnderlineOffset: 2 }}
              title={`Find every source of ${target}`}
              onClick={(e) => {
                e.stopPropagation();
                searchDropsFor(target);
              }}
            >
              {label}
            </span>
          ) : (
            label
          )}
          {gpCount !== null && ` (GP: ${formatGuildPointCap(h.n)})`}
        </React.Fragment>
      );
    });
  };

  const renderIngredients = (recipe: Recipe) =>
    recipe.ing.map((i, idx) => {
      const label = i.q > 1 ? `${i.n} x${i.q}` : i.n;
      const craftTarget = ingredientTarget(i.n);
      const dropTarget = findableName(i.n);
      return (
        <React.Fragment key={idx}>
          {idx > 0 ? ", " : ""}
          {craftTarget ? (
            <span
              style={ingredientLinkStyle}
              title={`Search recipes for ${craftTarget}`}
              onClick={(e) => {
                e.stopPropagation();
                searchForIngredient(craftTarget);
              }}
            >
              {label}
            </span>
          ) : dropTarget ? (
            <span
              style={dropLinkStyle}
              title={`Find sources for ${dropTarget}`}
              onClick={(e) => {
                e.stopPropagation();
                searchDropsFor(dropTarget);
              }}
            >
              {label}
            </span>
          ) : (
            label
          )}
          {craftTarget && dropTarget ? (
            <span
              style={{ ...dropLinkStyle, textDecoration: "none" }}
              title={`Find sources for ${dropTarget}`}
              onClick={(e) => {
                e.stopPropagation();
                searchDropsFor(dropTarget);
              }}
            >
              {" ⚔"}
            </span>
          ) : null}
        </React.Fragment>
      );
    });

  const recipeResults = useMemo(() => {
    const lvlMin = rLvlMin === "" ? null : Number(rLvlMin);
    const lvlMax = rLvlMax === "" ? null : Number(rLvlMax);

    const rows = eraFiltered.filter((r) => {
      if (!rIncludeDesynth && r.d === 1) return false;
      if (rCraft && r.craft !== rCraft) return false;
      if (rCrystal && r.crystal !== rCrystal) return false;
      if (rEra && eraLabel(r.era) !== rEra) return false;
      if (lvlMin !== null && Number.isFinite(lvlMin) && r.lvl < lvlMin) return false;
      if (lvlMax !== null && Number.isFinite(lvlMax) && r.lvl > lvlMax) return false;
      if (rResult) {
        const q = rResult.trim().toLowerCase();
        const qn = normalizeItemName(rResult);
        // HQ versions count as results too (Dusk Gloves +1, Baron's gear...)
        if (!nameMatches(r.res.n, q, qn) && !r.hq.some((h) => nameMatches(h.n, q, qn))) return false;
      }
      if (rIngredient) {
        const q = rIngredient.trim().toLowerCase();
        const qn = normalizeItemName(rIngredient);
        if (!r.ing.some((i) => nameMatches(i.n, q, qn))) return false;
      }
      if (rGlobal && !recipeMatchesText(r, rGlobal)) return false;
      return true;
    });

    const dir = rSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      if (rSortKey === "gpItemsToCap") {
        const av = getGuildPointItemsToCap(a.res.n);
        const bv = getGuildPointItemsToCap(b.res.n);
        if (av === null && bv !== null) return 1;
        if (av !== null && bv === null) return -1;
        cmp = (av ?? 0) - (bv ?? 0);
      }
      else if (rSortKey === "lvl") cmp = a.lvl - b.lvl;
      else if (rSortKey === "res") cmp = a.res.n.localeCompare(b.res.n);
      else if (rSortKey === "craft") cmp = a.craft.localeCompare(b.craft);
      else if (rSortKey === "crystal") cmp = a.crystal.localeCompare(b.crystal);
      else cmp = eraLabel(a.era).localeCompare(eraLabel(b.era));
      if (cmp === 0) cmp = a.lvl - b.lvl;
      if (cmp === 0) cmp = a.res.n.localeCompare(b.res.n);
      return cmp * dir;
    });

    return rows;
  }, [eraFiltered, rGlobal, rResult, rIngredient, rCraft, rCrystal, rEra, rLvlMin, rLvlMax, rIncludeDesynth, rSortKey, rSortDir]);

  const skillTenths = parseSkillTenths(pSkill);
  const supportBonus = Number(pSupport) + (pGearMain ? 1 : 0) + (pGearSub ? 1 : 0) + (pMogh ? 1 : 0);

  const plannerResults = useMemo(() => {
    if (skillTenths === null) return [] as PlannerRow[];

    const minSuccess = pMinSuccess === "" ? null : Number(pMinSuccess);
    const lvlMin = pLvlMin === "" ? null : Number(pLvlMin);
    const lvlMax = pLvlMax === "" ? null : Number(pLvlMax);

    const rows: PlannerRow[] = [];
    for (const recipe of eraFiltered) {
      if (recipe.craft !== pCraft) continue;
      if (!pIncludeDesynth && recipe.d === 1) continue;
      if (pHideKeyItem && recipe.ki) continue;
      if (lvlMin !== null && Number.isFinite(lvlMin) && recipe.lvl < lvlMin) continue;
      if (lvlMax !== null && Number.isFinite(lvlMax) && recipe.lvl > lvlMax) continue;
      if (pIngredient && !recipe.ing.some((i) => i.n.toLowerCase().includes(pIngredient.trim().toLowerCase()))) continue;
      if (pGlobal && !recipeMatchesText(recipe, pGlobal)) continue;

      const stats = craftSkillupStats(skillTenths, recipe.lvl, recipe.d === 1, supportBonus, recipe.subs?.length ?? 0);
      if (!stats.eligible) continue;
      if (minSuccess !== null && Number.isFinite(minSuccess) && stats.successPct < minSuccess) continue;

      rows.push({
        recipe,
        gap: stats.gap,
        successPct: stats.successPct,
        chanceOnSuccessPct: stats.chanceOnSuccessPct,
        chanceOnFailPct: stats.chanceOnFailPct,
        avgGain: stats.avgGain,
        expectedPerSynth: stats.expectedPerSynth,
        synthsPerLevel: stats.synthsPerLevel,
      });
    }

    const dir = pSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      if (pSortKey === "expectedPerSynth") cmp = a.expectedPerSynth - b.expectedPerSynth;
      else if (pSortKey === "res") cmp = a.recipe.res.n.localeCompare(b.recipe.res.n);
      else if (pSortKey === "lvl") cmp = a.recipe.lvl - b.recipe.lvl;
      else if (pSortKey === "gap") cmp = a.gap - b.gap;
      else if (pSortKey === "successPct") cmp = a.successPct - b.successPct;
      else if (pSortKey === "chanceOnSuccessPct") cmp = a.chanceOnSuccessPct - b.chanceOnSuccessPct;
      else if (pSortKey === "avgGain") cmp = a.avgGain - b.avgGain;
      else if (pSortKey === "synthsPerLevel") cmp = a.synthsPerLevel - b.synthsPerLevel;
      else if (pSortKey === "crystal") cmp = a.recipe.crystal.localeCompare(b.recipe.crystal);
      else cmp = eraLabel(a.recipe.era).localeCompare(eraLabel(b.recipe.era));
      if (cmp === 0) cmp = b.expectedPerSynth - a.expectedPerSynth;
      if (cmp === 0) cmp = a.recipe.res.n.localeCompare(b.recipe.res.n);
      return cmp * dir;
    });

    return rows;
  }, [eraFiltered, skillTenths, pCraft, supportBonus, pGlobal, pIngredient, pMinSuccess, pLvlMin, pLvlMax, pIncludeDesynth, pHideKeyItem, pSortKey, pSortDir]);

  const calcSkillTenths = calcSkill.trim() === "" ? null : parseSkillTenths(calcSkill);
  const calculatorOptions = useMemo(() => {
    const query = calcSearch.trim().toLowerCase();
    const matchesCraftAndSkill = (recipe: Recipe) =>
      recipe.craft === calcCraft && (calcSkillTenths === null || recipe.lvl * 10 > calcSkillTenths);
    const options = eraFiltered.filter((recipe) => recipe.d !== 1 && matchesCraftAndSkill(recipe) && (!query ||
      recipe.res.n.toLowerCase().includes(query) ||
      recipe.craft.toLowerCase().includes(query) ||
      recipe.ing.some((ingredient) => ingredient.n.toLowerCase().includes(query)) ||
      recipe.hq.some((result) => result.n.toLowerCase().includes(query))));
    const selected = eraFiltered.find((recipe) => String(recipe.id) === calcRecipeId);
    if (selected && selected.d !== 1 && matchesCraftAndSkill(selected) && !options.some((recipe) => recipe.id === selected.id)) options.unshift(selected);
    return options.slice(0, 200);
  }, [eraFiltered, calcSearch, calcRecipeId, calcCraft, calcSkillTenths]);

  const calculatorRecipe = calculatorOptions.find((recipe) => String(recipe.id) === calcRecipeId);
  const calculatorDesynth = calculatorRecipe
    ? eraFiltered.find((recipe) => recipe.d === 1 && recipe.craft === calculatorRecipe.craft && recipe.ing[0]?.n === calculatorRecipe.res.n) ?? null
    : null;
  const calcTargetTenths = calcTarget.trim() === "" ? null : parseSkillTenths(calcTarget);
  const calculatorEstimate = useMemo(() => calculatorRecipe && calcSkillTenths !== null && calcTargetTenths !== null
    ? estimateCraftMaterials(
        calculatorRecipe,
        calcSkillTenths,
        calcTargetTenths,
        calcSupport ? Number(calcSupportStrength) : 0,
        calcLoop ? calculatorDesynth : null,
      )
    : null,
  [calculatorRecipe, calcSkillTenths, calcTargetTenths, calcSupport, calcSupportStrength, calcLoop, calculatorDesynth]);
  const ingredientBreakdowns = useMemo(() => {
    if (!calculatorEstimate?.reachable || !calculatorEstimate.materials.length) return [];
    const settings = { ...ingredientCraftSettings, skillMode: "character" as const };
    const chain = createPrintingChain(
      eraFiltered.filter((recipe) => recipe.d !== 1),
      settings,
      () => null,
      () => null,
      printItemKey,
    );
    return calculatorEstimate.materials.map((material) => ({
      material,
      node: chain.resolve(material.name),
    }));
  }, [calculatorEstimate, eraFiltered, ingredientCraftSettings]);
  const rawIngredientPlan = useMemo(() => {
    type RawMaterial = { key: string; name: string; quantity: number };
    const allTotals = new Map<string, RawMaterial>();
    const groups = ingredientBreakdowns.map(({ material, node }) => {
      const groupTotals = new Map<string, RawMaterial>();
      const collectRawMaterials = (currentNode: ChainNode, quantity: number, totals: Map<string, RawMaterial>) => {
        if (!currentNode.recipe || !Number.isFinite(currentNode.yield) || currentNode.yield <= 0) {
          const previous = totals.get(currentNode.key);
          totals.set(currentNode.key, {
            key: currentNode.key,
            name: previous?.name ?? currentNode.name,
            quantity: (previous?.quantity ?? 0) + quantity,
          });
          return;
        }

        const required = Math.ceil(Math.max(0, quantity));
        const attempts = Math.ceil(required / currentNode.yield);
        for (const child of currentNode.children) {
          collectRawMaterials(child.node, child.quantity * attempts, totals);
        }
      };

      collectRawMaterials(node, material.quantity, groupTotals);
      for (const rawMaterial of groupTotals.values()) {
        const previous = allTotals.get(rawMaterial.key);
        allTotals.set(rawMaterial.key, {
          ...rawMaterial,
          quantity: (previous?.quantity ?? 0) + rawMaterial.quantity,
        });
      }
      return {
        material,
        node,
        materials: [...groupTotals.values()].sort((first, second) => second.quantity - first.quantity),
      };
    });

    return {
      groups,
      totals: [...allTotals.values()].sort((first, second) => second.quantity - first.quantity),
    };
  }, [ingredientBreakdowns]);
  const visibleCount = mode === "recipes" ? recipeResults.length : mode === "planner" ? plannerResults.length : 0;

  const selectFilter = (
    label: string,
    value: string,
    setter: (v: string) => void,
    options: string[],
    width = 160,
    anyLabel = "Any"
  ) => (
    <div style={{ ...styles.field, width }}>
      <div style={styles.label}>{label}</div>
      <select style={styles.selectCompact} value={value} onChange={(e) => setter(e.target.value)}>
        <option style={optionBaseStyle} value="">
          {anyLabel}
        </option>
        {options.map((opt) => (
          <option key={opt} style={optionBaseStyle} value={opt}>
            {opt}
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

  const numberFilter = (
    label: string,
    value: string,
    setter: (v: string) => void,
    placeholder: string,
    width = 100
  ) => (
    <div style={{ ...styles.field, width }}>
      <div style={styles.label}>{label}</div>
      <input
        style={styles.inputCompact}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => setter(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  const wotgCheckbox = (
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
      title="Include Wings of the Goddess recipes"
    >
      <input type="checkbox" checked={includeWotg} onChange={(e) => setIncludeWotg(e.target.checked)} />
      Include WotG
    </label>
  );

  return (
    <section style={styles.card}>
      <div style={styles.titleRow}>
        <h3 style={styles.h3}>
          {mode === "guilds" ? "Crafting Guilds" : mode === "recipes" ? "Crafting Recipes (ToAU Era)" : mode === "calculator" ? "Ingredient Calculator" : "Crafting Skill-up Planner"}
        </h3>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          {(mode === "recipes" || mode === "planner") && <div style={styles.sub}>
            {`${visibleCount.toLocaleString()} of ${eraFiltered.length.toLocaleString()} recipes${
              visibleCount > MAX_VISIBLE_ROWS ? ` (showing first ${MAX_VISIBLE_ROWS} — refine filters)` : ""
            }`}
          </div>}
          {canGoBack && (
            <button style={styles.buttonCompact} onClick={goBack} title="Return to your previous search">
              ← Back
            </button>
          )}
        </div>
      </div>

      {mode === "recipes" && <div style={styles.sub}>
        GP shows points per NQ item / daily cap (calculated item quantity) when requested, not synths.
        Round up to whole items for turn-in. Sort by items needed.
        Assumes no GP earned today; a dash means no guild-point entry.
        Distinct HQ results show their own counts and caps; alternate caps are listed when patterns differ.
      </div>}

      <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
        <CollapsibleSection kind="tabs">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            style={mode === "recipes" ? styles.buttonPrimaryCompact : styles.buttonCompact}
            onClick={() => setMode("recipes")}
          >
            Recipe browser
          </button>
          <button
            style={mode === "planner" ? styles.buttonPrimaryCompact : styles.buttonCompact}
            onClick={() => setMode("planner")}
          >
            Skill-up planner
          </button>
          <button
            style={mode === "calculator" ? styles.buttonPrimaryCompact : styles.buttonCompact}
            onClick={() => setMode("calculator")}
          >
            Ingredient calculator
          </button>
          <button
            style={mode === "guilds" ? styles.buttonPrimaryCompact : styles.buttonCompact}
            onClick={() => setMode("guilds")}
          >
            Guilds
          </button>
        </div>
        </CollapsibleSection>

        {mode === "guilds" ? <GuildSellingTab {...timerControls} /> : <>
        <CollapsibleSection kind="search">
        {mode === "recipes" ? (
          <div style={styles.subCard}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              {textFilter("Search everything", rGlobal, setRGlobal, "item, ingredient, craft...", 240)}
              {textFilter("Result item", rResult, setRResult, "e.g. sole sushi", 180)}
              {textFilter("Ingredient", rIngredient, setRIngredient, "e.g. iron ingot", 180)}
              {selectFilter("Craft", rCraft, setRCraft, CRAFTS, 150)}
              {selectFilter("Crystal", rCrystal, setRCrystal, CRYSTAL_OPTIONS, 130)}
              {selectFilter("Era", rEra, setREra, ERA_OPTIONS, 110)}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              {numberFilter("Lvl min", rLvlMin, setRLvlMin, "0", 90)}
              {numberFilter("Lvl max", rLvlMax, setRLvlMax, "100", 90)}

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
                <input
                  type="checkbox"
                  checked={rIncludeDesynth}
                  onChange={(e) => setRIncludeDesynth(e.target.checked)}
                />
                Include desynths
              </label>

              {wotgCheckbox}

              <button
                style={{ ...styles.buttonCompact, ...(recipeFilterActive ? {} : styles.buttonDisabled) }}
                onClick={clearRecipeFilters}
                disabled={!recipeFilterActive}
              >
                Clear filters
              </button>
            </div>

            <div style={{ marginTop: 8, ...styles.sub }}>
              All LandSandBoat recipes through Treasures of Aht Urhgan (base, RotZ, CoP, ToAU). Lvl = the recipe cap
              for its main craft; Subs = other crafts (and levels) the recipe also requires. Recipes flagged Key Item
              need the matching craft key item (e.g. Trituration, Sheeting). Recipes in{" "}
              <span style={{ color: RANK_UP_COLOR, fontWeight: 700 }}>blue</span> craft a guild rank-up test item.
              Ingredients in <span style={{ color: "#8af6b0", fontWeight: 700 }}>green</span> link to their recipe;{" "}
              <span style={{ color: "#7ec4e8", fontWeight: 700 }}>blue</span> ingredients (and ⚔) jump to the Items
              tab showing every way to get them.
            </div>
          </div>
        ) : mode === "calculator" ? (
          <div style={styles.subCard}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ ...styles.field, width: 160 }}>
                <div style={styles.label}>Craft</div>
                <select
                  style={styles.selectCompact}
                  value={calcCraft}
                  onChange={(event) => {
                    setCalcCraft(event.target.value);
                    setCalcRecipeId("");
                  }}
                >
                  <option style={optionBaseStyle} value="">Choose a craft</option>
                  {CRAFTS.map((craft) => (
                    <option key={craft} style={optionBaseStyle} value={craft}>{craft}</option>
                  ))}
                </select>
              </div>
              {numberFilter("Current skill", calcSkill, setCalcSkill, "e.g. 45.0", 120)}
              {numberFilter("Target skill", calcTarget, setCalcTarget, "e.g. 50.0", 120)}
              {textFilter("Find recipe or item", calcSearch, setCalcSearch, "e.g. Mythic Pole", 240)}
              <div style={{ ...styles.field, width: 340, maxWidth: "100%" }}>
                <div style={styles.label}>Recipe / item to craft</div>
                <select
                  style={styles.selectCompact}
                  value={calculatorOptions.some((recipe) => String(recipe.id) === calcRecipeId) ? calcRecipeId : ""}
                  onChange={(event) => setCalcRecipeId(event.target.value)}
                >
                  <option style={optionBaseStyle} value="">Choose a recipe above current skill</option>
                  {calculatorOptions.map((recipe) => (
                    <option key={recipe.id} style={optionBaseStyle} value={String(recipe.id)}>
                      {recipe.craft}: {recipe.res.n} (cap {recipe.lvl})
                    </option>
                  ))}
                </select>
              </div>
              <label style={plannerToggleStyle} title="Improves synth success and lowers break chance.">
                <input type="checkbox" checked={calcSupport} onChange={(event) => setCalcSupport(event.target.checked)} />
                Image support
              </label>
              <div style={{ ...styles.field, width: 150 }}>
                <div style={styles.label}>Support strength</div>
                <select
                  style={styles.selectCompact}
                  value={calcSupportStrength}
                  disabled={!calcSupport}
                  onChange={(event) => setCalcSupportStrength(event.target.value)}
                >
                  <option style={optionBaseStyle} value="1">Basic (+1)</option>
                  <option style={optionBaseStyle} value="3">Advanced (+3)</option>
                </select>
              </div>
              <label
                style={plannerToggleStyle}
                title={calculatorDesynth ? "After each successful craft, attempt the matching desynthesis before continuing." : "No matching desynthesis recipe is listed for this result."}
              >
                <input
                  type="checkbox"
                  checked={calcLoop && Boolean(calculatorDesynth)}
                  disabled={!calculatorDesynth}
                  onChange={(event) => setCalcLoop(event.target.checked)}
                />
                Craft → desynth loop
              </label>
              {wotgCheckbox}
            </div>
            <div style={{ marginTop: 8, ...styles.sub }}>
              Expected material totals account for skill-up chances and gains changing at each tenth of skill, synth breaks,
              support, recipe sub-craft checks, and the app’s break-loss rule. Main recipe sub-craft requirements are assumed
              sufficient. Desynthesis recovery is not credited because recipe data lists possible yields but not their probabilities.
            </div>
            <details className="printing-tab" style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", color: "#ccc" }}>Craft levels for ingredient crafts</summary>
              <div style={{ marginTop: 8, ...styles.sub }}>
                These levels and bonuses are shared with Profits → Quantities and saved automatically. They are used to
                estimate crafting and break losses for ingredients.
              </div>
              <CraftingLevels
                settings={ingredientCraftSettings}
                onChange={updateIngredientCraftSettings}
                planning={false}
              />
            </details>
          </div>
        ) : (
          <div style={styles.subCard}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ ...styles.field, width: 160 }}>
                <div style={styles.label}>Craft</div>
                <select style={styles.selectCompact} value={pCraft} onChange={(e) => setPCraft(e.target.value)}>
                  {CRAFTS.map((craft) => (
                    <option key={craft} style={optionBaseStyle} value={craft}>
                      {craft}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ ...styles.field, width: 130 }}>
                <div style={styles.label}>Current skill</div>
                <input
                  style={styles.inputCompact}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={1}
                  value={pSkill}
                  onChange={(e) => setPSkill(e.target.value)}
                  placeholder="e.g. 45"
                />
              </div>
              <div style={{ ...styles.field, width: 160 }}>
                <div style={styles.label}>Image support</div>
                <select style={styles.selectCompact} value={pSupport} onChange={(e) => setPSupport(e.target.value)}>
                  <option style={optionBaseStyle} value="0">None</option>
                  <option style={optionBaseStyle} value="1">Basic (+1 skill)</option>
                  <option style={optionBaseStyle} value="3">Advanced (+3 skill)</option>
                </select>
              </div>
              <label style={plannerToggleStyle}>
                <input type="checkbox" checked={pGearMain} onChange={(e) => setPGearMain(e.target.checked)} />
                Gp +1
              </label>
              <label style={plannerToggleStyle}>
                <input type="checkbox" checked={pGearSub} onChange={(e) => setPGearSub(e.target.checked)} />
                Gp +1
              </label>
              <label style={plannerToggleStyle}>
                <input type="checkbox" checked={pMogh} onChange={(e) => setPMogh(e.target.checked)} />
                Gp +1
              </label>
              {wotgCheckbox}
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
                <input
                  type="checkbox"
                  checked={pIncludeDesynth}
                  onChange={(e) => setPIncludeDesynth(e.target.checked)}
                />
                Include desynths
              </label>
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
                <input type="checkbox" checked={pHideKeyItem} onChange={(e) => setPHideKeyItem(e.target.checked)} />
                Hide key-item recipes
              </label>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              {textFilter("Search everything", pGlobal, setPGlobal, "item, ingredient, crystal...", 240)}
              {textFilter("Ingredient", pIngredient, setPIngredient, "e.g. crayfish", 180)}
              {numberFilter("Min success %", pMinSuccess, setPMinSuccess, "e.g. 50", 120)}
              {numberFilter("Cap min", pLvlMin, setPLvlMin, "0", 90)}
              {numberFilter("Cap max", pLvlMax, setPLvlMax, "100", 90)}
              <button
                style={{ ...styles.buttonCompact, ...(plannerFilterActive ? {} : styles.buttonDisabled) }}
                onClick={clearPlannerFilters}
                disabled={!plannerFilterActive}
              >
                Clear filters
              </button>
            </div>

            <details style={{ marginTop: 8 }}>
              <summary style={{ ...styles.sub, cursor: "pointer", userSelect: "none", width: "fit-content" }}>
                ℹ️ Info — era rates &amp; assumptions
              </summary>
              <div style={{ marginTop: 6, ...styles.sub }}>
                Era rates: skill-up chance is a flat <strong>60%</strong> below skill 50.0 and{" "}
                <strong>25%</strong> at 50.0+, on any synth where your skill is below the recipe cap. Broken synths can
                still skill up at half rate, but only within 1–5 levels of the cap. Skill-up size scales with the level
                gap (up to +0.5 at 14+ over), and is baked into the calculation. Only +0.1 happens above skill 60. 
                Guild image support, gear and Moghancement boost success rate only — skill-up rolls always use your real skill.
                Sub-craft requirements are assumed met; each sub-craft still rolls its own break check (~5% per sub), which
                is factored into success and expected skill. Recipes in{" "}
                <span style={{ color: RANK_UP_COLOR, fontWeight: 700 }}>blue</span> craft a guild rank-up test item
              </div>
            </details>

            {skillTenths === null ? (
              <div style={{ marginTop: 10, ...styles.sub, color: "#ff9c7a" }}>
                Enter a valid current skill (0–100) to see recommendations.
              </div>
            ) : null}
          </div>
        )}
        </CollapsibleSection>

        {mode === "calculator" ? (
          <div style={{ ...styles.subCard, display: "grid", gap: 12 }}>
            {!calculatorRecipe ? (
              <div style={styles.sub}>Choose a recipe and enter current and target skill to estimate materials.</div>
            ) : calcSkillTenths === null || calcTargetTenths === null ? (
              <div style={{ ...styles.sub, color: "#ff9c7a" }}>Enter valid current and target skill values (0–110).</div>
            ) : !calculatorEstimate?.reachable ? (
              <div style={{ ...styles.sub, color: "#ff9c7a" }}>
                This target cannot be reached with the selected recipe. Check that the target is above current skill but
                no higher than its cap{calcLoop && calculatorDesynth ? ` or the desynthesis cap (${calculatorDesynth.lvl})` : ""}, and that the recipe is craftable at your current skill.
              </div>
            ) : (
              <>
                <div>
                  <strong>Expected materials to reach {(calcTargetTenths / 10).toFixed(1)} skill</strong>
                </div>
                <div style={styles.sub}>
                  {calculatorRecipe.craft}: {calculatorRecipe.res.n} (cap {calculatorRecipe.lvl}) ·{" "}
                  {calculatorEstimate.craftAttempts.toFixed(1)} craft attempts
                  {calcLoop ? ` · ${calculatorEstimate.desynthAttempts.toFixed(1)} desynth attempts` : ""} ·{" "}
                  {calculatorEstimate.breakRateAtStart.toFixed(1)}% break chance at starting skill.
                  Break chance and skill-up rate are recalculated as skill rises.
                </div>
                <div>
                  <strong>Materials to prepare (rounded up)</strong>
                  {calculatorEstimate.materials.length ? (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 22 }}>
                      {calculatorEstimate.materials
                        .slice()
                        .sort((a, b) => b.quantity - a.quantity)
                        .map((material) => (
                          <li key={material.name}>
                            {formatMaterialAmount(material.name, Math.ceil(material.quantity))}
                          </li>
                        ))}
                    </ul>
                  ) : <div style={styles.sub}>No materials needed.</div>}
                </div>
                {ingredientBreakdowns.length > 0 && (
                  <details>
                    <summary style={{ cursor: "pointer", color: "#ccc" }}>Crafting breakdown for ingredients</summary>
                    <div style={{ marginTop: 8, ...styles.sub }}>
                      Ingredient recipes use your saved craft levels and bonuses. Recipe paths are selected automatically;
                      synth counts are rounded up to whole attempts, and raw item totals are rounded up when preparing.
                    </div>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 22 }}>
                      {ingredientBreakdowns.map(({ material, node }) => (
                        <CraftIngredientBreakdown key={material.name} node={node} quantity={material.quantity} />
                      ))}
                    </ul>
                    <div style={{ marginTop: 10 }}>
                      <strong>Combined raw materials to obtain, grouped by ingredient</strong>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 22 }}>
                        {rawIngredientPlan.groups.map(({ material, node, materials }) => (
                          <li key={material.name}>
                            <details>
                              <summary>
                                {formatMaterialAmount(material.name, Math.ceil(material.quantity))}
                                {node.recipe ? ` — ${node.recipe.craft} recipe` : ""}
                              </summary>
                              <ul style={{ margin: "6px 0 0", paddingLeft: 22 }}>
                                {materials.map((rawMaterial) => (
                                  <li key={rawMaterial.key}>
                                    {formatMaterialAmount(rawMaterial.name, Math.ceil(rawMaterial.quantity))}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          </li>
                        ))}
                      </ul>
                      <details style={{ marginTop: 8 }}>
                        <summary>All raw materials combined</summary>
                        <ul style={{ margin: "6px 0 0", paddingLeft: 22 }}>
                          {rawIngredientPlan.totals.map((material) => (
                            <li key={material.key}>
                              {formatMaterialAmount(material.name, Math.ceil(material.quantity))}
                            </li>
                          ))}
                        </ul>
                      </details>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8, ...styles.sub }}>
                        Auction House craft categories:
                        {CRAFTS.map((craft) => (
                          <span key={craft} style={{ color: CRAFT_COLORS[craft] }}>{craft}</span>
                        ))}
                        <span>Crystals use element colors.</span>
                      </div>
                    </div>
                  </details>
                )}
                {calcLoop && calculatorDesynth && (
                  <div style={styles.sub}>
                    The loop uses about {calculatorEstimate.desynthInputs.toFixed(2)} crafted{" "}
                    {calculatorRecipe.res.n} as desynth inputs per run. Possible desynth yields:{" "}
                    {[calculatorDesynth.res, ...calculatorDesynth.hq].map((item) => item.n).filter((name, index, names) => names.indexOf(name) === index).join(", ")}.
                    Yield probabilities are not in the recipe data, so recovered ingredients are not subtracted from these gross totals.
                  </div>
                )}
                <div style={styles.sub}>
                  Estimates are expected values, not guarantees. They include stochastic skill-up gains, success and break
                  outcomes, and the modeled material loss on breaks. Sub-craft skill is assumed sufficient. The loop
                  assumes the selected recipe’s base result is desynthesized after each successful craft; HQ output paths
                  and recovered materials are not modeled.
                </div>
              </>
            )}
          </div>
        ) : <div
          ref={resultsRef}
          style={{
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 12,
            overflow: "auto",
            maxHeight: resultsHeight ?? "62vh",
            background: "rgba(255,255,255,0.015)",
          }}
        >
          {mode === "recipes" ? (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {RECIPE_COLUMNS.map((col) => {
                    const active = col.key === rSortKey;
                    return (
                      <th
                        key={col.key}
                        style={{ ...thStyle, ...(active ? { color: "#8af6b0" } : {}) }}
                        onClick={() => onRecipeHeader(col.key)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}
                        {active ? (rSortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
                  <th style={{ ...thStyle, cursor: "default" }}>Subs</th>
                  <th style={{ ...thStyle, cursor: "default" }}>Ingredients</th>
                  <th style={{ ...thStyle, cursor: "default" }}>HQ Results</th>
                  <th style={{ ...thStyle, cursor: "default" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {visibleCount === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={RECIPE_COLUMNS.length + 4}>
                      No matches. Try clearing some filters.
                    </td>
                  </tr>
                ) : (
                  recipeResults.slice(0, MAX_VISIBLE_ROWS).map((r) => {
                    const rowKey = `recipes|${r.id}`;
                    const selected = selectedRowKey === rowKey;
                    const rankUp = isRankUpItem(r.craft, r.res.n);
                    return (
                      <React.Fragment key={rowKey}>
                      <tr
                        onClick={() => setSelectedRowKey(selected ? null : rowKey)}
                        style={{ ...clickableRowStyle, ...(selected ? selectedRowStyle : {}) }}
                        title="Show or hide item details"
                      >
                        <td
                          style={{ ...tdStyle, fontWeight: 700, ...(rankUp ? { color: RANK_UP_COLOR } : {}) }}
                          title={rankUp ? "Guild rank-up test item" : undefined}
                        >
                          <button type="button" aria-label={`Item details for ${r.res.n}`} aria-expanded={selected} title="Show or hide item details" style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: "2px 6px" }} onClick={(event) => { event.stopPropagation(); setSelectedRowKey(selected ? null : rowKey); }}>
                            {selected ? "▾" : "▸"}
                          </button>
                          {renderResult(r, rankUp)}
                        </td>
                        <td style={tdStyle}>{formatGuildPointCap(r.res.n)}</td>
                        <td style={tdStyle}>{r.craft}</td>
                        <td style={tdStyle}>{r.lvl}</td>
                        <td style={{ ...tdStyle, color: CRYSTAL_COLORS[r.crystal] }}>{r.crystal}</td>
                        <td style={{ ...tdStyle, ...(r.era === "WotG" ? { color: "#D8B04B" } : {}) }}>
                          {eraLabel(r.era)}
                        </td>
                        <td style={tdStyle}>{subsText(r)}</td>
                        <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: 260, opacity: 0.9 }}>
                          {renderIngredients(r)}
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: 180, opacity: 0.85 }}>{renderHqResults(r)}</td>
                        <td style={{ ...tdStyle, opacity: 0.85 }}>{badges(r) || "—"}</td>
                      </tr>
                      {selected && <tr><td colSpan={RECIPE_COLUMNS.length + 4} style={tdStyle}><RecipeItemDetails recipe={r} /></td></tr>}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {PLANNER_COLUMNS.map((col) => {
                    const active = col.key === pSortKey;
                    return (
                      <th
                        key={col.key}
                        style={{ ...thStyle, ...(active ? { color: "#8af6b0" } : {}) }}
                        onClick={() => onPlannerHeader(col.key)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}
                        {active ? (pSortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
                  <th style={{ ...thStyle, cursor: "default" }}>Subs</th>
                  <th style={{ ...thStyle, cursor: "default" }}>Ingredients</th>
                  <th style={{ ...thStyle, cursor: "default" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {skillTenths === null ? (
                  <tr>
                    <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={PLANNER_COLUMNS.length + 3}>
                      Enter your current skill above.
                    </td>
                  </tr>
                ) : visibleCount === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={PLANNER_COLUMNS.length + 3}>
                      No eligible recipes. Your skill may be at or above every reachable cap — raise the level range,
                      include desynths, or check the craft.
                    </td>
                  </tr>
                ) : (
                  plannerResults.slice(0, MAX_VISIBLE_ROWS).map((row) => {
                    const rowKey = `planner|${row.recipe.id}`;
                    const selected = selectedRowKey === rowKey;
                    const rankUp = isRankUpItem(row.recipe.craft, row.recipe.res.n);
                    return (
                      <React.Fragment key={rowKey}>
                      <tr
                        onClick={() => setSelectedRowKey(selected ? null : rowKey)}
                        style={{ ...clickableRowStyle, ...(selected ? selectedRowStyle : {}) }}
                        title="Show or hide item details"
                      >
                        <td style={{ ...tdStyle, color: "#8af6b0", fontWeight: 800 }}>
                          {row.expectedPerSynth.toFixed(4)}
                        </td>
                        <td
                          style={{ ...tdStyle, fontWeight: 700, ...(rankUp ? { color: RANK_UP_COLOR } : {}) }}
                          title={rankUp ? "Guild rank-up test item" : undefined}
                        >
                          <button type="button" aria-label={`Item details for ${row.recipe.res.n}`} aria-expanded={selected} title="Show or hide item details" style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: "2px 6px" }} onClick={(event) => { event.stopPropagation(); setSelectedRowKey(selected ? null : rowKey); }}>
                            {selected ? "▾" : "▸"}
                          </button>
                          {renderResult(row.recipe, rankUp)}
                        </td>
                        <td style={tdStyle}>{row.recipe.lvl}</td>
                        <td style={tdStyle}>+{row.gap}</td>
                        <td style={{ ...tdStyle, ...successColor(row.successPct) }}>{row.successPct.toFixed(0)}%</td>
                        <td style={tdStyle}>
                          {row.chanceOnSuccessPct.toFixed(0)}%
                          {row.chanceOnFailPct > 0 ? ` (${row.chanceOnFailPct.toFixed(0)}% on break)` : ""}
                        </td>
                        <td style={tdStyle}>{row.avgGain.toFixed(2)}</td>
                        <td style={tdStyle}>{Number.isFinite(row.synthsPerLevel) ? Math.ceil(row.synthsPerLevel) : "—"}</td>
                        <td style={{ ...tdStyle, color: CRYSTAL_COLORS[row.recipe.crystal] }}>{row.recipe.crystal}</td>
                        <td style={{ ...tdStyle, ...(row.recipe.era === "WotG" ? { color: "#D8B04B" } : {}) }}>
                          {eraLabel(row.recipe.era)}
                        </td>
                        <td style={tdStyle}>{subsText(row.recipe)}</td>
                        <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: 260, opacity: 0.9 }}>
                          {renderIngredients(row.recipe)}
                        </td>
                        <td style={{ ...tdStyle, opacity: 0.85 }}>{badges(row.recipe) || "—"}</td>
                      </tr>
                      {selected && <tr><td colSpan={PLANNER_COLUMNS.length + 3} style={tdStyle}><RecipeItemDetails recipe={row.recipe} /></td></tr>}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>}
        </>}
      </div>
    </section>
  );
}
