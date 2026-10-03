// src/RodsTab.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { styles } from "./styles";
import { CollapsibleSection, useTableViewportHeight } from "./ScreenControls";
import { loadJson, saveJson } from "./utils/storage";
import fishingPlanner from "./data/fishingPlanner.json";
import { rodFishData } from "./utils/phoenixData";
import { calculateRodRisk, getRodHiddenSuccessBonus } from "./utils/fishingSkillup";

type Rod = {
  rodId: number;
  rod: string;
  era: string;
  size: string;
  material: string;
  legendary: boolean;
  breakable: boolean;
  brokenItemId: number | null;
  minRank: number;
  maxRank: number;
  rating: number;
  fishAttack: number;
  lgdBonusAttack: number;
  fishRecovery: number;
  fishTime: number;
  lgdBonusTime: number;
  smDelayBonus: number;
  smMoveBonus: number;
  lgDelayBonus: number;
  lgMoveBonus: number;
  multiplier: number;
  specialFlags: string | null;
};

type BreakFish = {
  fish: string;
  skillCap: number;
  ranking: number;
  size: string;
  legendary: boolean;
  item?: boolean;
};

const RODS: Rod[] = fishingPlanner.rods as Rod[];
const PLANNER_FISH = fishingPlanner.fish as Record<string, BreakFish>;
const BREAK_FISH: BreakFish[] = rodFishData.map(row => PLANNER_FISH[row.fish] ?? row);

const SKILL_KEY = "ffxi_rod_skill_v1";
const RODS_UI_KEY = "ffxi_rods_ui_v1";

type MatrixRow = {
  rod: string;
  rodMaxRank: number;
  fish: string;
  skillCap: number;
  ranking: number;
  size: string;
  legendary: boolean;
  snapPct: number;
  breakPct: number;
  escapePct: number;
  okPct: number;
};

function buildMatrix(skill: number): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const r of RODS) {
    for (const f of BREAK_FISH) {
      const { snapPct, breakPct, escapePct } = calculateRodRisk(skill + getRodHiddenSuccessBonus(r.rod), f, r);
      // Sequential d100 rolls: escape, then snap, then break.
      const okPct =
        Math.round(1000 * (1 - escapePct / 100) * (1 - snapPct / 100) * (1 - breakPct / 100)) / 10;
      rows.push({
        rod: r.rod,
        rodMaxRank: r.maxRank,
        fish: f.fish,
        skillCap: f.skillCap,
        ranking: f.ranking,
        size: f.size,
        legendary: f.legendary,
        snapPct,
        breakPct,
        escapePct,
        okPct,
      });
    }
  }
  return rows;
}

type Mode = "matrix" | "rods";

type RodKey =
  | "rod"
  | "era"
  | "size"
  | "material"
  | "legendary"
  | "breakable"
  | "minRank"
  | "maxRank"
  | "rating"
  | "fishAttack"
  | "lgdBonusAttack"
  | "fishRecovery"
  | "fishTime"
  | "lgdBonusTime"
  | "multiplier"
  | "specialFlags";

type MatrixKey =
  | "rod"
  | "rodMaxRank"
  | "fish"
  | "skillCap"
  | "ranking"
  | "size"
  | "legendary"
  | "snapPct"
  | "breakPct"
  | "escapePct"
  | "okPct";

type SortDir = "asc" | "desc";

const ROD_COLUMNS: { key: RodKey; label: string }[] = [
  { key: "rod", label: "Rod" },
  { key: "era", label: "Era" },
  { key: "size", label: "Size" },
  { key: "material", label: "Material" },
  { key: "legendary", label: "Legendary" },
  { key: "breakable", label: "Breakable" },
  { key: "minRank", label: "Min Rank" },
  { key: "maxRank", label: "Durability" },
  { key: "rating", label: "Rating" },
  { key: "fishAttack", label: "Fish Attack" },
  { key: "lgdBonusAttack", label: "Lgd Atk" },
  { key: "fishRecovery", label: "Recovery" },
  { key: "fishTime", label: "Fish Time" },
  { key: "lgdBonusTime", label: "Lgd Time" },
  { key: "multiplier", label: "Multiplier" },
  { key: "specialFlags", label: "Special" },
];

