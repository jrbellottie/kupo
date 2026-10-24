import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { outputFiles } = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/printing.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { printingChances, printingEstimate, restorePrintSettings, DEFAULT_PRINT_SETTINGS } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const recipe = { id: 1, craft: "Woodworking", lvl: 20, crystal: "Wind", era: "", ing: [{ n: "Elm Log", q: 2 }], res: { n: "Output", q: 1 }, hq: [{ n: "Output", q: 2 }, { n: "Output", q: 3 }, { n: "Output", q: 4 }] };
const settings = { ...DEFAULT_PRINT_SETTINGS, lossMode: "fixed", lossPct: 100, skills: { Woodworking: 71 } };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const chainBundle = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/printingChain.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { createPrintingChain, chainTierCosts, chainBatchAllocation } = await import(`data:text/javascript;base64,${Buffer.from(chainBundle.outputFiles[0].text).toString("base64")}`);
const key = (name) => name.toLowerCase();
const plannerBundle = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/printingPlanner.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { createPrintingPlanner } = await import(`data:text/javascript;base64,${Buffer.from(plannerBundle.outputFiles[0].text).toString("base64")}`);
const tiersBundle = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/printingTiers.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { reachablePrintTiers, printTierComparisons, selectPrintTier } = await import(`data:text/javascript;base64,${Buffer.from(tiersBundle.outputFiles[0].text).toString("base64")}`);
const lumber = { ...recipe, id: 20, lvl: 1, ing: [{ n: "Log", q: 1 }], res: { n: "Lumber", q: 1 }, hq: [2, 3, 4].map((q) => ({ n: "Lumber", q })) };
const pole = { ...recipe, id: 21, lvl: 60, ing: [{ n: "Lumber", q: 2 }], res: { n: "Pole", q: 1 }, hq: [1, 1, 1].map((q) => ({ n: "Pole", q })) };

test("HQ selection uses best gil/hour within 106, honors manual tiers, and refreshes after repricing", () => {
  for (const [cap, expected] of [[19, [0, 1, 2, 3]], [55, [0, 1, 2, 3]], [56, [0, 1, 2]], [75, [0, 1, 2]], [76, [0, 1]], [95, [0, 1]], [96, [0]], [106, [0]], [107, []]]) {
    assert.deepEqual(reachablePrintTiers({ ...recipe, lvl: cap }), expected);
  }
  assert.deepEqual(reachablePrintTiers({ ...recipe, subs: [{ c: "Alchemy", l: 96 }] }), [0]);
  const target = { ...recipe, lvl: 19, hq: [2, 3, 4].map((q) => ({ n: "HQ Output", q })) };
  const chain = createPrintingChain([target], restorePrintSettings({ skillMode: "at-cap" }), () => 10, () => 100, key);
  const rows = printTierComparisons(chain, target);
  assert.strictEqual(printTierComparisons(chain, target), rows);
  assert.equal(selectPrintTier(rows).tier, 3);
  assert.strictEqual(selectPrintTier(rows, 1), rows[1]);
  assert.equal(selectPrintTier(rows, 99).tier, 3);
  const cheaperHQ = chain.reprice(() => 10, (name) => name === "HQ Output" ? 0 : 100, [], [key("HQ Output")]);
  const updated = printTierComparisons(cheaperHQ, target);
  assert.equal(selectPrintTier(updated).tier, 0, "Best gil/hour is not necessarily highest HQ tier");
  assert.equal(selectPrintTier(updated, 2).tier, 2, "Manual selection survives price changes");
  assert.equal(selectPrintTier(rows.map((row) => ({ ...row, gilPerHour: -100 - row.tier }))).tier, 0);
  assert.equal(selectPrintTier(rows.map((row) => ({ ...row, gilPerHour: null }))).tier, 0);
  assert.equal(selectPrintTier([]), undefined);
});

test("default break loss is 50%, old defaults migrate once, and custom overrides survive", () => {
  assert.equal(DEFAULT_PRINT_SETTINGS.lossPct, 50);
  assert.equal(restorePrintSettings().lossPct, 50);
  assert.equal(restorePrintSettings({ lossPct: 100 }).lossPct, 50);
  for (const lossPct of [0, 30, 50, 75]) assert.equal(restorePrintSettings({ lossPct }).lossPct, lossPct);
  const migrated = restorePrintSettings({ lossPct: 100, overhead: 10 });
  assert.equal(migrated.overhead, 10);
  assert.equal(restorePrintSettings({ ...migrated, lossPct: 100 }).lossPct, 100);
  const result = printingEstimate(recipe, restorePrintSettings({ skillMode: "at-cap" }), (name) => name === "Wind Crystal" ? 100 : 3000, () => 5000);
  close(result.success, 0.95);
  close(result.consumption, 0.975);
  close(result.cost, 6000 * 0.975 + 100);
  const chain = createPrintingChain([lumber, pole], restorePrintSettings({ skillMode: "at-cap" }), () => 100, () => 1000, key);
  const chained = chain.estimate(pole);
  close(chained.sources[0].quantity, 2 * 0.975);
  close(chained.sources[0].node.children.find((child) => child.node.name === "Log").quantity, 0.975);
});

test("planner retains estimates across remounts while refreshing changed prices and assumptions", () => {
  const recipes = [lumber, pole, { ...pole, id: 30, era: "WotG" }, { ...pole, id: 31, ki: true }];
  let priceReads = 0;
  const planner = createPrintingPlanner(recipes, key, (name, book, vendors, modernGuilds) => {
    priceReads++;
    return book[key(name)] ?? (vendors ? modernGuilds ? 5 : 10 : null);
  }, (name, book) => book[key(name)] ?? 1000);
  const state = { settings, buy: {}, sell: {}, sources: {}, vendors: true, modernGuilds: false, wotg: false, keyItems: false };
  const first = planner(state);
  const result = first.chain.estimate(pole);
  const reads = priceReads;
  const restored = planner(JSON.parse(JSON.stringify(state)));
  assert.strictEqual(restored, first);
  assert.strictEqual(restored.chain.estimate(pole), result);
  assert.equal(priceReads, reads, "Returning with deserialized settings must not recalculate prices");
  assert.strictEqual(planner({ ...state, query: "Lumber", selected: 21, sort: "profit" }), first);
  const edited = { ...state, buy: { log: 500 } };
  const repriced = planner(edited);
  assert.strictEqual(repriced.available, first.available);
  assert.notStrictEqual(repriced.chain.estimate(pole), result);
  assert.strictEqual(planner(JSON.parse(JSON.stringify(edited))), repriced);
  assert.deepEqual(planner(state).chain.estimate(pole), result, "Restoring an older navigation state resets the price");
  for (const patch of [{ settings: { ...settings, lossPct: 50 } }, { sources: { lumber: "buy" } }, { vendors: false }, { modernGuilds: true }, { wotg: true }, { keyItems: true }]) {
    const baseline = planner(state);
    const updated = planner({ ...state, ...patch });
    assert.notStrictEqual(updated.chain, baseline.chain);
    assert.strictEqual(planner(JSON.parse(JSON.stringify({ ...state, ...patch }))), updated);
    assert.equal(updated.available.length, patch.wotg || patch.keyItems ? 3 : 2);
  }
});

