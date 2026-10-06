import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: ["src/utils/gardening.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { GARDENING, GARDEN_ROWS, DEFAULT_GARDEN_FILTERS, gardenSeed, crystalName, gardenTiming, gardenHarvest, gardenBaseStrength, gardenOutcomes, filterGardenRows, gardenDuration, gardenDurationRange, gardenQuantity } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const recipe = id => {
  const value = GARDENING.recipes.find(recipe => recipe.id === id);
  assert.ok(value, `Missing recipe ${id}`);
  return value;
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("gardening snapshot covers all seeds, chronological feed combinations, pots and result rows", () => {
  assert.equal(GARDENING.source.revision, "9b93232a0cc1e4a5a50b0f988f37d7ae63b8fcfa");
  assert.equal(GARDENING.source.repository, "https://github.com/phoenixffxi/Phoenix");
  assert.equal(GARDENING.seeds.length, 8);
  assert.equal(GARDENING.recipes.length, 360);
  assert.equal(GARDEN_ROWS.length, 2444);
  assert.equal(new Set(GARDEN_ROWS.map(row => row.outcome.itemId)).size, 135);
  assert.deepEqual(GARDENING.pots.map(pot => pot.id), [216, 217, 218, 219, 220, 221, 3744, 3745, 3746, 3747]);
  assert.equal(GARDENING.pots.filter(pot => pot.standard).length, 6);
  assert.ok(Object.values(GARDENING.settings).every(value => value === false));
  for (const hash of Object.values(GARDENING.source.inputs)) assert.match(hash, /^[a-f0-9]{64}$/);
  for (const path of ["sql/gardening_results.sql", "src/map/utils/gardenutils.cpp", "settings/default/map.lua", "src/map/packets/c2s/0x0fc_myroom_plant_add.cpp"]) assert.ok(GARDENING.source.inputs[path]);
  for (const seed of GARDENING.seeds) {
    const entries = GARDENING.recipes.filter(recipe => recipe.seedId === seed.id);
    assert.equal(entries.length, seed.feeds === 2 ? 81 : 9);
    for (let first = 0; first <= 8; first++) {
      if (seed.feeds === 1) assert.ok(entries.some(recipe => recipe.first === first && recipe.second === null));
      else for (let second = 0; second <= 8; second++) assert.ok(entries.some(recipe => recipe.first === first && recipe.second === second));
    }
  }
});

test("all 11,880 planting outcomes select valid rows and bounded integer yields", () => {
  for (const entry of GARDENING.recipes) {
    assert.equal(entry.results.reduce((sum, result) => sum + result.weight, 0), 100);
    assert.equal(new Set(entry.results.map(result => result.itemId)).size, entry.results.length);
    for (let roll = 0; roll <= 32; roll++) {
      const harvest = gardenHarvest(entry, roll);
      assert.ok(entry.results.some(row => row.id === harvest.result.id));
      assert.ok(Number.isInteger(harvest.quantity));
      assert.ok(harvest.quantity >= harvest.result.min && harvest.quantity <= harvest.result.max, `${entry.id} roll ${roll}`);
      if (roll === 32) {
        assert.equal(harvest.strength, 100);
        assert.equal(harvest.result.id, entry.results.at(-1).id);
        assert.equal(harvest.quantity, entry.results.at(-1).max);
      }
    }
    const outcomes = gardenOutcomes(entry);
    assert.equal(outcomes.reduce((sum, row) => sum + row.rolls, 0), 33);
    close(outcomes.reduce((sum, row) => sum + row.chance, 0), 1);
    close(outcomes.reduce((sum, row) => sum + row.expected, 0),
      Array.from({ length: 33 }, (_, roll) => gardenHarvest(entry, roll).quantity).reduce((sum, quantity) => sum + quantity, 0) / 33);
  }
});

test("seed affinity, skipped feeds and matching tree feeds affect base strength", () => {
  assert.equal(gardenBaseStrength(recipe("2:0:-")), 10);
  assert.equal(gardenBaseStrength(recipe("2:1:-")), 10);
  assert.equal(gardenBaseStrength(recipe("2:3:-")), 20);
  assert.equal(gardenBaseStrength(recipe("7:1:1")), 40);
  assert.equal(gardenBaseStrength(recipe("7:8:8")), 60);
  assert.equal(gardenBaseStrength(recipe("7:1:2")), 20);
  assert.equal(gardenBaseStrength(recipe("7:0:0")), 40);
  assert.equal(gardenBaseStrength(recipe("7:0:8")), 40);
});

test("tree saplings with Fire twice have 7/33 Fire Ore chance, not the SQL weight", () => {
  const entry = recipe("7:1:1");
  const ore = gardenOutcomes(entry).find(row => row.itemId === 1255);
  assert.ok(ore);
  assert.equal(ore.rolls, 7);
  close(ore.chance, 7 / 33);
  assert.notEqual(ore.chance, ore.weight / 100);
  assert.deepEqual(ore.quantities, [1]);
  assert.equal(gardenHarvest(entry, 25).result.name, "Stick of Cinnamon");
  assert.equal(gardenHarvest(entry, 26).result.itemId, 1255);
  assert.equal(gardenHarvest(entry, 32).result.itemId, 1255);
});

test("source-listed unreachable outcomes remain available without being advertised as obtainable", () => {
  assert.equal(GARDEN_ROWS.filter(row => row.outcome.rolls > 0).length, 2178);
  const all = filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, includeUnreachable: true });
  assert.equal(all.length, 2444);
  assert.ok(all.some(row => row.outcome.rolls === 0 && gardenQuantity(row.outcome) === "Not reachable"));
  assert.ok(filterGardenRows(DEFAULT_GARDEN_FILTERS).every(row => row.outcome.rolls > 0));
});

