import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { evaluateLuaData } from "./lib/lua-data.mjs";

const checkout = process.argv[2];
if (!checkout) throw new Error("Usage: node scripts/generate-raising.mjs <source checkout> [--check]");
const revision = "9b93232a0cc1e4a5a50b0f988f37d7ae63b8fcfa";
const repository = "https://github.com/phoenixffxi/Phoenix";
const inputs = {};
const source = file => {
  const text = execFileSync("git", ["-C", checkout, "show", `${revision}:${file}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  inputs[file] = createHash("sha256").update(text).digest("hex");
  return text;
};
const root = "scripts/globals/hobbies/chocobo_raising/";
const catalog = JSON.parse(readFileSync("src/data/itemInfo.json", "utf8"));
const items = Object.fromEntries([...source("scripts/enum/item.lua").matchAll(/^\s*(\w+)\s*=\s*(\d+)\s*,/gm)].map(([, name, value]) => [name, Number(value)]));
const zones = Object.fromEntries(Object.entries(parseYaml(source("data/enums/zone.yaml")).values).map(([name, id]) => [name.toUpperCase(), id]));
const luaTable = object => `{${Object.entries(object).map(([key, value]) => `[${JSON.stringify(key)}]=${value}`).join(",")}}`;
const settingsText = source(`${root}settings.lua`);
const settingKeys = [...settingsText.matchAll(/^xi\.chocoboRaising\.(\w+)\s*=/gm)].map(match => match[1]);
const chunks = [
  `xi={item=${luaTable(items)},zone=${luaTable(zones)}}; utils={unused=function() end}`,
  source("scripts/enum/chocobo_raising.lua"), settingsText, source(`${root}constants.lua`),
];
const raw = evaluateLuaData(chunks, `{
  foods=xi.chocoboRaising.validFoods, plans=xi.chocoboRaising.carePlanData,
  conditions=xi.chocoboRaising.conditions, energy=xi.chocoboRaising.careActionEnergy,
  settings={${settingKeys.map(key => `${key}=xi.chocoboRaising.${key}`).join(",")}},
  hungerPerArrow=xi.chocoboRaising.hungerPerArrow,
  affectionPerArrow=xi.chocoboRaising.affectionPerArrow,
  statPerFoodArrow=xi.chocoboRaising.statPerFoodArrow,
  affectionPerPlanArrow=xi.chocoboRaising.affectionPerPlanArrow,
  statPerPlanArrow=xi.chocoboRaising.statPerPlanArrow,
  odds=xi.chocoboRaising.odds
}`);
const init = source("modules/init.txt");
const enabledModules = init.split(/\r?\n/).map(line => line.split("#")[0].trim().replace(/\/$/, "")).filter(Boolean);
const qol = "custom/lua/chocobo_raising_qol.lua";
if (enabledModules.some(path => qol === path || qol.startsWith(`${path}/`))) {
  throw new Error("Accelerated raising module is enabled; review settings before generating.");
}
const fields = ["strength", "endurance", "discernment", "receptivity"];
const values = table => Object.values(table ?? {});
const stats = table => Object.fromEntries(fields.map((field, i) => [field, table?.[i + 1] ?? 0]));
const conditionNames = Object.fromEntries(Object.entries(raw.conditions).map(([name, id]) => [id, name.toLowerCase().replaceAll("_", " ")]));
const sourceNames = Object.fromEntries([
  ["BUNCH_OF_SHARUG_GREENS", "Sharug Greens"], ["BUNCH_OF_AZOUPH_GREENS", "Azouph Greens"],
  ["CLUMP_OF_GARIDAV_WILDGRASS", "Garidav Wildgrass"], ["ZEGHAM_CARROT", "Zegham Carrot"],
  ["PARASITE_WORM", "Parasite Worm"], ["GREGARIOUS_WORM", "Gregarious Worm"],
].map(([key, name]) => [items[key], name]));
const foods = Object.entries(raw.foods).map(([id, food]) => {
  const name = catalog.items[id]?.name ?? sourceNames[id];
  if (!name) throw new Error(`Missing food name for ${id}`);
  const variant = data => ({
    fullness: data.hunger * raw.hungerPerArrow,
    affection: data.affection * raw.affectionPerArrow,
    cures: values(data.cures).map(id => conditionNames[id]),
  });
  return {
    id: Number(id), name, category: ["", "Medicine", "Energy", "Training", "Food"][food.category],
    ...variant(food), chick: variant({ ...food, ...food.chick }),
    stats: Object.fromEntries(Object.entries(stats(food.stats)).map(([key, value]) => [key, value * raw.statPerFoodArrow])),
    energy: food.energy ?? 0,
    random: {
      fields: values(food.randomStat?.stats).map(index => fields[index - 1]),
      chance: food.randomStat?.chance ?? 0, eitherWay: food.randomStat?.eitherWay ?? false,
    },
    wakes: food.wakes ?? false, alone: food.alone ?? false,
    rerollGene: food.rerollGene ?? false, forgetsAbility: food.forgetsAbility ?? false,
  };
}).sort((a, b) => a.name.localeCompare(b.name));
const planNames = ["Basic Care", "Rest", "Take a Walk", "Listen to Music", "Exercise Alone", "Exercise in a Group", "Interact with Children", "Interact with Chocobos", "Carry Packages", "Exhibit to the Public", "Deliver Messages", "Dig for Treasure", "Act in a Play"];
const plans = Object.entries(raw.plans).map(([id, plan]) => ({
  id: Number(id), name: planNames[Number(id)],
  stage: Number(id) === 0 ? "Egg" : Number(id) < 4 ? "Chick" : Number(id) < 10 ? "Adolescent" : "Adult",
  arrows: stats(plan.stats), affection: plan.affection * raw.affectionPerPlanArrow,
  energy: plan.energy, poorEnergy: plan.poorEnergy,
  difficulty: plan.difficulty, successStats: values(plan.successStats), pay: values(plan.pay),
}));
const walks = source(`${root}walks.lua`);
const thresholds = [...walks.matchAll(/\[xi\.chocoboRaising\.ability\.(\w+)\s*\]\s*=\s*(\d+),/g)];
if (thresholds.length !== 6) throw new Error("Expected six story thresholds");
const abilities = thresholds.map(([, key, threshold]) => ({
  name: key === "AUTO_REGEN" ? "Auto-Regen" : key.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()),
  discernment: Number(threshold),
}));
const learnChance = Number(walks.match(/walks\.learnChance = (\d+)/)?.[1]);
if (!Number.isFinite(learnChance)) throw new Error("Missing story learning chance");
const breeding = source(`${root}breeding.lua`);
const eggColorOdds = [...breeding.matchAll(/^\s*\[xi\.item\.CHOCOBO_EGG_(\w+)\s*\]\s*=\s*\{ colors = \{([^}]+)\}/gm)].map(([, name, weights]) => {
  const chances = weights.split(",").map(value => Number(value.trim()));
  if (chances.length !== 5 || chances.some(value => !Number.isFinite(value) || value < 0) || Math.abs(chances.reduce((sum, value) => sum + value, 0) - 100) > 0.000001) {
    throw new Error(`Invalid egg color odds: ${name}`);
  }
  return {
    id: items[`CHOCOBO_EGG_${name}`],
    name: name.toLowerCase().replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase()),
    yellow: chances[0], black: chances[1], blue: chances[2], red: chances[3], green: chances[4],
  };
});
if (eggColorOdds.length !== 5 || eggColorOdds.some(egg => !Number.isInteger(egg.id))) throw new Error("Expected five egg color distributions");
// Hash the behavior and override inputs as well as the extracted tables.
for (const file of [
  ...["care_plan.lua", "model.lua", "event_vm.lua", "event_playout.lua", "choco_data.lua", "whistle.lua", "retirement.lua", "README.md"].map(file => root + file),
  "modules/custom/lua/chocobo_raising_qol.lua", "settings/default/main.lua",
  "modules/phoenix/lua/globals/hobbies/chocobo_digging/pxi_digging_logic.lua",
  "scripts/quests/hiddenQuests/Chocobo_Whistle.lua", "scripts/quests/jeuno/Chocobo_on_the_Loose.lua",
  "scripts/zones/RuLude_Gardens/npcs/Dabih_Jajalioh.lua", "LICENSE",
]) source(file);
const data = {
  source: {
    repository, revision, checkedOn: "2026-10-05", license: "GPL-3.0",
    licenseUrl: `${repository}/blob/${revision}/LICENSE`,
    attribution: "Mechanics and numeric tables researched from the source fork and LandSandBoat contributors; explanatory text is independently written.",
    inputs,
    wiki: "https://www.bg-wiki.com/ffxi/Category:Chocobo_Raising",
    caveat: "Public source snapshot, not verification of live-server settings. Several source formulas are explicitly estimates of retail behavior.",
  },
  settings: raw.settings, foods, plans, abilities, learnChance, eggColorOdds,
  foodStatPoints: raw.statPerFoodArrow,
  planStatPoints: values(raw.statPerPlanArrow),
  forcedFeedIllnessChance: raw.odds.stomachacheForced,
  actionEnergy: raw.energy,
  feeding: {
    initialAffection: Number(source(`${root}choco_data.lua`).match(/newChoco\.affection\s*=\s*(\d+)/)?.[1]),
    chickHungerPerEnergy: Number(source(`${root}model.lua`).match(/local chickHungerPerEnergy = ([\d.]+)/)?.[1]),
  },
};
if (!Number.isFinite(data.feeding.initialAffection) || !Number.isFinite(data.feeding.chickHungerPerEnergy)) {
  throw new Error("Missing initial affection or chick hunger rule.");
}
const path = "src/data/chocoboRaising.json";
const output = `${JSON.stringify(data, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output) throw new Error("Raising snapshot differs; regenerate and review.");
  console.log("Raising snapshot matches pinned inputs.");
} else {
  writeFileSync(path, output);
  console.log(`Generated ${foods.length} foods, ${plans.length} plans and ${abilities.length} abilities.`);
}