test("cost overrides replace branches, preserve source choices and reprice without double counting", () => {
  const planner = createPrintingPlanner([lumber, pole], key, (name, book) => book[key(name)] ?? null, () => 2000);
  const state = { settings, buy: { log: 100, "wind crystal": 10 }, sell: {}, sources: { lumber: 20 },
    costOverrides: {}, vendors: false, modernGuilds: false, wotg: false, keyItems: false };
  const crafted = planner(state).chain.estimate(pole);
  assert.equal(crafted.sources[0].node.recipe.id, 20);
  for (const price of [350, 125.5, 0]) {
    const saved = JSON.parse(JSON.stringify({ ...state, costOverrides: { lumber: price } }));
    const result = planner(saved).chain.estimate(pole);
    assert.equal(result.sources[0].node.recipe, undefined);
    assert.deepEqual(result.sources[0].node.children, []);
    assert.equal(result.sources[0].node.price, price);
    close(result.cost, 2 * price + 10);
    assert.equal(result.totalAttempts, 1);
    assert.deepEqual(result.leaves.map((leaf) => leaf.name), ["Lumber", "Wind Crystal"]);
    const changedUnusedInput = planner({ ...saved, buy: { ...saved.buy, log: 9999 } }).chain.estimate(pole);
    assert.strictEqual(changedUnusedInput, result, "overridden branch ingredients must not affect cost or time");
    const fresh = createPrintingPlanner([lumber, pole], key, (name, book) => book[key(name)] ?? null, () => 2000);
    assert.deepEqual(fresh(saved).chain.estimate(pole), result, "overrides survive reopening");
  }
  assert.deepEqual(planner(state).chain.estimate(pole), crafted, "clearing restores original recipe, prices and crafting time");
  assert.deepEqual(state.sources, { lumber: 20 });
  const missing = planner({ ...state, buy: { "wind crystal": 10 } }).chain.estimate(pole);
  assert.equal(missing.cost, null);
  const covered = planner({ ...state, buy: { "wind crystal": 10 }, costOverrides: { lumber: 50 } }).chain.estimate(pole);
  close(covered.cost, 110);
  const raw = planner({ ...state, costOverrides: { log: 0 } }).chain.estimate(pole);
  assert.equal(raw.sources[0].node.recipe.id, 20);
  close(raw.sources[0].node.price, 10 / raw.sources[0].node.yield);
  for (const price of [-1, NaN, Infinity, "100"]) {
    assert.throws(() => planner({ ...state, costOverrides: { lumber: price } }), /Invalid cost override/);
  }
});

test("at-cap planning ignores saved skills throughout the chain and preserves HQ breakpoints", () => {
  const baseline = { ...DEFAULT_PRINT_SETTINGS, skillMode: "at-cap" };
  const stale = { ...baseline, skills: { Woodworking: 110, Alchemy: 0 }, bonuses: { Woodworking: 30 } };
  const target = { ...pole, subs: [{ c: "Alchemy", l: 50 }] };
  const engine = (config) => createPrintingChain([lumber, target], config, () => 10, () => 100, key);
  const chain = engine(baseline);
  const result = chain.estimate(target);
  assert.deepEqual(engine(stale).estimate(target), result);
  assert.equal(result.eligible, true);
  assert.equal(result.tier, 0);
  assert.equal(result.sources[0].node.tier, 0);
  close(result.success, 0.95 ** 2);
  assert.deepEqual(result.requirements.map((requirement) => requirement.gap), [0, 0]);
  for (const [tier, gap] of [0, 11, 31, 51].entries()) {
    const comparison = chain.estimate(target, tier);
    assert.equal(comparison.tier, tier);
    assert.deepEqual(comparison.requirements.map((requirement) => requirement.gap), [gap, gap]);
    assert.deepEqual(comparison.sources, result.sources);
  }
  const costs = chainTierCosts(result.sources[0].node, baseline, key);
  assert.ok(costs[3].price < costs[0].price);
});

test("repricing reuses unrelated estimates and matches a fresh chain, including alternative sources", () => {
  const alternate = { ...lumber, id: 22, ing: [{ n: "Other Log", q: 1 }] };
  const unrelated = { ...pole, id: 23, ing: [{ n: "Ore", q: 1 }], res: { n: "Ingot", q: 1 }, hq: [] };
  const recipes = [lumber, alternate, pole, unrelated];
  const prices = { log: 100, "other log": 200, ore: 10, "wind crystal": 1 };
  const buy = (name) => prices[key(name)] ?? null;
  const chain = createPrintingChain(recipes, settings, buy, () => 1000, key);
  const original = chain.estimate(pole);
  const untouched = chain.estimate(unrelated);
  assert.strictEqual(chain.estimate(pole), original);
  assert.equal(original.sources[0].node.recipe.id, lumber.id);
  const cheaper = (name) => key(name) === "other log" ? 20 : buy(name);
  const repriced = chain.reprice(cheaper, () => 1000, [key("Other Log")], []);
  assert.strictEqual(repriced.estimate(unrelated), untouched);
  assert.notStrictEqual(repriced.estimate(pole), original);
  assert.equal(repriced.estimate(pole).sources[0].node.recipe.id, alternate.id);
  const fresh = createPrintingChain(recipes, settings, cheaper, () => 1000, key);
  for (const target of recipes) for (const tier of [undefined, 0, 1, 2, 3]) assert.deepEqual(repriced.estimate(target, tier), fresh.estimate(target, tier));
  assert.strictEqual(chain.estimate(pole), original);
  const sale = (name) => name === "Pole" ? 2000 : 1000;
  const resold = repriced.reprice(cheaper, sale, [], [key("Pole")]);
  assert.strictEqual(resold.estimate(unrelated), untouched);
  assert.strictEqual(resold.estimate(pole).sources[0].node, repriced.estimate(pole).sources[0].node);
  assert.deepEqual(resold.estimate(pole), createPrintingChain(recipes, settings, cheaper, sale, key).estimate(pole));
});

test("upstream lumber HQ makes poles profitable and adds every upstream attempt to time", () => {
  const prices = { log: 1000, lumber: 1100, "wind crystal": 10 };
  const chain = createPrintingChain([lumber, pole], settings, (name) => prices[key(name)] ?? null, () => 1800, key);
  const result = chain.estimate(pole);
  const output = 0.95 * (0.5 + 0.375 * 2 + 0.09375 * 3 + 0.03125 * 4);
  close(result.sources[0].node.yield, output);
  close(result.sources[0].node.price, 1010 / output);
  assert.ok(result.directProfit < 0);
  assert.ok(result.profit > 0);
  close(result.totalAttempts, 1 + 2 / output);
  close(result.gilPerHour, result.profit * 3600 / (21 * (1 + 2 / output)));
  const tiers = chainTierCosts(result.sources[0].node, settings, key);
  assert.ok(tiers[3].price < tiers[0].price);
  const ceiling = result.rawCeilings.find((leaf) => leaf.name === "Log").maximum;
  const fixed = createPrintingChain([lumber, pole], settings, (name) => key(name) === "log" ? ceiling : prices[key(name)] ?? null, () => 1800, key, { lumber: 20 });
  close(fixed.estimate(pole).profit, 0);
});

