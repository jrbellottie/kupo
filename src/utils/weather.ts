import weatherData from "../data/zoneWeather.json";
import { Calibration, getVanaNow } from "../vanadiel";
import { isElementalOreMoon, ORE_WEATHER_IDS, ORE_ZONES } from "./digging";
import { formatCountdown } from "./time";
import type { EarthTimer } from "../types";

export const WEATHER_DATA: {
  cycle: number; weathers: string[]; patterns: string[];
  zones: Record<string, number>; cities: string[];
} = weatherData;
export const WEATHER_ZONES = Object.keys(WEATHER_DATA.zones);
export const ALL_ZONES = "All zones";
export const EARTH_MS_PER_VANA_DAY = 3_456_000;
const HOUR_MS = EARTH_MS_PER_VANA_DAY / 24;
const EPOCH_EARTH_MS = 1_009_810_800_000;

export function weatherDayStartsIn(absDay: number, nowMs: number, cal: Calibration): string {
  const remainingMs = absDay * EARTH_MS_PER_VANA_DAY - cal.timeOffsetMs - nowMs;
  return remainingMs <= 0 ? "Started" : formatCountdown(remainingMs);
}

export function canonicalWeatherZone(zone: string): string {
  if (zone === "Carpenters Landing") return "Carpenters' Landing";
  if (zone === "The Sanctuary of ZiTah") return "The Sanctuary of Zi'Tah";
  return zone;
}

const patternCache = new Map<number, { days: Uint16Array; staticWeather: number | null }>();

function patternForZone(zone: string) {
  const index = WEATHER_DATA.zones[zone];
  if (index === undefined) throw new Error(`Unknown weather zone: ${zone}`);
  let pattern = patternCache.get(index);
  if (!pattern) {
    const binary = atob(WEATHER_DATA.patterns[index]);
    const days = new Uint16Array(WEATHER_DATA.cycle);
    let last = 0;
    let entries = 0;
    for (let day = 0; day < days.length; day++) {
      const value = binary.charCodeAt(day * 2) | (binary.charCodeAt(day * 2 + 1) << 8);
      if (value) { last = value; entries++; }
      days[day] = last;
    }
    // Phoenix initializes static zones to day zero's common slot, without rolling or fog.
    pattern = { days, staticWeather: entries <= 1 ? (days[0] >> 5) & 31 : null };
    patternCache.set(index, pattern);
  }
  return pattern;
}

export function weatherChances(zone: string, cycleDay: number, hour: number): [number, number][] {
  if (!Number.isInteger(cycleDay) || cycleDay < 0 || cycleDay >= WEATHER_DATA.cycle || hour < 0 || hour >= 24) {
    throw new Error("Invalid weather cycle day or hour");
  }
  const pattern = patternForZone(zone);
  if (pattern.staticWeather !== null) return [[pattern.staticWeather, 100]];
  const value = pattern.days[cycleDay];
  const fog = hour >= 2 && hour < 7 && !WEATHER_DATA.cities.includes(zone);
  const chances = new Map<number, number>();
  for (const [id, chance] of [[value >> 10, 50], [(value >> 5) & 31, 35], [value & 31, 15]]) {
    const weather = fog && id < 4 ? 3 : id;
    chances.set(weather, (chances.get(weather) ?? 0) + chance);
  }
  return [...chances].sort(([a, x], [b, y]) => y - x || a - b);
}

type Window = { startEarthMs: number; endEarthMs: number };
export type WeatherRow = Window & {
  zone: string; absDay: number; chances: [number, number][];
  matchPct: number; moonMin: number; moonMax: number;
};

export function weatherWindowTimerId(row: WeatherRow): string {
  return `weather:${row.zone}:${row.startEarthMs}`;
}

export function createWeatherWindowTimer(row: WeatherRow, digMode: boolean, nowMs: number): EarthTimer {
  return {
    id: weatherWindowTimerId(row),
    kind: "EARTH_TIME",
    label: `${digMode ? "Elemental ore" : "Weather"} window: ${row.zone}`,
    enabled: true,
    createdAtMs: nowMs,
    targetEarthMs: row.startEarthMs,
    rawInput: new Date(row.startEarthMs).toISOString(),
    repeatDaily: false,
  };
}

