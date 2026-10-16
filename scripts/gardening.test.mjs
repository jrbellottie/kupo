import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: ["src/utils/gardening.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { GARDENING, GARDEN_ROWS, DEFAULT_GARDEN_FILTERS, gardenSeed, crystalName, gardenTiming, gardenHarvest, gardenBaseStrength, gardenOutcomes, filterGardenRows, gardenDuration, gardenDurationRange, gardenQuantity, createGardeningTimer } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const timerBundle = buildSync({ entryPoints: ["src/utils/gardeningTimers.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { gardeningEvents, nextGardeningEvent, advanceGardeningTimer, recordGardeningFeed } = await import(`data:text/javascript;base64,${Buffer.from(timerBundle.outputFiles[0].text).toString("base64")}`);
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
  assert.match(shell, /activeTab === "gardening"[\s\S]*?<GardeningTab[^\n]+onSetTimer=\{addGardeningTimer\} onRecordFeed=\{recordGardenFeed\}/);
  assert.match(shell, /React\.lazy\(\(\) => import\("\.\/GardeningTab"\)\)/);
  assert.match(readFileSync("src/ScreenControls.tsx", "utf8"), /COLLAPSIBLE_SCOPES.*"gardening"/);
});

test("every recipe creates one timer with exact source-duration window and harvest estimates", () => {
  const planted = Date.parse("2026-10-01T12:00:00Z");
  const dayMs = GARDENING.daySeconds * 1000;
  for (const entry of GARDENING.recipes) {
    const timing = gardenTiming(entry);
    const timer = createGardeningTimer(entry, planted, planted, "Test pot");
    assert.equal(timer.kind, "GARDENING");
    assert.equal(timer.label, "Test pot");
    assert.equal(timer.recipeId, entry.id);
    assert.deepEqual(timer.notifiedEvents, []);
    const events = gardeningEvents(timer);
    assert.equal(events.length, timing.windows.length * 2 + 1);
    assert.equal(events.at(-1).id, "harvest", entry.id);
    for (const [index, window] of timing.windows.entries()) {
      const open = events.find(event => event.id === `feed-${index + 1}-open`);
      const close = events.find(event => event.id === `feed-${index + 1}-close`);
      assert.equal(open.earliestAtMs, planted + window.earliest * dayMs);
      assert.equal(open.atMs, planted + window.latest * dayMs);
      assert.equal(close.atMs, open.atMs + window.duration * dayMs);
      assert.equal(close.earliestAtMs, open.earliestAtMs + window.duration * dayMs);
    }
    assert.equal(events.at(-1).earliestAtMs, planted + timing.minDays * dayMs);
    assert.equal(events.at(-1).atMs, planted + timing.maxDays * dayMs);
    assert.deepEqual(gardeningEvents(JSON.parse(JSON.stringify(timer))), events);
  }
  for (const invalid of [NaN, Infinity, -1, planted + 1]) {
    assert.throws(() => createGardeningTimer(recipe("2:1:-"), invalid, planted), /planting time/);
  }
});

test("one timer rolls through all milestones exactly once, catches up after sleep, and stops at harvest", () => {
  const original = createGardeningTimer(recipe("7:1:1"), 1000, 1000);
  const events = gardeningEvents(original);
  let timer = original;
  for (const event of events) {
    assert.equal(nextGardeningEvent(timer).id, event.id);
    assert.equal(advanceGardeningTimer(timer, event.atMs - 1).timer, timer);
    const advanced = advanceGardeningTimer(timer, event.atMs);
    assert.equal(advanced.event.id, event.id);
    timer = JSON.parse(JSON.stringify(advanced.timer));
    assert.equal(advanceGardeningTimer(timer, event.atMs + 1).event, undefined);
  }
  assert.equal(timer.enabled, false);
  assert.equal(nextGardeningEvent(timer), undefined);
  assert.deepEqual(original.notifiedEvents, [], "rollover does not mutate a saved snapshot");
  const caughtUp = advanceGardeningTimer(original, events[2].atMs + 1);
  assert.equal(caughtUp.event.id, events[2].id, "only the newest missed event is notified");
  assert.deepEqual(caughtUp.timer.notifiedEvents, events.slice(0, 3).map(event => event.id));
  const disabled = { ...original, enabled: false };
  assert.equal(advanceGardeningTimer(disabled, events.at(-1).atMs).timer, disabled);
  const oldPlanting = createGardeningTimer(recipe("7:1:1"), 1000, events[2].atMs + 1);
  assert.equal(nextGardeningEvent(oldPlanting).id, events[3].id, "new timers skip past feeding events");
});