test("unknown raw costs preserve a craft chain and propagate a usable log ceiling", () => {
  const parchment = { ...lumber, id: 22, res: { n: "Parchment", q: 12 }, hq: [12, 12, 12].map((q) => ({ n: "Parchment", q })) };
  const shihei = { ...pole, id: 23, ing: [{ n: "Parchment", q: 2 }] };
  const chain = createPrintingChain([parchment, shihei], settings, (name) => name === "Wind Crystal" ? 10 : null, () => 1800, key);
  const result = chain.estimate(shihei);
  assert.equal(result.profit, null);
  close(result.sources[0].node.yield, 0.95 * 12);
  assert.ok(result.rawCeilings.find((leaf) => leaf.name === "Log").maximum > 0);
  assert.equal(result.leaves.filter((leaf) => leaf.name === "Wind Crystal").length, 1);
  close(result.leaves.find((leaf) => leaf.name === "Wind Crystal").quantity, 1 + 2 / (0.95 * 12));
  const yields = chainTierCosts(result.sources[0].node, settings, key).map((tier) => tier.yield);
  assert.ok(yields.every((value) => Math.abs(value - yields[0]) < 1e-8));
});

test("source choices, unavailable recipes and circular chains never invent free inputs", () => {
  const prices = (name) => name === "Lumber" ? 500 : name === "Wind Crystal" ? 10 : 1000;
  assert.equal(createPrintingChain([lumber], settings, prices, () => 0, key).resolve("Lumber").recipe.id, 20);
  assert.equal(createPrintingChain([lumber], settings, prices, () => 0, key, { lumber: 20 }).resolve("Lumber").recipe.id, 20);
  assert.equal(createPrintingChain([lumber], settings, prices, () => 0, key, { lumber: "buy" }).resolve("Lumber").price, 500);
  const locked = createPrintingChain([lumber], { ...settings, skills: {} }, prices, () => 0, key, { lumber: 999 }).resolve("Lumber");
  assert.equal(locked.price, null);
  assert.ok(locked.issue);
  const reverse = { ...lumber, id: 24, ing: [{ n: "Lumber", q: 1 }], res: { n: "Log", q: 1 }, hq: [] };
  const cycle = createPrintingChain([lumber, reverse, pole], settings, () => null, () => 1800, key, { lumber: 20, log: 24 }).estimate(pole);
  assert.equal(cycle.profit, null);
  assert.equal(cycle.eligible, false);
  assert.ok(cycle.issues.some((issue) => issue.startsWith("Circular ingredient chain")));
});

test("HQ-only ingredients count only matching output and multiple stages preserve costs", () => {
  const different = { ...lumber, res: { n: "Other Lumber", q: 1 }, hq: [1, 1, 1].map((q) => ({ n: "Lumber", q })) };
  const chain = createPrintingChain([different, pole], settings, (name) => name === "Wind Crystal" ? 10 : name === "Log" ? 1000 : null, () => 1800, key);
  close(chain.resolve("Lumber").yield, 0.95 * 0.5);
  close(chain.resolve("Lumber").price, 1010 / (0.95 * 0.5));
  const final = { ...pole, id: 25, ing: [{ n: "Pole", q: 2 }], res: { n: "Final", q: 1 }, hq: [] };
  const result = createPrintingChain([lumber, pole, final], settings, (name) => name === "Wind Crystal" ? 10 : name === "Log" ? 1000 : null, () => 1800, key).estimate(final);
  assert.ok(result.totalAttempts > 4);
  close(result.cost, result.leaves.reduce((total, leaf) => total + leaf.quantity * leaf.price, 0));
});

test("no-loss ingredient synths preserve materials, never crystals; buy-only matches the original model", () => {
  const prices = (name) => name === "Wind Crystal" ? 10 : name === "Log" ? 1000 : 1100;
  const noLoss = { ...lumber, d: 2 };
  const chain = createPrintingChain([noLoss, pole], settings, prices, () => 1800, key, { lumber: 20 });
  const result = chain.estimate(pole);
  const output = chain.expectedYield(noLoss, "Lumber");
  close(result.cost, 2 * (1000 * 0.95 + 10) / output + 10);
  close(result.leaves.find((leaf) => leaf.name === "Wind Crystal").quantity, 1 + 2 / output);
  const bought = createPrintingChain([lumber, pole], settings, prices, () => 1800, key, { lumber: "buy" }).estimate(pole);
  const direct = printingEstimate(pole, settings, prices, () => 1800);
  close(bought.profit, direct.profit);
  close(bought.gilPerHour, direct.gilPerHour);
  assert.equal(bought.totalAttempts, 1);
});

test("forced under-skilled and over-depth ingredient recipes remain unresolved", () => {
  const locked = { ...lumber, lvl: 100 };
  const result = createPrintingChain([locked, pole], { ...settings, skills: { Woodworking: 60 } }, () => 10, () => 1800, key, { lumber: 20 }).estimate(pole);
  assert.equal(result.eligible, false);
  assert.equal(result.profit, null);
  const stages = Array.from({ length: 34 }, (_, index) => ({ ...lumber, id: 100 + index, ing: [{ n: `Stage${index + 1}`, q: 1 }], res: { n: `Stage${index}`, q: 1 }, hq: [] }));
  const choices = Object.fromEntries(stages.map((stage) => [key(stage.res.n), stage.id]));
  const deep = createPrintingChain(stages, settings, () => 10, () => 0, key, choices).resolve("Stage0");
  assert.equal(deep.price, null);
  assert.match(deep.issue, /More than 32/);
});

test("Auto expands craftable ingredients despite cheaper known buy prices or missing raw costs", () => {
  const chain = createPrintingChain([lumber, pole], settings, (name) => name === "Lumber" ? 1 : name === "Wind Crystal" ? 10 : null, () => 1800, key);
  const result = chain.estimate(pole);
  assert.equal(result.sources[0].node.recipe.id, 20);
  assert.ok(result.leaves.some((leaf) => leaf.name === "Log" && leaf.price === null));
  assert.equal(result.profit, null);
  const locked = createPrintingChain([{ ...lumber, lvl: 100 }, pole], { ...settings, skills: { Woodworking: 60 } }, () => 1, () => 1800, key).estimate(pole);
  assert.equal(locked.sources[0].node.recipe.id, 20);
  assert.ok(locked.sources[0].node.children.some((child) => child.node.name === "Log"));
  assert.equal(locked.eligible, false);
  assert.equal(locked.profit, null);
});

test("12-output parchment allocates only two units of a 4000-gil log batch to Shihei", () => {
  const parchment = { ...lumber, id: 22, res: { n: "Parchment", q: 12 }, hq: [12, 12, 12].map((q) => ({ n: "Parchment", q })), ing: [{ n: "Elm Log", q: 1 }, { n: "Moko Grass", q: 1 }, { n: "Distilled Water", q: 1 }] };
  const shihei = { ...pole, id: 23, ing: [{ n: "Parchment", q: 2 }] };
  const prices = (name) => name === "Elm Log" ? 4000 : 0;
  const result = createPrintingChain([parchment, shihei], settings, prices, () => 1800, key).estimate(shihei);
  close(result.sources[0].node.price, 4000 / (12 * 0.95));
  close(result.cost, 4000 * 2 / (12 * 0.95));
  close(result.leaves.find((leaf) => leaf.name === "Elm Log").quantity, 2 / (12 * 0.95));
  assert.equal(result.sources[0].node.children.find((child) => child.node.name === "Elm Log").recipeQuantity, 1);
  const allocation = chainBatchAllocation(result.sources[0].node, 2, key);
  assert.equal(allocation.output, 12);
  assert.equal(allocation.parentQuantity, 2);
  close(allocation.inputs.find((input) => input.name === "Elm Log").allocatedCost, 666.6666666666666);
});

