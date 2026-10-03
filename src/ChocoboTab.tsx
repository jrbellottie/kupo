import React, { useEffect, useMemo, useState } from "react";
import { styles } from "./styles";
import { CollapsibleSection } from "./ScreenControls";
import { DIGGING, DIG_RANKS, DIG_ZONES, DIG_DAY_ITEMS, DIG_DAILY_CAP, ORE_ZONES, diggingDistribution, diggingEstimate, elementalOreActive, type DigConditions, type DigReward } from "./utils/digging";
import { itemPrices, useItemPrices } from "./utils/itemPrices";
import { printItemKey, printBuyPrice, printSellPrice } from "./utils/printingData";
import PriceInput from "./PriceInput";
import { selectedSellPrice } from "./utils/itemPriceStore";
import { Tags } from "lucide-react";
import { saveJson } from "./utils/storage";
import { navigateToTab } from "./utils/tabNav";
import { Calibration, getVanaNow } from "./vanadiel";

type SortKey = "zone" | "item" | "share" | "perAttempt" | "vendor" | "ah" | "experience" | "zoneExperience" | "condition" | "greens" | "zoneGil" | "zoneGilAh";
type Result = DigReward & { vendor: number; ah: number; greens: number; zoneGil: number; zoneGilAh: number; zoneExperience: number };

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "zone", label: "Zone" },
  { key: "item", label: "Item" },
  { key: "share", label: "Share of successful digs" },
  { key: "perAttempt", label: "Chance / attempt" },
  { key: "vendor", label: "Vendor" },
  { key: "ah", label: "AH price" },
  { key: "experience", label: "Dig XP / item" },
  { key: "zoneExperience", label: "Zone XP / 100 items" },
  { key: "condition", label: "Availability" },
  { key: "greens", label: "Greens to daily cap" },
  { key: "zoneGil", label: "Zone net / day (vendor)" },
  { key: "zoneGilAh", label: "Zone net / day (AH)" },
];
const thStyle: React.CSSProperties = {
  position: "sticky", top: 0, zIndex: 1, background: "#161616", color: "#eaeaea",
  textAlign: "left", padding: "6px 8px", fontSize: 11, fontWeight: 800,
  borderBottom: "1px solid #444", cursor: "pointer", userSelect: "none", lineHeight: 1.25,
};
const tdStyle: React.CSSProperties = {
  padding: "6px 8px", fontSize: 12, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap",
};
const ITEM_NAMES = [...new Set([
  ...DIGGING.entries.map(entry => entry.item), ...Object.values(DIG_DAY_ITEMS).map(entry => entry.item),
  ...DIGGING.weather.flatMap(entry => entry.item ? [entry.item] : []),
])];
const vendorPrice = (item: string) => printSellPrice(item, {}) ?? 0;

