import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { displayName, parseSql } from "./lib/item-data.mjs";

const checkout = process.argv[2];
if (!checkout) throw new Error("Usage: node scripts/generate-moghancements.mjs <LandSandBoat checkout> [--check]");

const revision = "3e73b0bd38626df86481547133332f0c1e59dc1d";
const actualRevision = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (actualRevision !== revision) throw new Error(`Expected furnishing source ${revision}, found ${actualRevision}`);

const inputs = {};
const source = file => {
  const content = execFileSync("git", ["-C", checkout, "show", `${revision}:${file}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  inputs[file] = createHash("sha256").update(content).digest("hex");
  return content;
};

const items = new Map(parseSql(source("sql/item_basic.sql"), "item_basic").map(row => [row.itemid, row]));
const furnishingRows = parseSql(source("sql/item_furnishing.sql"), "item_furnishing");
const enumSource = source("src/map/items/item_furnishing.h");
const rawEffects = [...enumSource.matchAll(/^\s*((?:MOGHANCEMENT|MOGLIFICATION|MEGA_MOGLIFICATION)_[A-Z_]+)\s*=\s*(\d+),?\s*(?:\/\/\s*(.*))?$/gm)]
  .map(([, enumName, rawId, description = ""]) => {
    const prefix = enumName.startsWith("MEGA_MOGLIFICATION_")
      ? "MEGA_MOGLIFICATION"
      : enumName.startsWith("MOGLIFICATION_")
        ? "MOGLIFICATION"
        : "MOGHANCEMENT";
    const suffix = enumName.slice(prefix.length + 1);
    const name = suffix.split("_").map(part => part[0] + part.slice(1).toLowerCase()).join(" ");
    const overrides = {
      MOGHANCEMENT_FISHING_ITEM: "Moghancement: Fishing (item drops)",
      MOGHANCEMENT_MONEY_II: "Moghancement: Money II",
      MOGHANCEMENT_SANDORIA_CONQUEST: "Moghancement: San d'Oria Conquest",
    };
    const label = overrides[enumName] ?? (prefix === "MOGHANCEMENT"
      ? `Moghancement: ${name}`
      : `${prefix === "MEGA_MOGLIFICATION" ? "Mega Moglification" : "Moglification"}: ${name}`);
    return { id: Number(rawId), enumName, category: prefix, label, description: description.trim(), suffix };
  });
const effectIdsByName = new Map(rawEffects.map(effect => [effect.enumName, effect.id]));
const effects = rawEffects.map(({ suffix, ...effect }) => {
  if (effect.category !== "MOGLIFICATION") return effect;
  const pairedBaseId = effectIdsByName.get(`MOGHANCEMENT_${suffix}`);
  const pairedMegaId = effectIdsByName.get(`MEGA_MOGLIFICATION_${suffix}`);
  return pairedBaseId && pairedMegaId ? { ...effect, pairedBaseId, pairedMegaId } : effect;
});
if (effects.length === 0) throw new Error("No furnishing effects found in the pinned enum");

const elementNames = ["", "Fire", "Ice", "Wind", "Earth", "Lightning", "Water", "Light", "Dark"];
const furniture = furnishingRows.map(row => {
  const item = items.get(row.itemid);
  if (!item) throw new Error(`Missing item ${row.itemid} from item_basic`);
  if (!elementNames[row.element]) throw new Error(`Unknown element ${row.element} for ${item.name}`);
  return {
    id: row.itemid,
    name: displayName(item.name),
    storage: row.storage,
    moghancementId: row.moghancement,
    elementId: row.element,
    aura: row.aura,
    placement: row.placement,
    sizeX: row.size_x,
    sizeY: row.size_y,
    height: row.height,
  };
}).sort((a, b) => a.name.localeCompare(b.name));

const output = {
  source: { repository: "https://github.com/LandSandBoat/server", revision, inputs },
  elements: elementNames.slice(1).map((name, index) => ({ id: index + 1, name })),
  effects,
  furniture,
};
const path = "src/data/moghancements.json";
const text = `${JSON.stringify(output)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== text) throw new Error(`${path} is out of date`);
} else {
  writeFileSync(path, text);
}
console.log(`Mog House data: ${furniture.length} furnishings, ${effects.length} effects, ${revision}`);