test("HQ boundaries, below-cap eligibility, and fractional skill truncation", () => {
  for (const [skill, tier] of [[19, -1], [20, 0], [30.9, 0], [31, 1], [50, 1], [51, 2], [70, 2], [71, 3]]) {
    const result = printingChances(recipe, { ...settings, skills: { Woodworking: skill } });
    assert.equal(result.tier, tier);
    close(result.distribution.reduce((total, value) => total + value, 0), 1);
  }
  assert.equal(printingChances(recipe, { ...settings, skills: { Woodworking: 4 } }).eligible, false);
  assert.equal(printingChances(recipe, { ...settings, skills: { Woodworking: 5 } }).eligible, true);
  assert.equal(printingChances(recipe, { ...settings, skills: { Woodworking: 5 }, successBonus: 5 }).success, 0);
});
test("subcraft limits HQ and rolls its own break chance; bonuses affect tiers", () => {
  const sub = { ...recipe, subs: [{ c: "Alchemy", l: 10 }] };
  const result = printingChances(sub, { ...settings, skills: { Woodworking: 71, Alchemy: 20 } });
  assert.equal(result.tier, 0);
  close(result.success, 0.95 * 0.95);
  assert.equal(printingChances(sub, { ...settings, skills: { Woodworking: 71, Alchemy: 20 }, bonuses: { Alchemy: 1 } }).tier, 1);
});
test("HQ upgrades use tier-specific NQ/HQ1/HQ2/HQ3 weights", () => {
  assert.deepEqual(printingChances(recipe, settings).distribution, [0.5, 0.375, 0.09375, 0.03125]);
  assert.deepEqual(printingChances(recipe, settings, 1).distribution, [0.9375, 0.046875, 0.015625, 0]);
});
test("profit includes crystal, quantities, breaks, and hourly cycle; ceiling is break-even", () => {
  const result = printingEstimate(recipe, settings, (name) => name === "Wind Crystal" ? 100 : 3000, () => 5000);
  close(result.revenue, 0.95 * 5000 * (0.5 + 0.375 * 2 + 0.09375 * 3 + 0.03125 * 4));
  close(result.cost, 6100);
  close(result.gilPerHour, result.profit * 3600 / 21);
  const limit = result.ceilings[0].maximum;
  close(printingEstimate(recipe, settings, (name) => name === "Wind Crystal" ? 100 : limit, () => 5000).profit, 0);
});
test("unknown costs and sale values never become free or profitable guesses", () => {
  const missing = printingEstimate(recipe, settings, () => null, () => 5000);
  assert.equal(missing.profit, null);
  assert.equal(missing.materialBudget, null);
  assert.equal(printingEstimate(recipe, settings, () => 0, () => null).profit, null);
  assert.ok(printingEstimate(recipe, settings, () => 0, () => 5000).profit > 0);
  assert.equal(printingEstimate(recipe, settings, () => 1, () => 0).profit, -3);
});
test("break material salvage and no-loss recipes never refund crystals", () => {
  const result = printingEstimate(recipe, { ...settings, lossPct: 50 }, (name) => name === "Wind Crystal" ? 100 : 3000, () => 5000);
  close(result.cost, 6000 * 0.975 + 100);
  close(printingEstimate({ ...recipe, d: 2 }, settings, (name) => name === "Wind Crystal" ? 100 : 3000, () => 5000).cost, 6000 * 0.95 + 100);
});