const MATRIX_COLUMNS: { key: MatrixKey; label: string }[] = [
  { key: "rod", label: "Rod" },
  { key: "rodMaxRank", label: "Durability" },
  { key: "fish", label: "Fish" },
  { key: "skillCap", label: "Skill Cap" },
  { key: "ranking", label: "Ranking" },
  { key: "size", label: "Size" },
  { key: "legendary", label: "Legendary" },
  { key: "snapPct", label: "Snap Roll %" },
  { key: "breakPct", label: "Break Roll %" },
  { key: "escapePct", label: "Escape %" },
  { key: "okPct", label: "No Mishap %" },
];

const MAX_VISIBLE_ROWS = 300;

const ROD_NAMES = RODS.map((r) => r.rod);
const FISH_SIZES = ["S", "L"];

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

function riskColor(pct: number): React.CSSProperties {
  if (pct <= 0) return { color: "#8af6b0", fontWeight: 800 };
  if (pct < 30) return { color: "#D8B04B", fontWeight: 700 };
  return { color: "#ff9c7a", fontWeight: 800 };
}

function okColor(pct: number): React.CSSProperties {
  if (pct >= 100) return { color: "#8af6b0", fontWeight: 800 };
  if (pct >= 70) return { color: "#D8B04B", fontWeight: 700 };
  return { color: "#ff9c7a", fontWeight: 800 };
}

