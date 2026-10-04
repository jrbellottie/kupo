import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSql, normalizeName, displayName } from "./lib/item-data.mjs";
import { buildSync } from "esbuild";
import { generateSourceItemDetails } from "./lib/source-item-details.mjs";

const catalog = JSON.parse(readFileSync(new URL("../src/data/itemInfo.json", import.meta.url), "utf8"));
const wiki = JSON.parse(readFileSync(new URL("../src/data/itemWiki.json", import.meta.url), "utf8"));
const purification = JSON.parse(readFileSync(new URL("../src/data/purification.json", import.meta.url), "utf8"));
const snapshot = JSON.parse(readFileSync(new URL("../src/data/phoenix.json", import.meta.url), "utf8"));

test("binary spell job levels retain all bytes and reject malformed values", () => {
  const jobs = "00002100000000000000000000000000000000230000";
  const sql = `CREATE TABLE \`spells\` (\n \`id\` int,\n \`jobs\` binary(22)\n);\nINSERT INTO \`spells\` VALUES (135,0x${jobs});`;
  assert.deepEqual(parseSql(sql, "spells"), [{ id: 135, jobs }]);
  assert.throws(() => parseSql(sql.replace(jobs, "0021"), "spells"), /Invalid binary value/);
});

test("source metadata applies enabled SQL in load order and maps attachment inventory IDs", () => {
  const sql = (table, row) => `CREATE TABLE \`${table}\` (\n${Object.keys(row).map(key => ` \`${key}\` ${key === "jobs" && table === "spell_list" ? "binary(22)" : "text"}`).join(",\n")}\n);\nINSERT INTO \`${table}\` VALUES (${Object.entries(row).map(([key, value]) => key === "jobs" && table === "spell_list" ? `0x${value}` : typeof value === "string" ? `'${value}'` : value).join(",")});`;
  const basicRows = [
    { itemid: 4743, subid: 0, name: "scroll_of_reraise" },
    { itemid: 2239, subid: 8450, name: "tension_spring" },
    { itemid: 15761, subid: 0, name: "chariot_band" },
  ];
  const sources = {
    "sql/item_basic.sql": basicRows.map(row => sql("item_basic", row)).join("\n"),
    "sql/item_equipment.sql": sql("item_equipment", { itemId: 12306, name: "kite_shield", level: 28, ilevel: 0, jobs: 193, slot: 2, shieldSize: 3 }),
    "sql/item_usable.sql": sql("item_usable", { itemid: 15761, name: "chariot_band", maxCharges: 7, activation: 1, useDelay: 5, reuseDelay: 3600, aoe: 0 }),
    "sql/item_puppet.sql": sql("item_puppet", { itemid: 8450, name: "tension_spring", slot: 3, element: 1 }),
    "sql/spell_list.sql": sql("spell_list", { spellid: 135, name: "reraise", jobs: "00001900000000000000000000000000000000230000", mpCost: 150, castTime: 8000, recastTime: 60000 }),
    "modules/init.txt": "phoenix/sql\nera/sql/wotg\nphoenix/lua\n# era/sql/toau\n",
    "modules/phoenix/sql/items.sql": "UPDATE item_equipment SET jobs = 192 WHERE itemId = 12306; UPDATE item_usable SET reuseDelay = 57600 WHERE name = \"chariot_band\"; UPDATE spell_list SET castTime = 7000 WHERE name = 'reraise';",
    "modules/era/sql/wotg/spells.sql": "UPDATE spell_list SET jobs = 0x00002100000000000000000000000000000000230000, castTime = 8000 WHERE name = 'Reraise'; UPDATE item_puppet SET element = 2 WHERE name = 'tension_spring';",
    "modules/era/sql/toau/spells.sql": "UPDATE spell_list SET castTime = 999 WHERE name = 'reraise';",
    "scripts/enum/magic.lua": "xi.magic.spell = {\n RERAISE = 135,\n}",
    "scripts/items/scroll_of_reraise.lua": "target:addSpell(xi.magic.spell.RERAISE)",
    "modules/phoenix/lua/items/era_items.lua": "local m=Module:new(); m:addOverride('xi.items.chariot_band.onItemUse',function(target) xi.itemUtils.addItemExpEffect(target,xi.effect.DEDICATION,75,5400,500) end)",
  };
  const inputs = {
    source: file => { assert.ok(file in sources, file); return sources[file]; },
    files: Object.keys(sources).reverse(),
    spellFiles: ["scripts/items/scroll_of_reraise.lua"],
    catalog: { items: Object.fromEntries([12306, 15761, 2239, 4743].map(id => [id, {}])) },
  };
  const { items, sqlOrder } = generateSourceItemDetails(inputs);
  assert.deepEqual(sqlOrder, ["modules/phoenix/sql/items.sql", "modules/era/sql/wotg/spells.sql"]);
  assert.equal(items[12306].equipment.jobs, 192);
  assert.equal(items[15761].usable.reuseDelay, 57600);
  assert.deepEqual(items[15761].expEffect, { bonus: 75, duration: 5400, cap: 500 });
  assert.deepEqual(items[2239].puppet, { slot: 3, element: 2 });
  assert.equal(items[8450], undefined);
  assert.equal(items[4743].spell.jobs[2], 33);
  assert.equal(items[4743].spell.jobs[19], 35);
  assert.equal(items[4743].spell.castTime, 8000);
  sources["modules/phoenix/sql/items.sql"] = "DELETE FROM item_equipment WHERE itemId = 12306;";
  assert.throws(() => generateSourceItemDetails(inputs), /Unsupported metadata patch/);
});