test("all named print examples are discoverable and material aliases share overrides", async () => {
  const { outputFiles } = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/printingData.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  const data = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
  for (const name of data.PRINT_EXAMPLES) {
    const recipe = data.PRINT_RECIPES.find((recipe) => recipe.res.n.toLowerCase() === name.toLowerCase());
    assert.ok(recipe, name);
    assert.notEqual(data.printSellPrice(recipe.res.n, {}), null);
    console.log(`${name}: cap ${recipe.lvl} ${recipe.craft}; NPC base sale ${data.printSellPrice(recipe.res.n, {})}; NQ/HQ quantities ${[recipe.res, ...recipe.hq].map((item) => item.q).join('/')}`);
  }
  assert.equal(data.printBuyPrice("Elm Log", { [data.printItemKey("Elm Log")]: 3000 }), 3000);
  assert.equal(data.printBuyPrice("Flask of Distilled Water", { [data.printItemKey("Distilled Water")]: 0 }), 0);
  assert.equal(data.printBuyPrice("Unknown price item", {}), null);
  assert.equal(data.printBuyPrice("Distilled Water", {}, false), null);
  assert.ok(data.PRINT_RECIPES.every((recipe) => recipe.d !== 1));
  const noSale = data.PRINT_RECIPES.flatMap((recipe) => [recipe.res, ...recipe.hq]).find((item) => (data.printItem(item.n)?.flags ?? 0) & 0x1000);
  assert.ok(noSale);
  assert.equal(data.printSellPrice(noSale.n, {}), 0);
  assert.equal(data.printSellPrice(noSale.n, { [data.printItemKey(noSale.n)]: 20 }), 20);
  const available = data.PRINT_RECIPES.filter((recipe) => !recipe.ki && recipe.era !== "WotG");
  const skilled = { ...settings, skills: Object.fromEntries(["Woodworking", "Smithing", "Goldsmithing", "Clothcraft", "Leathercraft", "Bonecraft", "Alchemy", "Cooking"].map((craft) => [craft, 100])) };
  const chain = createPrintingChain(available, skilled, (name) => /Crystal$/.test(name) ? 100 : null, (name) => data.printSellPrice(name, {}), data.printItemKey);
  for (const [output, raw] of [["Shihei", "Elm Log"], ["Mahogany Pole", "Mahogany Log"]]) {
    const target = available.find((recipe) => recipe.res.n === output);
    const ingredient = output === "Shihei" ? "Bast Parchment" : "Mahogany Lumber";
    const choices = chain.options(ingredient);
    const selected = choices.find((recipe) => recipe.ing.some((input) => data.printItemKey(input.n) === data.printItemKey(raw)));
    assert.ok(selected, `${ingredient} has a ${raw} recipe`);
    const fixed = createPrintingChain(available, skilled, (name) => /Crystal$/.test(name) ? 100 : null, (name) => data.printSellPrice(name, {}), data.printItemKey, { [data.printItemKey(ingredient)]: selected.id });
    const result = fixed.estimate(target);
    assert.ok(result.leaves.some((leaf) => leaf.key === data.printItemKey(raw)), `${output} reaches ${raw}`);
    console.log(`${ingredient} recipe ${selected.id}: ${JSON.stringify({ ing: selected.ing, res: selected.res, hq: selected.hq })}`);
  }
  const mahoganyPole = available.find((recipe) => recipe.res.n === "Mahogany Pole");
  const mahoganyRecipe = chain.options("Mahogany Lumber").find((recipe) => recipe.ing.some((input) => input.n === "Mahogany Log"));
  const sourceChoice = { [data.printItemKey("Mahogany Lumber")]: mahoganyRecipe.id };
  const prices = { [data.printItemKey("Mahogany Log")]: 5000, [data.printItemKey("Mahogany Lumber")]: 8000, [data.printItemKey("Wind Crystal")]: 100 };
  const purchase = (name) => prices[data.printItemKey(name)] ?? null;
  const payout = (name) => data.printSellPrice(name, {});
  const lower = createPrintingChain(available, skilled, purchase, payout, data.printItemKey, sourceChoice).estimate(mahoganyPole);
  const higherSkills = { ...skilled, bonuses: { Woodworking: 2 } };
  const higher = createPrintingChain(available, higherSkills, purchase, payout, data.printItemKey, sourceChoice).estimate(mahoganyPole);
  assert.equal(lower.tier, higher.tier, "The final pole HQ tier does not change");
  assert.equal(lower.sources[0].node.tier, 2);
  assert.equal(higher.sources[0].node.tier, 3);
  assert.ok(lower.profit < 0 && higher.profit > 0, "Only the lumber HQ breakpoint turns the pole profitable");
  const logCeiling = higher.rawCeilings.find((leaf) => leaf.key === data.printItemKey("Mahogany Log")).maximum;
  const breakEvenBuy = (name) => data.printItemKey(name) === data.printItemKey("Mahogany Log") ? logCeiling : purchase(name);
  close(createPrintingChain(available, higherSkills, breakEvenBuy, payout, data.printItemKey, sourceChoice).estimate(mahoganyPole).profit, 0);
  const atCap = { ...DEFAULT_PRINT_SETTINGS, skillMode: "at-cap" };
  let buyBook = {};
  let sellBook = {};
  let incremental = createPrintingChain(available, atCap, (name) => data.printBuyPrice(name, buyBook), payout, data.printItemKey);
  let previousResults = available.map((target) => incremental.estimate(target));
  for (const [kind, name, value] of [["buy", "Elm Log", 4000], ["buy", "Wind Crystal", 100], ["sell", "Shihei", 100], ["buy", "Elm Log", null], ["sell", "Shihei", null]]) {
    const changedKey = data.printItemKey(name);
    const nextBook = { ...(kind === "buy" ? buyBook : sellBook) };
    if (value === null) delete nextBook[changedKey]; else nextBook[changedKey] = value;
    if (kind === "buy") buyBook = nextBook; else sellBook = nextBook;
    const currentBuy = buyBook;
    const currentSell = sellBook;
    const purchase = (item) => data.printBuyPrice(item, currentBuy);
    const sale = (item) => data.printSellPrice(item, currentSell);
    const updateStart = performance.now();
    incremental = incremental.reprice(purchase, sale, kind === "buy" ? [changedKey] : [], kind === "sell" ? [changedKey] : []);
    const results = available.map((target) => incremental.estimate(target));
    const updateMs = performance.now() - updateStart;
    const freshStart = performance.now();
    const fresh = createPrintingChain(available, atCap, purchase, sale, data.printItemKey);
    const expected = available.map((target) => fresh.estimate(target));
    const freshMs = performance.now() - freshStart;
    assert.deepEqual(results, expected, `${kind} ${name} ${value}: incremental results match full rebuild`);
    const reused = results.filter((result, index) => result === previousResults[index]).length;
    assert.ok(reused > 0 && reused < available.length, `${name}: only affected recipes recompute`);
    console.log(`Reprice ${kind} ${name}=${value}: ${reused}/${available.length} reused; ${Math.round(updateMs)}ms incremental vs ${Math.round(freshMs)}ms fresh`);
    previousResults = results;
  }
  const started = performance.now();
  let expanded = 0;
  const unexplainedStops = [];
  const inspect = (node, engine) => {
    if (node.recipe) {
      expanded++;
      const required = [...node.recipe.ing, { n: `${node.recipe.crystal} Crystal`, q: 1 }];
      assert.deepEqual(node.children.map((child) => [child.node.key, child.recipeQuantity]), required.map((input) => [data.printItemKey(input.n), input.q]), `All ingredients present for #${node.recipe.id}`);
      for (const child of node.children) inspect(child.node, engine);
    } else if (engine.options(node.name).length && !node.issue) unexplainedStops.push(node.name);
  };
  for (const target of available) {
    const result = chain.estimate(target);
    for (const source of result.sources) inspect(source.node, chain);
    assert.ok(Number.isFinite(result.totalAttempts) && result.totalAttempts >= 1);
    if (result.profit !== null) close(result.cost, result.leaves.reduce((total, leaf) => total + leaf.quantity * leaf.price, 0));
  }
  const allEngine = createPrintingChain(data.PRINT_RECIPES, skilled, () => 1, payout, data.printItemKey);
  for (const target of data.PRINT_RECIPES) for (const source of allEngine.estimate(target).sources) inspect(source.node, allEngine);
  assert.deepEqual(unexplainedStops, [], "Every craftable branch must expand or carry an explicit cycle/depth warning");
  const shiheiAuto = chain.estimate(available.find((recipe) => recipe.res.n === "Shihei"));
  const parchmentAuto = shiheiAuto.sources.find((source) => source.node.key === data.printItemKey("Bast Parchment")).node;
  assert.equal(parchmentAuto.recipe.id, 2015);
  const water = parchmentAuto.children.find((child) => child.node.key === data.printItemKey("Distilled Water")).node;
  assert.equal(water.recipe, undefined, "Distilled water is a terminal purchased ingredient");
  assert.deepEqual(water.children, []);
  assert.ok(!data.PRINT_MATERIALS.includes("Tahrongi Cactus"));
  const waterPrice = data.printBuyPrice("Distilled Water", {});
  const terminal = createPrintingChain(available, skilled, (name) => data.printBuyPrice(name, {}), payout, data.printItemKey, { [data.printItemKey("Distilled Water")]: 60004 });
  assert.deepEqual(terminal.options("Flask of Distilled Water"), []);
  assert.equal(terminal.resolve("Flask of Distilled Water").price, waterPrice);
  assert.equal(terminal.resolve("Flask of Distilled Water").issue, undefined);
  assert.equal(createPrintingChain(available, skilled, () => 17, payout, data.printItemKey).resolve("Distilled Water").price, 17);
  console.log(`Breakdown audit: ${data.PRINT_RECIPES.length} recipes (all eras/key items), ${expanded} expanded stages across both scopes, zero unexplained craftable stops in ${Math.round(performance.now() - started)}ms`);
});