test("quantity distributions retain gaps and use strict cumulative thresholds", () => {
  const salt = gardenOutcomes(recipe("2:0:-")).find(row => row.itemId === 936);
  assert.deepEqual(salt.quantities, [16, 17, 18, 19, 21, 22, 23, 24]);
  assert.equal(gardenQuantity(salt), "16-24");
  assert.equal(gardenHarvest(recipe("2:0:-"), 0).quantity, 16);
  const synthetic = {
    ...recipe("2:0:-"),
    results: [
      { id: 1, itemId: 1, name: "First", min: 1, max: 4, weight: 10 },
      { id: 2, itemId: 2, name: "Second", min: 1, max: 4, weight: 90 },
    ],
  };
  assert.equal(gardenHarvest(synthetic, 0).result.name, "Second", "strength equal to boundary advances to next result");
});

test("one-feed crops skip the extra tree stages and distinguish no feed from prompt feed", () => {
  const none = gardenTiming(recipe("2:0:-"));
  assert.deepEqual([none.minDays, none.maxDays], [109, 109]);
  assert.deepEqual(none.windows, [{ label: "Feed 1", crystal: 0, earliest: 25, latest: 25, duration: 50 }]);
  const fed = gardenTiming(recipe("2:1:-"));
  assert.deepEqual([fed.minDays, fed.maxDays], [79, 129]);
  assert.equal(fed.windows.length, 1);
  assert.equal(gardenDuration(1), "58m");
  assert.equal(gardenDuration(25), "1d");
  assert.equal(gardenDurationRange(fed), "3d 3h 50m - 5d 3h 50m");
});

test("tree timelines account for feed-induced next-stage lengths and shifted second window", () => {
  const fed = gardenTiming(recipe("7:1:1"));
  assert.deepEqual([fed.minDays, fed.maxDays], [496, 662]);
  assert.deepEqual(fed.windows, [
    { label: "Feed 1", crystal: 1, earliest: 184, latest: 184, duration: 80 },
    { label: "Feed 2", crystal: 1, earliest: 324, latest: 404, duration: 86 },
  ]);
  assert.deepEqual(gardenTiming(recipe("7:0:0")), {
    minDays: 586, maxDays: 586,
    windows: [
      { label: "Feed 1", crystal: 0, earliest: 184, latest: 184, duration: 80 },
      { label: "Feed 2", crystal: 0, earliest: 366, latest: 366, duration: 86 },
    ],
  });
  for (const entry of GARDENING.recipes) {
    const timing = gardenTiming(entry);
    assert.ok(timing.minDays > 0 && timing.maxDays >= timing.minDays);
    assert.equal(timing.windows.length, gardenSeed(entry.seedId).feeds);
    assert.equal(timing.maxDays - timing.minDays, timing.windows.filter(window => window.crystal !== 0).reduce((sum, window) => sum + window.duration, 0));
  }
});

