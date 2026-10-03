import React, { useEffect, useMemo, useState } from "react";
import { styles } from "./styles";
import { CollapsibleSection } from "./ScreenControls";
import { Calibration } from "./vanadiel";
import { loadJson, saveJson } from "./utils/storage";
import { WEEKDAYS, weekdayStyle } from "./utils/weekday";
import { ORE_ZONES } from "./utils/digging";
import { ALL_ZONES, WEATHER_DATA as DATA, WEATHER_ZONES as ZONE_NAMES, canonicalWeatherZone, weatherDayStartsIn, weatherForecast, weatherWindowTimerId, type WeatherRow } from "./utils/weather";

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
  "#b9c2cb", // 2 Clouds
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

function mod(n: number, m: number): number {
  const r = n % m;
  return r < 0 ? r + m : r;
}

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

export default function WeatherTab({ cal, countdownNowMs, activeTimerIds, onSetTimer }: {
  cal: Calibration;
  countdownNowMs: number;
  activeTimerIds: ReadonlySet<string>;
  onSetTimer: (row: WeatherRow, digMode: boolean) => void;
}) {
  const stored = loadJson<Stored | null>(STORE_KEY, null);
  const [zone, setZone] = useState<string>(() => {
    const restored = canonicalWeatherZone(stored?.zone ?? "");
    if (stored?.digMode && !ORE_ZONES.includes(restored)) return ALL_ZONES;
    return restored === ALL_ZONES || DATA.zones[restored] !== undefined ? restored : ZONE_NAMES[0];
  });
  // Filters which zones appear in the results (only used with "All zones").
  const [zoneSearch, setZoneSearch] = useState<string>("");
  // "" = any, "w:<id>" = specific weather, "e:<element>" = either weather of element.
  const [filter, setFilter] = useState<string>(stored?.filter ?? "");
  // Share ore eligibility with the Phoenix digging model.
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

  const { rows, todayAbsDay, scannedWholeCycle, matchIds } = useMemo(
    () => weatherForecast({ zone, zoneSearch, filterIds, digMode, dayOffset, nowMs, cal }),
    [zone, zoneSearch, filterIds, digMode, dayOffset, nowMs, cal]
  );

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
        Weather patterns: 50% normal / 35% common / 15% rare per roll,
        normally every 3&ndash;30 Earth minutes. From 02:00 to before 07:00 Vana'diel time,
        non-elemental rolls become fog outside cities; static zones do not re-roll.
        These are roll windows, not guaranteed weather changes or ore-drop chances.
        Existing weather can persist until the next update; confirm conditions in game.
        {" "}Starts in counts down to Vana'diel midnight for that day, not the weather window.
        {" "}Set timer adds a one-time alert in Clock &amp; Timers for the window's start.
      </div>

      <CollapsibleSection kind="search">
      <div style={{ ...styles.subCard, marginTop: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="weather-zone">Zone</label>
            <select id="weather-zone" style={styles.select} value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value={ALL_ZONES}>{ALL_ZONES}</option>
              {(digMode ? ORE_ZONES : ZONE_NAMES).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="weather-zone-search">Zone search</label>
            <input
              id="weather-zone-search"
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
            <label style={styles.label} htmlFor="weather-filter">Weather</label>
            <select id="weather-filter" style={styles.select} value={filter} onChange={(e) => setFilter(e.target.value)}>
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
              title="Ore zones, active weather (including fog), and waxing moon 6-21%."
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
              Elemental ore: <b>Journeyman / skill 50+</b>, one of {ORE_ZONES.length} eligible
              zones, <b>active weather (including fog)</b> at the moment of the dig,
              and <b>waxing moon 6&ndash;21%</b> only. The ore matches the Vana'diel day,
              not the weather (e.g. Fire Ore on Firesday). Rows show upcoming qualifying
              windows using Kupo's calibrated clock and moon; elapsed windows are excluded.
            </>
          ) : (
            <>
              Pick a zone (or All zones + search) and optionally a weather to find upcoming roll windows.
            </>
          )}
        </div>
      </div>

      </CollapsibleSection>
      <div style={{ marginTop: 10, maxHeight: 520, overflow: "auto", border: "1px solid #333", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {zone === ALL_ZONES && <th style={thStyle}>Zone</th>}
              <th style={thStyle}>Earth window (local)</th>
              <th style={thStyle}>Vana'diel day</th>
              <th style={thStyle}>Starts in</th>
              {digMode && <th style={thStyle}>Moon</th>}
              <th style={thStyle}>Forecast (chance per roll)</th>
              <th style={thStyle}>Timer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const weekday = WEEKDAYS[mod(row.absDay, 8)];
              const isToday = row.absDay === todayAbsDay;
              const timerSet = activeTimerIds.has(weatherWindowTimerId(row));
              const windowStarted = row.startEarthMs <= countdownNowMs;
              return (
                <tr
                  key={`${row.startEarthMs}:${row.zone}`}
                  style={isToday ? { background: "rgba(138,246,176,0.08)" } : undefined}
                >
                  {zone === ALL_ZONES && <td style={tdStyle}>{row.zone}</td>}
                  <td style={tdStyle}>
                    {formatEarth(row.startEarthMs)}
                    <div style={{ opacity: 0.75 }}>to {formatEarth(row.endEarthMs)}</div>
                    {isToday && <span style={{ color: "#8af6b0", fontWeight: 800 }}> &middot; Today</span>}
                  </td>
                  <td style={tdStyle}>
                    <span style={weekdayStyle(weekday)}>{weekday}</span>
                  </td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                    {weatherDayStartsIn(row.absDay, countdownNowMs, cal)}
                  </td>
                  {digMode && (
                    <td style={tdStyle}>
                      Waxing{" "}
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
                  <td style={tdStyle}>
                    <button
                      style={styles.buttonPrimaryCompact}
                      disabled={timerSet || windowStarted}
                      onClick={() => onSetTimer(row, digMode)}
                    >
                      {timerSet ? "Timer set" : windowStarted ? "Started" : "Set timer"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={5 + (zone === ALL_ZONES ? 1 : 0) + (digMode ? 1 : 0)}>
                  No {digMode ? "windows matching the ore criteria" : "windows with that weather"} in{" "}
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
