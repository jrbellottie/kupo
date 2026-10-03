import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { parseSql } from "./lib/item-data.mjs";

const checkout = process.argv[2];
if (!checkout) throw new Error("Usage: node scripts/generate-weather.mjs <Phoenix checkout> [--check]");
const revision = "0f016c5c7b1639d16233fddb93db48e9a51222de";
const inputs = {};
const source = file => {
  const content = execFileSync("git", ["-C", checkout, "show", `${revision}:${file}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  inputs[file] = createHash("sha256").update(content).digest("hex");
  return content;
};
const names = new Map(parseSql(source("sql/zone_settings.sql"), "zone_settings").map(row => [row.zoneid, row.name]));
const zoneKeys = new Map(Object.entries(parseYaml(source("data/enums/zone.yaml")).values).map(([key, id]) => [id, key]));
for (const file of ["src/map/zone.cpp", "src/map/weather_container.cpp", "src/map/utils/zoneutils.cpp", "src/common/vana_time.h"]) source(file);
// Keep the existing pre-WotG scope, excluding unreleased, GM and residential zones.
const excluded = /_\[S\]|Abyssea|Walk_of_Echoes|Mog_Garden|Escha|Reisenjima|Leafallia|Maquette|Celennia|Feretory|Odyssey|unknown|^none$|Colosseum|Everbloom|Ruhotz|Ghoyus|Mordion|RaKaznar|Residential|GM_Home|Provenance|Throne_Room_\[V\]/i;
const aliases = { "Carpenters Landing": "Carpenters' Landing", "The Sanctuary of ZiTah": "The Sanctuary of Zi'Tah" };
const patterns = [];
const zones = {};
const cities = [];
for (const match of source("sql/zone_weather.sql").matchAll(/INSERT INTO `zone_weather` VALUES \((\d+),0x([\da-f]+)\);/gi)) {
  const id = Number(match[1]);
  const name = names.get(id);
  if (!name) throw new Error(`Unknown weather zone ${id}`);
  if (id > 255 || excluded.test(name)) continue;
  const blob = Buffer.from(match[2], "hex");
  if (blob.length !== 4320) throw new Error(`Invalid weather cycle length: ${name}`);
  let nonzero = false;
  for (let i = 0; i < 2160; i++) {
    const value = blob.readUInt16LE(i * 2);
    if ((value >> 10) >= 20 || ((value >> 5) & 31) >= 20 || (value & 31) >= 20) throw new Error(`Unknown weather ID: ${name}`);
    nonzero ||= value !== 0;
  }
  if (!nonzero) continue;
  const encoded = blob.toString("base64");
  let index = patterns.indexOf(encoded);
  if (index < 0) { index = patterns.length; patterns.push(encoded); }
  const original = name.replaceAll("_", " ");
  const display = aliases[original] ?? original;
  zones[display] = index;
  const key = zoneKeys.get(id);
  if (!key) throw new Error(`Missing zone enum ${name}`);
  const settings = parseYaml(source(`data/zones/${key}/zone.yaml`));
  if (settings.type !== undefined && !Array.isArray(settings.type)) throw new Error(`Invalid zone type: ${name}`);
  // Omitted type uses the server's Unknown flag, which is not a city.
  if (settings.type?.includes("city")) cities.push(display);
}
if (!patterns.length) throw new Error("No Phoenix weather patterns found");
const digging = JSON.parse(readFileSync("src/data/phoenix.json", "utf8")).digging;
for (const zone of digging.oreZones) if (zones[zone] === undefined) throw new Error(`Missing ore-zone weather: ${zone}`);
const output = {
  source: { repository: "https://github.com/phoenixffxi/Phoenix", revision, inputs },
  cycle: 2160,
  weathers: ["None", "Sunshine", "Clouds", "Fog", "Hot Spell", "Heat Wave", "Rain", "Squall", "Dust Storm", "Sand Storm", "Wind", "Gales", "Snow", "Blizzards", "Thunder", "Thunderstorms", "Auroras", "Stellar Glare", "Gloom", "Darkness"],
  patterns, zones: Object.fromEntries(Object.entries(zones).sort(([a], [b]) => a.localeCompare(b))), cities: cities.sort(),
};
const file = "src/data/zoneWeather.json";
const text = JSON.stringify(output) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== text) throw new Error("Phoenix weather snapshot differs; regenerate explicitly");
} else writeFileSync(file, text);
console.log(`Phoenix ${revision}: ${Object.keys(zones).length} weather zones, ${patterns.length} patterns`);
