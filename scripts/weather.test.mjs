import test from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

async function load(entry) {
  const bundle = buildSync({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
}
const { WEATHER_DATA, WEATHER_ZONES, ALL_ZONES, EARTH_MS_PER_VANA_DAY: DAY, canonicalWeatherZone, weatherChances, oreMoonWindows, weatherDayStartsIn, weatherForecast, weatherWindowTimerId, createWeatherWindowTimer } = await load("src/utils/weather.ts");
const { advanceEarthTimer, parseDurationToMs } = await load("src/utils/time.ts");
const { getVanaNow } = await load("src/vanadiel.ts");
const { ORE_ZONES, elementalOreActive } = await load("src/utils/digging.ts");
const snapshot = JSON.parse(readFileSync("src/data/zoneWeather.json", "utf8"));
const HOUR = DAY / 24;
const STEP = 1_451_520;
const dayStart = Math.ceil(Date.UTC(2026, 8, 5) / DAY) * DAY;
const calibration = (step, boundary = dayStart) => ({ timeOffsetMs: 0, newMoonStartEarthMs: boundary - (step + 10) * STEP });

test("Starts in counts down in Earth time to calibrated Vana'diel midnight", () => {
  const cal = { ...calibration(10), timeOffsetMs: 4753280 };
  const absDay = dayStart / DAY + 1;
  const midnight = absDay * DAY - cal.timeOffsetMs;
  assert.equal(weatherDayStartsIn(absDay, midnight - 3_661_000, cal), "01:01:01");
  assert.equal(weatherDayStartsIn(absDay, midnight - 3_660_000, cal), "01:01:00");
  assert.equal(weatherDayStartsIn(absDay, midnight - 1000, cal), "00:00:01");
  assert.equal(weatherDayStartsIn(absDay, midnight, cal), "Started");
  assert.equal(weatherDayStartsIn(absDay, midnight + 1000, cal), "Started");
});

test("Starts in uses the day's midnight rather than a later ore or fog window", () => {
  const cal = calibration(6, dayStart + 3 * HOUR);
  const { rows } = weatherForecast({ nowMs: dayStart, cal, zone: "La Theine Plateau", digMode: true, filterIds: [3], maxRows: 2 });
  assert.equal(rows[0].startEarthMs, dayStart + 3 * HOUR);
  assert.equal(weatherDayStartsIn(rows[0].absDay, dayStart, cal), "Started");
  assert.equal(weatherDayStartsIn(rows[1].absDay, dayStart, cal), "00:57:36");
});

test("weather timers persist an exact, one-time window target instead of midnight", () => {
  const cal = calibration(6, dayStart + 3 * HOUR);
  const [row] = weatherForecast({ nowMs: dayStart, cal, zone: "La Theine Plateau", digMode: true, filterIds: [3], maxRows: 1 }).rows;
  const timer = createWeatherWindowTimer(row, true, dayStart);
  assert.equal(timer.targetEarthMs, dayStart + 3 * HOUR);
  assert.notEqual(timer.targetEarthMs, row.absDay * DAY);
  assert.equal(timer.kind, "EARTH_TIME");
  assert.equal(timer.enabled, true);
  assert.equal(timer.repeatDaily, false);
  assert.equal(timer.label, "Elemental ore window: La Theine Plateau");
  assert.equal(timer.createdAtMs, dayStart);
  assert.equal(Date.parse(timer.rawInput), row.startEarthMs);
  assert.equal(parseDurationToMs(timer.rawInput), undefined, "fixed windows must not get countdown reset/pause controls");
  assert.deepEqual(JSON.parse(JSON.stringify(timer)), timer);
  assert.equal(timer.id, weatherWindowTimerId(row));
  assert.equal(createWeatherWindowTimer(row, false, dayStart + 1000).id, timer.id, "one timer per zone/window, regardless of filter");
  assert.equal(createWeatherWindowTimer(row, false, dayStart).label, "Weather window: La Theine Plateau");
  assert.notEqual(weatherWindowTimerId({ ...row, zone: "Tahrongi Canyon" }), timer.id);
  assert.notEqual(weatherWindowTimerId({ ...row, startEarthMs: row.startEarthMs + DAY }), timer.id);
});

test("weather alerts disable after firing while existing Earth timers still repeat daily", () => {
  const [row] = weatherForecast({ nowMs: dayStart, cal: calibration(10), zone: "Cloister of Flames", maxRows: 2 }).rows.slice(1);
  const timer = createWeatherWindowTimer(row, false, dayStart);
  const completed = advanceEarthTimer(timer, row.startEarthMs);
  assert.equal(completed.enabled, false);
  assert.equal(completed.targetEarthMs, row.startEarthMs);
  assert.equal(timer.enabled, true, "timer updates must not mutate state");
  for (const repeatDaily of [undefined, true]) {
    const repeated = advanceEarthTimer({ ...timer, repeatDaily }, row.startEarthMs);
    assert.equal(repeated.enabled, true);
    assert.equal(repeated.targetEarthMs, row.startEarthMs + 86_400_000);
  }
});

test("weather pins Phoenix sources, retains 203 era zones and covers every ore zone", () => {
  assert.equal(snapshot.source.revision, "0f016c5c7b1639d16233fddb93db48e9a51222de");
  for (const source of ["sql/zone_weather.sql", "sql/zone_settings.sql", "src/map/zone.cpp", "src/map/utils/zoneutils.cpp"]) {
    assert.match(snapshot.source.inputs[source], /^[a-f0-9]{64}$/);
  }
  assert.equal(WEATHER_ZONES.length, 203);
  assert.equal(ORE_ZONES.length, 22);
  for (const zone of ORE_ZONES) assert.ok(WEATHER_ZONES.includes(zone), zone);
  for (const pattern of WEATHER_DATA.patterns) assert.equal(Buffer.from(pattern, "base64").length, 4320);
  assert.ok(WEATHER_DATA.cities.includes("Southern San dOria"));
  assert.ok(!WEATHER_DATA.cities.includes("La Theine Plateau"));
});

test("normal forecasts preserve Phoenix sparse patterns and duplicate-slot probabilities", () => {
  for (const zone of WEATHER_ZONES) {
    const bytes = Buffer.from(WEATHER_DATA.patterns[WEATHER_DATA.zones[zone]], "base64");
    const raw = Array.from({ length: 2160 }, (_, day) => bytes.readUInt16LE(day * 2));
    const isStatic = raw.filter(Boolean).length <= 1;
    let value = 0;
    for (let day = 0; day < 2160; day++) {
      if (raw[day]) value = raw[day];
      if (![0, 1, 17, 2159].includes(day)) continue;
      const expected = new Map();
      if (isStatic) expected.set((raw[0] >> 5) & 31, 100);
      else for (const [id, pct] of [[value >> 10, 50], [(value >> 5) & 31, 35], [value & 31, 15]]) expected.set(id, (expected.get(id) ?? 0) + pct);
      const actual = weatherChances(zone, day, 12);
      assert.deepEqual(actual, [...expected].sort(([a, x], [b, y]) => y - x || a - b), `${zone}: ${day}`);
      assert.equal(actual.reduce((sum, [, pct]) => sum + pct, 0), 100);
    }
  }
});

test("morning fog transforms non-elemental rolls at 02:00, ending at 07:00", () => {
  const zone = "La Theine Plateau";
  const normal = weatherChances(zone, 1, 12);
  const fog = weatherChances(zone, 1, 2);
  const expected = normal.filter(([id]) => id >= 4);
  const fogPct = normal.reduce((sum, [id, pct]) => sum + (id < 4 ? pct : 0), 0);
  assert.ok(fogPct > 0);
  expected.push([3, fogPct]);
  expected.sort(([a, x], [b, y]) => y - x || a - b);
  assert.deepEqual(weatherChances(zone, 1, 1.999), normal);
  assert.deepEqual(fog, expected);
  assert.deepEqual(weatherChances(zone, 1, 6.999), expected);
  assert.deepEqual(weatherChances(zone, 1, 7), normal);
  assert.deepEqual(weatherChances("Southern San dOria", 0, 3), weatherChances("Southern San dOria", 0, 12));
  for (const hour of [0, 2, 6, 7, 12]) {
    assert.deepEqual(weatherChances("Bastok-Jeuno Airship", 0, hour), [[1, 100]]);
    assert.deepEqual(weatherChances("Cloister of Flames", 500, hour), [[5, 100]]);
  }
});

test("ore windows begin at waxing 6%, stop at 22%, and exclude waning", () => {
  const boundary = dayStart + 3 * HOUR;
  assert.deepEqual(oreMoonWindows(dayStart, dayStart + DAY, calibration(6, boundary)),
    [{ startEarthMs: boundary, endEarthMs: dayStart + DAY }]);
  assert.deepEqual(oreMoonWindows(dayStart, dayStart + DAY, calibration(22, boundary)),
    [{ startEarthMs: dayStart, endEarthMs: boundary }]);
  assert.deepEqual(oreMoonWindows(dayStart, dayStart + DAY, calibration(194, boundary)), []);
  for (const [step, eligible] of [[5, false], [6, true], [21, true], [22, false], [179, false], [194, false]]) {
    assert.equal(oreMoonWindows(dayStart, dayStart + 1, calibration(step)).length, Number(eligible));
  }
});

test("ore forecasts intersect exact moon and fog windows and omit elapsed opportunities", () => {
  const boundary = dayStart + 3 * HOUR;
  const cal = calibration(6, boundary);
  const args = { nowMs: dayStart, cal, zone: "La Theine Plateau", digMode: true, filterIds: [3], maxRows: 1 };
  const first = weatherForecast(args).rows[0];
  assert.equal(first.startEarthMs, boundary);
  assert.equal(first.endEarthMs, dayStart + 7 * HOUR);
  assert.ok(first.matchPct > 0);
  const nowMs = dayStart + 4 * HOUR;
  assert.equal(weatherForecast({ ...args, nowMs }).rows[0].startEarthMs, nowMs);
  const next = weatherForecast({ ...args, nowMs: dayStart + 7 * HOUR }).rows[0];
  assert.ok(next.startEarthMs >= dayStart + DAY);
});

test("all ore forecast rows agree with Digging eligibility at both ends", () => {
  const cal = calibration(194);
  const forecast = weatherForecast({ nowMs: dayStart, cal, zone: ALL_ZONES, digMode: true });
  assert.equal(forecast.rows.length, 40);
  assert.equal(new Set(forecast.rows.map(row => `${row.zone}:${row.startEarthMs}`)).size, 40);
  for (const row of forecast.rows) {
    assert.ok(row.startEarthMs >= dayStart && row.startEarthMs < row.endEarthMs);
    assert.ok(row.moonMin >= 6 && row.moonMax <= 21);
    for (const instant of [row.startEarthMs, row.endEarthMs - 1]) {
      const moon = getVanaNow(instant, cal);
      for (const [weather] of row.chances.filter(([id]) => forecast.matchIds.includes(id))) {
        const conditions = { rank: 5, hour: moon.hour, moonPercent: moon.moonPercent, waxing: moon.moonStep < 100, day: moon.weekday, weather };
        assert.ok(elementalOreActive(row.zone, conditions));
        assert.equal(elementalOreActive(row.zone, { ...conditions, rank: 4 }), false);
      }
    }
  }
  for (let i = 1; i < forecast.rows.length; i++) assert.ok(forecast.rows[i].startEarthMs >= forecast.rows[i - 1].startEarthMs);
});

test("legacy aliases work, unsupported zones cannot bypass ore mode, and filters intersect eligibility", () => {
  const cal = calibration(10);
  for (const [old, canonical] of [["Carpenters Landing", "Carpenters' Landing"], ["The Sanctuary of ZiTah", "The Sanctuary of Zi'Tah"]]) {
    assert.equal(canonicalWeatherZone(old), canonical);
    const rows = weatherForecast({ nowMs: dayStart, cal, zone: old, digMode: true, maxRows: 1 }).rows;
    assert.equal(rows[0].zone, canonical);
  }
  for (const changes of [{ zone: "Southern San dOria" }, { filterIds: [1, 2] }]) {
    const result = weatherForecast({ nowMs: dayStart, cal, zone: ALL_ZONES, digMode: true, ...changes });
    assert.deepEqual(result.rows, []);
    assert.ok(result.scannedWholeCycle);
  }
  const result = weatherForecast({ nowMs: dayStart, cal, zone: ALL_ZONES, zoneSearch: "tahrongi", digMode: true, filterIds: [10, 11], maxRows: 3 });
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.matchIds, [10, 11]);
  assert.ok(result.rows.every(row => row.zone === "Tahrongi Canyon" && row.matchPct > 0));
});

test("ordinary static forecasts stay full-day, fog filtering works, and calibration offsets persist", () => {
  const cal = calibration(50);
  const args = { nowMs: dayStart, cal, zone: "Cloister of Flames", maxRows: 2 };
  const rows = weatherForecast(args).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].startEarthMs, dayStart);
  assert.equal(rows[0].endEarthMs, dayStart + DAY);
  assert.equal(rows[1].endEarthMs, dayStart + 2 * DAY);
  const fog = weatherForecast({ ...args, zone: "La Theine Plateau", filterIds: [3], maxRows: 1 }).rows[0];
  assert.equal(fog.startEarthMs, dayStart + 2 * HOUR);
  assert.equal(fog.endEarthMs, dayStart + 7 * HOUR);
  const shifted = weatherForecast({ ...args, cal: { ...cal, timeOffsetMs: HOUR } }).rows[0];
  assert.equal(shifted.endEarthMs, dayStart + DAY - HOUR);
  const cycleOffset = 33;
  const dynamic = weatherForecast({ ...args, nowMs: dayStart + 12 * HOUR, zone: "La Theine Plateau", dayOffset: cycleOffset, maxRows: 1 }).rows[0];
  const epochDay = Math.round(1_009_810_800_000 / DAY);
  const cycleDay = ((dayStart / DAY - epochDay + cycleOffset) % 2160 + 2160) % 2160;
  assert.deepEqual(dynamic.chances, weatherChances("La Theine Plateau", cycleDay, 12));
});