test("Shihei exposes all nine Black Ink recipes and honors raw or intermediate cost overrides", async () => {
  const bundle = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/printingData.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  const data = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const inkKey = data.printItemKey("Jar of Black Ink");
  const inkRecipes = data.PRINT_RECIPES.filter((entry) => data.printItemKey(entry.res.n) === inkKey);
  assert.deepEqual(inkRecipes.map((entry) => entry.id), [60007, 60008, 60009, 60010, 60011, 60012, 60013, 60014, 60037]);
  const shihei = data.PRINT_RECIPES.find((entry) => entry.res.n === "Shihei");
  const recipes = [shihei, ...inkRecipes];
  const planner = createPrintingPlanner(recipes, data.printItemKey, data.printBuyPrice, data.printSellPrice);
  const state = { settings: restorePrintSettings({ skillMode: "at-cap" }), buy: {}, sell: {}, sources: {}, vendors: false, modernGuilds: false, wotg: false, keyItems: false };
  for (const entry of recipes) for (const input of [...entry.ing, { n: `${entry.crystal} Crystal` }]) state.buy[data.printItemKey(input.n)] = 10;
  const ink = (result) => result.sources.find((source) => source.node.key === inkKey).node;
  for (const entry of inkRecipes) {
    const plan = planner({ ...state, sources: { [inkKey]: entry.id } });
    assert.equal(plan.chain.options("Jar of Black Ink").length, 9);
    const result = plan.chain.estimate(shihei);
    assert.equal(ink(result).recipe.id, entry.id);
    assert.deepEqual(ink(result).children.map((child) => [child.node.key, child.recipeQuantity]),
      [...entry.ing, { n: `${entry.crystal} Crystal`, q: 1 }].map((input) => [data.printItemKey(input.n), input.q]));
    close(result.cost, result.leaves.reduce((total, leaf) => total + leaf.quantity * leaf.price, 0));
  }
  const chosen = { ...state, sources: { [inkKey]: 60037 }, costOverrides: { [data.printItemKey("Gigant Squid")]: 1800 } };
  const squid = planner(chosen).chain.estimate(shihei);
  const inkNode = ink(squid);
  close(inkNode.price, ((1800 + 2 * 10 + 10) * 0.975 + 10) / inkNode.yield);
  const override = planner({ ...chosen, costOverrides: { ...chosen.costOverrides, [inkKey]: 100 } }).chain.estimate(shihei);
  close(ink(override).price, 100);
  assert.equal(ink(override).recipe, undefined);
  assert.ok(!override.leaves.some((leaf) => leaf.key === data.printItemKey("Gigant Squid")));
  assert.ok(override.totalAttempts < squid.totalAttempts);
  assert.deepEqual(planner(chosen).chain.estimate(shihei), squid);
});

