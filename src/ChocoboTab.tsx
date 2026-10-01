import React, { useEffect, useMemo, useState } from "react";
import { styles } from "./styles";
import { CollapsibleSection } from "./ScreenControls";
import { phoenixDigging as digData } from "./utils/phoenixData";
import { diggingDistribution, diggingExtras, DIG_DAY_ITEMS, ORE_ZONES, type DigLayer } from "./utils/digging";
import { itemPrices, useItemPrices } from "./utils/itemPrices";
import { printItemKey, printBuyPrice, printSellPrice } from "./utils/printingData";
import PriceInput from "./PriceInput";
import { selectedSellPrice } from "./utils/itemPriceStore";
import { Tags } from "lucide-react";
import { saveJson } from "./utils/storage";
import { navigateToTab } from "./utils/tabNav";
import { Calibration, getVanaNow, type VanaWeekday } from "./vanadiel";

type DigMode = "burrow" | "bore" | "both" | null;

type DigEntry = {
  zone: string;
  item: string;
  rate: number;
  /** Minimum digging rank; null = Amateur (no requirement). */
  rank: string | null;
  /** burrow | bore | both | null (normal dig). */
  mode: DigMode;
  layer: DigLayer;
  conditional?: boolean;
};

// Digging ranks in progression order. "Amateur" = no rank requirement.
const RANKS = [
  "Amateur",
  "Recruit",
  "Initiate",
  "Novice",
  "Apprentice",
  "Journeyman",
  "Craftsman",
  "Artisan",
  "Adept",
] as const;

type Rank = (typeof RANKS)[number];

const MODE_TOGGLES = [
  { id: "normal", label: "Normal dig" },
  { id: "burrow", label: "Burrow" },
  { id: "bore", label: "Bore" },
] as const;

type ModeId = (typeof MODE_TOGGLES)[number]["id"];

/** Basis for the gil columns: 100 attempts, or 100 successful attempts. */
type GilBasis = "digs" | "items";

type SortKey = "zone" | "item" | "rate" | "vendor" | "ah" | "rank" | "type" | "success" | "greens" | "zoneGil" | "zoneGilAh" | "zoneGilMoon" | "zoneGilAhMoon";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "zone", label: "Zone" },
  { key: "item", label: "Item" },
  { key: "rate", label: "Reward chance (moon / base)" },
  { key: "vendor", label: "Vendor" },
  { key: "ah", label: "AH price" },
  { key: "rank", label: "Min Rank" },
  { key: "type", label: "Type" },
  { key: "success", label: "Dig success (moon / base)" },
  { key: "greens", label: "Greens" },
  { key: "zoneGil", label: "Gil / 100 digs (vendor)" },
  { key: "zoneGilAh", label: "Gil / 100 digs (AH)" },
  { key: "zoneGilMoon", label: "Moon gil / 100 digs (vendor)" },
  { key: "zoneGilAhMoon", label: "Moon gil / 100 digs (AH)" },
];

const ENTRIES = digData.entries as DigEntry[];

function vendorPrice(item: string): number {
  return printSellPrice(item, {}) ?? 0;
}

const WEATHER_ELEMENTS = ["Fire", "Ice", "Wind", "Earth", "Lightning", "Water", "Light", "Dark"] as const;

const ZONES = [...new Set(ENTRIES.map((e) => e.zone))];

const GYSAHL_COST = 61;

function rankIndex(rank: string | null): number {
  if (!rank) return 0;
  const idx = RANKS.indexOf(rank as Rank);
  return idx < 0 ? 0 : idx;
}

function modeValue(mode: DigMode): number {
  if (mode === null) return 0;
  if (mode === "burrow") return 1;
  if (mode === "bore") return 2;
  return 3; // both
}