test("optional actual feeding times shift later windows, cancel closing alerts, and narrow harvest estimates", () => {
  const day = GARDENING.daySeconds * 1000;
  const planted = 1000;
  const original = createGardeningTimer(recipe("7:1:1"), planted, planted);
  const firstAt = planted + 224 * day;
  const first = recordGardeningFeed(original, 0, firstAt, firstAt);
  const events = gardeningEvents(first);
  assert.equal(events.length, 3, "recorded feeding no longer needs open or close reminders");
  assert.equal(events[0].id, "feed-2-open");
  assert.equal(events[0].atMs, planted + 364 * day);
  assert.equal(events[0].earliestAtMs, events[0].atMs);
  assert.equal(events.at(-1).earliestAtMs, planted + 536 * day);
  assert.equal(events.at(-1).atMs, planted + 622 * day);
  const secondAt = planted + 400 * day;
  const second = recordGardeningFeed(first, 1, secondAt, secondAt);
  const harvest = gardeningEvents(second);
  assert.equal(harvest.length, 1);
  assert.equal(harvest[0].atMs, planted + 572 * day);
  assert.equal(harvest[0].earliestAtMs, harvest[0].atMs);
  assert.equal(original.feeds[0].fedAtMs, null);
  const restored = recordGardeningFeed(first, 0, null, firstAt);
  assert.deepEqual(gardeningEvents(restored), gardeningEvents(original));
  assert.equal(nextGardeningEvent(restored).id, "feed-1-close", "clearing a record does not re-alert for its old opening");
});

test("feeding records allow real delayed stage updates but reject impossible times and skipped feeds", () => {
  const day = GARDENING.daySeconds * 1000;
  const original = createGardeningTimer(recipe("7:1:1"), 1000, 1000);
  const lateAt = 1000 + 700 * day;
  const finished = advanceGardeningTimer(original, lateAt).timer;
  const delayed = recordGardeningFeed(finished, 0, lateAt, lateAt);
  assert.equal(delayed.enabled, true, "a later observed feeding reopens a completed estimated schedule");
  assert.ok(nextGardeningEvent(delayed).atMs > lateAt);
  const disabled = recordGardeningFeed({ ...original, enabled: false }, 0, lateAt, lateAt);
  assert.equal(disabled.enabled, false, "manual disable remains respected");
  for (const invalid of [NaN, Infinity, 999, lateAt + 1]) {
    assert.throws(() => recordGardeningFeed(original, 0, invalid, lateAt), /actual feeding time/);
  }
  assert.throws(() => recordGardeningFeed(original, 0, 1000 + 183 * day, lateAt), /earliest possible/);
  assert.throws(() => recordGardeningFeed(original, 2, lateAt, lateAt), /does not call/);
  assert.throws(() => recordGardeningFeed(createGardeningTimer(recipe("7:0:0"), 1000, 1000), 0, lateAt, lateAt), /does not call/);
  assert.throws(() => recordGardeningFeed(original, 0, lateAt, NaN), /current time/);
});

