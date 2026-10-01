import React, { useEffect, useMemo, useState } from "react";
import { styles } from "./styles";
import { CollapsibleSection } from "./ScreenControls";
import { Calibration, moonPercentAtEarthMs } from "./vanadiel";
import { loadJson, saveJson } from "./utils/storage";
import { WEEKDAYS, weekdayStyle } from "./utils/weekday";
import weatherData from "./data/zoneWeather.json";

// ---------------------------------------------------------------------------
// Data (extracted from LandSandBoat sql/zone_weather.sql by
// scripts/extract-weather.py).
//
// Each zone maps to a pattern: 2160 uint16 values, one per Vana'diel day of
// the repeating weather cycle. A non-zero value sets that day's weather
// triple: normal = v >> 10, common = (v >> 5) & 0x1F, rare = v & 0x1F.
// Zero = unchanged (the last non-zero entry at or before the day applies).
//
// The server re-rolls weather every 3-30 earth minutes during the day:
// rand(100) < 15 -> rare, < 50 -> common, else normal (50% / 35% / 15%).
// ---------------------------------------------------------------------------

type WeatherData = {
  cycle: number;
  weathers: string[];
  patterns: string[]; // base64, 2160 little-endian uint16 each
  zones: Record<string, number>; // zone name -> pattern index
};

const DATA = weatherData as WeatherData;
const CYCLE = DATA.cycle;
const ZONE_NAMES = Object.keys(DATA.zones);
const ALL_ZONES = "All zones";

// Vana'diel time constants (matching src/vanadiel.ts).
const VANA_MS_PER_VANA_SECOND = 40;
const VANA_SECONDS_PER_DAY = 86400;
const EARTH_MS_PER_VANA_DAY = VANA_SECONDS_PER_DAY * VANA_MS_PER_VANA_SECOND; // 3,456,000 ms
// LSB Vana'diel epoch (Vana'diel 0886-01-01 00:00) = earth 2001-12-31 15:00:00 UTC.
const LSB_EPOCH_EARTH_MS = 1_009_810_800_000;

const ELEMENT_WEATHERS: { element: string; ids: [number, number] }[] = [
  { element: "Fire", ids: [4, 5] },
  { element: "Water", ids: [6, 7] },
  { element: "Earth", ids: [8, 9] },
  { element: "Wind", ids: [10, 11] },
  { element: "Ice", ids: [12, 13] },
  { element: "Lightning", ids: [14, 15] },
  { element: "Light", ids: [16, 17] },
  { element: "Dark", ids: [18, 19] },
];

// Text color per weather id (doubles are more saturated than singles).
const WEATHER_COLORS: string[] = [
  "#9aa3ad", // 0 Clear
  "#ffd75e", // 1 Sunshine
  "#b9c2cb", // 2 Clouds (non-elemental per LSB zoneutils.cpp)
  "#9fb4c7", // 3 Fog
  "#ff9c54", // 4 Hot Spell
  "#ff6b4a", // 5 Heat Wave
  "#6db3f2", // 6 Rain
  "#3f8fe8", // 7 Squall
  "#d8b46a", // 8 Dust Storm
  "#c99a3d", // 9 Sand Storm
  "#98e6a8", // 10 Wind
  "#57d977", // 11 Gales
  "#b3e8f2", // 12 Snow
  "#6fd8ec", // 13 Blizzards
  "#c9a2ff", // 14 Thunder
  "#a875ff", // 15 Thunderstorms
  "#f5f0d0", // 16 Auroras
  "#fff8ae", // 17 Stellar Glare
  "#9089a8", // 18 Gloom
  "#7d739c", // 19 Darkness
];

const patternCache = new Map<number, Uint16Array>();

function getPattern(index: number): Uint16Array {
  let arr = patternCache.get(index);
  if (!arr) {
    const bin = atob(DATA.patterns[index]);
    arr = new Uint16Array(bin.length / 2);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    }
    patternCache.set(index, arr);
  }
  return arr;
}

function mod(n: number, m: number): number {
  const r = n % m;
  return r < 0 ? r + m : r;
}

/**
 * Per-day resolved pattern values (LSB weather_container semantics: last
 * non-zero entry at or before the day, 0 if none). Cached per pattern index.
 */
