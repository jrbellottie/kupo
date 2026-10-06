import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const vendorBundle = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/fishingVendor.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { getFishingVendorOptions } = await import(`data:text/javascript;base64,${Buffer.from(vendorBundle.outputFiles[0].text).toString("base64")}`);

test("fishing NPC options include raw carp, sliced carp and roast carp with yield-aware prices", () => {
  const carp = getFishingVendorOptions("Moat Carp");
  assert.ok(carp.rawPrice > 0);
  for (const name of ["Slice of Carp", "Roast Carp"]) {
    const option = carp.recipes.find(entry => entry.recipe.res.n === name);
    assert.ok(option, name);
    assert.ok(option.outcomes[0].price > 0, name);
  }
  for (const option of carp.recipes) {
    for (const outcome of option.outcomes) {
      assert.equal(outcome.total, outcome.price === null ? null : outcome.price * outcome.q);
      assert.equal(outcome.perFish, outcome.total === null ? null : outcome.total / option.fishQuantity);
    }
  }
  assert.equal(carp.bestPrice, Math.max(carp.rawPrice, ...carp.recipes.filter(entry => entry.recipe.era !== "WotG").map(entry => entry.outcomes[0].perFish ?? -1)));
  assert.ok(carp.bestPrice > carp.rawPrice);
  assert.strictEqual(getFishingVendorOptions("Moat Carp"), carp);
});

test("aquarium proceeds are allocated across three fish, not a direct fish price or net return", () => {
  const butterfly = getFishingVendorOptions("Coral Butterfly");
  const aquarium = butterfly.recipes.find(entry => entry.recipe.res.n === "Reef Aquarium");
  assert.equal(butterfly.rawPrice, 125);
  assert.equal(aquarium.fishQuantity, 3);
  assert.equal(aquarium.outcomes[0].total, 3836);
  assert.equal(aquarium.outcomes[0].perFish, 3836 / 3);
});

test("headline NPC proceeds exclude WotG recipes while retaining them in the breakdown", () => {
  const recipes = JSON.parse(readFileSync(new URL("../src/data/recipes.json", import.meta.url), "utf8"));
  const fishNames = JSON.parse(readFileSync(new URL("../src/data/fishingPlanner.json", import.meta.url), "utf8")).fish;
  const affectedFish = Object.keys(fishNames).filter(name => recipes.some(recipe => recipe.era === "WotG" && recipe.ing.some(item => item.n === name)));
  assert.ok(affectedFish.length > 0);
  for (const fish of affectedFish) {
    const options = getFishingVendorOptions(fish);
    const prices = [options.rawPrice, ...options.recipes.filter(entry => entry.recipe.era !== "WotG").map(entry => entry.outcomes[0].perFish)].filter(price => price !== null);
    assert.equal(options.bestPrice, prices.length ? Math.max(...prices) : null, fish);
    assert.ok(options.recipes.some(entry => entry.recipe.era === "WotG"), fish);
  }
});

test("fishing NPC options retain unknown prices and include every direct synthesis recipe", () => {
  assert.deepEqual(getFishingVendorOptions("Unknown fish"), { rawPrice: null, bestPrice: null, bestName: "Unknown fish", recipes: [] });
  const recipes = JSON.parse(readFileSync(new URL("../src/data/recipes.json", import.meta.url), "utf8"));
  const expected = recipes.filter(recipe => recipe.d !== 1 && recipe.ing.some(item => item.n === "Moat Carp")).map(recipe => recipe.id).sort();
  assert.deepEqual(getFishingVendorOptions("Moat Carp").recipes.map(entry => entry.recipe.id).sort(), expected);
});