export default function RodsTab({ mode: activeMode }: { mode?: Mode } = {}) {
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const resultsHeight = useTableViewportHeight(resultsRef);
  type RodsUiState = {
    mode: Mode;
    mGlobal: string;
    mRod: string;
    mFish: string;
    mSize: string;
    mLegendaryOnly: boolean;
    mSafeOnly: boolean;
    mSortKey: MatrixKey;
    mSortDir: SortDir;
    rGlobal: string;
    rSortKey: RodKey;
    rSortDir: SortDir;
  };

  const defaultUi: RodsUiState = {
    mode: "matrix",
    mGlobal: "",
    mRod: "",
    mFish: "",
    mSize: "",
    mLegendaryOnly: false,
    mSafeOnly: false,
    mSortKey: "fish",
    mSortDir: "asc",
    rGlobal: "",
    rSortKey: "maxRank",
    rSortDir: "desc",
  };

  const loaded = loadJson<Partial<RodsUiState>>(RODS_UI_KEY, {});
  const initialUi: RodsUiState = {
    ...defaultUi,
    ...loaded,
    mode: loaded.mode === "rods" ? "rods" : "matrix",
    mSortKey: MATRIX_COLUMNS.some((c) => c.key === loaded.mSortKey)
      ? (loaded.mSortKey as MatrixKey)
      : defaultUi.mSortKey,
    mSortDir: loaded.mSortDir === "desc" ? "desc" : "asc",
    rSortKey: ROD_COLUMNS.some((c) => c.key === loaded.rSortKey)
      ? (loaded.rSortKey as RodKey)
      : defaultUi.rSortKey,
    rSortDir: loaded.rSortDir === "asc" ? "asc" : "desc",
  };

  const [savedMode, setMode] = useState<Mode>(initialUi.mode);
  const mode = activeMode ?? savedMode;

  // ---- Fishing skill (persisted) ----
  const [skillInput, setSkillInput] = useState(() => String(loadJson<number>(SKILL_KEY, 100)));
  const skill = useMemo(() => {
    const n = Number(skillInput);
    return Number.isFinite(n) ? Math.max(0, Math.min(200, Math.floor(n))) : 100;
  }, [skillInput]);

  useEffect(() => {
    saveJson(SKILL_KEY, skill);
  }, [skill]);

  // ---- Matrix filters ----
  const [mGlobal, setMGlobal] = useState(initialUi.mGlobal);
  const [mRod, setMRod] = useState(initialUi.mRod);
  const [mFish, setMFish] = useState(initialUi.mFish);
  const [mSize, setMSize] = useState(initialUi.mSize);
  const [mLegendaryOnly, setMLegendaryOnly] = useState(initialUi.mLegendaryOnly);
  const [mSafeOnly, setMSafeOnly] = useState(initialUi.mSafeOnly);
  const [mSortKey, setMSortKey] = useState<MatrixKey>(initialUi.mSortKey);
  const [mSortDir, setMSortDir] = useState<SortDir>(initialUi.mSortDir);

  // ---- Rod list filters ----
  const [rGlobal, setRGlobal] = useState(initialUi.rGlobal);
  const [rSortKey, setRSortKey] = useState<RodKey>(initialUi.rSortKey);
  const [rSortDir, setRSortDir] = useState<SortDir>(initialUi.rSortDir);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);

  useEffect(() => {
    saveJson(RODS_UI_KEY, {
      mode,
      mGlobal,
      mRod,
      mFish,
      mSize,
      mLegendaryOnly,
      mSafeOnly,
      mSortKey,
      mSortDir,
      rGlobal,
      rSortKey,
      rSortDir,
    } satisfies RodsUiState);
  }, [mode, mGlobal, mRod, mFish, mSize, mLegendaryOnly, mSafeOnly, mSortKey, mSortDir, rGlobal, rSortKey, rSortDir]);

  const MATRIX = useMemo(() => buildMatrix(skill), [skill]);

  function onMatrixHeader(key: MatrixKey) {
    if (key === mSortKey) setMSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setMSortKey(key);
      setMSortDir(
        key === "snapPct" || key === "breakPct" || key === "escapePct" || key === "okPct" ? "desc" : "asc"
      );
    }
  }

  function onRodHeader(key: RodKey) {
    if (key === rSortKey) setRSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setRSortKey(key);
      setRSortDir(key === "rod" || key === "era" || key === "size" || key === "material" ? "asc" : "desc");
    }
  }

  function clearMatrixFilters() {
    setMGlobal("");
    setMRod("");
    setMFish("");
    setMSize("");
    setMLegendaryOnly(false);
    setMSafeOnly(false);
  }

  const matrixActive =
    mGlobal.trim() !== "" || mRod !== "" || mFish.trim() !== "" || mSize !== "" || mLegendaryOnly || mSafeOnly;

  const matrixResults = useMemo(() => {
    const g = mGlobal.trim().toLowerCase();
    const fq = mFish.trim().toLowerCase();

    const filtered = MATRIX.filter((row) => {
      if (mRod && row.rod !== mRod) return false;
      if (mSize && row.size !== mSize) return false;
      if (mLegendaryOnly && !row.legendary) return false;
      if (mSafeOnly && (row.snapPct > 0 || row.breakPct > 0)) return false;
      if (fq && !row.fish.toLowerCase().includes(fq)) return false;

      if (g) {
        const hay = [
          row.rod,
          row.fish,
          String(row.skillCap),
          String(row.ranking),
          row.size,
          row.legendary ? "legendary" : "",
          `${row.snapPct}%`,
          `${row.breakPct}%`,
          `${row.escapePct}%`,
        ]
          .join(" | ")
          .toLowerCase();
        if (!hay.includes(g)) return false;
      }
      return true;
    });

    return filtered.sort((x, y) => {
      let cmp = 0;
      if (mSortKey === "rod" || mSortKey === "fish" || mSortKey === "size") {
        cmp = x[mSortKey].localeCompare(y[mSortKey]);
      } else if (mSortKey === "legendary") {
        cmp = Number(x.legendary) - Number(y.legendary);
      } else {
        cmp = x[mSortKey] - y[mSortKey];
      }
      if (cmp === 0) {
        // Tie-break: safest first (higher No Mishap %), then higher durability.
        cmp = y.okPct - x.okPct;
        if (cmp !== 0) return cmp;
        return y.rodMaxRank - x.rodMaxRank;
      }
      return mSortDir === "asc" ? cmp : -cmp;
    });
  }, [MATRIX, mGlobal, mRod, mFish, mSize, mLegendaryOnly, mSafeOnly, mSortKey, mSortDir]);

  const rodResults = useMemo(() => {
    const g = rGlobal.trim().toLowerCase();

    const filtered = RODS.filter((r) => {
      if (!g) return true;
      const hay = [
        r.rod,
        r.era,
        r.size,
        r.material,
        r.legendary ? "legendary" : "",
        r.breakable ? "breakable" : "unbreakable",
        r.specialFlags ?? "",
      ]
        .join(" | ")
        .toLowerCase();
      return hay.includes(g);
    });

    return [...filtered].sort((x, y) => {
      let cmp = 0;
      if (rSortKey === "rod" || rSortKey === "era" || rSortKey === "size" || rSortKey === "material") {
        cmp = x[rSortKey].localeCompare(y[rSortKey]);
      } else if (rSortKey === "specialFlags") {
        cmp = (x.specialFlags ?? "").localeCompare(y.specialFlags ?? "");
      } else if (rSortKey === "legendary" || rSortKey === "breakable") {
        cmp = Number(x[rSortKey]) - Number(y[rSortKey]);
      } else {
        cmp = x[rSortKey] - y[rSortKey];
      }
      return rSortDir === "asc" ? cmp : -cmp;
    });
  }, [rGlobal, rSortKey, rSortDir]);

  const results = mode === "matrix" ? matrixResults : rodResults;
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
        <h3 style={styles.h3}>{mode === "matrix" ? "Snap / Break Matrix" : "Rod Stats"}</h3>
        <div style={styles.sub}>
          {results.length.toLocaleString()} of{" "}
          {(mode === "matrix" ? MATRIX.length : RODS.length).toLocaleString()} entries
          {results.length > MAX_VISIBLE_ROWS ? ` (showing first ${MAX_VISIBLE_ROWS} — refine filters)` : ""}
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
        {activeMode === undefined && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            style={mode === "matrix" ? styles.buttonPrimaryCompact : styles.buttonCompact}
            onClick={() => setMode("matrix")}
          >
            Break matrix
          </button>
          <button
            style={mode === "rods" ? styles.buttonPrimaryCompact : styles.buttonCompact}
            onClick={() => setMode("rods")}
          >
            Rod stats
          </button>
        </div>}

        <CollapsibleSection kind="search">
        {mode === "matrix" ? (
          <div style={styles.subCard}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ ...styles.field, width: 130 }}>
                <div style={styles.label}>Fishing skill (+gear)</div>
                <input
                  style={styles.inputCompact}
                  type="number"
                  inputMode="numeric"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  placeholder="100"
                />
              </div>
              {textFilter("Search everything", mGlobal, setMGlobal, "e.g. lu shang", 220)}
              {selectFilter("Rod", mRod, setMRod, ROD_NAMES, 210)}
              {textFilter("Fish", mFish, setMFish, "e.g. moat carp", 170)}
              {selectFilter("Fish size", mSize, setMSize, FISH_SIZES, 110)}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
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
                  checked={mLegendaryOnly}
                  onChange={(e) => setMLegendaryOnly(e.target.checked)}
                />
                Legendary fish only
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
                <input type="checkbox" checked={mSafeOnly} onChange={(e) => setMSafeOnly(e.target.checked)} />
                Safe only (0% snap &amp; 0% break)
              </label>

              <button
                style={{ ...styles.buttonCompact, ...(matrixActive ? {} : styles.buttonDisabled) }}
                onClick={clearMatrixFilters}
                disabled={!matrixActive}
              >
                Clear filters
              </button>
            </div>

            <div style={{ marginTop: 8, ...styles.sub }}>
              Public-source formulas and rod durability. Skill affects escape, not snap/break durability.
              Rolls are sequential: escape, then line snap (lose bait), then rod break.
              Snap Roll % applies after surviving escape; Break Roll % applies after surviving both earlier rolls.
              No Mishap % is the combined chance to land a completed fight, excluding minigame failures.
            </div>
          </div>
        ) : (
          <div style={styles.subCard}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              {textFilter("Search everything", rGlobal, setRGlobal, "e.g. legendary", 240)}
              <button
                style={{ ...styles.buttonCompact, ...(rGlobal.trim() !== "" ? {} : styles.buttonDisabled) }}
                onClick={() => setRGlobal("")}
                disabled={rGlobal.trim() === ""}
              >
                Clear filters
              </button>
            </div>
            <div style={{ marginTop: 8, ...styles.sub }}>
              Durability (MaxRank) is what resists snap/break. Legendary rods ignore size penalties. Ebisu,
              Ebisu +1, Judges Rod and the Goldfish Basket never break. Rating is overall quality (not used in
              formulas).
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
          {mode === "matrix" ? (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {MATRIX_COLUMNS.map((col) => {
                    const active = col.key === mSortKey;
                    return (
                      <th
                        key={col.key}
                        style={{ ...thStyle, ...(active ? { color: "#8af6b0" } : {}) }}
                        onClick={() => onMatrixHeader(col.key)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}
                        {active ? (mSortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleCount === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={MATRIX_COLUMNS.length}>
                      No matches. Try clearing some filters.
                    </td>
                  </tr>
                ) : (
                  matrixResults.slice(0, MAX_VISIBLE_ROWS).map((row, i) => {
                    const rowKey = `matrix|${row.rod}|${row.fish}|${i}`;
                    const selected = selectedRowKey === rowKey;
                    return (
                    <tr
                      key={rowKey}
                      onClick={() => setSelectedRowKey(rowKey)}
                      style={{ ...clickableRowStyle, ...(selected ? selectedRowStyle : {}) }}
                      title="Click to highlight this row"
                    >
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{row.rod}</td>
                      <td style={tdStyle}>{row.rodMaxRank}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{row.fish}</td>
                      <td style={tdStyle}>{row.skillCap}</td>
                      <td style={tdStyle}>{row.ranking}</td>
                      <td style={tdStyle}>{row.size}</td>
                      <td style={{ ...tdStyle, ...(row.legendary ? { color: "#D8B04B", fontWeight: 700 } : {}) }}>
                        {row.legendary ? "Yes" : ""}
                      </td>
                      <td style={{ ...tdStyle, ...riskColor(row.snapPct) }}>{row.snapPct}%</td>
                      <td style={{ ...tdStyle, ...riskColor(row.breakPct) }}>{row.breakPct}%</td>
                      <td style={{ ...tdStyle, ...riskColor(row.escapePct) }}>{row.escapePct}%</td>
                      <td style={{ ...tdStyle, ...okColor(row.okPct) }}>{row.okPct}%</td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {ROD_COLUMNS.map((col) => {
                    const active = col.key === rSortKey;
                    return (
                      <th
                        key={col.key}
                        style={{ ...thStyle, ...(active ? { color: "#8af6b0" } : {}) }}
                        onClick={() => onRodHeader(col.key)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}
                        {active ? (rSortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleCount === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={ROD_COLUMNS.length}>
                      No matches. Try clearing some filters.
                    </td>
                  </tr>
                ) : (
                  rodResults.map((r) => {
                    const rowKey = `rods|${r.rodId}`;
                    const selected = selectedRowKey === rowKey;
                    return (
                    <tr
                      key={rowKey}
                      onClick={() => setSelectedRowKey(rowKey)}
                      style={{ ...clickableRowStyle, ...(selected ? selectedRowStyle : {}) }}
                      title="Click to highlight this row"
                    >
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{r.rod}</td>
                      <td style={tdStyle}>{r.era}</td>
                      <td style={tdStyle}>{r.size}</td>
                      <td style={tdStyle}>{r.material}</td>
                      <td style={{ ...tdStyle, ...(r.legendary ? { color: "#D8B04B", fontWeight: 700 } : {}) }}>
                        {r.legendary ? "Yes" : ""}
                      </td>
                      <td style={{ ...tdStyle, ...(r.breakable ? {} : { color: "#8af6b0", fontWeight: 700 }) }}>
                        {r.breakable ? "Yes" : "Never"}
                      </td>
                      <td style={tdStyle}>{r.minRank}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{r.maxRank}</td>
                      <td style={tdStyle}>{r.rating}</td>
                      <td style={tdStyle}>{r.fishAttack}</td>
                      <td style={tdStyle}>{r.lgdBonusAttack}</td>
                      <td style={tdStyle}>{r.fishRecovery}</td>
                      <td style={tdStyle}>{r.fishTime}</td>
                      <td style={tdStyle}>{r.lgdBonusTime}</td>
                      <td style={tdStyle}>{r.multiplier}</td>
                      <td style={{ ...tdStyle, opacity: 0.85 }}>{r.specialFlags ?? ""}</td>
                    </tr>
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
