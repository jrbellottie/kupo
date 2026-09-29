import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseSql } from "./lib/item-data.mjs";

const checkout = process.argv[2];
if (!checkout) throw new Error("Usage: node scripts/generate-fishing.mjs <Phoenix checkout> [--check]");
const revision = "8d2e0c0de9869317775ba2aec908e5dd8034dda4";
const inputs = {};
const source = file => {
  const text = execFileSync("git", ["-C", checkout, "show", `${revision}:${file}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  inputs[file] = createHash("sha256").update(text).digest("hex");
  return text;
};
const table = name => parseSql(source(`sql/${name}.sql`), name);
const normalize = name => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const fishRows = table("fishing_fish");
const fish = Object.fromEntries(fishRows.map(row => [row.name, {
  fish: row.name, skillCap: row.skill_level, ranking: row.ranking,
  size: row.size_type ? "L" : "S", legendary: Boolean(row.legendary),
  rarity: row.rarity / 1000, shellfish: Boolean(row.flags & 1), item: Boolean(row.item),
  restricted: Boolean(row.disabled || row.quest_only || row.required_keyitem || row.quest < 255),
}]));
const names = new Map(fishRows.map(row => [row.fishid, row.name]));
const affinities = table("fishing_bait_affinity");
const baits = Object.fromEntries(table("fishing_bait").map(row => [row.name, {
  poorFish: Boolean(row.flags & 8), shellfishBait: Boolean(row.flags & 64),
  fish: Object.fromEntries(affinities.filter(entry => entry.baitid === row.baitid).map(entry => [names.get(entry.fishid), [0, row.type ? 30 : 35, row.type ? 60 : 65, row.type ? 75 : 80][entry.power]])),
}]));
const zones = new Map(table("zone_settings").map(row => [row.zoneid, row.name]));
const difficulty = new Map(table("fishing_zone").map(row => [row.zoneid, row.difficulty]));
const groups = table("fishing_group");
const catches = table("fishing_catch");
const mobs = table("fishing_mob");
const areas = Object.fromEntries(table("fishing_area").map(row => {
  const group = catches.find(entry => entry.zoneid === row.zoneid && entry.areaid === row.areaid)?.groupid;
  return [`${normalize(zones.get(row.zoneid) ?? "")}|${normalize(row.name)}`, {
    difficulty: difficulty.get(row.zoneid) ?? 0,
    hasMobs: mobs.some(mob => mob.zoneid === row.zoneid && (!mob.areaid || mob.areaid === row.areaid) && !mob.nm && !mob.disabled),
    members: groups.filter(entry => entry.groupid === group).map(entry => names.get(entry.fishid)).filter(name => name && !fish[name].restricted),
  }];
}));
const rodRows = table("fishing_rod");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE fishing_rod (name TEXT, max_rank INTEGER)");
const insert = db.prepare("INSERT INTO fishing_rod VALUES (?, ?)");
for (const row of rodRows) insert.run(row.name, row.max_rank);
if (!source("modules/init.txt").includes("phoenix/sql")) throw new Error("Phoenix SQL modules not enabled");
db.exec(source("modules/phoenix/sql/fishing_rod.sql"));
const ranks = new Map(db.prepare("SELECT * FROM fishing_rod").all().map(row => [row.name, row.max_rank]));
const rods = JSON.parse(readFileSync("src/data/rods.json", "utf8")).map(rod => ({ ...rod, maxRank: ranks.get(rod.rod) ?? rod.maxRank }));
db.close();
source("src/map/utils/fishingutils.cpp");
source("modules/temp_patch/phoenix-fishing.patch");
const output = { source: { repository: "https://github.com/phoenixffxi/Phoenix", revision, inputs }, fish, baits, areas, rods };
const filename = "src/data/fishingPlanner.json";
const text = JSON.stringify(output) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(filename, "utf8") !== text) throw new Error("Fishing snapshot differs; regenerate explicitly");
} else writeFileSync(filename, text);
console.log(`Phoenix fishing ${revision}: ${Object.keys(areas).length} areas, ${Object.keys(fish).length} catches`);