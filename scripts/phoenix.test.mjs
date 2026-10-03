import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { buildSync } from "esbuild";

const snapshot = JSON.parse(readFileSync("src/data/phoenix.json", "utf8"));
const bundle = buildSync({ stdin: { contents: 'export * from "./src/utils/printingData"; export * from "./src/utils/phoenixData"; export * from "./src/utils/priceCatalog"; export * from "./src/utils/itemSources"; export * from "./src/utils/guildPoints"; export { CLAM_ITEM_NAMES } from "./src/ClamTab";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm" });
const data = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("app copy uses neutral server wording, including tooltips, accessible labels and errors", () => {
  const violations = [];
  function inspectDirectory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { inspectDirectory(file); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
        entry.name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function visit(node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
        if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
          const text = node.text.replace(/\bphoenix[ _](?:feather|pearl|armlet|perch[ _]inn)\b/gi, "");
          if (/\b(?:phoenix|pheonix|phenix)\b/i.test(text)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            violations.push(`${file}:${line + 1}: ${node.text.trim()}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  inspectDirectory("src");
  assert.deepEqual(violations, []);
});

test("neutral item-source wording preserves mechanics, game names and repository provenance", () => {
  assert.equal(data.catalogData.items["844"].name, "Phoenix Feather");
  assert.ok(data.getItemSources("Phoenix Feather").digging.length > 0);
  assert.equal(snapshot.source.repository, "https://github.com/phoenixffxi/Phoenix");
  for (const item of [...snapshot.digging.entries.map(row => row.item), "Fire Ore", "Fire Crystal"]) {
    for (const source of data.getItemSources(item).digging) assert.doesNotMatch(source.condition, /phoenix/i);
  }
  assert.match(data.getItemSources("Fire Ore").digging[0].condition, /Journeyman.*waxing moon 6-21%/);
});

test("GP cap quantities round up to the minimum number of items, not gil or synths", () => {
  assert.equal(data.itemsToCapGuildPoints(100, 1500), 15);
  assert.equal(data.itemsToCapGuildPoints(100, 1501), 16);
  assert.equal(data.itemsToCapGuildPoints(2000, 1500), 1);
  for (const [points, cap] of [[0, 1500], [-1, 1500], [100, 0], [1.5, 1500], [100, NaN]]) {
    assert.throws(() => data.itemsToCapGuildPoints(points, cap), /positive integers/);
  }
});
test("Phoenix GP source entries all agree on the minimum full-cap quantity", () => {
  assert.equal(snapshot.guildPoints.length, 1305);
  for (const source of ["sql/guild_item_points.sql", "scripts/enum/guild.lua", "src/map/guild.cpp", ...snapshot.source.guildPointSqlOrder]) {
    assert.match(snapshot.source.inputs[source], /^[a-f0-9]{64}$/);
  }
  for (const row of snapshot.guildPoints) {
    const count = data.getGuildPointItemsToCap(row.item, row.guild);
    assert.ok(Number.isInteger(count) && count > 0, row.item);
    assert.ok(count * row.points >= row.maxPoints, row.item);
    assert.ok((count - 1) * row.points < row.maxPoints, row.item);
  }
});
test("GP fish lookups match fish-list names, not suffixed enum aliases", () => {
  assert.equal(data.getGuildPointItemsToCap("Bastore Sardine", "Fishing"), 50);
  assert.equal(data.getGuildPointItemsToCap("Moat Carp", "Fishing"), 43);
  assert.equal(data.getGuildPointItemsToCap("Monke-Onke", "Fishing"), 5);
  assert.equal(data.getGuildPointItemsToCap("Monke Onke", "Fishing"), 5);
  assert.equal(data.getGuildPointItemsToCap("Moat Carp", "Cooking"), null);
  assert.equal(data.getGuildPointItemsToCap("Not a GP item"), null);
  for (const fish of ["Bastore Sardine", "Moat Carp", "Monke-Onke"]) {
    assert.ok(data.fishData.some(row => row.catch === fish), fish);
  }
});
test("recipe GP counts distinguish NQ and HQ while tolerating pattern caps with the same count", () => {
  assert.equal(data.getGuildPointItemsToCap("Ash Staff"), 75);
  assert.equal(data.getGuildPointItemsToCap("Ash Staff +1"), 50);
  assert.equal(data.getGuildPointItemsToCap("Shinobi Tekko"), 2);
  assert.equal(data.getGuildPointItemsToCap("Shinobi Tekko +1"), 2);
  assert.equal(data.getGuildPointItemsToCap("Pair of Shinobi Tekko"), 2);
  assert.equal(new Set(snapshot.guildPoints.filter(row => row.item === "Shinobi Tekko +1").map(row => row.maxPoints)).size, 2);
});

test("era GP overrides restore Greedie and other requests without dividing corrected caps twice", () => {
  assert.deepEqual(snapshot.source.guildPointSqlOrder, [
    "modules/era/sql/rov/guild_item_points.sql",
    "modules/era/sql/abyssea/guild_item_points.sql",
  ]);
  const greedie = snapshot.guildPoints.filter(row => row.item === "Greedie");
  assert.equal(greedie.length, 2);
  assert.deepEqual(greedie.map(row => row.pattern), [4, 5]);
  assert.ok(greedie.every(row => row.points === 24 && row.maxPoints === 1520));
  for (const [name, count] of [["Greedie", 64], ["Phanauet Newt", 94], ["Dark Bass", 36], ["Sandfish", 31]]) {
    assert.equal(data.getGuildPointItemsToCap(name, "Fishing"), count, name);
    assert.ok(data.fishData.some(row => row.catch === name), name);
  }
  for (const name of ["Bastore Sweeper", "Trumpet Shell", "Black Eel"]) {
    assert.equal(data.getGuildPointItemsToCap(name, "Fishing"), null, name);
  }
  assert.equal(data.getGuildPointItemsToCap("Maple Wand"), 93);
  assert.equal(data.getGuildPointItemsToCap("Flute"), 94);
});

test("GP display shows per-item points, daily cap and fractional item quantity", () => {
  assert.equal(data.formatGuildPointCap("Greedie", "Fishing"), "24 / 1,520 (63.33 items)");
  assert.equal(data.getGuildPointItemsToCap("Greedie", "Fishing"), 64);
  assert.equal(data.formatGuildPointCap("Moat Carp", "Fishing"), "30 / 1,280 (42.67 items)");
  assert.equal(data.formatGuildPointCap("Ash Staff"), "16 / 1,200 (75 items)");
  assert.equal(data.formatGuildPointCap("Ash Staff +1"), "24 / 1,200 (50 items)");
  assert.deepEqual(data.getGuildPointDailyCaps("Shinobi Tekko +1"), [6400, 6480]);
  assert.equal(data.formatGuildPointCap("Shinobi Tekko +1"), "4,455 / 6,400 (1.44 items) or 4,455 / 6,480 (1.45 items)");
  assert.equal(data.formatGuildPointCap("Greedie", "Cooking"), "-");
  assert.equal(data.formatGuildPointCap("Not a GP item"), "-");
});

test("Phoenix source is pinned with economic values and stack changes shared by consumers", () => {
  assert.equal(snapshot.source.revision, "ace1415cf5643d8d45ff72067522d97f2ccb038f");
  for (const hash of Object.values(snapshot.source.inputs)) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(data.printSellPrice("Black Ink", {}), 298);
  assert.equal(data.printItem("Gysahl Greens").stack, 12);
  assert.equal(data.printItem("Fire Cluster").stack, 1);
  for (const [id, item] of Object.entries(snapshot.items)) {
    assert.equal(data.catalogData.items[id].sell, item.sell);
    assert.equal(data.catalogData.items[id].stack, item.stack);
    assert.equal(data.printSellPrice(id, { [id]: 12345 }), 12345);
  }
});
test("automatic guild offers exclude empty non-restocking stock and retain verified stocked offers", () => {
  for (const offer of snapshot.guildOffers) {
    const active = data.shopsData.some(row => row.npc === offer.npc && row.n === offer.n && row.zone === offer.zone);
    assert.equal(active, offer.stocked, `${offer.npc}: ${offer.n}`);
  }
  assert.equal(snapshot.valerianoOffers.length, 24);
  assert.equal(data.shopsData.filter(row => row.npc === "Valeriano").length, 24);
});
test("Phoenix fish caps propagate to every bundled fishing surface", () => {
  for (const [name, cap] of [["Lik", 140], ["Gugrusaurus", 140], ["Ryugu Titan", 150], ["Cave Cherax", 130], ["Titanic Sawfish", 125]]) {
    assert.equal(data.phoenixFish[name].skillCap, cap);
    for (const row of data.fishData.filter(row => row.catch === name)) assert.equal(row.lvl, cap);
    for (const row of data.rodFishData.filter(row => row.fish === name)) assert.equal(row.skillCap, cap);
    for (const row of data.baitData.filter(row => row.fish === name)) assert.equal(row.lvl, cap);
  }
});
test("digging uses Phoenix weighted rewards and shares availability with item sources and prices", () => {
  assert.equal(new Set(snapshot.digging.entries.map(row => row.zone)).size, 26);
  assert.ok(snapshot.digging.entries.every(row => row.weights.length === 11 && !Object.hasOwn(row, "layer")));
  for (const name of ["Gold Ore", "Fire Ore", "Dark Ore", "Translucent Rock"]) assert.equal(data.PRICE_CATALOG.find(row => row.key === data.printItemKey(name))?.digging, true);
  assert.deepEqual(data.getItemSources("Gold Ore").digging.map(row => row.zone), ["Tahrongi Canyon", "Western Altepa Desert"]);
  assert.equal(data.getItemSources("Heavy Metal").digging.length, 0);
  assert.equal(data.getItemSources("Fire Ore").digging.length, 22);
  assert.ok(data.getItemSources("Fire Ore").digging.every(row => /Journeyman.*waxing moon 6-21%/.test(row.condition)));
  assert.ok(data.getItemSources("Tree Cuttings").digging.every(row => /night 20:00-04:00/.test(row.condition)));
  for (const item of snapshot.digging.entries) {
    assert.ok(data.getItemSources(item.item).digging.some(row => row.zone === item.zone));
  }
  const zones = new Set(snapshot.digging.entries.map(row => row.zone));
  for (const weather of snapshot.digging.weather.filter(row => row.item)) {
    assert.deepEqual(new Set(data.getItemSources(weather.item).digging.map(row => row.zone)), zones);
  }
});
test("clamming aliases resolve to source item IDs", () => {
  const clams = new Set(data.CLAM_ITEM_NAMES.map(data.printItemKey));
  for (const id of Object.keys(snapshot.clamming.itemData)) assert.ok(clams.has(id), `Missing clamming item ${id}`);
});
test("era HELM removes out-of-era items and normalizes fresh-pool weights", () => {
  const removed = [["Eastern Ginger Root", "Wajaom Woodlands"], ["Eastern Ginger Root", "Bhaflau Thickets"], ["Aquilaria Log", "Yhoator Jungle"], ["Aquilaria Log", "Yuhtunga Jungle"], ["Kapor Log", "Yhoator Jungle"], ["Butterpear", "Yhoator Jungle"], ["Sprig of Dyer's Woad", "Giddeus"], ["Sprig of Dyer's Woad", "West Sarutabaruta"]];
  for (const [name, zone] of removed) assert.ok(!snapshot.helm.some(row => row.n === name && row.zone === zone));
  const totals = new Map();
  for (const row of snapshot.helm) totals.set(`${row.kind}|${row.zone}`, (totals.get(`${row.kind}|${row.zone}`) ?? 0) + row.pct);
  for (const total of totals.values()) assert.ok(Math.abs(total - 100) < 1e-8);
});