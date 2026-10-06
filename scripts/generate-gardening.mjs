import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseSql, displayName } from "./lib/item-data.mjs";
import { evaluateLuaData } from "./lib/lua-data.mjs";

const checkout = process.argv[2];
if (!checkout) throw new Error("Usage: node scripts/generate-gardening.mjs <source checkout> [--check]");
const revision = "9b93232a0cc1e4a5a50b0f988f37d7ae63b8fcfa";
const repository = "https://github.com/phoenixffxi/Phoenix";
const inputs = {};
const source = file => {
  const content = execFileSync("git", ["-C", checkout, "show", `${revision}:${file}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  inputs[file] = createHash("sha256").update(content).digest("hex");
  return content;
};
const settingsText = source("settings/default/map.lua");
const settings = Object.fromEntries([...settingsText.matchAll(/(GARDEN_\w+)\s*=\s*(true|false)/g)].map(([, key, value]) => [key, value === "true"]));
if (Object.keys(settings).length !== 4 || Object.values(settings).some(Boolean)) throw new Error("Gardening modifiers changed; review the model before generating.");
const catalog = JSON.parse(readFileSync("src/data/itemInfo.json", "utf8"));
const basic = parseSql(source("sql/item_basic.sql"), "item_basic");
const names = new Map(basic.map(row => [row.itemid, catalog.items[row.itemid]?.name ?? displayName(row.name)]));
const name = id => {
  if (!names.has(id)) throw new Error(`Missing source item ${id}`);
  return names.get(id);
};
const pots = basic.filter(row => row.type === 9).map(row => ({ id: row.itemid, name: name(row.itemid), standard: row.itemid >= 216 && row.itemid <= 221 }));
if (pots.length !== 10 || pots.filter(pot => pot.standard).length !== 6) throw new Error("Supported pot types changed.");
const enums = evaluateLuaData([source("scripts/enum/gardening.lua")], "xi.gardening");
const flowerpot = source("src/map/items/item_flowerpot.cpp");
const logic = source("src/map/utils/gardenutils.cpp");
const daySeconds = Number(logic.match(/VANADAY_SECONDS\s*=\s*(\d+)/)?.[1]);
if (daySeconds !== 3456) throw new Error("Review gardening time conversion.");
const seedSection = flowerpot.split("uint16 CItemFlowerpot::getSeedID")[1]?.split("FLOWERPOT_PLANT_TYPE CItemFlowerpot::getPlantFromSeed")[0];
const seedIds = new Map([...seedSection.matchAll(/case FLOWERPOT_PLANT_(\w+):\s*return (\d+);/g)].map(([, key, id]) => [key, Number(id)]));
const affinities = new Map([...logic.matchAll(/case FLOWERPOT_PLANT_(\w+):\s*elements\[FLOWERPOT_ELEMENT_(\w+)\] \+= 10;/g)].map(([, seed, element]) => [seed, element]));
const elements = ["None", "Fire", "Ice", "Wind", "Earth", "Lightning", "Water", "Light", "Dark"];
const crystals = elements.map((element, id) => ({ id, itemId: id ? id + 4095 : 0, name: id ? name(id + 4095) : "No crystal" }));
const durations = logic.split("uint8 GetStageDuration")[1];
const blocks = [...durations.matchAll(/case FLOWERPOT_PLANT_(\w+):([\s\S]*?)(?=\n        case FLOWERPOT_PLANT_|\n        default:)/g)];
const seeds = blocks.map(([, key, block]) => {
  const stages = [...block.matchAll(/case FLOWERPOT_STAGE_(\w+):\s*return (?:growFromFeed \? (\d+) : (\d+)|(\d+));/g)].map(([, stage, fed, normal, fixed]) => ({
    id: enums.stage[stage], name: stage, days: Number(normal ?? fixed), fedDays: Number(fed ?? fixed),
  })).filter(stage => stage.id > 0 && stage.id < 10);
  const itemId = seedIds.get(key);
  const affinity = elements.findIndex(element => element.toUpperCase() === affinities.get(key));
  if (!itemId || affinity < 1 || !stages.length) throw new Error(`Incomplete seed ${key}`);
  const tree = stages.some(stage => stage.id === 4);
  if (stages.length !== (tree ? 9 : 6)) throw new Error(`Unexpected stage count for ${key}`);
  return { id: enums.plant[key], itemId, name: name(itemId), affinity, feeds: tree ? 2 : 1, stages };
}).sort((a, b) => a.id - b.id);
if (seeds.length !== 8) throw new Error("Expected eight seed types");
const resultRows = parseSql(source("sql/gardening_results.sql"), "gardening_results").sort((a, b) => a.resultId - b.resultId);
const groups = new Map();
for (const row of resultRows) {
  const seed = seeds.find(seed => seed.id === row.seed);
  if (!seed || (seed.feeds === 1 && row.element2 !== 0)) throw new Error(`Invalid feed mapping: ${row.resultId}`);
  // The SQL key stores the common (last) feed before the extra (first) tree feed.
  const first = seed.feeds === 2 ? row.element2 : row.element1;
  const second = seed.feeds === 2 ? row.element1 : null;
  const key = `${seed.id}:${first}:${second ?? "-"}`;
  if (!groups.has(key)) groups.set(key, { id: key, seedId: seed.id, first, second, results: [] });
  groups.get(key).results.push({ id: row.resultId, itemId: row.result, name: name(row.result), min: row.min_quantity, max: row.max_quantity, weight: row.weight });
}
const recipes = [...groups.values()];
for (const recipe of recipes) {
  if (recipe.results.reduce((sum, row) => sum + row.weight, 0) !== 100) throw new Error(`Unexpected total weight for ${recipe.id}`);
  if (recipe.results.some(row => row.weight <= 0 || row.min < 1 || row.max < row.min)) throw new Error(`Invalid result in ${recipe.id}`);
}
if (recipes.length !== 360 || resultRows.length !== 2444) throw new Error("Recipe coverage changed; review the snapshot.");
for (const path of [
  "modules/init.txt", "src/map/items/item_flowerpot.h", "src/map/items/exdata/flower_pot.h",
  "src/map/utils/itemutils.cpp", "src/map/entities/char_entity.cpp", "src/common/xirand.h",
  "src/map/packets/c2s/0x0fc_myroom_plant_add.cpp", "src/map/packets/c2s/0x0fd_myroom_plant_check.cpp",
  "src/map/packets/c2s/0x0fe_myroom_plant_crop.cpp", "src/map/packets/c2s/0x0ff_myroom_plant_stop.cpp",
  "scripts/tests/systems/gardening.lua", "LICENSE",
]) source(path);
const data = {
  source: {
    repository, revision, checkedOn: "2026-10-05", inputs,
    license: "GPL-3.0-or-later", licenseUrl: `${repository}/blob/${revision}/LICENSE`,
    attribution: "Source mechanics and numeric tables: Darkstar, LandSandBoat and source-fork contributors. Explanatory text is independently written.",
    wiki: "https://ffxi.gamerescape.com/wiki/Category:Gardening",
    caveat: "Public source snapshot, not a confirmation of live-server configuration. Wiki pot bonuses and timing may use different rules.",
  },
  settings, daySeconds, pots, crystals, seeds, recipes,
};
const path = "src/data/gardening.json";
const output = `${JSON.stringify(data, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output) throw new Error("Gardening snapshot differs; regenerate and review.");
  console.log("Gardening snapshot matches pinned inputs.");
} else {
  writeFileSync(path, output);
  console.log(`Generated ${pots.length} pots, ${seeds.length} seeds, ${recipes.length} recipes and ${resultRows.length} result rows.`);
}