function compareEntries(
  a: DigEntry,
  b: DigEntry,
  key: SortKey,
  dir: SortDir,
  ctx: {
    zoneGil: Record<string, number>;
    zoneGilAh: Record<string, number>;
    zoneGilMoon: Record<string, number>;
    zoneGilAhMoon: Record<string, number>;
    zoneSuccess: Record<string, number>;
    zoneGreensMoon: Record<string, number>;
    eff: (item: string) => number;
    ah: Record<string, number>;
    rewardRates: Map<DigEntry, [number, number]>;
  }
): number {
  let cmp = 0;

  if (key === "rate") {
    cmp = (ctx.rewardRates.get(a)?.[0] ?? 0) - (ctx.rewardRates.get(b)?.[0] ?? 0);
  } else if (key === "vendor") {
    cmp = vendorPrice(a.item) - vendorPrice(b.item);
  } else if (key === "ah") {
    cmp = (ctx.ah[a.item] ?? 0) - (ctx.ah[b.item] ?? 0);
  } else if (key === "rank") {
    cmp = rankIndex(a.rank) - rankIndex(b.rank);
  } else if (key === "type") {
    cmp = modeValue(a.mode) - modeValue(b.mode);
  } else if (key === "success") {
    cmp = (ctx.zoneSuccess[a.zone] ?? 0) - (ctx.zoneSuccess[b.zone] ?? 0);
    if (cmp === 0) cmp = a.zone.localeCompare(b.zone);
  } else if (key === "greens") {
    cmp = (ctx.zoneGreensMoon[a.zone] ?? Infinity) - (ctx.zoneGreensMoon[b.zone] ?? Infinity);
    if (cmp === 0) cmp = a.zone.localeCompare(b.zone);
  } else if (key === "zoneGil") {
    cmp = (ctx.zoneGil[a.zone] ?? 0) - (ctx.zoneGil[b.zone] ?? 0);
    if (cmp === 0) cmp = a.zone.localeCompare(b.zone);
  } else if (key === "zoneGilAh") {
    cmp = (ctx.zoneGilAh[a.zone] ?? 0) - (ctx.zoneGilAh[b.zone] ?? 0);
    if (cmp === 0) cmp = a.zone.localeCompare(b.zone);
  } else if (key === "zoneGilMoon") {
    cmp = (ctx.zoneGilMoon[a.zone] ?? 0) - (ctx.zoneGilMoon[b.zone] ?? 0);
    if (cmp === 0) cmp = a.zone.localeCompare(b.zone);
  } else if (key === "zoneGilAhMoon") {
    cmp = (ctx.zoneGilAhMoon[a.zone] ?? 0) - (ctx.zoneGilAhMoon[b.zone] ?? 0);
    if (cmp === 0) cmp = a.zone.localeCompare(b.zone);
  } else {
    cmp = a[key].localeCompare(b[key]);
  }

  if (cmp === 0) cmp = a.item.localeCompare(b.item);
  return dir === "asc" ? cmp : -cmp;
}

const thStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: "#161616",
  color: "#eaeaea",
  textAlign: "left",
  padding: "6px 8px",
  fontSize: 11,
  fontWeight: 800,
  borderBottom: "1px solid #444",
  cursor: "pointer",
  userSelect: "none",
  lineHeight: 1.25,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 12,
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  whiteSpace: "nowrap",
};

// Small segmented-switch styles for the gil basis toggle.
const segBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#999",
  padding: "2px 10px",
  fontSize: 11,
  cursor: "pointer",
};

const segActiveStyle: React.CSSProperties = {
  background: "rgba(138,246,176,0.15)",
  color: "#8af6b0",
  fontWeight: 700,
};

