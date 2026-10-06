import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parse as parseYaml } from "yaml";
import { parseSql } from "./lib/item-data.mjs";
import { evaluateLuaData } from "./lib/lua-data.mjs";
import { generateSourceItemDetails } from "./lib/source-item-details.mjs";

const checkout = process.argv[2];
if (!checkout) throw new Error("Usage: node scripts/generate-phoenix.mjs <Phoenix checkout> [--check]");
const revision = "ace1415cf5643d8d45ff72067522d97f2ccb038f";
const diggingRevision = "0f016c5c7b1639d16233fddb93db48e9a51222de";
const inputs = {};
const readSource = (file, ref, hashes) => {
  const content = execFileSync("git", ["-C", checkout, "show", `${ref}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  hashes[file] = createHash("sha256").update(content).digest("hex");
  return content;
};
const source = (file) => readSource(file, revision, inputs);
const diggingInputs = {};
const digSource = (file) => readSource(file, diggingRevision, diggingInputs);
const catalog = JSON.parse(readFileSync("src/data/itemInfo.json", "utf8"));
const gitLines = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split(/\r?\n/);
const itemDetails = generateSourceItemDetails({
  source,
  files: gitLines("ls-tree", "-r", "--name-only", revision, "modules"),
  spellFiles: gitLines("grep", "-l", "target:canLearnSpell(", revision, "--", "scripts/items").map(file => file.slice(revision.length + 1)),
  catalog,
});
const fishing = Object.fromEntries(parseSql(source("sql/fishing_fish.sql"), "fishing_fish").map(row => [row.name, { skillCap: row.skill_level, item: Boolean(row.item), disabled: Boolean(row.disabled) }]));
const basic = parseSql(source("sql/item_basic.sql"), "item_basic");
const db = new DatabaseSync(":memory:");
const columns = Object.keys(basic[0]);
db.exec(`CREATE TABLE item_basic (${columns.map(column => `"${column}" ${typeof basic[0][column] === "number" ? "INTEGER" : "TEXT"}`).join(",")})`);
const insert = db.prepare(`INSERT INTO item_basic VALUES (${columns.map(() => "?").join(",")})`);
db.exec("BEGIN");
for (const row of basic) insert.run(...columns.map(column => row[column]));
db.exec("COMMIT");
const init = source("modules/init.txt");
if (!init.includes("phoenix/sql") || !init.includes("phoenix/lua")) throw new Error("Phoenix modules not enabled");
for (const file of ["pre_rmt_basesell_vendor_revert.sql", "pxi_item_basic.sql"]) {
  const sql = source(`modules/phoenix/sql/${file}`);
  const variables = new Map([...sql.matchAll(/^SET\s+(@\w+)\s*=\s*(\d+);/gm)].map(match => [match[1], match[2]]));
  const statements = sql.replace(/--[^\n]*/g, "").replace(/^SET[^;]+;/gm, "").split(";").map(statement => statement.trim()).filter(Boolean);
  for (const statement of statements) {
    if (!/^UPDATE\s+`?item_basic`?\s+SET\s/i.test(statement)) throw new Error(`Unsupported item patch: ${statement}`);
    db.exec(statement.replace(/@\w+/g, variable => { if (!variables.has(variable)) throw new Error(`Unknown SQL variable ${variable}`); return variables.get(variable); }));
  }
}
const items = {};
for (const row of db.prepare("SELECT * FROM item_basic ORDER BY itemid").all()) {
  const original = catalog.items[row.itemid];
  if (original && (original.sell !== row.BaseSell || original.stack !== row.stackSize || (original.flags & 4096) !== (row.flags & 4096))) items[row.itemid] = { sell: row.BaseSell, stack: row.stackSize, flags: row.flags };
}

const enumValues = (file) => Object.fromEntries([...source(file).matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*,/gm)].map(match => [match[1], Number(match[2])]));
const itemEnums = enumValues("scripts/enum/item.lua");
const zoneEnums = Object.fromEntries(Object.entries(parseYaml(source("data/enums/zone.yaml")).values).map(([name, id]) => [name.toUpperCase(), id]));
const ranks = ["Amateur", "Recruit", "Initiate", "Novice", "Apprentice", "Journeyman", "Craftsman", "Artisan", "Adept", "Veteran", "Expert"];
const luaTable = (object) => `{${Object.entries(object).map(([key, value]) => `[${JSON.stringify(key)}]=${value}`).join(",")}}`;
const bootstrap = `xi={item=${luaTable(itemEnums)},zone=${luaTable(zoneEnums)},craftRank=${luaTable(Object.fromEntries(ranks.map((rank,index)=>[rank.toUpperCase(),index])))},day={FIRESDAY=0,EARTHSDAY=1,WATERSDAY=2,WINDSDAY=3,ICEDAY=4,LIGHTNINGDAY=5,LIGHTSDAY=6,DARKSDAY=7},data={}}; Module={new=function() return {addOverride=function(self,name,callback) callback() end} end}; super=function() end`;
const names = new Map(Object.entries(itemEnums).map(([name, id]) => [id, catalog.items[id]?.name ?? name.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase())]));
const clamming = evaluateLuaData([bootstrap, source("scripts/globals/hobbies/clamming/data.lua")], "xi.clamming");
for (const id of Object.keys(clamming.itemData)) if (!catalog.items[id]) {
  const row = db.prepare("SELECT * FROM item_basic WHERE itemid = ?").get(Number(id));
  if (!row) throw new Error(`Missing clamming item ${id}`);
  items[id] = { name: row.name.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()), sell: row.BaseSell, stack: row.stackSize, flags: row.flags, category: 0 };
}
source("scripts/globals/hobbies/clamming/logic.lua");
const zoneName = (id) => Object.entries(zoneEnums).find(([, value]) => value === Number(id))?.[0].toLowerCase().replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()).replace("The Sanctuary Of Zitah", "The Sanctuary of Zi'Tah").replace("Carpenters Landing", "Carpenters' Landing");
const helmSetup = `xi.helmType={HARVESTING=1,EXCAVATION=2,LOGGING=3,MINING=4}; xi.emote=xi.helmType; xi.expansion={ABYSSEA=8,WOTG=4}; Module.new=function() return {addOverrideByEra=function(self,name,callbacks) for _,callback in pairs(callbacks) do callback() end end} end`;
const helmTable = evaluateLuaData([bootstrap, helmSetup, source("scripts/globals/hobbies/helm/data.lua"), source("modules/era/lua/globals/helm/helm_adjustments.lua")], "xi.helm.dataTable");
source("scripts/globals/hobbies/helm/logic.lua");
const helm = [];
const helmZones = [];
for (const table of Object.values(helmTable)) for (const [zone, data] of Object.entries(table.zone)) {
  const drops = Object.values(data.drops);
  const total = drops.reduce((sum, row) => sum + row[1], 0);
  helmZones.push({ kind: table.id.toLowerCase().replace(/^\w/, letter => letter.toUpperCase()), zone: zoneName(zone), zoneId: Number(zone), toolId: table.tool, tool: names.get(table.tool), obtainRate: data.obtainRate, breakRate: data.breakRate, minLevel: data.minLevel ?? 0, relocateRate: table.relocateRate, respawnTime: table.respawnTime, campMultiplier: table.campMultiplier, depletion: data.depletion ? { max: data.depletion.max, pool: Object.values(data.depletion.pool) } : null, points: Object.values(data.points).map(point => Object.values(point)), drops: drops.map(row => ({ itemId: row[2], name: names.get(row[2]), weight: row[1], dailyCap: data.dailyCap?.[row[2]] ?? null })) });
  for (const row of drops) helm.push({ kind: table.id.toLowerCase().replace(/^\w/, letter => letter.toUpperCase()), zone: zoneName(zone), n: names.get(row[2]), pct: 100 * row[1] / total, obtainRate: data.obtainRate, breakRate: data.breakRate, minLevel: data.minLevel ?? 0, dailyCap: data.dailyCap?.[row[2]] ?? null, depletion: data.depletion ?? null });
}
helm.sort((first, second) => first.kind.localeCompare(second.kind) || first.zone.localeCompare(second.zone) || first.n.localeCompare(second.n));
helmZones.sort((first, second) => first.kind.localeCompare(second.kind) || first.zone.localeCompare(second.zone));
const modEnums = parseYaml(source("data/enums/mod.yaml")).values;
const helmMods = new Map();
for (const kind of ["Harvesting", "Logging", "Mining"]) for (const quality of ["nq", "hq"]) {
  helmMods.set(modEnums[`${kind.toLowerCase()}_result_${quality}`], { kind, quality });
}
const gearByItem = new Map();
for (const row of parseSql(source("sql/item_mods.sql"), "item_mods")) {
  const mod = helmMods.get(row.modId);
  if (!mod) continue;
  const key = `${row.itemId}:${mod.kind}`;
  const name = catalog.items[row.itemId]?.name ?? names.get(row.itemId) ?? basic.find(item => item.itemid === row.itemId)?.name.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
  if (!name) throw new Error(`Unknown HELM gear item ${row.itemId}`);
  const gear = gearByItem.get(key) ?? { itemId: row.itemId, name, kind: mod.kind, nq: 0, hq: 0 };
  gear[mod.quality] += row.value;
  gearByItem.set(key, gear);
}
const helmGear = [...gearByItem.values()].sort((first, second) => first.kind.localeCompare(second.kind) || first.name.localeCompare(second.name));
const valerianoSource = source("modules/era/lua/globals/valeriano_shop_adjust.lua");
const valerianoStock = evaluateLuaData([bootstrap], `{${valerianoSource.match(/local stock\s*=\s*\{([\s\S]*?)\n    \}/)[1]}}`);
const valerianoOffers = ["Southern San d'Oria", "Port Bastok", "Windurst Woods"].flatMap(zone => Object.values(valerianoStock).map(row => ({ n: names.get(row[1]), npc: "Valeriano", zone, price: row[2] })));
const digInit = digSource("modules/init.txt");
if (!digInit.split(/\r?\n/).some(line => line.trim() === "phoenix/lua")) throw new Error("Phoenix digging modules not enabled");
const digItems = Object.fromEntries([...digSource("scripts/enum/item.lua").matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*,/gm)].map(match => [match[1], Number(match[2])]));
const digZones = Object.fromEntries(Object.entries(parseYaml(digSource("data/enums/zone.yaml")).values).map(([name, id]) => [name.toUpperCase(), id]));
const digWeather = Object.fromEntries(Object.entries(parseYaml(digSource("data/enums/weather.yaml")).values).map(([name, id]) => [name.toUpperCase(), id]));
const digBootstrap = `${bootstrap}; xi.item=${luaTable(digItems)}; xi.zone=${luaTable(digZones)}; xi.weather=${luaTable(digWeather)}; set=function(values) local result={} for _,v in ipairs(values) do result[v]=true end return result end`;
const digTable = evaluateLuaData([digBootstrap, digSource("modules/phoenix/lua/globals/hobbies/chocobo_digging/pxi_digging_data.lua")], "xi.chocoboDig");
for (const file of [
  "modules/phoenix/lua/globals/hobbies/chocobo_digging/pxi_digging_logic.lua",
  "modules/phoenix/lua/globals/hobbies/chocobo_digging/chocobo_account_fatigue.lua",
  "scripts/utils/common.lua", "scripts/utils/utils.lua", "settings/default/main.lua",
  "src/map/packets/c2s/0x01a_action.cpp",
]) digSource(file);
const digName = id => {
  const name = catalog.items[id]?.name;
  if (!name) throw new Error(`Unknown Phoenix digging item ${id}`);
  return { itemId: Number(id), item: name };
};
const digZoneName = id => {
  const key = Object.keys(digZones).find(name => digZones[name] === Number(id));
  if (!key || zoneEnums[key] !== Number(id)) throw new Error(`Unmapped Phoenix digging zone ${id}`);
  return zoneName(id);
};
const rankValues = table => ranks.map((_, rank) => {
  const value = table[rank];
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid digging value at rank ${rank}`);
  return value;
});
const entries = Object.entries(digTable.zoneTable).flatMap(([zone, rows]) => Object.values(rows).map(row => ({
  zone: digZoneName(zone), ...digName(row[1]), itemRank: row[2],
  weights: rankValues(Object.fromEntries(ranks.map((_, rank) => [rank, row[rank + 3]]))),
  nightOnly: Boolean(digTable.nightOnlyItems[row[1]]),
})));
entries.sort((first, second) => first.zone.localeCompare(second.zone) || first.item.localeCompare(second.item));
const baseDigging = evaluateLuaData([digBootstrap, digSource("scripts/globals/hobbies/chocobo_digging/data.lua")], "xi.chocoboDig");
digSource("scripts/globals/hobbies/chocobo_digging/logic.lua");
const referenceItemNames = new Map(parseSql(digSource("sql/item_basic.sql"), "item_basic").map(row => [
  row.itemid, catalog.items[row.itemid]?.name ?? row.name.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()),
]));
const activeDigZones = new Set(entries.map(entry => entry.zone));
const referenceLayers = Object.entries(baseDigging.digInfo).flatMap(([zone, layers]) => {
  const name = digZoneName(zone);
  if (!activeDigZones.has(name)) return [];
  return ["BURROW", "BORE", "TREASURE"].flatMap(layer => Object.values(layers[baseDigging.layer[layer]] ?? {}).map(row => {
    const item = referenceItemNames.get(row[1]);
    if (!item) throw new Error(`Unknown base-layer digging item ${row[1]}`);
    return { zone: name, itemId: row[1], item, layer: layer[0] + layer.slice(1).toLowerCase(), minimumRank: row[3] };
  }));
});
referenceLayers.sort((first, second) => first.zone.localeCompare(second.zone) || first.item.localeCompare(second.item) || first.layer.localeCompare(second.layer));
const days = ["Firesday", "Earthsday", "Watersday", "Windsday", "Iceday", "Lightningday", "Lightsday", "Darksday"];
const digging = {
  source: { repository: "https://github.com/phoenixffxi/Phoenix", revision: diggingRevision, branch: "beta", inputs: diggingInputs },
  ranks, accuracy: rankValues(digTable.accuracy), experiencePerItem: rankValues(digTable.experiencePerItem),
  xpToLevel: Array.from({ length: 100 }, (_, index) => digTable.xpToLevel[index + 1]),
  entries, referenceLayers, oreZones: Object.keys(digTable.elementalOreZones).map(digZoneName).sort(),
  oreWeights: rankValues(digTable.elementalOreWeight),
  ores: Object.fromEntries(days.map((day, index) => [day, digName(digTable.elementalOreByDay[index])])),
  weather: [
    { id: digWeather.FOG, name: "Fog", itemId: null, item: null, weights: ranks.map(() => 0) },
    ...Object.entries(digTable.crystalByWeather).map(([id, item]) => ({ id: Number(id), name: digName(item).item.replace(" Crystal", " (single weather)"), ...digName(item), weights: rankValues(digTable.crystalWeight) })),
    ...Object.entries(digTable.clusterByWeather).map(([id, item]) => ({ id: Number(id), name: digName(item).item.replace(" Cluster", " (double weather)"), ...digName(item), weights: rankValues(digTable.clusterWeight) })),
  ].sort((first, second) => first.id - second.id),
};
const guilds = evaluateLuaData([bootstrap, source("scripts/data/guild_shops.lua"), source("modules/phoenix/lua/data/era_guild_shops.lua")], "xi.data.guildShops");
const shops = JSON.parse(readFileSync("src/data/shops.json", "utf8"));
const npcZones = new Map(shops.map(row => [row.npc.replaceAll(" ", "_"), row.zone]));
const npcPaths = execFileSync("git", ["-C", checkout, "ls-tree", "-r", "--name-only", revision, "scripts/zones"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
for (const match of npcPaths.matchAll(/scripts\/zones\/([^/]+)\/npcs\/([^/]+)\.lua/g)) if (!npcZones.has(match[2])) npcZones.set(match[2], match[1].replaceAll("_", " ").replace(/\bd([A-Z])/g, "d'$1"));
const guildOffers = [];
const guildPrice = (stock) => {
  const floor = stock.priceFloor ?? stock.maxStock * 0.75;
  const count = stock.targetStock ?? stock.maxStock;
  if (floor <= 0) return stock.buyMax;
  const knee = floor * 2 / 3;
  return count <= knee ? Math.floor(stock.buyMax * (125 - Math.floor(150 * count / floor)) / 125) : Math.floor(stock.buyMax * (200 - Math.floor(100 * (count - knee) / (stock.maxStock - knee))) / 1000);
};
for (const [npc, guild] of Object.entries(guilds)) {
  const stock = guilds[guild.sharedStock ?? npc]?.stock;
  if (!stock) throw new Error(`Unresolved guild stock ${npc}`);
  if (!npcZones.has(npc)) throw new Error(`Missing guild NPC zone ${npc}`);
  for (const row of Object.values(stock)) guildOffers.push({ n: names.get(row.id), npc: npc.replaceAll("_", " "), zone: npcZones.get(npc), price: guildPrice(row), initial: row.initial, restockRate: row.restockRate, stocked: row.initial > 0 || row.restockRate > 0 });
}
guildOffers.sort((first, second) => first.npc.localeCompare(second.npc) || first.n.localeCompare(second.n));
const guildNames = new Map(Object.entries(enumValues("scripts/enum/guild.lua")).map(([name, id]) => [id, name[0] + name.slice(1).toLowerCase()]));
const basicNames = new Map(basic.map(row => [row.itemid, row.name]));
source("src/map/guild.cpp");
const guildPointSqlOrder = ["modules/era/sql/rov/guild_item_points.sql", "modules/era/sql/abyssea/guild_item_points.sql"];
db.exec("CREATE TABLE guild_item_points (guildid INTEGER, itemid INTEGER, rank INTEGER, points INTEGER, max_points INTEGER, pattern INTEGER, PRIMARY KEY (guildid, itemid, pattern))");
const insertGp = db.prepare("INSERT INTO guild_item_points VALUES (?, ?, ?, ?, ?, ?)");
for (const row of parseSql(source("sql/guild_item_points.sql"), "guild_item_points")) {
  insertGp.run(row.guildid, row.itemid, row.rank, row.points, row.max_points, row.pattern);
}
// Roll back the global cap multiplier before item-specific era corrections.
// This differs from public init order, matching the confirmed live Greedie cap of 1,520.
for (const file of guildPointSqlOrder) {
  const module = file.replace(/^modules\//, "").replace(/\/guild_item_points\.sql$/, "");
  if (!init.split(/\r?\n/).some(line => line.trim().replace(/\/$/, "") === module)) throw new Error(`GP era module not enabled: ${module}`);
  const statements = source(file).replace(/--[^\n]*/g, "").split(";").map(statement => statement.trim()).filter(Boolean);
  for (const statement of statements) {
    if (!/^(?:UPDATE|INSERT INTO|DELETE FROM)\s+`?guild_item_points`?\s/i.test(statement)) throw new Error(`Unsupported GP patch: ${statement}`);
    // MariaDB rounds division results when assigning to integer columns; SQLite otherwise truncates.
    db.exec(statement.replace(/`max_points`\s*\/\s*3\b/g, "CAST(ROUND(`max_points` / 3.0) AS INTEGER)"));
  }
}
const gpCounts = new Map();
const guildPoints = db.prepare("SELECT * FROM guild_item_points ORDER BY guildid, rank, pattern, itemid").all().map(row => {
  const guild = guildNames.get(row.guildid);
  const item = catalog.items[row.itemid]?.name ?? basicNames.get(row.itemid)?.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
  if (!guild || !item || !Number.isInteger(row.points) || row.points <= 0 || !Number.isInteger(row.max_points) || row.max_points <= 0) {
    throw new Error(`Invalid guild-point entry: ${JSON.stringify(row)}`);
  }
  const count = Math.ceil(row.max_points / row.points);
  const previous = gpCounts.get(row.itemid);
  if (previous !== undefined && previous !== count) throw new Error(`Pattern-dependent GP quantities need explicit handling: ${item}`);
  gpCounts.set(row.itemid, count);
  return { guild, itemId: row.itemid, item, rank: row.rank, pattern: row.pattern, points: row.points, maxPoints: row.max_points };
});
db.close();
const output = { source: { repository: "https://github.com/phoenixffxi/Phoenix", revision, branch: "beta", eraScenario: "ToAU (pre-WotG)", itemDetailSqlOrder: itemDetails.sqlOrder, guildPointSqlOrder, guildPointScenario: "Global cap rollback before item-specific era corrections; live Greedie cap confirmed at 1520 GP", inputs }, items, itemDetails: itemDetails.items, fishing, clamming, helm, helmZones, helmGear, valerianoOffers, guildNpcs: Object.keys(guilds).map(npc => npc.replaceAll("_", " ")).sort(), guildOffers, guildPoints, digging };
const filename = "src/data/phoenix.json";
const text = JSON.stringify(output) + "\n";
if (process.argv.includes("--check")) { if (readFileSync(filename, "utf8") !== text) throw new Error("Phoenix snapshot differs; regenerate explicitly"); }
else writeFileSync(filename, text);
console.log(`Phoenix ${revision}: ${Object.keys(items).length} item overrides, ${guildOffers.length} guild offers; digging ${diggingRevision}: ${entries.length} entries in ${Object.keys(digTable.zoneTable).length} zones`);