test("crystal filters are chronological: single feed versus no crystal at a second feed", () => {
  assert.equal(recipe("1:1:0").results[0].id, 5, "SQL element1=0, element2=1 means Fire first, no crystal second");
  assert.equal(recipe("1:1:0").results[0].itemId, 936);
  const single = filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, second: "single" });
  assert.ok(single.length);
  assert.ok(single.every(row => row.seed.feeds === 1 && row.recipe.second === null));
  const noSecond = filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, second: "0" });
  assert.ok(noSecond.length);
  assert.ok(noSecond.every(row => row.seed.feeds === 2 && row.recipe.second === 0));
  const ordered = filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, seed: "1", first: "2", second: "1" });
  assert.ok(ordered.length);
  assert.ok(ordered.every(row => row.recipe.id === "1:2:1"));
  assert.equal(crystalName(null), "Not needed");
  assert.equal(crystalName(0), "No crystal");
  assert.equal(crystalName(1), "Fire Crystal");
});

test("item, pot, seed and crystal filters intersect; pot selection does not fabricate modifiers", () => {
  const filtered = filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, result: "fire ore", seed: "7", first: "1", second: "1", pot: "221" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].outcome.itemId, 1255);
  const matches = filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, query: "arcane tree saplings fire", result: "fire ore" });
  assert.ok(matches.length);
  assert.ok(matches.every(row => row.outcome.itemId === 1255 && row.seed.id === 7));
  assert.equal(filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, query: "arcane", pot: "218" }).length, 0);
  for (const pot of GARDENING.pots) {
    assert.deepEqual(filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, pot: String(pot.id), result: "Vomp" }),
      filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, result: "Vomp" }));
  }
  assert.deepEqual(filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, result: "not a crop" }), []);
});

test("sorting is numeric for chance and timing with stable tie breaks", () => {
  for (const sort of ["chance", "time"]) {
    const rows = filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, sort });
    for (let i = 1; i < rows.length; i++) {
      if (sort === "chance") assert.ok(rows[i - 1].outcome.chance >= rows[i].outcome.chance);
      else assert.ok(rows[i - 1].timing.minDays <= rows[i].timing.minDays);
    }
  }
});

test("invalid identifiers and planting rolls surface errors", () => {
  assert.throws(() => gardenSeed(99), /Unknown/);
  assert.throws(() => crystalName(99), /Unknown/);
  assert.throws(() => filterGardenRows({ ...DEFAULT_GARDEN_FILTERS, pot: "999" }), /Unknown/);
  for (const value of [-1, 33, NaN, Infinity, 1.5]) assert.throws(() => gardenHarvest(recipe("2:0:-"), value), /Planting roll/);
});

test("Gardening is registered after Weather and before HELM with shared search controls", () => {
  const shell = readFileSync("src/AppShell.tsx", "utf8");
  assert.match(shell, /id: "weather"[^\n]+\n\s*\{ id: "gardening"[^\n]+\n\s*\{ id: "helm"/);
  assert.match(shell, /activeTab === "gardening"[\s\S]*?<GardeningTab \/>/);
  assert.match(shell, /React\.lazy\(\(\) => import\("\.\/GardeningTab"\)\)/);
  assert.match(readFileSync("src/ScreenControls.tsx", "utf8"), /COLLAPSIBLE_SCOPES.*"gardening"/);
});

test("offline tab renders search, pagination, source limitations and timing guide", () => {
  const { outputFiles } = buildSync({
    stdin: { contents: 'import React from "react"; import { renderToStaticMarkup } from "react-dom/server"; import Gardening from "./src/GardeningTab"; export const render = () => renderToStaticMarkup(<Gardening />);', resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const html = module.exports.render();
  assert.match(html, /360 recipes \/ 135 harvest items/);
  assert.match(html, /2,178 matching outcomes/);
  assert.match(html, /Showing 1-50/);
  assert.match(html, /Page 1 of 44/);
  assert.match(html, /Desired harvest item/);
  assert.match(html, /LSB-based gardening code from a pinned public source snapshot/);
  assert.match(html, /Private-server modules and settings may override these rules; unpublished overrides cannot be reviewed or verified here/);
  assert.match(html, /pot choice, weekday, moon phase and room aura do not modify results/);
  assert.match(html, /Additional source types - availability unverified/);
  assert.doesNotMatch(html, /Try a harvest:|gardening-examples|Pot compatibility:|all listed recipes work with every source-classified planting pot/);
  assert.doesNotMatch(html, />(?:Vomp Carrot|Zegham Carrot|Fire Ore|Tree Saplings)<\/button>/);
  assert.match(html, /stored at planting|hidden integer roll from 0 through 32/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /Phoenix/i);
});