export default function ChocoboTab({ cal }: { cal: Calibration }) {
  // Empty selection = all zones.
  const [zoneFilter, setZoneFilter] = useState<string[]>([]);
  const [rankFilter, setRankFilter] = useState<Rank>("Adept");
  const [itemQuery, setItemQuery] = useState<string>("");
  const [activeModes, setActiveModes] = useState<ModeId[]>(["normal"]);
  const [sortKey, setSortKey] = useState<SortKey>("zoneGilAh");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Weather item ("" = no weather): crystal for single weather, cluster for double.
  const [weatherItem, setWeatherItem] = useState<string>("");
  const [moonOverride, setMoonOverride] = useState<number | null>(null);
  const [dayOverride, setDayOverride] = useState<VanaWeekday | "">("");
  const [gilBasis, setGilBasis] = useState<GilBasis>("items");
  const prices = useItemPrices();
  const ahPrices = useMemo(() => Object.fromEntries([...new Set([...ENTRIES.map((entry) => entry.item), ...Object.values(DIG_DAY_ITEMS).flat(), weatherItem])]
    .map((name) => [name, selectedSellPrice(prices, printItemKey(name), vendorPrice(name)) ?? vendorPrice(name)])), [prices, weatherItem]);
  const greensCost = printBuyPrice("Gysahl Greens", prices.effectiveBuy) ?? GYSAHL_COST;

  // Refresh each minute so the moon multiplier tracks the current phase.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const vana = getVanaNow(nowMs, cal);
  const moonPercent = moonOverride ?? vana.moonPercent;
  const day = dayOverride || vana.weekday;

  /** Effective price: user AH price if set, otherwise vendor price. */
  function eff(item: string): number {
    const ah = ahPrices[item];
    return ah ?? vendorPrice(item);
  }

  function toggleMode(id: ModeId) {
    if (id === "normal") return;
    setActiveModes((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  function addZone(zone: string) {
    if (zone === "") return;
    setZoneFilter((prev) => (prev.includes(zone) ? prev : [...prev, zone]));
  }

  function removeZone(zone: string) {
    setZoneFilter((prev) => prev.filter((z) => z !== zone));
  }

  function onHeaderClick(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const maxRank = RANKS.indexOf(rankFilter);

  function matchesRankAndMode(entry: DigEntry): boolean {
    if (rankIndex(entry.rank) > maxRank) return false;
    if (entry.layer === "treasure" || entry.layer === "regular") return true;
    return (
      (activeModes.includes("burrow") && (entry.mode === "burrow" || entry.mode === "both")) ||
      (activeModes.includes("bore") && (entry.mode === "bore" || entry.mode === "both"))
    );
  }

  const allEntries = useMemo(() => {
    const extra: DigEntry[] = ZONES.flatMap(zone => diggingExtras(zone, maxRank, moonPercent, day, weatherItem).map(entry => ({ ...entry, zone, mode: null, rank: entry.item.endsWith(" Ore") ? "Craftsman" : entry.item === weatherItem ? null : "Novice", conditional: true })));
    return [...ENTRIES, ...extra];
  }, [weatherItem, maxRank, moonPercent, day]);

  const { zoneGil, zoneGilAh, zoneGilMoon, zoneGilAhMoon, zoneSuccess, zoneSuccessMoon, zoneGreensMoon, rewardRates } = useMemo(() => {
    const vendor: Record<string, number> = {};
    const withAh: Record<string, number> = {};
    const vendorMoon: Record<string, number> = {};
    const withAhMoon: Record<string, number> = {};
    const success: Record<string, number> = {};
    const successMoon: Record<string, number> = {};
    const greensMoon: Record<string, number> = {};
    const rewardRates = new Map<DigEntry, [number, number]>();
    for (const zone of ZONES) {
      const pool = allEntries.filter((e) => e.zone === zone && matchesRankAndMode(e));
      const base = diggingDistribution(pool.map(entry => entry.conditional && entry.item.endsWith(" Ore") ? { ...entry, rate: 0 } : entry), 25);
      const current = diggingDistribution(pool, moonPercent);
      pool.forEach((entry, index) => rewardRates.set(entry, [current.rewards[index] * 100, base.rewards[index] * 100]));
      success[zone] = Number((base.successChance * 100).toFixed(2));
      successMoon[zone] = Number((current.successChance * 100).toFixed(2));
      greensMoon[zone] = current.successChance > 0 ? Math.ceil(100 / current.successChance) : Infinity;
      const digsBase = gilBasis === "digs" ? 100 : base.successChance > 0 ? 100 / base.successChance : 0;
      const digsMoon = gilBasis === "digs" ? 100 : current.successChance > 0 ? 100 / current.successChance : 0;
      const evVendor = pool.reduce((sum, entry, index) => sum + base.rewards[index] * vendorPrice(entry.item), 0);
      const evAh = pool.reduce((sum, entry, index) => sum + base.rewards[index] * eff(entry.item), 0);
      const evVendorMoon = pool.reduce((sum, entry, index) => sum + current.rewards[index] * vendorPrice(entry.item), 0);
      const evAhMoon = pool.reduce((sum, entry, index) => sum + current.rewards[index] * eff(entry.item), 0);
      vendor[zone] = Math.round((evVendor - greensCost) * digsBase);
      withAh[zone] = Math.round((evAh - greensCost) * digsBase);
      vendorMoon[zone] = Math.round((evVendorMoon - greensCost) * digsMoon);
      withAhMoon[zone] = Math.round((evAhMoon - greensCost) * digsMoon);
    }
    return {
      zoneGil: vendor,
      zoneGilAh: withAh,
      zoneGilMoon: vendorMoon,
      zoneGilAhMoon: withAhMoon,
      zoneSuccess: success,
      zoneSuccessMoon: successMoon,
      zoneGreensMoon: greensMoon,
      rewardRates,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankFilter, activeModes, ahPrices, allEntries, moonPercent, gilBasis, greensCost]);

  const filtered = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    return allEntries.filter((entry) => {
      if (zoneFilter.length > 0 && !zoneFilter.includes(entry.zone)) return false;
      if (q !== "" && !entry.item.toLowerCase().includes(q)) return false;
      return matchesRankAndMode(entry);
    }).sort((a, b) => compareEntries(a, b, sortKey, sortDir, { zoneGil, zoneGilAh, zoneGilMoon, zoneGilAhMoon, zoneSuccess: zoneSuccessMoon, zoneGreensMoon, eff, ah: ahPrices, rewardRates }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneFilter, rankFilter, itemQuery, activeModes, sortKey, sortDir, zoneGil, zoneGilAh, zoneGilMoon, zoneGilAhMoon, zoneSuccessMoon, zoneGreensMoon, rewardRates, ahPrices, allEntries]);

  return (
    <section style={styles.card}>
      <div style={styles.titleRow}>
        <h3 style={styles.h3}>Chocobo Digging</h3>
        <div style={styles.sub}>Gysahl Greens: {greensCost.toLocaleString()} gil each</div>
        <button type="button" style={{ ...styles.buttonCompact, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => { saveJson("kupo.profits.view.v1", "prices"); navigateToTab("printing", "", "chocobo"); }}><Tags size={15} /> Prices</button>
      </div>
      {prices.error && <p role="alert" style={{ color: "#e6c17a" }}>{prices.error}</p>}

      <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
        <CollapsibleSection kind="search">
        <div style={styles.subCard}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={styles.field}>
              <label style={styles.label}>Zones (pick to add, click to remove)</label>
              <select value="" onChange={(e) => addZone(e.target.value)} style={styles.select}>
                <option value="">{zoneFilter.length === 0 ? "All zones" : "Add a zone..."}</option>
                {ZONES.filter((zone) => !zoneFilter.includes(zone)).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              {zoneFilter.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {zoneFilter.map((zone) => (
                    <button
                      key={zone}
                      style={{ ...styles.buttonCompact, borderColor: "#8af6b0", color: "#8af6b0" }}
                      onClick={() => removeZone(zone)}
                      title="Remove zone"
                    >
                      {zone} {"\u00d7"}
                    </button>
                  ))}
                  <button style={styles.buttonCompact} onClick={() => setZoneFilter([])}>
                    Clear (all zones)
                  </button>
                </div>
              )}
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Item search</label>
              <input
                type="text"
                placeholder="e.g. elm log"
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>My dig rank (shows items at or below)</label>
              <select value={rankFilter} onChange={(e) => setRankFilter(e.target.value as Rank)} style={styles.select}>
                {RANKS.map((rank) => (
                  <option key={rank} value={rank}>
                    {rank}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Assumed weather</label>
              <select value={weatherItem} onChange={(e) => setWeatherItem(e.target.value)} style={styles.select}>
                <option value="">None</option>
                <optgroup label="Single weather (crystal)">
                  {WEATHER_ELEMENTS.map((el) => (
                    <option key={`${el} Crystal`} value={`${el} Crystal`}>
                      {el} - {el} Crystal
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Double weather (cluster)">
                  {WEATHER_ELEMENTS.map((el) => (
                    <option key={`${el} Cluster`} value={`${el} Cluster`}>
                      {el} x2 - {el} Cluster
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Vana'diel day<select aria-label="Digging day" style={styles.select} value={dayOverride} onChange={event => setDayOverride(event.target.value as VanaWeekday | "")}><option value="">Live: {vana.weekday}</option>{Object.keys(DIG_DAY_ITEMS).map(day => <option key={day}>{day}</option>)}</select></label>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Moon (%)<input aria-label="Digging moon percent" type="number" min={0} max={100} placeholder={`Live: ${vana.moonPercent}`} value={moonOverride ?? ""} style={{ ...styles.input, width: 110 }} onChange={event => setMoonOverride(event.target.value === "" ? null : Math.max(0, Math.min(100, Number(event.target.value))))} /></label>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Dig layers (extra abilities unverified)</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {MODE_TOGGLES.map((mode) => (
                  <label key={mode.id} style={styles.sub}><input type="checkbox" checked={activeModes.includes(mode.id)} disabled={mode.id === "normal"} onChange={() => toggleMode(mode.id)} /> {mode.label}</label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={styles.sub}>
              {filtered.length} result{filtered.length === 1 ? "" : "s"} &middot; {day} / Moon {moonPercent}%
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={styles.sub}>Gil per</span>
              <div style={{ display: "inline-flex", border: "1px solid #444", borderRadius: 999, overflow: "hidden" }}>
                <button
                  style={{ ...segBtnStyle, ...(gilBasis === "digs" ? segActiveStyle : {}) }}
                  onClick={() => setGilBasis("digs")}
                  title="Expected profit from 100 dig attempts (100 greens)"
                >
                  100 digs
                </button>
                <button
                  style={{ ...segBtnStyle, ...(gilBasis === "items" ? segActiveStyle : {}) }}
                  onClick={() => setGilBasis("items")}
                  title="Expected profit for 100 successful digs, shared across the Phoenix account; resets at midnight JST. Extra layers count once per successful dig."
                >
                  100 successes / account
                </button>
              </div>
            </div>
          </div>
          <details style={{ marginTop: 10, ...styles.sub }}><summary>Elemental ore: {DIG_DAY_ITEMS[day][1]} / {maxRank >= 6 && weatherItem && moonPercent >= 7 && moonPercent <= 21 ? "conditions met in eligible zones" : "conditions not met"}</summary><p>Craftsman (60+) / elemental weather / moon 7-21%, either direction. Ore follows the day, not the weather. Qualifying candidates compete with other rewards; the 10% base roll is not the final reward chance.</p><p>{ORE_ZONES.join(", ")}</p><p>Phoenix fatigue is account-wide. Estimates assume movement between digs, available inventory, no fatigue bypass or rare-item equipment, and constant day/weather/moon. Public defaults specify 100 successful digs; live settings are not published.</p></details>
        </div>

        </CollapsibleSection>

        <div style={styles.subCard}>
          {filtered.length === 0 ? (
            <div style={styles.sub}>No dig results match the current filters.</div>
          ) : (
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 12,
                overflow: "auto",
                maxHeight: "62vh",
                background: "rgba(255,255,255,0.015)",
              }}
            >
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {COLUMNS.map((col) => {
                      const active = col.key === sortKey;
                      const label = col.label.replace("100 digs", gilBasis === "digs" ? "100 digs" : "100 successes");
                      return (
                        <th
                          key={col.key}
                          style={{ ...thStyle, ...(active ? { color: "#8af6b0" } : {}) }}
                          onClick={() => onHeaderClick(col.key)}
                          title={`Sort by ${label}`}
                        >
                          {label}
                          {active ? (sortDir === "asc" ? " \u25b2" : " \u25bc") : ""}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <tr key={`${entry.zone}|${entry.item}|${entry.layer}|${entry.conditional ?? false}`}>
                      <td style={tdStyle}>{entry.zone}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>
                        {entry.item}
                        {weatherItem !== "" && entry.item === weatherItem && entry.mode === null && (
                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: "#8af6b0" }}>weather</span>
                        )}
                      </td>
                      <td style={tdStyle} title={`Candidate roll before competition: ${entry.rate}% at 25/75% moon`}>{(rewardRates.get(entry)?.[0] ?? 0).toFixed(2)}% / {(rewardRates.get(entry)?.[1] ?? 0).toFixed(2)}%</td>
                      <td style={tdStyle}>
                        {vendorPrice(entry.item) > 0 ? (
                          `${vendorPrice(entry.item).toLocaleString()}g`
                        ) : (
                          <span style={{ opacity: 0.5 }}>no NPC sale</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <PriceInput label={`AH ${entry.item} gil each`} value={prices.market[printItemKey(entry.item)]} baseline={null} onChange={(value) => itemPrices.setPrice("market", entry.item, value)} />
                        <small style={{ display: "block", color: "#e6c17a" }}>Applied: {eff(entry.item).toLocaleString()} gil</small>
                      </td>
                      <td style={tdStyle}>{entry.rank ?? "Amateur"}</td>
                      <td style={tdStyle}>
                        {entry.layer === "treasure" ? "Treasure" : entry.mode === null ? "Normal" : entry.mode === "burrow" ? "Burrow" : "Bore"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color:
                            (zoneSuccessMoon[entry.zone] ?? 0) > (zoneSuccess[entry.zone] ?? 0)
                              ? "#8af6b0"
                              : (zoneSuccessMoon[entry.zone] ?? 0) === (zoneSuccess[entry.zone] ?? 0)
                                ? "#f6e58a"
                                : "#ff8a8a",
                        }}
                        title="Chance a dig finds anything: at the current moon phase / at the listed (quarter moon) rates"
                      >
                        {zoneSuccessMoon[entry.zone] ?? 0}% / {zoneSuccess[entry.zone] ?? 0}%
                      </td>
                      <td
                        style={tdStyle}
                        title="Expected greens for 100 successful digs, shared across the account; resets at midnight JST"
                      >
                        {Number.isFinite(zoneGreensMoon[entry.zone]) ? zoneGreensMoon[entry.zone] : "\u2014"}
                      </td>
                      <td style={{ ...tdStyle, ...((zoneGil[entry.zone] ?? 0) < 0 ? { color: "#ff8a8a" } : {}) }}>
                        {(zoneGil[entry.zone] ?? 0).toLocaleString()}g
                      </td>
                      <td style={{ ...tdStyle, ...((zoneGilAh[entry.zone] ?? 0) < 0 ? { color: "#ff8a8a" } : {}) }}>
                        {(zoneGilAh[entry.zone] ?? 0).toLocaleString()}g
                      </td>
                      <td style={{ ...tdStyle, ...((zoneGilMoon[entry.zone] ?? 0) < 0 ? { color: "#ff8a8a" } : {}) }}>
                        {(zoneGilMoon[entry.zone] ?? 0).toLocaleString()}g
                      </td>
                      <td style={{ ...tdStyle, ...((zoneGilAhMoon[entry.zone] ?? 0) < 0 ? { color: "#ff8a8a" } : {}) }}>
                        {(zoneGilAhMoon[entry.zone] ?? 0).toLocaleString()}g
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