const resolvedCache = new Map<number, Uint16Array>();

function getResolvedPattern(index: number): Uint16Array {
  let arr = resolvedCache.get(index);
  if (!arr) {
    const pattern = getPattern(index);
    arr = new Uint16Array(CYCLE);
    let last = 0;
    for (let d = 0; d < CYCLE; d++) {
      if (pattern[d]) last = pattern[d];
      arr[d] = last;
    }
    resolvedCache.set(index, arr);
  }
  return arr;
}

/** Weather id -> chance % for one day's triple (slots sharing an id sum). */
function chancesForValue(v: number): Map<number, number> {
  const out = new Map<number, number>();
  const add = (id: number, pct: number) => out.set(id, (out.get(id) ?? 0) + pct);
  add(v >> 10, 50);
  add((v >> 5) & 0x1f, 35);
  add(v & 0x1f, 15);
  return out;
}

type ForecastRow = {
  zone: string;
  absDay: number; // calibrated Vana'diel day index (1970-based)
  startEarthMs: number;
  chances: [number, number][]; // [weatherId, pct] sorted by pct desc
  matchPct: number; // chance of the filtered weather (0 when unfiltered)
  moonMin: number; // moon % range over the Vana'diel day
  moonMax: number;
};

// Elemental-ore digging zones (LSB chocobo_digging/logic.lua elementalOreZoneTable).
const ORE_ZONES = [
  "La Theine Plateau",
  "Jugner Forest",
  "Batallia Downs",
  "Konschtat Highlands",
  "Pashhow Marshlands",
  "Rolanberry Fields",
  "Tahrongi Canyon",
  "Meriphataud Mountains",
  "Sauromugue Champaign",
];

// Elemental weathers (ids 4..19); weathers 0-3 map to element NONE in LSB.
const ELEMENTAL_WEATHER_IDS = ELEMENT_WEATHERS.flatMap((e) => e.ids);

// LSB ore roll: moon phase must be between 7% and 21% (either direction).
const ORE_MOON_MIN = 7;
const ORE_MOON_MAX = 21;

const STORE_KEY = "ffxi_weather_v1";

type Stored = { zone: string; filter: string; dayOffset?: number; digMode?: boolean };

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
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: 13,
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  whiteSpace: "nowrap",
};

const MAX_ROWS = 40;