test("Profits renders recipe alternatives, nested groups and per-item/per-stack costs from saved state", () => {
  const require = createRequire(import.meta.url);
  const React = require("react");
  const storage = new Map();
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const bundle = buildSync({
    stdin: { contents: 'import React from "react"; import { renderToStaticMarkup } from "react-dom/server"; import Printing from "./src/PrintingTab"; import { ProfitCostField, ProfitDualPriceField } from "./src/ProfitControls"; export { printItemKey } from "./src/utils/printingData"; export { CraftingLevels, NumberField, ProfitCostField, ProfitDualPriceField } from "./src/ProfitControls"; export const render = () => renderToStaticMarkup(<Printing />); export const renderCostField = (props) => renderToStaticMarkup(<ProfitCostField {...props} onChange={() => {}} />); export const renderDualPriceField = (props) => renderToStaticMarkup(<ProfitDualPriceField {...props} onChange={() => {}} />);', resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", external: ["react", "react-dom/server"],
    loader: { ".css": "empty" }, define: { "import.meta.env.BASE_URL": '"/"' }, logOverride: { "empty-import-meta": "silent" },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", "localStorage", bundle.outputFiles[0].text)(
    (name) => name === "react" ? { ...React, useLayoutEffect: () => {} } : require(name),
    module, module.exports, localStorage);
  const { render, renderCostField, renderDualPriceField, printItemKey, CraftingLevels, NumberField } = module.exports;
  const calculatedEach = renderCostField({ name: "Sheet of Bast Parchment", value: undefined, baseline: 123.99 });
  const unknownCost = renderCostField({ name: "Sheet of Bast Parchment", value: undefined, baseline: null });
  assert.match(calculatedEach, /aria-label="Cost Sheet of Bast Parchment gil each"[^>]*value="123"/);
  assert.match(calculatedEach, /aria-label="Cost Sheet of Bast Parchment gil stack of 12"[^>]*value="1487"/);
  assert.match(unknownCost, /aria-label="Cost Sheet of Bast Parchment gil stack of 12"[^>]*placeholder="Unknown"/);
  assert.doesNotMatch(unknownCost, /No calculated cost; enter either amount|Changing either amount updates both/);
  const sellPrices = renderDualPriceField({ name: "Shihei", kind: "Sell", value: undefined, baseline: 25 });
  assert.match(sellPrices, /aria-label="Sell Shihei gil each"[^>]*placeholder="25"/);
  assert.match(sellPrices, /aria-label="Sell Shihei gil stack of 99"[^>]*placeholder="2475"/);
  assert.match(sellPrices, /aria-label="Reset sell price for Shihei"/);
  const vendorSale = renderDualPriceField({ name: "Spool of Wool Thread", kind: "Sale", value: undefined, baseline: 600, useBaseline: true, resetText: "Reset to vendor price", resetLabel: "Reset sale price to vendor value for Spool of Wool Thread" });
  assert.match(vendorSale, /aria-label="Sale Spool of Wool Thread gil each"[^>]*value="600"/);
  assert.match(vendorSale, /aria-label="Sale Spool of Wool Thread gil stack of 12"[^>]*value="7200"/);
  assert.match(vendorSale, /Reset to vendor price/);
  let currentSettings = restorePrintSettings();
  const fields = [];
  const visit = (node) => React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === NumberField) fields.push(child);
    visit(child.props.children);
  });
  visit(CraftingLevels({ settings: currentSettings, onChange: (patch) => {
    currentSettings = { ...currentSettings, ...(typeof patch === "function" ? patch(currentSettings) : patch) };
  } }));
  fields.find((field) => field.props.label === "Woodworking level").props.onChange(80);
  fields.find((field) => field.props.label === "Alchemy level").props.onChange(60);
  fields.find((field) => field.props.label === "Woodworking bonus").props.onChange(3);
  fields.find((field) => field.props.label === "Alchemy bonus").props.onChange(2);
  assert.deepEqual(currentSettings.skills, { Woodworking: 80, Alchemy: 60 }, "rapid edits from one render must preserve every craft level");
  assert.deepEqual(currentSettings.bonuses, { Woodworking: 3, Alchemy: 2 });
  const inkKey = printItemKey("Black Ink");
  const parchmentKey = printItemKey("Bast Parchment");
  const state = { query: "Shihei", selected: 1033, sources: { [inkKey]: 60037 }, costOverrides: {} };
  storage.set("kupo.printing.v1", JSON.stringify(state));
  const html = render();
  assert.doesNotMatch(html, /Recipe cost tree|Each group makes the item above it|Auto expands craftable ingredients/);
  assert.match(html, /Ingredients &amp; crafting tree/);
  assert.ok(html.indexOf("Ingredients &amp; crafting tree") < html.indexOf("Combined shopping list"));
  assert.match(html, /Cost per synth/);
  assert.match(html, /Profit per 100 synths/);
  assert.match(html, /Profit \/ gil per hour/);
  assert.doesNotMatch(html, /Output price unit/);
  assert.match(html, /aria-label="Sell Shihei gil each"/);
  assert.match(html, /aria-label="Sell Shihei gil stack of 99"/);
  assert.match(html, /aria-label="Woodworking level"/);
  assert.match(html, /aria-label="Alchemy level"/);
  assert.match(html, /<details class="print-ingredient print-crafted-ingredient print-ingredient-color-1" data-item="Jar of Black Ink"><summary/);
  assert.match(html, /<details class="print-ingredient print-ingredient-color-1" data-item="Clump of Windurstian Tea Leaves"><summary/);
  assert.match(html, /<details class="print-ingredient print-crafted-ingredient print-ingredient-color-2" data-item="Sheet of Bast Parchment"><summary/);
  assert.match(html, /<details class="print-ingredient print-ingredient-color-3" data-item="Wind Crystal"><summary/);
  assert.match(html, /role="group" aria-label="Ingredients to make Shihei"/);
  assert.match(html, /role="group" aria-label="Ingredients to make Jar of Black Ink"/);
  assert.match(html, /role="group" aria-label="Ingredients to make Sheet of Bast Parchment"/);
  assert.match(html, /All 9 recipes for Jar of Black Ink/);
  for (const id of [60007, 60008, 60009, 60010, 60011, 60012, 60013, 60014, 60037]) {
    assert.ok(html.includes(`value="${id}"`), "saved recipe choices retain their internal IDs");
    assert.ok(!html.includes(`#${id}`), "recipe reference numbers must not be displayed");
  }
  assert.match(html, /aria-label="Use Alchemy 4 recipe for Jar of Black Ink:/);
  for (const name of ["Nebimonite", "Cone Calamary", "Kalamar", "Grimmonite", "Ahtapot", "Gigant Squid"]) assert.ok(html.includes(name));
  assert.match(html, /aria-label="Cost Gigant Squid gil each"/);
  assert.doesNotMatch(html, /Total cost for 2 x Sheet of Bast Parchment/);
  storage.set("kupo.printing.v1", JSON.stringify({ ...state, costOverrides: { [inkKey]: 100, [parchmentKey]: 123.5 } }));
  const overridden = render();
  assert.match(overridden, /Using your entered cost; the breakdown below is excluded from the estimate/);
  assert.doesNotMatch(overridden, /aria-label="Cost Gigant Squid gil each"/);
  assert.doesNotMatch(overridden, /aria-label="Ingredients to make Jar of Black Ink"/);
  assert.match(overridden, /aria-label="Cost Sheet of Bast Parchment gil each"[^>]*value="123"/);
  assert.match(overridden, /aria-label="Cost Sheet of Bast Parchment gil stack of 12"[^>]*value="1482"/);
  assert.doesNotMatch(overridden, /123 gil each \/ 1,482 gil per stack of 12/);
  assert.match(overridden, /aria-label="Use calculated cost for Sheet of Bast Parchment"/);
  assert.match(overridden, /All 9 recipes for Jar of Black Ink/);
  storage.set("kupo.printing.v1", JSON.stringify(state));
  assert.equal(render(), html, "clearing overrides restores the original hierarchy and saved recipe");
  storage.set("kupo.profits.price-unit.v1", JSON.stringify("stack"));
  storage.set("kupo.printing.v1", JSON.stringify({ ...state, costOverrides: { [inkKey]: 100, [parchmentKey]: 123.5 } }));
  const stacked = render();
  assert.match(stacked, /aria-label="Sell Shihei gil stack of 99"/);
  assert.doesNotMatch(stacked, /Sell Shihei gil stack of (33|66)/);
  assert.match(stacked, /aria-label="Cost Sheet of Bast Parchment gil each"[^>]*value="123"/);
  assert.match(stacked, /aria-label="Cost Sheet of Bast Parchment gil stack of 12"[^>]*value="1482"/);
  assert.doesNotMatch(stacked, /Total cost for 2 x Sheet of Bast Parchment/);
  storage.set("kupo.profits.price-unit.v1", JSON.stringify("each"));
  storage.set("kupo.profits.view.v1", JSON.stringify("desynthesis"));
  storage.set("kupo.desynthesis.v1", JSON.stringify({ query: "Gigas Socks", selected: 60510, saleMode: "vendor", batchMode: "input-count", batchCount: 100 }));
  storage.set("kupo.profits.settings.v1", JSON.stringify({ ...DEFAULT_PRINT_SETTINGS, skills: { Alchemy: 15 } }));
  const desynth = render();
  assert.match(desynth, /What you recover/);
  assert.match(desynth, /Pinch of Poison Dust/);
  assert.doesNotMatch(desynth, /Gigas Socks \(desynth\)|#60510/);
  assert.match(desynth, /<option value="input-count" selected="">Input items/);
  assert.match(desynth, /aria-label="Items to desynthesize"[^>]*value="100"/);
  assert.match(desynth, /Expected Pinch of Poison Dust: <strong>160<\/strong>/);
  assert.match(desynth, /aria-label="Sale Pinch of Poison Dust gil each"/);
  assert.match(desynth, /aria-label="Sale Pinch of Poison Dust gil stack of 12"/);
  assert.match(desynth, /Reset sale price to vendor value for Pinch of Poison Dust/);
  assert.match(desynth, /<th>Input<\/th><th>Per attempt<\/th><th>Cost<\/th><th>Applied cost each<\/th>/);
  assert.match(desynth, /aria-label="Cost Fire Crystal gil each"/);
  assert.match(desynth, /aria-label="Cost Fire Crystal gil stack of 12"/);
  assert.doesNotMatch(desynth, /<th>AH \/ market price<\/th>|<th>Buy quote<\/th>|aria-label="Market [^"]+ gil|aria-label="Buy [^"]+ gil/);
  assert.doesNotMatch(desynth, /AH sale price|Vendor sale price|AH vs vendor returns|Sell recovered materials via|Output price unit|Price entry/);
  assert.match(desynth, /aria-label="Alchemy level"[^>]*value="15"/);
  const fireKey = printItemKey("Fire Crystal");
  storage.set("kupo.desynthesis.v1", JSON.stringify({ query: "Gigas Socks", selected: 60510, costOverrides: { [fireKey]: 200 } }));
  const costOverride = render();
  assert.match(costOverride, /aria-label="Cost Fire Crystal gil each"[^>]*value="200"/);
  assert.match(costOverride, /aria-label="Cost Fire Crystal gil stack of 12"[^>]*value="2400"/);
  assert.match(costOverride, /aria-label="Use calculated cost for Fire Crystal"/);
  assert.match(costOverride, /<td>Fire Crystal<\/td><td>1<\/td><td>[\s\S]*?<\/td><td>200<\/td>/);
  storage.set("kupo.desynthesis.v1", JSON.stringify({ query: "Gigas Socks", selected: 60510, costOverrides: { [fireKey]: 200 }, batchMode: "target-output", batchCount: 24, targetOutput: printItemKey("Pinch of Poison Dust") }));
  const targetBatch = render();
  assert.match(targetBatch, /<option value="target-output" selected="">Desired recovered amount/);
  assert.match(targetBatch, /aria-label="Desired Pinch of Poison Dust count"[^>]*value="24"/);
  assert.match(targetBatch, /Inputs needed: <strong>15 x Gigas Socks<\/strong>/);
  assert.match(targetBatch, /Expected Pinch of Poison Dust: <strong>24<\/strong>/);
  storage.set("kupo.desynthesis.v1", JSON.stringify({ query: "Gigas Socks", selected: 60510, costOverrides: { [fireKey]: 200 }, batchMode: "input-count", batchCount: 100 }));
  storage.set("kupo.profits.price-unit.v1", JSON.stringify("stack"));
  const desynthStacks = render();
  assert.match(desynthStacks, /aria-label="Sale Pinch of Poison Dust gil stack of 12"/);
  assert.match(desynthStacks, /aria-label="Cost Fire Crystal gil stack of 12"[^>]*value="2400"/);
  assert.doesNotMatch(desynthStacks, /aria-label="Market [^"]+ gil|aria-label="Buy [^"]+ gil/);
});