export function oreMoonWindows(startEarthMs: number, endEarthMs: number, cal: Calibration): Window[] {
  const windows: Window[] = [];
  for (let start = startEarthMs; start < endEarthMs;) {
    const moon = getVanaNow(start, cal);
    const end = Math.min(endEarthMs, moon.nextMoonStepAtEarthMs);
    if (isElementalOreMoon(moon.moonPercent, moon.moonStep < 100)) {
      const previous = windows[windows.length - 1];
      if (previous?.endEarthMs === start) previous.endEarthMs = end;
      else windows.push({ startEarthMs: start, endEarthMs: end });
    }
    start = end;
  }
  return windows;
}

export function weatherForecast({
  nowMs, cal, zone, zoneSearch = "", filterIds = null, digMode = false, dayOffset = 0, maxRows = 40,
}: {
  nowMs: number; cal: Calibration; zone: string; zoneSearch?: string;
  filterIds?: number[] | null; digMode?: boolean; dayOffset?: number; maxRows?: number;
}) {
  const todayAbsDay = Math.floor((nowMs + cal.timeOffsetMs) / EARTH_MS_PER_VANA_DAY);
  const epochDay = Math.round((EPOCH_EARTH_MS + cal.timeOffsetMs) / EARTH_MS_PER_VANA_DAY);
  const canonical = canonicalWeatherZone(zone);
  if (canonical !== ALL_ZONES && WEATHER_DATA.zones[canonical] === undefined) throw new Error(`Unknown weather zone: ${zone}`);
  const needle = zoneSearch.trim().toLowerCase();
  const zones = (digMode ? ORE_ZONES : WEATHER_ZONES)
    .filter(name => canonical === ALL_ZONES ? name.toLowerCase().includes(needle) : name === canonical);
  const matchIds = digMode ? ORE_WEATHER_IDS.filter(id => !filterIds || filterIds.includes(id)) : filterIds;
  const rows: WeatherRow[] = [];
  let scannedDays = 0;
  for (; scannedDays < WEATHER_DATA.cycle && rows.length < maxRows; scannedDays++) {
    const absDay = todayAbsDay + scannedDays;
    const cycleDay = ((absDay - epochDay + dayOffset) % WEATHER_DATA.cycle + WEATHER_DATA.cycle) % WEATHER_DATA.cycle;
    const dayStart = absDay * EARTH_MS_PER_VANA_DAY - cal.timeOffsetMs;
    const dayEnd = dayStart + EARTH_MS_PER_VANA_DAY;
    const start = Math.max(dayStart, nowMs);
    const moonWindows = digMode ? oreMoonWindows(start, dayEnd, cal) : [{ startEarthMs: start, endEarthMs: dayEnd }];
    if (!moonWindows.length) continue;
    const dayRows: WeatherRow[] = [];
    for (const name of zones) {
      const weatherWindows: (Window & { chances: [number, number][] })[] = [];
      const hours = [0, 2, 7, 24];
      for (let i = 0; i < hours.length - 1; i++) {
        const chances = weatherChances(name, cycleDay, hours[i]);
        const endEarthMs = dayStart + hours[i + 1] * HOUR_MS;
        const previous = weatherWindows[weatherWindows.length - 1];
        if (previous && JSON.stringify(previous.chances) === JSON.stringify(chances)) previous.endEarthMs = endEarthMs;
        else weatherWindows.push({ startEarthMs: dayStart + hours[i] * HOUR_MS, endEarthMs, chances });
      }
      for (const weather of weatherWindows) {
        const matchPct = weather.chances.reduce((sum, [id, pct]) => sum + (matchIds?.includes(id) ? pct : 0), 0);
        if (matchIds && !matchPct) continue;
        for (const moon of moonWindows) {
          const startEarthMs = Math.max(weather.startEarthMs, moon.startEarthMs);
          const endEarthMs = Math.min(weather.endEarthMs, moon.endEarthMs);
          if (startEarthMs >= endEarthMs) continue;
          const first = getVanaNow(startEarthMs, cal).moonPercent;
          const last = getVanaNow(endEarthMs - 1, cal).moonPercent;
          dayRows.push({ zone: name, absDay, startEarthMs, endEarthMs, chances: weather.chances, matchPct, moonMin: Math.min(first, last), moonMax: Math.max(first, last) });
        }
      }
    }
    dayRows.sort((a, b) => a.startEarthMs - b.startEarthMs || a.zone.localeCompare(b.zone));
    rows.push(...dayRows.slice(0, maxRows - rows.length));
  }
  return { rows, todayAbsDay, scannedWholeCycle: scannedDays === WEATHER_DATA.cycle, matchIds };
}