export default function WeatherTab({ cal }: { cal: Calibration }) {
  const stored = loadJson<Stored | null>(STORE_KEY, null);
  const [zone, setZone] = useState<string>(() =>
    stored && (stored.zone === ALL_ZONES || DATA.zones[stored.zone] !== undefined)
      ? stored.zone
      : ZONE_NAMES[0] ?? ""
  );
  // Filters which zones appear in the results (only used with "All zones").
  const [zoneSearch, setZoneSearch] = useState<string>("");
  // "" = any, "w:<id>" = specific weather, "e:<element>" = either weather of element.
  const [filter, setFilter] = useState<string>(stored?.filter ?? "");
  // Chocobo digging mode: elemental-ore zones + elemental weather + moon 7-21%.
  const [digMode, setDigMode] = useState<boolean>(stored?.digMode ?? false);
  // Cycle shift retained from earlier calibration (UI removed; value persists).
  const dayOffset = stored?.dayOffset ?? 0;
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    saveJson(STORE_KEY, { zone, filter, dayOffset, digMode } satisfies Stored);
  }, [zone, filter, dayOffset, digMode]);

  // Refresh once a minute so "Today" and times stay current.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const filterIds = useMemo<number[] | null>(() => {
    if (!filter) return null;
    if (filter.startsWith("w:")) return [Number(filter.slice(2))];
    const el = ELEMENT_WEATHERS.find((e) => `e:${e.element}` === filter);
    return el ? [...el.ids] : null;
  }, [filter]);

  const { rows, todayAbsDay, scannedWholeCycle, matchIds } = useMemo(() => {
    // Calibrated Vana'diel absolute seconds (same scale as vanadiel.ts).
    const vanaAbsNow = Math.floor((nowMs + cal.timeOffsetMs) / VANA_MS_PER_VANA_SECOND);
    const todayAbs = Math.floor(vanaAbsNow / VANA_SECONDS_PER_DAY);
    // Day index containing the LSB Vana'diel epoch, under the same calibration.
    const epochDay = Math.round(
      (LSB_EPOCH_EARTH_MS + cal.timeOffsetMs) / VANA_MS_PER_VANA_SECOND / VANA_SECONDS_PER_DAY
    );

    const needle = zoneSearch.trim().toLowerCase();
    const baseZones = digMode ? ORE_ZONES : ZONE_NAMES;
    const zoneNames =
      zone === ALL_ZONES
        ? needle
          ? baseZones.filter((z) => z.toLowerCase().includes(needle))
          : baseZones
        : DATA.zones[zone] !== undefined
          ? [zone]
          : [];
    const patterns = zoneNames.map((z) => ({ z, values: getResolvedPattern(DATA.zones[z]) }));

    // In dig mode, only elemental weathers count (optionally narrowed by the filter).
    const matchIds = digMode
      ? filterIds
        ? filterIds.filter((id) => id >= 4)
        : ELEMENTAL_WEATHER_IDS
      : filterIds;
    const scanWholeCycle = !!matchIds;

    const out: ForecastRow[] = [];
    for (let i = 0; i < CYCLE && out.length < MAX_ROWS; i++) {
      const absDay = todayAbs + i;
      const cycleDay = mod(absDay - epochDay + dayOffset, CYCLE);
      const startEarthMs = absDay * EARTH_MS_PER_VANA_DAY - cal.timeOffsetMs;

      // Moon % range over this Vana'diel day (moon steps last ~24 earth min,
      // so a day spans 2-3 steps; sample often enough to hit each one).
      let moonMin = 100;
      let moonMax = 0;
      for (let k = 0; k <= 3; k++) {
        const pct = moonPercentAtEarthMs(
          startEarthMs + Math.min((k * EARTH_MS_PER_VANA_DAY) / 3, EARTH_MS_PER_VANA_DAY - 1),
          cal
        );
        moonMin = Math.min(moonMin, pct);
        moonMax = Math.max(moonMax, pct);
      }
      // LSB ore roll requires moon 7-21%.
      if (digMode && (moonMax < ORE_MOON_MIN || moonMin > ORE_MOON_MAX)) continue;

      for (const { z, values } of patterns) {
        if (out.length >= MAX_ROWS) break;
        const chances = chancesForValue(values[cycleDay]);
        let matchPct = 0;
        if (matchIds) {
          for (const id of matchIds) matchPct += chances.get(id) ?? 0;
          if (matchPct === 0) continue;
        }
        out.push({
          zone: z,
          absDay,
          startEarthMs,
          chances: [...chances.entries()].sort((a, b) => b[1] - a[1]),
          matchPct,
          moonMin,
          moonMax,
        });
      }
      // Without a filter, only show the next MAX_ROWS consecutive days.
      if (!scanWholeCycle && i >= MAX_ROWS - 1) break;
    }
    return { rows: out, todayAbsDay: todayAbs, scannedWholeCycle: scanWholeCycle, matchIds };
  }, [zone, zoneSearch, filterIds, digMode, dayOffset, nowMs, cal]);

  function formatEarth(ms: number): string {
    return new Date(ms).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div style={styles.card}>
      <div style={styles.titleRow}>
        <h3 style={styles.h3}>Weather forecast</h3>
      </div>
      <div style={styles.sub}>
        Per-zone weather patterns from LandSandBoat. Each Vana'diel day has a fixed pattern; the
        server re-rolls every 3&ndash;30 earth minutes: 50% normal / 35% common / 15% rare.
      </div>

      <CollapsibleSection kind="search">
      <div style={{ ...styles.subCard, marginTop: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={styles.field}>
            <label style={styles.label}>Zone</label>
            <select style={styles.select} value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value={ALL_ZONES}>{ALL_ZONES}</option>
              {(digMode ? ORE_ZONES : ZONE_NAMES).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Zone search</label>
            <input
              style={{ ...styles.input, width: 170 }}
              value={zoneSearch}
              placeholder="Filter results…"
              disabled={zone !== ALL_ZONES}
              title={
                zone === ALL_ZONES
                  ? "Only show zones whose name contains this text."
                  : "Select \"All zones\" to search across zones."
              }
              onChange={(e) => setZoneSearch(e.target.value)}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Weather</label>
            <select style={styles.select} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Any weather</option>
              {ELEMENT_WEATHERS.map(({ element, ids }) => (
                <optgroup key={element} label={element}>
                  <option value={`e:${element}`}>Any {element} weather</option>
                  <option value={`w:${ids[0]}`}>{DATA.weathers[ids[0]]} (single)</option>
                  <option value={`w:${ids[1]}`}>{DATA.weathers[ids[1]]} (double)</option>
                </optgroup>
              ))}
              <optgroup label="Other">
                <option value="w:1">Sunshine</option>
                <option value="w:2">Clouds</option>
                <option value="w:3">Fog</option>
              </optgroup>
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Chocobo digging</label>
            <label
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", height: 32 }}
              title="Only elemental-ore zones, on days with elemental weather and moon 7-21%."
            >
              <input
                type="checkbox"
                checked={digMode}
                onChange={(e) => {
                  const on = e.target.checked;
                  setDigMode(on);
                  if (on) {
                    setZone(ALL_ZONES);
                    setFilter("");
                  }
                }}
              />
              Elemental ore
            </label>
          </div>
        </div>
        <div style={{ ...styles.sub, marginTop: 8 }}>
          {digMode ? (
            <>
              Elemental ore (LSB): dig skill 60+, an elemental-ore zone, <b>elemental weather</b> at
              the moment of the dig, and <b>moon 7&ndash;21%</b>; the ore matches the Vana'diel day
              (e.g. Chunk of Fire Ore on Firesday). Rows below are the next qualifying days.
            </>
          ) : (
            <>
              Pick a zone (or All zones + search) and optionally a weather to find upcoming days.
            </>
          )}
        </div>
      </div>

      </CollapsibleSection>
      <div style={{ marginTop: 10, maxHeight: 520, overflowY: "auto", border: "1px solid #333", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {zone === ALL_ZONES && <th style={thStyle}>Zone</th>}
              <th style={thStyle}>Earth time (local)</th>
              <th style={thStyle}>Vana'diel day</th>
              {digMode && <th style={thStyle}>Moon</th>}
              <th style={thStyle}>Forecast (chance per roll)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const weekday = WEEKDAYS[mod(row.absDay, 8)];
              const isToday = row.absDay === todayAbsDay;
              return (
                <tr
                  key={`${row.absDay}:${row.zone}`}
                  style={isToday ? { background: "rgba(138,246,176,0.08)" } : undefined}
                >
                  {zone === ALL_ZONES && <td style={tdStyle}>{row.zone}</td>}
                  <td style={tdStyle}>
                    {formatEarth(row.startEarthMs)}
                    {isToday && <span style={{ color: "#8af6b0", fontWeight: 800 }}> &middot; Today</span>}
                  </td>
                  <td style={tdStyle}>
                    <span style={weekdayStyle(weekday)}>{weekday}</span>
                  </td>
                  {digMode && (
                    <td style={tdStyle}>
                      {row.moonMin === row.moonMax
                        ? `${row.moonMin}%`
                        : `${row.moonMin}\u2013${row.moonMax}%`}
                    </td>
                  )}
                  <td style={tdStyle}>
                    {row.chances.map(([id, pct], i) => {
                      const matched = matchIds?.includes(id) ?? false;
                      return (
                        <span key={id}>
                          {i > 0 && <span style={{ opacity: 0.4 }}> &middot; </span>}
                          <span
                            style={{
                              color: WEATHER_COLORS[id] ?? "#eaeaea",
                              ...(matched
                                ? { fontWeight: 800, textDecoration: "underline" }
                                : undefined),
                            }}
                          >
                            {id === 0 ? "Clear" : DATA.weathers[id]} {pct}%
                          </span>
                        </span>
                      );
                    })}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={3 + (zone === ALL_ZONES ? 1 : 0) + (digMode ? 1 : 0)}>
                  No {digMode ? "days matching the ore criteria" : "days with that weather"} in{" "}
                  {zone === ALL_ZONES ? "any zone" : "this zone"}
                  {scannedWholeCycle ? " (searched the full 2160-day cycle)." : "."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