test("personal skills survive restore and govern final and ingredient stages, including subcrafts", () => {
  assert.equal(restorePrintSettings().skillMode, "character");
  assert.equal(restorePrintSettings().lossMode, "skill");
  assert.equal(restorePrintSettings({ lossPct: 75 }).lossMode, "fixed");
  const personal = restorePrintSettings({ skills: { Woodworking: 60, Alchemy: 10 } });
  const subRecipe = { ...pole, subs: [{ c: "Alchemy", l: 12 }] };
  const chain = createPrintingChain([lumber, subRecipe], personal, () => 100, () => 2000, key);
  const estimate = chain.estimate(subRecipe);
  assert.equal(estimate.tier, -1, "below-cap subcraft prevents HQ despite main craft skill");
  close(estimate.success, 0.95 * 0.85);
  assert.equal(estimate.sources[0].node.tier, 3, "ingredient crafts use personal skills too");
  const improved = createPrintingChain([lumber, subRecipe], { ...personal, skills: { Woodworking: 71, Alchemy: 23 } }, () => 100, () => 2000, key).estimate(subRecipe);
  assert.equal(improved.tier, 1);
  close(improved.success, 0.95 ** 2);
  assert.notEqual(improved.cost, estimate.cost);
  const unavailable = createPrintingChain([lumber, subRecipe], { ...personal, skills: { Woodworking: 40 } }, () => 100, () => 2000, key).estimate(subRecipe);
  assert.equal(unavailable.eligible, false);
  assert.equal(restorePrintSettings({ skillMode: "at-cap" }).skillMode, "at-cap", "explicit legacy planning mode remains available");
});

test("skill-based losses use the first failed craft in server order and never refund crystals", () => {
  const mixed = { ...recipe, craft: "Alchemy", lvl: 20, subs: [{ c: "Woodworking", l: 10 }] };
  const personal = restorePrintSettings({ skills: { Woodworking: 6, Alchemy: 20 } });
  const estimate = printingEstimate(mixed, personal, () => 100, () => 2000);
  close(estimate.success, 0.7 * 0.95);
  close(estimate.consumption, 0.7 * 0.95 + 0.3 * 0.7 + 0.7 * 0.05 * 0.5);
  close(estimate.cost, 200 * estimate.consumption + 100);
  const custom = printingEstimate(mixed, { ...personal, lossMode: "fixed", lossPct: 0 }, () => 100, () => 2000);
  close(custom.cost, 200 * estimate.success + 100);
  const noLoss = printingEstimate({ ...mixed, d: 2 }, personal, () => 100, () => 2000);
  close(noLoss.cost, custom.cost);
});

test("desynthesis recovers actual outputs and calculates one selected sale price without synthesizing the input", async () => {
  const bundle = buildSync({ stdin: { contents: 'export * from "./src/utils/desynthesis"; export { DESYNTH_RECIPES } from "./src/utils/printingData";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm" });
  const { desynthesisBatchEstimate, desynthesisEstimate, DESYNTH_RECIPES } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const socks = DESYNTH_RECIPES.find((recipe) => recipe.id === 60510);
  assert.equal(socks.ing[0].n, "Gigas Socks");
  assert.equal(socks.res.n, "Pinch of Poison Dust");
  assert.deepEqual([socks.res, ...socks.hq].map((item) => item.q), [2, 4, 6, 8]);
  assert.ok(DESYNTH_RECIPES.every((recipe) => [recipe.res, ...recipe.hq].every((item) => !item.n.includes("(desynth)"))));
  const personal = restorePrintSettings({ skills: { Alchemy: 15 } });
  const buy = (name) => name === "Fire Crystal" ? 10 : 1000;
  const result = desynthesisEstimate(socks, personal, buy, () => 1000);
  close(result.success, 0.4);
  result.outcomes.forEach((outcome, index) => close(outcome.probability, [0.16, 0.12, 0.08, 0.04][index]));
  close(result.cost, 710);
  close(result.revenue, 1600);
  close(result.profit * 100, 89000);
  close(result.gilPerHour, 890 * 3600 / 21);
  const inputBatch = desynthesisBatchEstimate(socks, result.outcomes, "Pinch of Poison Dust", 100, "input-count");
  assert.equal(inputBatch.attempts, 100);
  close(inputBatch.expectedOutput, 160);
  const targetBatch = desynthesisBatchEstimate(socks, result.outcomes, "Pinch of Poison Dust", 24, "target-output");
  assert.equal(targetBatch.inputsNeeded, 15);
  close(targetBatch.expectedOutput, 24);
  const linenRecipe = DESYNTH_RECIPES.find((recipe) => recipe.id === 31007);
  const linenResult = desynthesisEstimate(linenRecipe, restorePrintSettings({ skills: { Clothcraft: 22 } }), buy, () => 100);
  const linenInputBatch = desynthesisBatchEstimate(linenRecipe, linenResult.outcomes, "Square of Linen Cloth", 100, "input-count");
  close(linenInputBatch.expectedOutput, 64);
  const linenTargetBatch = desynthesisBatchEstimate(linenRecipe, linenResult.outcomes, "Square of Linen Cloth", 24, "target-output");
  assert.equal(linenTargetBatch.inputsNeeded, 38);
  close(linenTargetBatch.expectedOutput, 24.32);
  const missing = desynthesisEstimate(socks, personal, buy, () => null);
  assert.equal(missing.profit, null);
  assert.equal(desynthesisEstimate(socks, personal, () => null, () => 100).cost, null);
  close(desynthesisEstimate(socks, personal, buy, () => 100).profit, -550);
  close(desynthesisEstimate(socks, { ...personal, skills: { Alchemy: 14 } }, buy, () => 100).cost, 740);
  const sub = { ...socks, subs: [{ c: "Woodworking", l: 10 }] };
  close(desynthesisEstimate(sub, { ...personal, skills: { Alchemy: 15, Woodworking: 10 } }, buy, () => 100).success, 0.16);
  assert.equal(desynthesisEstimate(sub, { ...personal, skillMode: "at-cap", skills: {} }, buy, () => 100).success, 0, "desynthesis uses personal levels even in hypothetical crafting mode");
  assert.throws(() => desynthesisEstimate(recipe, personal, buy, () => 1), /desynthesis recipe/);
});

test("distinct HQ sale prices, nerfs, and overhead are applied without changing yields", () => {
  const special = { ...recipe, hq: [{ n: "HQ", q: 1 }, { n: "HQ", q: 1 }, { n: "HQ", q: 1 }] };
  const result = printingEstimate(special, { ...settings, sellMultiplier: 50, seconds: 22, overhead: 8 }, () => 0, (name) => name === "HQ" ? 101 : 10);
  close(result.revenue, 0.95 * (0.5 * 5 + 0.5 * 50));
  close(result.attemptsPerHour, 120);
});

test("stack-derived sale quotes retain precision while NPC base payouts keep integer rounding", () => {
  for (const stack of [12, 99]) {
    const quoted = printingEstimate(recipe, { ...settings, sellMultiplier: 50 }, () => 0, () => ({ unitPrice: 1000 / stack }));
    close(quoted.outcomes[0].price, 500 / stack);
    const expectedYield = quoted.outcomes.reduce((total, outcome) => total + outcome.probability * outcome.q, 0);
    close(quoted.revenue, expectedYield * 500 / stack);
    const baseline = printingEstimate(recipe, { ...settings, sellMultiplier: 50 }, () => 0, () => 101);
    assert.equal(baseline.outcomes[0].price, 50);
  }
});