test("pinned scroll statistics include all Reraise levels and overlapping era corrections", () => {
  for (const [id, level, mp] of [[4743, 33, 150], [4749, 60, 175], [4750, 75, 200]]) {
    const { spell } = snapshot.itemDetails[id];
    assert.equal(spell.available, true);
    assert.equal(spell.jobs[2], level);
    assert.equal(spell.mpCost, mp);
    assert.equal(spell.castTime, 8000);
    assert.equal(spell.recastTime, 60000);
  }
  const spell = name => snapshot.itemDetails[catalog.names[normalizeName(name)]].spell;
  assert.equal(spell("Scroll of Raise II").mpCost, 200);
  assert.equal(spell("Scroll of Raise III").castTime, 20000);
  assert.equal(spell("Scroll of Stone II").mpCost, 43);
  assert.equal(spell("Scroll of Stone II").recastTime, 14500);
  assert.equal(spell("Scroll of Flare").castTime, 19000, "SoA rollback follows RoV rollback");
  assert.equal(spell("Scroll of Protectra").castTime, 3000);
  assert.equal(spell("Scroll of Banishga").jobs[6], 0, "PLD access must be removed");
  assert.deepEqual(spell("Scroll of Inundation"), { id: 879, available: false });
  assert.equal(Object.values(snapshot.itemDetails).filter(item => item.spell).length, 369);
  for (const [id, item] of Object.entries(snapshot.itemDetails)) {
    assert.ok(catalog.items[id], `Unknown item ${id}`);
    if (!item.spell?.available) continue;
    assert.equal(item.spell.jobs.length, 22);
    assert.ok(item.spell.jobs.every(level => Number.isInteger(level) && level >= 0 && level <= 255));
    for (const key of ["mpCost", "castTime", "recastTime"]) assert.ok(Number.isInteger(item.spell[key]) && item.spell[key] >= 0);
  }
  for (const file of [...snapshot.source.itemDetailSqlOrder, "sql/spell_list.sql", "scripts/enum/magic.lua", "scripts/items/scroll_of_reraise.lua", "modules/phoenix/lua/items/era_items.lua"]) {
    assert.match(snapshot.source.inputs[file], /^[a-f0-9]{64}$/);
  }
});

test("shared catalog applies equipment, pet food, cooldown and EXP overrides without losing base stats", async () => {
  const { outputFiles } = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/phoenixData.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  const { catalogData } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
  for (const [id, changes] of Object.entries(snapshot.itemDetails)) {
    for (const [key, value] of Object.entries(changes)) assert.deepEqual(catalogData.items[id][key], value, `${id}.${key}`);
  }
  assert.equal(catalogData.items[12306].equipment.jobs, 192);
  assert.deepEqual(catalogData.items[12306].modifiers, catalog.items[12306].modifiers);
  for (const id of [17016, 17017, 17018, 17019, 17020, 17021]) assert.equal(catalogData.items[id].equipment.level, 0);
  for (const [id, jobs] of [[17318, 7665], [17336, 1153], [17343, 70688]]) assert.equal(catalogData.items[id].equipment.jobs, jobs);
  assert.equal(catalogData.items[17040].usable.reuseDelay, 86400);
  assert.equal(catalogData.items[17040].usable.useDelay, 30);
  for (const [id, cap, duration] of [[15761, 500, 5400], [15762, 1000, 10800], [15763, 2000, 12600]]) {
    assert.equal(catalogData.items[id].usable.reuseDelay, 57600);
    assert.equal(catalogData.items[id].usable.useDelay, 15);
    assert.equal(catalogData.items[id].expEffect.cap, cap);
    assert.equal(catalogData.items[id].expEffect.duration, duration);
  }
});