function ChocoboTab({ cal }: { cal: Calibration }) {
  const [zoneFilter, setZoneFilter] = useState<string[]>([]);
  const [rank, setRank] = useState(8);
  const [itemQuery, setItemQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("zoneGilAh");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [weather, setWeather] = useState(0);
  const prices = useItemPrices();
  const ahPrices = useMemo(() => Object.fromEntries(ITEM_NAMES.map(name => [
    name, selectedSellPrice(prices, printItemKey(name), vendorPrice(name)) ?? vendorPrice(name),
  ])), [prices]);
  const greensCost = printBuyPrice("Gysahl Greens", prices.effectiveBuy) ?? 61;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
  }, [cal, rank, weather, zoneFilter, itemQuery, sortKey, sortDir, prices]);
  const vana = getVanaNow(nowMs, cal);
  const { moonPercent, hour, weekday: day } = vana;
  const waxing = vana.moonStep < 100;
  const conditions = useMemo<DigConditions>(() => ({ rank, hour, moonPercent, waxing, day, weather }), [rank, hour, moonPercent, waxing, day, weather]);
  const results = useMemo(() => DIG_ZONES.flatMap(zone => {
    const distribution = diggingDistribution(zone, conditions);
    const vendor = diggingEstimate(distribution, greensCost, vendorPrice);
    const market = diggingEstimate(distribution, greensCost, item => ahPrices[item]);
    return distribution.rewards.map(entry => ({
      ...entry, vendor: vendorPrice(entry.item), ah: ahPrices[entry.item],
      greens: vendor.greens, zoneGil: Math.round(vendor.net), zoneGilAh: Math.round(market.net), zoneExperience: vendor.experience,
    }));
  }), [conditions, greensCost, ahPrices]);
  const filtered = useMemo(() => {
    const query = itemQuery.trim().toLowerCase();
    return results.filter(entry => (!zoneFilter.length || zoneFilter.includes(entry.zone)) && entry.item.toLowerCase().includes(query))
      .sort((a, b) => {
        const first = a[sortKey];
        const second = b[sortKey];
        const comparison = typeof first === "number" && typeof second === "number" ? first - second : String(first).localeCompare(String(second));
        const order = comparison || a.zone.localeCompare(b.zone) || a.item.localeCompare(b.item);
        return sortDir === "asc" ? order : -order;
      });
  }, [results, zoneFilter, itemQuery, sortKey, sortDir]);
  const oreActive = ORE_ZONES.some(zone => (!zoneFilter.length || zoneFilter.includes(zone)) && elementalOreActive(zone, conditions));

  function onHeaderClick(key: SortKey) {
    if (key === sortKey) setSortDir(value => value === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "zoneExperience" ? "desc" : "asc"); }
  }

  function renderCell(entry: Result, key: SortKey) {
    if (key === "ah") return <>
      <PriceInput label={`AH ${entry.item} gil each`} value={prices.market[printItemKey(entry.item)]} baseline={null} onChange={value => itemPrices.setPrice("market", entry.item, value)} />
      <small style={{ display: "block", color: "#e6c17a" }}>Applied: {entry.ah.toLocaleString()} gil</small>
    </>;
    if (key === "share" || key === "perAttempt") return `${(entry[key] * 100).toFixed(2)}%`;
    if (key === "zoneExperience") return entry.zoneExperience.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (key === "vendor") return entry.vendor > 0 ? `${entry.vendor.toLocaleString()}g` : <span style={{ opacity: 0.5 }}>no NPC sale</span>;
    if (key === "zoneGil" || key === "zoneGilAh") return <span style={entry[key] < 0 ? { color: "#ff8a8a" } : undefined}>{entry[key].toLocaleString()}g</span>;
    return entry[key];
  }

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
                <label style={styles.label} htmlFor="dig-zones">Zones (pick to add, click to remove)</label>
                <select id="dig-zones" value="" style={styles.select} onChange={event => {
                  const zone = event.target.value;
                  if (zone) setZoneFilter(previous => previous.includes(zone) ? previous : [...previous, zone]);
                }}>
                  <option value="">{zoneFilter.length ? "Add a zone..." : "All zones"}</option>
                  {DIG_ZONES.filter(zone => !zoneFilter.includes(zone)).map(zone => <option key={zone}>{zone}</option>)}
                </select>
                {zoneFilter.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {zoneFilter.map(zone => <button key={zone} style={{ ...styles.buttonCompact, borderColor: "#8af6b0", color: "#8af6b0" }} aria-label={`Remove ${zone}`} onClick={() => setZoneFilter(previous => previous.filter(value => value !== zone))}>{zone} &times;</button>)}
                  <button style={styles.buttonCompact} onClick={() => setZoneFilter([])}>Clear (all zones)</button>
                </div>}
              </div>
              <label style={styles.field}><span style={styles.label}>Item search</span>
                <input type="text" placeholder="e.g. gold ore" value={itemQuery} onChange={event => setItemQuery(event.target.value)} style={styles.input} />
              </label>
              <label style={styles.field}><span style={styles.label}>My dig rank</span>
                <select value={rank} onChange={event => setRank(Number(event.target.value))} style={styles.select}>
                  {DIG_RANKS.map((name, index) => <option key={name} value={index}>{name} ({index * 10}{index < 10 ? `-${index * 10 + 9}` : ""})</option>)}
                </select>
              </label>
              <label style={styles.field}><span style={styles.label}>Assumed weather</span>
                <select value={weather} onChange={event => setWeather(Number(event.target.value))} style={styles.select}>
                  <option value={0}>None / sunshine / clouds</option>
                  {DIGGING.weather.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
              <div style={styles.field}><span style={styles.label}>Daily cap</span>
                <span style={styles.sub}>{DIG_DAILY_CAP} successful digs / account</span>
              </div>
            </div>
            <p style={styles.sub}>{filtered.length} results &middot; Calculated at: {day} / {String(hour).padStart(2, "0")}:{String(vana.minute).padStart(2, "0")} / {waxing ? "Waxing" : "Waning"} {moonPercent}% &middot; Dig success: {DIGGING.accuracy[rank]}% (rank only)</p>
            <details style={styles.sub}>
              <summary>Elemental ore: {DIG_DAY_ITEMS[day].item} / {oreActive ? "conditions met in eligible selected zones" : "conditions not met"}</summary>
              <p>Journeyman (50+) / active weather (including fog) / lesser waxing crescent (6-21%). Ore follows the day, not the weather. Weight increases with rank; the final chance depends on the whole pool.</p>
              <p>{ORE_ZONES.join(", ")}</p>
            </details>
            <details style={{ marginTop: 10, ...styles.sub }}>
              <summary>Digging rules and estimate assumptions</summary>
              <p>Zone XP / 100 items is the expected digging XP from the full zone pool at the daily cap: 100 times each item's share of successful digs times its XP, summed across all eligible items. Click its header to rank zones by highest XP first. Item search does not change this total. Estimates hold rank and conditions fixed; Expert (level 100) earns no further XP.</p>
              <p>Time, day, and moon are sampled when this tab opens or you change filters, sorting, rank, weather, or prices. The table stays fixed between changes, including while menus are open.</p>
              <p>Moon changes elemental-ore availability and expected loot, not digging accuracy or the greens needed to reach the daily cap.</p>
              <p>One rank-based success roll, then one weighted item. Moon does not change general success. Each item's weights depend on your rank; its XP tier is not a minimum rank requirement. Seeds and tree cuttings appear only from 20:00 to before 04:00. Colored rocks are zone drops, not day bonuses.</p>
              <p>These digging rules do not use Burrow, Bore, treasure/cache layers, personal chocobo stat bonuses, or rare-item/fatigue-bypass equipment bonuses. Dig XP stops at level 100.</p>
              <p>Move at least 4 yalms between digs. Dig cooldown: {Math.max(3, 15 - rank * 5)} seconds; zone-in delay: {Math.max(10, 60 - rank * 5)} seconds. Each animated attempt spends one green, including failures. Estimates assume valid movement, available inventory, fixed rank and conditions, and no travel/rental or auction fees. Search filters do not remove competing rewards from the estimates.</p>
              <p>Fatigue is account-wide and resets at midnight JST. The public default is 100 successful digs; live settings may differ. Zone net totals subtract greens and use the entire zone pool, not just the displayed item. Missing AH quotes use NPC prices.</p>
              <p>Source revision: {DIGGING.source.revision.slice(0, 12)}. Public-source estimates, not verified live-server rates.</p>
            </details>
          </div>
        </CollapsibleSection>
        <div style={styles.subCard}>
          {filtered.length === 0 ? <div style={styles.sub}>No dig results match the sampled time, selected rank, weather, and filters.</div> :
            <div style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, overflow: "auto", maxHeight: "62vh", background: "rgba(255,255,255,0.015)" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }} aria-label="Chocobo digging">
                <thead><tr>{COLUMNS.map(column => <th key={column.key} scope="col" style={{ ...thStyle, ...(column.key === sortKey ? { color: "#8af6b0" } : {}) }} onClick={() => onHeaderClick(column.key)}>
                  {column.label}{column.key === sortKey ? sortDir === "asc" ? " \u25b2" : " \u25bc" : ""}
                </th>)}</tr></thead>
                <tbody>{filtered.map(entry => <tr key={`${entry.zone}|${entry.itemId}`}>
                  {COLUMNS.map(column => <td key={column.key} style={{ ...tdStyle, ...(column.key === "item" ? { fontWeight: 700 } : {}) }}>{renderCell(entry, column.key)}</td>)}
                </tr>)}</tbody>
              </table>
            </div>}
        </div>
      </div>
    </section>
  );
}

// Ignore the app shell's clock ticks while digging inputs stay unchanged.
export default React.memo(ChocoboTab);