async function loadUtility(name) {
  const source = readFileSync(new URL(`../src/utils/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
const craft = await loadUtility("craftingSkillup");
const fishing = await loadUtility("fishingSkillup");
const fishingSnapshot = JSON.parse(readFileSync(new URL("../src/data/fishingPlanner.json", import.meta.url), "utf8"));

test("fishing moon phases use source thresholds and Kupo's calibrated moon step", async () => {
  const clock = await loadUtility("../vanadiel");
  const phaseSteps = [
    [0, 5, 6, 39, 56, 89, 106, 139, 156, 157, 189, 190, 199],
    [7, 38], [40, 55], [57, 88], [90, 95, 100, 105],
    [107, 138], [140, 155], [158, 188],
  ];
  for (const [phase, steps] of phaseSteps.entries()) {
    for (const step of steps) assert.equal(fishing.getFishingMoonPhase(step), phase, `step ${step}`);
  }
  for (const step of [-1, 200, 1.5, NaN, Infinity]) {
    assert.throws(() => fishing.getFishingMoonPhase(step), RangeError);
  }
  const anchor = clock.DEFAULT_CALIBRATION.newMoonStartEarthMs;
  const stepDuration = 1_451_520;
  for (let step = 0; step < 200; step++) {
    const snapshot = clock.getVanaNow(anchor + (step + 10) * stepDuration, clock.DEFAULT_CALIBRATION);
    assert.equal(snapshot.moonStep, step);
    assert.ok(fishing.getFishingMoonPhase(snapshot.moonStep) >= 0);
    assert.ok(fishing.getFishingMoonPhase(snapshot.moonStep) <= 7);
  }
  const now = anchor + 110 * stepDuration;
  assert.equal(fishing.getFishingMoonPhase(clock.getVanaNow(now, clock.DEFAULT_CALIBRATION).moonStep), 4);
  const shifted = { ...clock.DEFAULT_CALIBRATION, newMoonStartEarthMs: anchor + 100 * stepDuration };
  assert.equal(fishing.getFishingMoonPhase(clock.getVanaNow(now, shifted).moonStep), 0);
});

test("fishing snapshot preserves every fish's moon pattern and formula provenance", () => {
  assert.match(fishingSnapshot.source.inputs["src/map/utils/fishingutils.h"], /^[a-f0-9]{64}$/);
  for (const fish of Object.values(fishingSnapshot.fish)) {
    assert.ok(Number.isInteger(fish.moonPattern), fish.fish);
    assert.ok(fish.moonPattern >= 0 && fish.moonPattern <= 5, fish.fish);
  }
  assert.equal(fishingSnapshot.fish["Moat Carp"].moonPattern, 1);
});

test("fish moon preferences match source weights for all patterns and phases", () => {
  const rod = fishingSnapshot.rods.find(row => row.rodId === 17389);
  const fish = { ...fishingSnapshot.fish["Moat Carp"], hookBonus: 35 };
  const expected = [
    [85, 85, 85, 85, 85, 85, 85, 85],
    [84, 69, 61, 79, 81, 62, 67, 84],
    [60, 76, 83, 64, 64, 83, 76, 60],
    [85, 85, 85, 85, 85, 85, 85, 60],
    [60, 64, 75, 83, 83, 75, 64, 60],
    [60, 64, 75, 83, 83, 75, 64, 60],
  ];
  for (const [moonPattern, weights] of expected.entries()) {
    assert.equal(fishing.calculateHookWeight(11, { ...fish, moonPattern }, rod), 85, "Omitted moon preserves neutral behavior");
    for (const [phase, weight] of weights.entries()) {
      assert.equal(fishing.calculateHookWeight(11, { ...fish, moonPattern }, rod, false, phase), weight);
      assert.equal(fishing.calculateHookWeight(11, { ...fish, moonPattern, rarity: 0.01 }, rod, false, phase), 20);
      assert.equal(fishing.calculateHookWeight(0, { ...fish, moonPattern, skillCap: 101 }, rod, false, phase), 0);
      assert.equal(fishing.calculateHookWeight(11, { ...fish, moonPattern, shellfish: true }, rod, true, phase), Math.min(120, weight + 50));
    }
  }
  assert.throws(() => fishing.calculateHookWeight(11, { ...fish, moonPattern: 6 }, rod, false, 0), RangeError);
});

test("moon adjusts city and outdoor catch pools with source rounding and empty-pool redistribution", () => {
  const rod = fishingSnapshot.rods.find(row => row.rodId === 17389);
  const fish = { ...fishingSnapshot.fish["Moat Carp"], hookBonus: 0, moonPattern: 0 };
  const expected = [
    [[50, 10, 30, 35], [54, 19, 30, 31], [65, 24, 30, 22], [73, 12, 30, 15],
      [73, 12, 30, 16], [65, 24, 30, 22], [54, 19, 30, 31], [50, 10, 15, 34]],
    [[50, 25, 0, 45], [52, 38, 0, 42], [59, 43, 0, 35], [64, 28, 0, 30],
      [64, 28, 0, 30], [59, 43, 0, 35], [52, 38, 0, 42], [50, 25, 0, 44]],
  ];
  for (const [city, phases] of expected.entries()) {
    for (const [moonPhase, weights] of phases.entries()) {
      const options = { city: Boolean(city), hasItems: true, hasMobs: true, difficulty: 0, moonPhase };
      const odds = fishing.calculateCastOdds(11, rod, [fish], options);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      for (const [index, key] of ["fishPct", "itemPct", "mobPct", "nothingPct"].entries()) {
        assert.ok(Math.abs(odds[key] - 100 * weights[index] / total) < 1e-10, `${city}/${moonPhase}/${key}`);
      }
      assert.equal(odds.targetPct[0], odds.fishPct);
      const empty = fishing.calculateCastOdds(11, rod, [], { ...options, hasItems: false, hasMobs: false });
      assert.deepEqual(empty, { fishPct: 0, itemPct: 0, mobPct: 0, nothingPct: 100, targetPct: [] });
      const noItems = fishing.calculateCastOdds(11, rod, [fish], { ...options, hasItems: false, hasMobs: false });
      const adjustedTotal = weights[0] + weights[3] + Math.floor(weights[1] / 2) + Math.floor(weights[2] / 2);
      assert.equal(noItems.itemPct, 0);
      assert.equal(noItems.mobPct, 0);
      assert.ok(Math.abs(noItems.fishPct - 100 * weights[0] / adjustedTotal) < 1e-10);
    }
  }
});

test("moon changes species shares and forecasts without changing direct skill-up rolls", () => {
  const rod = fishingSnapshot.rods.find(row => row.rodId === 17389);
  const fish = [
    { ...fishingSnapshot.fish["Moat Carp"], hookBonus: 35, moonPattern: 1 },
    { ...fishingSnapshot.fish["Crayfish"], hookBonus: 35, moonPattern: 2 },
  ];
  const options = { city: false, hasItems: true, hasMobs: true, difficulty: 0 };
  const settings = { baseSkill: 0, bonusSkill: 0, zone: "East Sarutabaruta", rod, fish, options };
  const direct = fish.map(member => fishing.calculateSkillup(0, member.skillCap, settings.zone, rod.rod));
  const estimates = [0, 2, 4, 7].map(moonPhase => {
    const conditions = { ...options, moonPhase };
    const odds = fishing.calculateCastOdds(0, rod, fish, conditions);
    const gains = fishing.calculatePoolSkillup(0, 0, settings.zone, rod, fish, odds.targetPct);
    for (const [index, member] of fish.entries()) {
      const fight = fishing.calculateFishingFight(0, member, rod);
      assert.equal(gains.gains[index], direct[index].expectedGainPerTargetHook * odds.targetPct[index] * fight.skillupResolvePct / 100);
    }
    const session = fishing.calculatePoolSession({ ...settings, options: conditions });
    assert.ok(session.catchTimeSeconds > 0);
    assert.ok(session.skillGain > 0);
    assert.deepEqual(fishing.calculatePoolSession({ ...settings, options: conditions }), session);
    return { odds, session };
  });
  assert.notEqual(estimates[0].odds.targetPct[0] / estimates[0].odds.fishPct, estimates[1].odds.targetPct[0] / estimates[1].odds.fishPct);
  assert.notEqual(estimates[0].session.catchTimeSeconds, estimates[1].session.catchTimeSeconds);
  assert.notEqual(estimates[0].session.skillGain, estimates[1].session.skillGain);
  assert.notDeepEqual(estimates[0].session.catches, estimates[1].session.catches);

  const eel = { ...fishingSnapshot.fish["Black Eel"], hookBonus: 35 };
  const snap = moonPhase => {
    const odds = fishing.calculateCastOdds(31, rod, [eel], { ...options, moonPhase });
    const plan = fishing.calculateSnapPlan({ baseSkill: 31, bonusSkill: 0, zone: "Zeruhn Mines", rod,
      fish: [eel], weights: odds.targetPct, landed: 0, fatigueUsed: 0, reserve: 1000 });
    assert.equal(plan.status, "Ready");
    return { plan, time: fishing.calculateSnapTime(plan, odds.fishPct), bait: fishing.calculateSnapBait(plan, odds) };
  };
  const newMoon = snap(0);
  const fullMoon = snap(4);
  assert.ok(newMoon.time && fullMoon.time);
  assert.notEqual(newMoon.time.seconds, fullMoon.time.seconds);
  assert.notEqual(newMoon.time.casts, fullMoon.time.casts);
  assert.notEqual(newMoon.bait, fullMoon.bait);
  assert.ok(Math.abs(newMoon.plan.expectedGain - fullMoon.plan.expectedGain) < 1e-10);
});

test("fishing skill-up table and expanded details have no native hover tooltips", () => {
  const source = readFileSync(new URL("../src/BaitTab.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("BaitTab.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let table;
  function findTable(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "table"
      && node.openingElement.attributes.properties.some(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.text === "aria-label"
        && attribute.initializer && ts.isStringLiteral(attribute.initializer)
        && attribute.initializer.text === "Fishing skill-up combinations")) {
      table = node;
    }
    ts.forEachChild(node, findTable);
  }
  findTable(file);
  assert.ok(table, "Skill-up table must exist");
  function checkTooltips(node) {
    if (ts.isJsxAttribute(node)) {
      assert.notEqual(node.name.getText(file), "title", "Table content must not create native hover popups");
    }
    ts.forEachChild(node, checkTooltips);
  }
  checkTooltips(table);
});

test("snap planner conditions warnings and reserves fatigue for landing 200", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Carbon Fishing Rod");
  const fish = { ...fishingSnapshot.fish["Black Eel"], hookBonus: 80 };
  const settings = { baseSkill: 31, bonusSkill: 0, zone: "Zeruhn Mines", rod, fish: [fish], weights: [1], landed: 0, fatigueUsed: 0, reserve: 1000 };
  const plan = fishing.calculateSnapPlan(settings);
  assert.equal(plan.status, "Ready");
  assert.ok(Math.abs(plan.badLandingChance - 0.1824722040549379) < 1e-10);
  assert.equal(fishing.fishingFatigue(30, fish, rod), 100);
  assert.equal(fishing.fishingFatigue(31, fish, rod), 25);
  assert.ok(plan.badFights > 600);
  assert.ok(plan.fatigueProjected <= 19000);
  assert.ok(plan.finishFailures > 0);
  assert.ok(Math.abs(plan.accidentalLandings + plan.finishLandings - 200) < 1e-8);
  assert.ok(plan.opportunities > 700);
  assert.ok(plan.opportunities < 760);
  const level30 = fishing.calculateSnapPlan({ ...settings, baseSkill: 30 });
  assert.match(level30.status, /Insufficient fatigue/);
  assert.match(fishing.calculateSnapPlan({ ...settings, landed: 200 }).status, /limit reached/);
  assert.match(fishing.calculateSnapPlan({ ...settings, fatigueUsed: 20000 }).status, /Insufficient/);
  assert.match(fishing.calculateSnapPlan({ ...settings, baseSkill: NaN }).status, /Invalid/);
  assert.match(fishing.calculateSnapPlan({ ...settings, baseSkill: 47 }).status, /No eligible/);
  assert.match(fishing.calculateSnapPlan({ ...settings, fish: [{ ...fish, size: "L" }] }).status, /epic/);
  assert.match(fishing.calculateSnapPlan({ ...settings, fish: [], weights: [] }).status, /No fish/);
});

test("snap plans include competing capped fish and rod fatigue discounts", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Carbon Fishing Rod");
  const eel = { ...fishingSnapshot.fish["Black Eel"], hookBonus: 80 };
  const capped = { ...eel, fish: "Capped competitor", skillCap: 20 };
  const plan = fishing.calculateSnapPlan({ baseSkill: 31, bonusSkill: 0, zone: "Zeruhn Mines", rod,
    fish: [eel, capped], weights: [1, 1], landed: 172, fatigueUsed: 4300, reserve: 1000 });
  assert.equal(plan.status, "Ready");
  assert.ok(plan.opportunities < plan.badFights + plan.finishLandings);
  assert.ok(plan.fatigueProjected <= plan.budget);
  const lu = fishingSnapshot.rods.find(row => row.rod.startsWith("Lu Shang's"));
  assert.equal(fishing.fishingFatigue(31, eel, lu), 23);
  assert.equal(fishing.fishingFatigue(0, eel, rod, true), 1000);
  const safe = fishing.fishingWarningOdds({ snapPct: 0, breakPct: 0, escapePct: 0, landPct: 100 });
  assert.equal(safe.bad, 0);
  assert.equal(safe.finishLand, 1);
});
test("snap time includes every roll and both phases without double-counting outcomes", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Carbon Fishing Rod");
  const fish = { ...fishingSnapshot.fish["Black Eel"], hookBonus: 80 };
  const settings = { baseSkill: 31, bonusSkill: 0, zone: "Zeruhn Mines", rod, fish: [fish], weights: [1], landed: 0, fatigueUsed: 0, reserve: 1000 };
  const plan = fishing.calculateSnapPlan(settings);
  const full = fishing.calculateSnapTime(plan, 100);
  const half = fishing.calculateSnapTime(plan, 50);
  assert.equal(half.casts, full.casts * 2);
  assert.ok(Math.abs(half.snapCasts * 0.5 * plan.rows[0].warning.bad - plan.badFights) < 1e-8);
  assert.ok(Math.abs(half.finishCasts * 0.5 * plan.rows[0].warning.finishLand - plan.finishLandings) < 1e-8);
  assert.ok(full.cancelledOrEmpty > 0);
  assert.ok(Math.abs(half.seconds - (plan.remaining * 35 + (plan.snaps + plan.finishFailures + half.cancelledOrEmpty) * 15)) < 1e-8);
  assert.ok(Math.abs(half.seconds - full.seconds - full.casts * 15) < 1e-8);
  const odds = fishing.calculateCastOdds(31, rod, [fish], { city: false, hasItems: true, hasMobs: true, difficulty: 0 });
  const actual = fishing.calculateSnapTime(plan, odds.fishPct);
  const nonFish = actual.casts * (odds.itemPct + odds.mobPct + odds.nothingPct) / 100;
  assert.ok(actual.cancelledOrEmpty > nonFish);
  const progress = fishing.calculateSnapPlan({ ...settings, landed: 1, fatigueUsed: 25 });
  assert.ok(fishing.calculateSnapTime(progress, odds.fishPct).seconds < actual.seconds);
  for (const fishPct of [0, -1, 101, NaN]) assert.equal(fishing.calculateSnapTime(plan, fishPct), null);
  assert.equal(fishing.calculateSnapTime(fishing.calculateSnapPlan({ ...settings, landed: 200 }), 100), null);
});

test("snap bait includes hooked cancellations but excludes no bites and pre-rolled escapes", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Carbon Fishing Rod");
  const fish = { ...fishingSnapshot.fish["Black Eel"], hookBonus: 80 };
  const settings = { baseSkill: 31, bonusSkill: 0, zone: "Zeruhn Mines", rod, fish: [fish], weights: [1], landed: 0, fatigueUsed: 0, reserve: 1000 };
  const plan = fishing.calculateSnapPlan(settings);
  const full = fishing.calculateSnapTime(plan, 100);
  const bait = fishing.calculateSnapBait(plan, { fishPct: 100, nothingPct: 0 });
  assert.ok(Math.abs(bait - (plan.remaining + plan.snaps + full.cancelledOrEmpty)) < 1e-8);
  assert.ok(Math.abs(fishing.calculateSnapBait(plan, { fishPct: 50, nothingPct: 50 }) - bait) < 1e-8);
  assert.ok(Math.abs(fishing.calculateSnapBait(plan, { fishPct: 50, nothingPct: 0 }) - bait - full.casts) < 1e-8);
  const odds = fishing.calculateCastOdds(31, rod, [fish], { city: false, hasItems: true, hasMobs: true, difficulty: 0 });
  const actual = fishing.calculateSnapBait(plan, odds);
  assert.ok(actual > plan.remaining + plan.snaps);
  assert.ok(actual < fishing.calculateSnapTime(plan, odds.fishPct).casts);
  for (const landed of [false, true]) {
    const progress = fishing.calculateSnapPlan({ ...settings, landed: Number(landed), fatigueUsed: 25 });
    assert.ok(fishing.calculateSnapBait(progress, odds) < actual);
  }
  for (const nothingPct of [-1, 101, NaN, 60]) assert.equal(fishing.calculateSnapBait(plan, { fishPct: 50, nothingPct }), null);
  assert.equal(fishing.calculateSnapBait(fishing.calculateSnapPlan({ ...settings, landed: 200 }), odds), null);
});

test("time for 200 fish weights adjustable full cycles with 30/20 defaults", () => {
  assert.equal(fishing.calculateCatchTime({ fishPct: 100, targetPct: 100, landPct: 100 }), 6000);
  assert.equal(fishing.calculateCatchTime({ fishPct: 50, targetPct: 50, landPct: 100 }), 10000);
  assert.equal(fishing.calculateCatchTime({ fishPct: 50, targetPct: 50, landPct: 50 }), 20000);
  assert.equal(fishing.calculateCatchTime({ fishPct: 50, targetPct: 50, landPct: 100 }, { fishSeconds: 30, otherSeconds: 12 }), 8400);
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(fishing.calculateCatchTime({ fishPct: 50, targetPct: 50, landPct: 100 }, { fishSeconds: value, otherSeconds: 20 }), null);
    assert.equal(fishing.calculateCatchTime({ fishPct: 50, targetPct: 50, landPct: 100 }, { fishSeconds: 30, otherSeconds: value }), null);
  }
  assert.equal(fishing.calculateCatchTime({ fishPct: 100, targetPct: 50, landPct: 100 }), 12000);
  assert.equal(fishing.formatCatchTime(6000), "1h 40m");
  assert.equal(fishing.formatCatchTime(8400), "2h 20m");
  assert.equal(fishing.formatCatchTime(3599), "1h 00m");
  assert.equal(fishing.formatCatchTime(3601), "1h 01m");
});

test("catch time includes sequential escape, snap and break losses only once", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Bamboo Fishing Rod");
  const risk = fishing.calculateRodRisk(0, fishingSnapshot.fish.Crayfish, rod);
  const seconds = fishing.calculateCatchTime({ fishPct: 60, targetPct: 40, landPct: risk.landPct });
  const expected = 200 * (0.6 * 30 + 0.4 * 20) / (0.4 * (1 - risk.escapePct / 100) * (1 - risk.snapPct / 100) * (1 - risk.breakPct / 100));
  assert.ok(Math.abs(seconds - expected) < 1e-8);
  assert.equal(fishing.calculateCatchTime({ fishPct: 60, targetPct: 40, landPct: risk.landPct / 2 }), seconds * 2);
});

test("impossible catches have no finite completion estimate", () => {
  for (const odds of [{ fishPct: 0, targetPct: 0, landPct: 100 }, { fishPct: 100, targetPct: 100, landPct: 0 }, { fishPct: 50, targetPct: 60, landPct: 100 }, { fishPct: NaN, targetPct: 50, landPct: 100 }]) {
    assert.equal(fishing.calculateCatchTime(odds), null);
  }
  assert.equal(fishing.formatCatchTime(null), "Not catchable");
});

test("Knightwell totals include all landed competitors and adjustable timing", () => {
  const area = fishingSnapshot.areas["westronfaure|knightwell"];
  const rod = fishingSnapshot.rods.find(row => row.rod === "Tarutaru Fishing Rod");
  const bait = fishingSnapshot.baits["Little Worm"];
  const members = area.members.map(name => fishingSnapshot.fish[name]);
  const fish = members.filter(member => !member.item && bait.fish[member.fish] !== undefined)
    .map(member => ({ ...member, hookBonus: bait.fish[member.fish] }));
  const odds = fishing.calculateCastOdds(5, rod, fish, { ...area, ...bait, city: false, hasItems: members.some(member => member.item) });
  const plan = fishing.calculatePoolCatch(5, rod, fish, odds.targetPct, odds.fishPct);
  const targetIndex = fish.findIndex(member => member.fish === "Crayfish");
  assert.equal(fishing.formatCatchTime(plan.catchTimeSeconds), "3h 17m");
  assert.ok(Math.abs(plan.catches[targetIndex] - 93.5948563522422) < 1e-8);
  assert.ok(Math.abs(plan.catches.reduce((sum, value) => sum + value, 0) - 200) < 1e-8);
  const oldTiming = fishing.calculatePoolCatch(5, rod, fish, odds.targetPct, odds.fishPct, { fishSeconds: 30, otherSeconds: 12 });
  assert.equal(fishing.formatCatchTime(oldTiming.catchTimeSeconds), "2h 51m");
  assert.deepEqual(oldTiming.catches, plan.catches);
  const capped = fish.map(member => ({ ...member, skillCap: 5 }));
  const cappedPlan = fishing.calculatePoolCatch(5, rod, capped, odds.targetPct, odds.fishPct);
  assert.ok(Math.abs(cappedPlan.catches.reduce((sum, value) => sum + value, 0) - 200) < 1e-8);
  assert.equal(fishing.calculatePoolSkillup(5, 5, "West Ronfaure", rod, capped, odds.targetPct).totalGain, 0);
  const single = fishing.calculatePoolCatch(5, rod, [fish[targetIndex]], [50], 50);
  assert.deepEqual(single.catches, [200]);
  assert.equal(single.catchTimeSeconds, 10000);
  assert.deepEqual(fishing.calculatePoolCatch(5, rod, [], [], 0), { catchTimeSeconds: null, catches: [] });
  assert.deepEqual(fishing.calculatePoolCatch(5, rod, [fish[targetIndex]], [0], 0), { catchTimeSeconds: null, catches: [null] });
  assert.deepEqual(fishing.calculatePoolCatch(5, rod, [{ ...fish[targetIndex], skillCap: 100 }], [50], 50), { catchTimeSeconds: null, catches: [null] });
});

test("lures cancel bad warnings, including false alarms, while bait completes snaps", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Bamboo Fishing Rod");
  const fish = { ...fishingSnapshot.fish.Crayfish, skillCap: 140, hookBonus: 80 };
  const options = { city: false, hasItems: false, hasMobs: false, difficulty: 0 };
  const settings = { baseSkill: 100, bonusSkill: 0, zone: "Zeruhn Mines", rod, fish: [fish], options };
  const risk = fishing.calculateRodRisk(100, fish, rod);
  const warning = fishing.fishingWarningOdds(risk);
  assert.ok(warning.snap > 0 && warning.badLand > 0);
  const fight = fishing.calculateFishingFight(100, fish, rod, "Lure");
  assert.ok(Math.abs(fight.attemptedPct - 100 * (1 - warning.bad)) < 1e-8);
  assert.ok(Math.abs(fight.landPct - (risk.landPct - 100 * warning.badLand)) < 1e-8);
  assert.ok(Math.abs(fight.skillupResolvePct - (risk.skillupResolvePct - 100 * warning.bad)) < 1e-8);
  assert.deepEqual(fishing.calculateFishingFight(100, fish, rod, "Bait"), {
    attemptedPct: 100, landPct: risk.landPct, skillupResolvePct: risk.skillupResolvePct,
  });
  const odds = fishing.calculateCastOdds(100, rod, [fish], options);
  for (const baitKind of ["Bait", "Lure"]) {
    const plan = fishing.calculatePoolSession({ ...settings, baitKind });
    const outcome = fishing.calculateFishingFight(100, fish, rod, baitKind);
    const landed = odds.targetPct[0] / 100 * outcome.landPct / 100;
    const attempted = odds.targetPct[0] / 100 * outcome.attemptedPct / 100;
    const fatigue = landed * fishing.fishingFatigue(100, fish, rod)
      + (attempted - landed) * fishing.fishingFatigue(100, fish, rod, true);
    const casts = 20000 / fatigue;
    const gain = fishing.calculateSkillup(100, fish.skillCap, settings.zone, rod.rod).expectedGainPerTargetHook
      * odds.targetPct[0] / 100 * outcome.skillupResolvePct / 100;
    assert.ok(plan.skillGain > 0 && plan.skillGain < 1);
    assert.ok(Math.abs(plan.skillGain - gain * casts) < 1e-8);
    assert.ok(Math.abs(plan.catches[0] - landed * casts) < 1e-8);
    assert.ok(Math.abs(plan.catchTimeSeconds - casts * (30 * attempted + 20 * (1 - attempted))) < 1e-8);
    assert.ok(Math.abs(plan.fatigueUsed - 20000) < 1e-8);
  }
  const safeFish = { ...fish, ranking: 1 };
  const { baitNeeded: lureNeeded, ...safeLure } = fishing.calculatePoolSession({ ...settings, fish: [safeFish], baitKind: "Lure" });
  const { baitNeeded: baitNeeded, ...safeBait } = fishing.calculatePoolSession({ ...settings, fish: [safeFish], baitKind: "Bait" });
  assert.deepEqual(safeLure, safeBait);
  assert.equal(lureNeeded, 1);
  assert.ok(baitNeeded > 1);
  const epic = { ...fish, size: "L" };
  assert.deepEqual(fishing.calculateFishingFight(100, epic, rod, "Lure"), { attemptedPct: 0, landPct: 0, skillupResolvePct: 0 });
  assert.equal(fishing.calculatePoolSession({ ...settings, fish: [epic], baitKind: "Lure" }).skillGain, null);
  const mixed = fishing.calculatePoolSession({ ...settings, fish: [fish, { ...epic, fish: "Epic competitor" }], baitKind: "Lure" });
  assert.equal(mixed.catches[1], 0);
  assert.equal(mixed.gains[1], 0);
  assert.ok(mixed.skillGain > 0);
});

test("expanded fishing pools retain prerequisite fish without enabling disabled catches", () => {
  for (const name of ["Gugrusaurus", "Lik"]) {
    assert.ok(fishingSnapshot.fish[name].requiredKeyItem > 0);
    assert.equal(fishingSnapshot.fish[name].disabled, false);
    assert.ok(Object.values(fishingSnapshot.areas).some(area => area.allMembers.includes(name)));
    assert.ok(Object.values(fishingSnapshot.areas).every(area => !area.members.includes(name)));
  }
  for (const area of Object.values(fishingSnapshot.areas)) {
    assert.ok(area.members.every(name => area.allMembers.includes(name)));
    assert.ok(area.allMembers.every(name => !fishingSnapshot.fish[name].disabled));
  }
});

test("fish gutting rewards retain the pinned public quest rates and item names", () => {
  const gugrusaurus = fishingSnapshot.guttingRewards.Gugrusaurus;
  const lik = fishingSnapshot.guttingRewards.Lik;
  assert.equal(gugrusaurus.gil, 880);
  assert.equal(lik.gil, 880);
  assert.match(gugrusaurus.items[0].name, /Saber Shoot/i);
  assert.equal(gugrusaurus.items[0].chancePct, 0.4);
  assert.match(lik.items[0].name, /Opal Silk/i);
  assert.equal(lik.items[0].chancePct, 0.5);
  assert.ok(fishingSnapshot.guttingRewards["Moat Carp"] === undefined);
  for (const reward of Object.values(fishingSnapshot.guttingRewards)) {
    for (const item of reward.items) {
      assert.ok(item.chancePct > 0 && item.chancePct <= 100);
      assert.ok(item.min >= 1 && item.max >= item.min);
    }
  }
});

test("general catch planning can complete Lik epic fights with lures", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Ebisu Fishing Rod");
  const fish = { ...fishingSnapshot.fish.Lik, hookBonus: 75 };
  const settings = { baseSkill: 110, bonusSkill: 0, zone: "Lufaise Meadows", rod, fish: [fish], baitKind: "Lure",
    options: { city: false, hasItems: false, hasMobs: false, difficulty: 0 } };
  assert.equal(fishing.calculatePoolSession(settings).catchTimeSeconds, null);
  const plan = fishing.calculatePoolSession({ ...settings, allowEpicLures: true });
  assert.ok(plan.catchTimeSeconds > 0);
  assert.ok(plan.catches[0] > 0 && plan.catches[0] < 31);
  assert.ok(Math.abs(plan.fatigueUsed - 20000) < 1e-8);
  assert.equal(plan.baitNeeded, 1);
  assert.deepEqual(fishing.calculateFishingFight(110, fish, rod, "Lure", true), fishing.calculateFishingFight(110, fish, rod, "Bait"));
  const capped = fishing.calculatePoolSession({ ...settings, baseSkill: 140, allowEpicLures: true });
  assert.equal(capped.skillGain, 0);
  assert.ok(capped.catches[0] > 0);
});

test("daily bait counts landings and canceled bites but excludes no bites", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Carbon Fishing Rod");
  const fish = { ...fishingSnapshot.fish["Black Eel"], skillCap: 100, ranking: 1, hookBonus: 80 };
  const settings = { baseSkill: 100, bonusSkill: 0, zone: "Zeruhn Mines", rod, fish: [fish],
    options: { city: false, hasItems: false, hasMobs: false, difficulty: 0 } };
  const plain = fishing.calculatePoolSession(settings);
  assert.ok(Math.abs(plain.baitNeeded - 200) < 1e-8);
  assert.ok(plain.casts > plain.baitNeeded);
  const crowded = { ...settings, fish: [fish, { ...fish, fish: "Canceled competitor" }],
    excludedFish: ["Canceled competitor"], options: { ...settings.options, hasItems: true, hasMobs: true } };
  const plan = fishing.calculatePoolSession(crowded);
  const odds = fishing.calculateCastOdds(100, rod, crowded.fish, crowded.options);
  const extraBait = plan.casts * (odds.targetPct[1] + odds.itemPct + odds.mobPct) / 100;
  assert.ok(Math.abs(plan.baitNeeded - 200 - extraBait) < 1e-8);
  assert.ok(Math.abs(plan.baitNeeded - plan.casts * (1 - odds.nothingPct / 100)) < 1e-8);
  assert.equal(fishing.calculatePoolSession({ ...crowded, baitKind: "Lure" }).baitNeeded, 1);
  assert.equal(fishing.calculatePoolSession({ ...settings, fish: [] }).baitNeeded, null);
});

test("daily bait counts natural snaps and breaks, but not pre-rolled escapes", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Bamboo Fishing Rod");
  const fish = { ...fishingSnapshot.fish.Crayfish, skillCap: 140, hookBonus: 80 };
  const settings = { baseSkill: 100, bonusSkill: 0, zone: "Zeruhn Mines", rod, fish: [fish],
    options: { city: false, hasItems: true, hasMobs: true, difficulty: 0 } };
  const plan = fishing.calculatePoolSession(settings);
  assert.ok(plan.skillGain < 1);
  assert.ok(Math.abs(plan.fatigueUsed - 20000) < 1e-8);
  const risk = fishing.calculateRodRisk(100, fish, rod);
  const odds = fishing.calculateCastOdds(100, rod, [fish], settings.options);
  const escaped = plan.casts * odds.targetPct[0] / 100 * risk.escapePct / 100;
  const snapped = plan.casts * odds.targetPct[0] / 100 * (1 - risk.escapePct / 100) * risk.snapPct / 100;
  const broken = plan.casts * odds.targetPct[0] / 100 * (1 - risk.escapePct / 100) * (1 - risk.snapPct / 100) * risk.breakPct / 100;
  const canceled = plan.casts * (odds.itemPct + odds.mobPct) / 100;
  assert.ok(snapped > 0 && broken > 0 && escaped > 0);
  assert.ok(Math.abs(plan.baitNeeded - plan.catches[0] - snapped - broken - canceled) < 1e-8);
  assert.ok(Math.abs(plan.baitNeeded - plan.casts * (1 - odds.nothingPct / 100) + escaped) < 1e-8);
});

test("daily sessions stop at 20,000 fatigue for fish far above skill", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Carbon Fishing Rod");
  for (const difference of [22, 32]) {
    for (const size of ["S", "L"]) {
      const fish = { ...fishingSnapshot.fish["Black Eel"], skillCap: 5 + difference, ranking: 1, size, hookBonus: 80 };
      const settings = { baseSkill: 5, bonusSkill: 0, zone: "Zeruhn Mines", rod, fish: [fish],
        options: { city: false, hasItems: false, hasMobs: false, difficulty: 0 } };
      const plan = fishing.calculatePoolSession(settings);
      assert.ok(Math.abs(plan.fatigueUsed - 20000) < 1e-8);
      assert.ok(plan.catches[0] > 0 && plan.catches[0] < 200);
      assert.ok(plan.skillGain > 0 && plan.skillGain < 5);
      assert.ok(Math.abs(plan.gains[0] - plan.skillGain) < 1e-8);
      const odds = fishing.calculateCastOdds(5, rod, [fish], settings.options);
      const oldGain = fishing.calculatePoolSkillup(5, 5, settings.zone, rod, [fish], odds.targetPct).totalGain;
      const oldCasts = 200 / (odds.targetPct[0] / 100 * fishing.calculateRodRisk(5, fish, rod).landPct / 100);
      assert.ok(plan.skillGain < oldCasts * oldGain / 100);
      const boosted = fishing.calculatePoolSession({ ...settings, bonusSkill: difference });
      assert.ok(Math.abs(boosted.catches[0] - 200) < 1e-8);
      assert.ok(boosted.fatigueUsed < 20000);
    }
  }
});

test("daily fatigue weights landings and failed fights with rod discounts", () => {
  for (const rodName of ["Carbon Fishing Rod", "Lu Shang's Fishing Rod", "Ebisu Fishing Rod"]) {
    const rod = fishingSnapshot.rods.find(row => row.rod === rodName);
    assert.ok(rod, rodName);
    const fish = { ...fishingSnapshot.fish["Black Eel"], skillCap: 140, ranking: 1, hookBonus: 80 };
    const options = { city: false, hasItems: false, hasMobs: false, difficulty: 0 };
    const plan = fishing.calculatePoolSession({ baseSkill: 100, bonusSkill: 0, zone: "Zeruhn Mines", rod, fish: [fish], options });
    const odds = fishing.calculateCastOdds(100, rod, [fish], options);
    const landed = fishing.calculateRodRisk(100, fish, rod).landPct / 100;
    const cost = landed * fishing.fishingFatigue(100, fish, rod)
      + (1 - landed) * fishing.fishingFatigue(100, fish, rod, true);
    const attempts = 20000 / cost;
    assert.ok(plan.skillGain > 0 && plan.skillGain < 1);
    assert.ok(Math.abs(plan.casts - attempts / (odds.targetPct[0] / 100)) < 1e-8);
    assert.ok(Math.abs(plan.catches[0] - attempts * landed) < 1e-8);
    assert.ok(Math.abs(plan.fatigueUsed - 20000) < 1e-8);
  }
});

test("daily fatigue drops when expected skill crosses the 17-level penalty boundary", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Carbon Fishing Rod");
  const fish = { ...fishingSnapshot.fish["Black Eel"], skillCap: 22, ranking: 1, hookBonus: 80 };
  const options = { city: false, hasItems: false, hasMobs: false, difficulty: 0 };
  const plan = fishing.calculatePoolSession({ baseSkill: 5.9, bonusSkill: 0, zone: "Zeruhn Mines", rod, fish: [fish], options });
  assert.ok(plan.skillGain > 0.1);
  assert.ok(Math.abs(plan.catches[0] - 200) < 1e-8);
  assert.ok(plan.fatigueUsed > 5000 && plan.fatigueUsed < 10000);
});

test("200-catch sessions retain canceled bites, remove their gains, and advance skill", () => {
  const area = fishingSnapshot.areas["westronfaure|knightwell"];
  const rod = fishingSnapshot.rods.find(row => row.rod === "Tarutaru Fishing Rod");
  const bait = fishingSnapshot.baits["Little Worm"];
  const members = area.members.map(name => fishingSnapshot.fish[name]);
  const fish = members.filter(member => !member.item && bait.fish[member.fish] !== undefined)
    .map(member => ({ ...member, hookBonus: bait.fish[member.fish] }));
  const settings = { baseSkill: 5, bonusSkill: 0, zone: "West Ronfaure", rod, fish, options: { ...area, ...bait, city: false, hasItems: members.some(member => member.item) } };
  const all = fishing.calculatePoolSession(settings);
  const small = fishing.calculatePoolSession({ ...settings, excludedFish: ["Giant Catfish"] });
  const catfishIndex = fish.findIndex(member => member.fish === "Giant Catfish");
  assert.equal(small.catches[catfishIndex], 0);
  assert.equal(small.gains[catfishIndex], 0);
  assert.ok(small.casts > all.casts);
  assert.ok(Math.abs(small.catches.reduce((sum, value) => sum + value, 0) - 200) < 1e-8);
  assert.ok(Math.abs(small.gains.reduce((sum, value) => sum + value, 0) - small.skillGain) < 1e-8);
  const physicallyRemoved = fishing.calculatePoolSession({ ...settings, fish: fish.filter(member => member.fish !== "Giant Catfish") });
  assert.ok(small.casts > physicallyRemoved.casts);
  assert.ok(small.catchTimeSeconds > physicallyRemoved.catchTimeSeconds);
  assert.ok(Math.abs(small.fatigueUsed - physicallyRemoved.fatigueUsed) < 1e-8);
  const slowCancels = fishing.calculatePoolSession({ ...settings, excludedFish: ["Giant Catfish"], timing: { fishSeconds: 30, otherSeconds: 30 } });
  assert.ok(slowCancels.catchTimeSeconds > small.catchTimeSeconds);
  assert.deepEqual(slowCancels.catches, small.catches);
  assert.equal(slowCancels.skillGain, small.skillGain);
  const crayfishOnly = fishing.calculatePoolSession({ ...settings, excludedFish: ["Moat Carp", "Giant Catfish"] });
  assert.ok(Math.abs(crayfishOnly.skillGain - 2) < 1e-8);
  assert.ok(Math.abs(crayfishOnly.catches[fish.findIndex(member => member.fish === "Crayfish")] - 200) < 1e-8);
  const none = fishing.calculatePoolSession({ ...settings, excludedFish: fish.map(member => member.fish) });
  assert.equal(none.skillGain, null);
  assert.equal(none.catchTimeSeconds, null);
  const capped = fishing.calculatePoolSession({ ...settings, baseSkill: 7, excludedFish: ["Moat Carp", "Giant Catfish"] });
  assert.equal(capped.skillGain, 0);
  assert.ok(capped.catchTimeSeconds > 0);
  const capStartingPoint = fishing.calculatePoolSession({ ...settings, baseSkill: 7, excludedFish: ["Giant Catfish"] });
  const carpOnly = fishing.calculatePoolSession({ ...settings, baseSkill: 7, excludedFish: ["Giant Catfish", "Crayfish"] });
  assert.ok(carpOnly.skillGain > capStartingPoint.skillGain);
  assert.ok(carpOnly.skillGain <= 4);
  const nearCap = fishing.calculatePoolSession({ ...settings, baseSkill: 6.9, excludedFish: ["Moat Carp", "Giant Catfish"] });
  assert.ok(Math.abs(nearCap.skillGain - 0.1) < 1e-8);
  const impossible = fishing.calculatePoolSession({ ...settings, fish: [{ ...fish[0], skillCap: 100 }] });
  assert.equal(impossible.catchTimeSeconds, null);
  assert.equal(impossible.skillGain, null);
  assert.equal(fishing.calculatePoolSession({ ...settings, timing: { fishSeconds: 0, otherSeconds: 20 } }).skillGain, null);
  assert.equal(fishing.calculatePoolSession({ ...settings, fish: [] }).skillGain, null);
  assert.deepEqual(fishing.calculatePoolSession(settings), all);
});

test("planner groups equivalent zone rows while retaining every sublocation and bait", () => {
  const first = {
    zone: "East Sarutabaruta", fish: "Moat Carp", rod: "Carbon Fishing Rod",
    targetGain: 2.454, targetPct: 57.1, fishPct: 60, landPct: 97, escapePct: 3, snapPct: 0,
    breakPct: 0, effectiveSkill: 0, area: "Lake", bait: "Insect Paste", itemHazards: "", catchTimeSeconds: 10000, targetFishPer200: 180, skillGainPer200: 3,
  };
  const alternate = { ...first, area: "River", bait: "Other bait", itemHazards: "Rusty Bucket" };
  const changes = { zone: "West Sarutabaruta", fish: "Other fish", rod: "Other rod", targetGain: 2.45401, targetPct: 57.11, fishPct: 70, landPct: 96, escapePct: 4, snapPct: 1, breakPct: 1, effectiveSkill: 1, catchTimeSeconds: 12000, targetFishPer200: 160, skillGainPer200: 4 };
  const separate = Object.entries(changes).map(([key, value]) => ({ ...first, [key]: value }));
  const groups = fishing.groupSkillupRows([first, ...separate, alternate]);
  assert.equal(groups.length, separate.length + 1);
  assert.deepEqual(groups[0].rows, [first, alternate]);
  assert.deepEqual(groups.slice(1).map(group => group.rows[0]), separate);
  assert.equal(groups.flatMap(group => group.rows).length, separate.length + 2);
  assert.equal(fishing.groupSkillupRows([alternate, first])[0].key, groups[0].key);
  assert.deepEqual(fishing.groupSkillupRows([]), []);
});
test("Moat Carp target gain reflects Insect Paste versus Little Worm competition", () => {
  const area = fishingSnapshot.areas["eastsarutabaruta|laketepokalipuka"];
  const rod = fishingSnapshot.rods.find(row => row.rodId === 17389);
  const estimates = ["Ball of Insect Paste", "Little Worm"].map(name => {
    const bait = fishingSnapshot.baits[name];
    const members = area.members.map(member => fishingSnapshot.fish[member]);
    const fish = members.filter(member => !member.item && bait.fish[member.fish] !== undefined)
      .map(member => ({ ...member, hookBonus: bait.fish[member.fish] }));
    const odds = fishing.calculateCastOdds(0, rod, fish, { ...area, ...bait, city: false, hasItems: members.some(member => member.item) });
    const gain = fishing.calculatePoolSkillup(0, 0, "East Sarutabaruta", rod, fish, odds.targetPct);
    const targetIndex = fish.findIndex(member => member.fish === "Moat Carp");
    return { targetPct: odds.targetPct[targetIndex], targetGain: gain.gains[targetIndex], poolGain: gain.totalGain };
  });
  const [paste, worm] = estimates;
  assert.ok(paste.targetPct > 2 * worm.targetPct);
  assert.ok(paste.targetGain > 2 * worm.targetGain);
  assert.ok(Math.abs(paste.targetGain / worm.targetGain - paste.targetPct / worm.targetPct) < 1e-10);
  assert.ok(worm.poolGain > worm.targetGain);
});
test("Phoenix lake snapshot separates carp bites and item rod-break hazards", () => {
  assert.equal(fishingSnapshot.source.revision, "8d2e0c0de9869317775ba2aec908e5dd8034dda4");
  const area = fishingSnapshot.areas["eastsarutabaruta|laketepokalipuka"];
  const bait = fishingSnapshot.baits["Ball of Insect Paste"];
  const rod = fishingSnapshot.rods.find(row => row.rodId === 17389);
  assert.equal(rod.maxRank, 7);
  const members = area.members.map(name => fishingSnapshot.fish[name]);
  const fish = members.filter(member => !member.item && bait.fish[member.fish] !== undefined)
    .map(member => ({ ...member, hookBonus: bait.fish[member.fish] }));
  assert.deepEqual(fish.map(member => member.fish), ["Moat Carp"]);
  const options = { ...area, ...bait, city: false, hasItems: members.some(member => member.item) };
  const odds = fishing.calculateCastOdds(0, rod, fish, options);
  const gain = fishing.calculatePoolSkillup(0, 0, "East Sarutabaruta", rod, fish, odds.targetPct);
  assert.ok(Math.abs(odds.itemPct - 100 * 25 / 210) < 1e-10);
  assert.ok(Math.abs(gain.totalGain - (25 / 60) * 0.10625 * 0.97 * (120 / 210) * 100) < 1e-10);
  const hazards = members.filter(member => member.item && fishing.calculateRodRisk(0, member, rod).breakPct > 0);
  assert.deepEqual(hazards.map(member => member.fish), ["Rusty Bucket", "Rusty Leggings"]);
  assert.equal(fishing.calculateRodRisk(0, fishingSnapshot.fish["Rusty Leggings"], rod).breakPct, 20);
  assert.equal(fishing.calculateRodRisk(0, { ...fish[0], item: true, skillCap: 50 }, rod).escapePct, 0);
});
test("pool yield counts all eligible fish and cannot be confused with target-only yield", () => {
  const rod = fishingSnapshot.rods.find(row => row.rodId === 17389);
  const first = { ...fishingSnapshot.fish["Moat Carp"], hookBonus: 80 };
  const second = { ...first, fish: "Other", skillCap: 7, hookBonus: 35 };
  const options = { city: false, hasItems: true, hasMobs: true, difficulty: 0 };
  const fish = [first, second];
  const odds = fishing.calculateCastOdds(0, rod, fish, options);
  assert.ok(Math.abs(odds.targetPct.reduce((sum, value) => sum + value, 0) - odds.fishPct) < 1e-10);
  const gain = fishing.calculatePoolSkillup(0, 0, "East Sarutabaruta", rod, fish, odds.targetPct);
  assert.equal(gain.totalGain, gain.gains[0] + gain.gains[1]);
  assert.ok(gain.totalGain > gain.gains[0]);
  assert.ok(gain.gains[0] < fishing.calculatePoolSkillup(0, 0, "East Sarutabaruta", rod, [first], [100]).totalGain);
  assert.equal(fishing.calculatePoolSkillup(11, 11, "East Sarutabaruta", rod, fish, odds.targetPct).totalGain, 0);
  assert.equal(fishing.isCityFishingZone("Southern San d'Oria"), true);
  const noItems = fishing.calculateCastOdds(0, rod, fish, { ...options, hasItems: false, hasMobs: false });
  assert.equal(noItems.itemPct, 0);
  assert.equal(noItems.mobPct, 0);
  assert.ok(noItems.nothingPct > odds.nothingPct);
});
test("cast odds include junk, monsters and empty casts independently of target landing", () => {
  const rod = { rodId: 17389, size: "S", minRank: 1, maxRank: 7, legendary: false, breakable: true };
  const carp = { fish: "Moat Carp", skillCap: 11, ranking: 7, size: "S", legendary: false, hookBonus: 80, rarity: 1 };
  const odds = fishing.calculateCastOdds(0, rod, [carp], { city: false, hasItems: true, hasMobs: true, difficulty: 0 });
  assert.equal(fishing.calculateHookWeight(0, carp, rod), 120);
  assert.ok(Math.abs(odds.fishPct - 100 * 120 / 210) < 1e-10);
  assert.ok(Math.abs(odds.itemPct - 100 * 25 / 210) < 1e-10);
  assert.equal(odds.targetPct[0], odds.fishPct);
  assert.ok(Math.abs(odds.fishPct + odds.itemPct + odds.mobPct + odds.nothingPct - 100) < 1e-10);
  assert.equal(fishing.calculateRodRisk(0, carp, rod).landPct, 97);
  const empty = fishing.calculateCastOdds(0, rod, [], { city: true, hasItems: false, hasMobs: false, difficulty: 0 });
  assert.equal(empty.nothingPct, 100);
  const weakBait = { ...carp, hookBonus: 35, skillCap: 60 };
  assert.ok(fishing.calculateHookWeight(0, weakBait, rod) < fishing.calculateHookWeight(50, weakBait, rod));
  const difficult = fishing.calculateCastOdds(0, rod, [carp], { city: false, hasItems: true, hasMobs: true, difficulty: 2 });
  assert.ok(difficult.fishPct < odds.fishPct);
});
test("Phoenix escape prioritizes certain skill loss and preserves uint8 durability", () => {
  const rod = { size: "L", minRank: 20, maxRank: 30, legendary: false, breakable: true };
  const fish = { fish: "Test", skillCap: 100, ranking: 10, size: "S", legendary: false };
  assert.equal(fishing.calculateRodRisk(0, fish, rod).escapePct, 100);
  assert.equal(fishing.calculateRodRisk(0, { ...fish, ranking: 21 }, rod).escapePct, 100);
  assert.equal(fishing.calculateRodRisk(0, { ...fish, size: "L", legendary: true }, { ...rod, size: "S", maxRank: 1 }).snapPct, 0);
  assert.equal(fishing.getRodHiddenSuccessBonus("Lu Shang's Fishing Rod"), 0);
  assert.equal(fishing.getRodHiddenSuccessBonus("Ebisu Fishing Rod"), 0);
  const risk = fishing.calculateRodRisk(60, { ...fish, size: "L", ranking: 40 }, rod);
  assert.equal(risk.skillupResolvePct, 100 - risk.escapePct);
  assert.ok(risk.skillupResolvePct > risk.landPct);
});

test("Phoenix Bamboo can snap and break on Crayfish regardless of angler skill", () => {
  const rod = fishingSnapshot.rods.find(row => row.rod === "Bamboo Fishing Rod");
  const fish = fishingSnapshot.fish.Crayfish;
  assert.equal(rod.maxRank, 7);
  assert.equal(fish.ranking, 8);
  for (const skill of [0, 2, 7, 100]) {
    const risk = fishing.calculateRodRisk(skill, fish, rod);
    assert.equal(risk.escapePct, 0);
    assert.equal(risk.snapPct, 19);
    assert.equal(risk.breakPct, 10);
    assert.ok(Math.abs(risk.landPct - 72.9) < 1e-10);
    assert.ok(Math.abs((1 - risk.snapPct / 100) * risk.breakPct - 8.1) < 1e-10);
    assert.equal(risk.skillupResolvePct, 100);
  }
});

test("Phoenix public regression cases for snap and break thresholds and caps", () => {
  const rod = { size: "S", minRank: 1, maxRank: 10, legendary: false, breakable: true };
  const fish = { fish: "Test", skillCap: 10, size: "S", legendary: false };
  for (const [ranking, snapPct, breakPct] of [[10, 0, 0], [11, 19, 10], [12, 38, 20], [13, 55, 20], [24, 55, 20], [37, 55, 20]]) {
    for (const skill of [0, 100]) {
      const risk = fishing.calculateRodRisk(skill, { ...fish, ranking }, rod);
      assert.equal(risk.snapPct, snapPct);
      assert.equal(risk.breakPct, breakPct);
    }
  }
  assert.equal(fishing.calculateRodRisk(0, { ...fish, ranking: 100, size: "L", legendary: true }, { ...rod, breakable: false }).breakPct, 0);
});

test("Phoenix public regression cases for size and skill escape rules", () => {
  const rod = { size: "L", minRank: 1, maxRank: 10, legendary: false, breakable: true };
  const fish = { fish: "Test", skillCap: 20, size: "S", ranking: 10, legendary: false };
  for (const skill of [20, 100]) {
    for (const ranking of [0, 10]) {
      assert.equal(fishing.calculateRodRisk(skill, { ...fish, ranking }, rod).escapePct, 36);
    }
  }
  for (const skillCap of [50, 100]) {
    assert.equal(fishing.calculateRodRisk(100, { ...fish, skillCap }, rod).escapePct, 90);
  }
  assert.equal(fishing.calculateRodRisk(100, fish, { ...rod, legendary: true }).escapePct, 0);
  for (const [skillCap, expected] of [[27, 0], [28, 0], [29, 1], [69, 33], [70, 100], [71, 100]]) {
    assert.equal(fishing.calculateRodRisk(20, { ...fish, skillCap }, { ...rod, size: "S" }).escapePct, expected);
  }
  assert.equal(fishing.calculateRodRisk(0, { ...fish, skillCap: 100, item: true }, { ...rod, size: "S" }).escapePct, 0);
  assert.equal(fishing.calculateRodRisk(0, { ...fish, size: "L", skillCap: 51, ranking: 11 }, { ...rod, size: "S" }).escapePct, 100);
  assert.equal(fishing.calculateRodRisk(100, { ...fish, size: "L", skillCap: 18, ranking: 16 }, { ...rod, size: "S" }).escapePct, 0);
});

test("era crafting thresholds at 50 and 60", () => {
  assert.equal(craft.eraSkillupChance(499), 0.6);
  assert.equal(craft.eraSkillupChance(500), 0.25);
  assert.ok(craft.averageGainPerSkillup(599, 14) > 0.1);
  assert.equal(craft.averageGainPerSkillup(600, 14), 0.1);
});
test("era crafting cap and 15-level eligibility window", () => {
  assert.equal(craft.craftSkillupStats(500, 50, false).eligible, false);
  assert.equal(craft.craftSkillupStats(350, 50, false).craftable, true);
  assert.equal(craft.craftSkillupStats(349, 50, false).craftable, false);
  assert.equal(craft.craftSkillupStats(350, 50, false).chanceOnSuccessPct, 60);
});
test("broken synth skill-up window and desynthesis penalty", () => {
  assert.equal(craft.craftSkillupStats(450, 50, false).chanceOnFailPct, 30);
  assert.equal(craft.craftSkillupStats(440, 50, false).chanceOnFailPct, 0);
  assert.equal(craft.craftSkillupStats(450, 50, true).chanceOnSuccessPct, 30);
  assert.ok(Math.abs(craft.craftSkillupStats(450, 50, true).chanceOnFailPct - 20) < 1e-10);
});
test("support changes completion but not raw skill-up rolls", () => {
  const base = craft.craftSkillupStats(440, 50, false);
  const supported = craft.craftSkillupStats(440, 50, false, 3);
  assert.ok(supported.successPct > base.successPct);
  assert.equal(supported.chanceOnFailPct, 0);
  assert.equal(supported.chanceOnSuccessPct, base.chanceOnSuccessPct);
  assert.equal(supported.avgGain, base.avgGain);
  assert.equal(craft.craftSkillupStats(500, 50, false, 0, 1).successPct, 95 * 0.95);
});
test("neutral fishing eligibility window and base-skill truncation", () => {
  assert.equal(fishing.calculateSkillup(50, 50, "Selbina", "Composite Fishing Rod").eligible, false);
  assert.equal(fishing.calculateSkillup(50, 100, "Selbina", "Composite Fishing Rod").eligible, true);
  assert.equal(fishing.calculateSkillup(50, 101, "Selbina", "Composite Fishing Rod").eligible, false);
  assert.deepEqual(fishing.calculateSkillup(50.9, 61, "Selbina", "Composite Fishing Rod"), fishing.calculateSkillup(50, 61, "Selbina", "Composite Fishing Rod"));
});
test("neutral fishing city and Lu Shang penalties", () => {
  const city = fishing.calculateSkillup(40, 51, "Selbina", "Composite Fishing Rod");
  const outside = fishing.calculateSkillup(40, 51, "Buburimu Peninsula", "Composite Fishing Rod");
  const luShang = fishing.calculateSkillup(40, 51, "Selbina", "Lu Shang's Fishing Rod");
  assert.ok(Math.abs(city.chancePct - 100 * 17 / 83) < 1e-10);
  assert.ok(outside.chancePct > city.chancePct);
  assert.ok(luShang.chancePct < city.chancePct);
  assert.ok(Math.abs(city.expectedGainPerTargetHook - city.chancePct / 100 * 0.10625) < 1e-10);
});