test("item details render corrected levels and keep retail text and images behind labeled disclosure", async () => {
  const { outputFiles } = buildSync({
    stdin: { contents: 'import React from "react"; import { renderToStaticMarkup } from "react-dom/server"; import ItemInfo from "./src/ItemInfo"; export const render = name => renderToStaticMarkup(<ItemInfo name={name} />);', resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", loader: { ".css": "empty" }, define: { "import.meta.env.BASE_URL": '"/"' },
  });
  const { createRequire } = await import("node:module");
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  for (const [name, level] of [["Reraise", 33], ["Reraise II", 60], ["Reraise III", 75]]) {
    const html = module.exports.render(`Scroll of ${name}`);
    const primary = html.replace(/<details\b[\s\S]*?<\/details>/g, "");
    assert.match(primary, new RegExp(`WHM Lv\\. ${level}`));
    assert.doesNotMatch(primary, /WHM Lv\. (25|56|70)\b/);
    assert.match(html, /<details><summary[^>]*>Wiki statistics and notes \(may show later-retail values\)/);
    assert.match(html, /Wiki tooltip image \(may show later-retail values\)/);
    assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
    assert.match(primary, /pinned source overrides/);
  }
  const shield = module.exports.render("Kite Shield").replace(/<details\b[\s\S]*?<\/details>/g, "");
  assert.match(shield, /PLD \/ DRK/);
  assert.doesNotMatch(shield, /WAR/);
  assert.match(module.exports.render("Warp Cudgel"), /24h/);
  assert.match(module.exports.render("Scroll of Inundation"), /not defined in the pinned source snapshot/);
});
test("crystal family lists match bundled ToAU element assignments", () => {
  const data = JSON.parse(readFileSync(new URL("../src/data/crystalFamilies.json", import.meta.url), "utf8"));
  const bestiary = JSON.parse(readFileSync(new URL("../src/data/bestiary.json", import.meta.url), "utf8"));
  const elements = ["fire", "ice", "wind", "earth", "thunder", "water", "light", "dark"];
  assert.equal(data.source.bestiaryRevision, bestiary.source.revision);
  assert.equal(Object.keys(data.crystals).length, 8);
  for (const [index, element] of elements.entries()) {
    const crystal = data.crystals[4096 + index];
    const expected = [...new Set(bestiary.monsters.filter((monster) => monster.era === "TOAU" && monster.element === element).map((monster) => displayName(monster.family)))].sort();
    assert.deepEqual(crystal.families, expected);
    assert.ok(crystal.families.length > 0);
    assert.equal(catalog.names[normalizeName(crystal.name)], 4096 + index);
  }
  assert.ok(data.crystals[4096].families.includes("Orc"));
  assert.ok(data.crystals[4099].families.includes("Rabbit"));
  assert.ok(data.crystals[4100].families.includes("Coeurl"));
  assert.equal(data.crystals[4100].name, "Lightning Crystal");
});
test("abjuration mob sources use era drops and deduplicate repeated spawns", async () => {
  const { outputFiles } = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/abjurationDrops.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  const { abjurationMobs } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
  const mobs = abjurationMobs(catalog.names[normalizeName("Earthen Abjuration: Body")]);
  assert.ok(mobs.includes("Nidhogg"));
  assert.equal(mobs.length, new Set(mobs).size);
  assert.deepEqual(abjurationMobs(-1), []);
  const missing = [...new Set(purification.exchanges.map(([, abjuration]) => abjuration))]
    .filter((name) => abjurationMobs(catalog.names[normalizeName(name)]).length === 0);
  assert.deepEqual(missing, [], "Every required abjuration should have a recorded mob source");
});
test("purification items have local metadata, descriptions and paired images", () => {
  const missing = [];
  for (const [cursed, abjuration, result, hq] of purification.exchanges) {
    for (const name of [cursed, result, ...(hq ? [`${cursed} -1`, hq] : [])]) {
      const id = catalog.names[normalizeName(name)];
      const entry = wiki.items[id];
      if (!catalog.items[id] || !entry?.image || entry.status !== "ok") missing.push(`${name}: ${id}, ${entry?.status}, ${entry?.image ?? "no image"}`);
    }
    const id = catalog.names[normalizeName(abjuration)];
    if (!catalog.items[id] || wiki.items[id]?.status !== "ok") missing.push(`${abjuration}: missing local details`);
  }
  assert.deepEqual(missing, []);
});
test("purification lookup normalizes item labels and searches rewards and abjurations", async () => {
  const { outputFiles } = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/purification.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  const { getPurification, getPurificationOrigin, purificationMatches } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
  assert.deepEqual(getPurificationOrigin("Adaman Sollerets"), { cursed: "Cursed Sollerets", abjuration: "Earthen Abjuration: Feet" });
  assert.equal(getPurificationOrigin("Armada Sollerets").cursed, "Cursed Sollerets -1");
  assert.equal(getPurification("Cursed Hauberk -1").result, "Armada Hauberk");
  assert.equal(getPurification("Cursed Sune Ate -1").result, "Shura Sune-Ate +1");
  assert.equal(getPurification("Cursed Cuisses (desynth)").result, "Crimson Cuisses");
  assert.equal(getPurification("Bowl of Cursed Soup").result, "Ambrosia");
  assert.equal(getPurification("Bronze Sword"), undefined);
  assert.equal(purificationMatches("Cursed Hauberk -1", "armada"), true);
  assert.equal(purificationMatches("Cursed Hauberk", "earthen abjuration"), true);
  assert.equal(purificationMatches("Cursed Hauberk", "armada"), false);
  assert.equal(purificationMatches("Bronze Sword", "armada"), false);
});
test("every cursed recipe output has a distinct NQ/HQ purification mapping", () => {
  const exchanges = new Map();
  for (const [cursed, abjuration, result, hq] of purification.exchanges) {
    assert.match(abjuration, /Abjuration/);
    assert.ok(result);
    assert.ok(!exchanges.has(normalizeName(cursed)), `Duplicate ${cursed}`);
    exchanges.set(normalizeName(cursed), { abjuration, result });
    if (hq) {
      assert.notEqual(result, hq);
      exchanges.set(normalizeName(`${cursed} -1`), { abjuration, result: hq });
    }
  }
  assert.equal(exchanges.size, 82);
  const recipes = JSON.parse(readFileSync(new URL("../src/data/recipes.json", import.meta.url), "utf8"));
  for (const recipe of recipes) {
    if (recipe.d === 1) continue;
    for (const item of [recipe.res, ...recipe.hq]) {
      if (/\bcursed\b/i.test(item.n)) assert.ok(exchanges.has(normalizeName(item.n)), `Missing ${item.n}`);
    }
  }
  assert.equal(exchanges.get(normalizeName("Cursed Hauberk")).result, "Adaman Hauberk");
  assert.equal(exchanges.get(normalizeName("Cursed Hauberk -1")).result, "Armada Hauberk");
  assert.equal(exchanges.get(normalizeName("Cursed Cuisses")).result, "Crimson Cuisses");
  assert.equal(exchanges.get(normalizeName("Cursed Cuishes")).result, "Shadow Cuishes");
  assert.equal(exchanges.get(normalizeName("Bottle of Cursed Beverage")).result, "Amrita");
});
test("SQL reader decodes quotes, NULL, variables and flag masks without execution", () => {
  const sql = "SET @FLAG = 4;\nCREATE TABLE IF NOT EXISTS `items` (\n `id` int,\n `name` text,\n `flags` int,\n `optional` int\n);\nINSERT INTO `items` VALUES (1,'Bob''s \\'rod\\'',@FLAG | 8,NULL);";
  assert.deepEqual(parseSql(sql, "items"), [{ id: 1, name: "Bob's 'rod'", flags: 12, optional: null }]);
  assert.throws(() => parseSql(sql.replace("@FLAG | 8", "@UNKNOWN"), "items"), /Unsupported SQL row/);
});
test("Piccolo and its HQ keep distinct IDs and effects", () => {
  const normal = catalog.names[normalizeName("Piccolo")];
  const highQuality = catalog.names[normalizeName("Piccolo +1")];
  assert.notEqual(normal, highQuality);
  assert.equal(catalog.items[normal].equipment.level, 9);
  assert.equal(catalog.items[normal].equipment.jobs, 512);
  assert.ok(catalog.items[normal].modifiers.some(([modifier, value]) => modifier === 437 && value === 1));
  assert.ok(catalog.items[highQuality].modifiers.some(([modifier, value]) => modifier === 437 && value === 2));
  assert.match(wiki.items[highQuality].notes, /STR\+1/);
});
test("wiki descriptions, nested armor stats and food caps are preserved", () => {
  assert.equal(wiki.items[catalog.names[normalizeName("Piece of Holly Lumber")]].description, "Processed holly lumber.");
  const armor = wiki.items[catalog.names[normalizeName("Dusk Gloves +1")]];
  assert.match(armor.fields.bonuses, /haste \+4%/i);
  const food = wiki.items[catalog.names[normalizeName("Meat Mithkabob")]];
  assert.match(food.fields.bonuses, /Attack \+22% \(cap 60\)/);
  assert.equal(food.fields.duration, "30 minutes");
});
test("catalog aliases and cached image references are valid", () => {
  for (const id of Object.values(catalog.names)) assert.ok(catalog.items[id], `Unknown item ID ${id}`);
  for (const [id, entry] of Object.entries(wiki.items)) {
    assert.ok(catalog.items[id], `Wiki item ${id} not in catalog`);
    if (entry.image) {
      assert.match(entry.image, /^items\/\d+\.(png|webp)$/);
      assert.ok(existsSync(new URL(`../public/${entry.image}`, import.meta.url)), `Missing image ${entry.image}`);
    }
  }
});