test("recipe button creates one saved timer and optional Fed now updates its remaining countdown", t => {
  const { outputFiles } = buildSync({
    stdin: { contents: `
      export { default as Gardening } from "./src/GardeningTab";
      export { default as Details } from "./src/GardeningTimerDetails";
    `, resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", external: ["react", "./utils/tabNav"],
    loader: { ".css": "empty" },
  });
  const require = createRequire(import.meta.url);
  const React = require("react");
  const module = { exports: {} };
  let states = [];
  let stateIndex = 0;
  const restored = { filters: { ...DEFAULT_GARDEN_FILTERS }, page: 0, selected: "7:1:1" };
  const now = Date.parse("2026-10-07T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  new Function("require", "module", "exports", outputFiles[0].text)(
    name => name === "react" ? {
      ...React, useEffect: () => {}, useMemo: compute => compute(),
      useState: initial => {
        const index = stateIndex++;
        if (index >= states.length) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
    } : name === "./utils/tabNav" ? {
      peekRestoredTabState: () => restored, rememberTabState: () => {},
    } : require(name), module, module.exports,
  );
  const find = (element, predicate) => {
    if (!React.isValidElement(element)) return undefined;
    if (predicate(element)) return element;
    return React.Children.toArray(element.props.children).map(child => find(child, predicate)).find(Boolean);
  };
  const created = [];
  const tab = module.exports.Gardening({ onSetTimer: timer => created.push(timer), nowMs: now });
  const selected = find(tab, element => element.props.recipe?.id === restored.selected);
  assert.ok(selected);
  states = [];
  stateIndex = 0;
  let detail = selected.type(selected.props);
  const button = find(detail, element => element.type === "button" && element.props.children === "Set gardening timer");
  assert.ok(button);
  button.props.onClick();
  assert.equal(created.length, 1);
  assert.equal(created[0].plantedAtMs, now);
  assert.equal(created[0].feeds.length, 2);
  assert.equal(created[0].notifiedEvents.length, 0);
  stateIndex = 0;
  detail = selected.type(selected.props);
  assert.ok(find(detail, element => element.type === "button" && element.props.children === "Timer added" && element.props.disabled));
  assert.ok(find(detail, element => element.props.role === "status"));

  const day = GARDENING.daySeconds * 1000;
  let timer = createGardeningTimer(recipe("7:1:1"), now - 224 * day, now);
  const calls = [];
  const onRecordFeed = (id, index, atMs) => {
    calls.push([id, index, atMs]);
    timer = recordGardeningFeed(timer, index, atMs, now);
  };
  states = [];
  stateIndex = 0;
  const current = module.exports.Details({ timer, nowMs: now, onRecordFeed });
  find(current, element => element.type === "button" && React.Children.toArray(element.props.children).join("") === "Fed 1 now").props.onClick();
  assert.deepEqual(calls, [[timer.id, 0, now]]);
  assert.equal(nextGardeningEvent(timer).id, "feed-2-open");
  stateIndex = 0;
  const updated = module.exports.Details({ timer, nowMs: now, onRecordFeed });
  assert.ok(find(updated, element => element.props.role === "status"));
  assert.ok(find(updated, element => element.type === "button" && React.Children.toArray(element.props.children).join("") === "Clear feed 1"));
  assert.ok(find(updated, element => element.type === "strong" && typeof element.props.children === "string" && element.props.children.startsWith("Feed 2 opens:")));
});

test("saved gardening cards render estimates, skipped feeds, future events and completed schedules", () => {
  const { outputFiles } = buildSync({
    stdin: { contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import Gardening from "./src/GardeningTab";
      export const render = (timers, nowMs) => renderToStaticMarkup(<Gardening timers={timers} nowMs={nowMs} onRecordFeed={() => {}} />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const timer = createGardeningTimer(recipe("7:0:1"), 1000, 1000, "Saplings pot");
  const html = module.exports.render([timer], 1000);
  assert.match(html, /Saved gardening timers/);
  assert.match(html, /Saplings pot/);
  assert.match(html, /Feed 1 opens: No crystal \(skip this feeding\)/);
  assert.match(html, /Feed 2 opens: Fire Crystal/);
  assert.match(html, /Harvest readiness/);
  assert.match(html, /could be as early as/);
  assert.match(html, /assume feeding near the end of each window/);
  assert.doesNotMatch(html, /Fed 1 now/);
  assert.match(html, /Fed 2 now/);
  const finishedAt = gardeningEvents(timer).at(-1).atMs;
  const finished = advanceGardeningTimer(timer, finishedAt).timer;
  assert.match(module.exports.render([finished], finishedAt), /Estimated schedule finished/);
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
  assert.match(html, /Pot choice, weekday, moon phase and room aura do not modify results/);
  assert.match(html, /Additional source types - availability unverified/);
  assert.doesNotMatch(html, /Try a harvest:|gardening-examples|Pot compatibility:|all listed recipes work with every source-classified planting pot/);
  assert.doesNotMatch(html, />(?:Vomp Carrot|Zegham Carrot|Fire Ore|Tree Saplings)<\/button>/);
  assert.match(html, /stored at planting|hidden integer roll from 0 through 32/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /Phoenix/i);
});
