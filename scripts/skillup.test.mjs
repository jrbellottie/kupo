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
test("time for 200 fish weights 30-second fish attempts and 12-second canceled casts", () => {
  assert.equal(fishing.calculateCatchTime({ fishPct: 100, targetPct: 100, landPct: 100 }), 6000);
  assert.equal(fishing.calculateCatchTime({ fishPct: 50, targetPct: 50, landPct: 100 }), 8400);
  assert.equal(fishing.calculateCatchTime({ fishPct: 50, targetPct: 50, landPct: 50 }), 16800);
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
  const expected = 200 * (0.6 * 30 + 0.4 * 12) / (0.4 * (1 - risk.escapePct / 100) * (1 - risk.snapPct / 100) * (1 - risk.breakPct / 100));
  assert.ok(Math.abs(seconds - expected) < 1e-8);
  assert.equal(fishing.calculateCatchTime({ fishPct: 60, targetPct: 40, landPct: risk.landPct / 2 }), seconds * 2);
});

test("impossible catches have no finite completion estimate", () => {
  for (const odds of [{ fishPct: 0, targetPct: 0, landPct: 100 }, { fishPct: 100, targetPct: 100, landPct: 0 }, { fishPct: 50, targetPct: 60, landPct: 100 }, { fishPct: NaN, targetPct: 50, landPct: 100 }]) {
    assert.equal(fishing.calculateCatchTime(odds), null);
  }
  assert.equal(fishing.formatCatchTime(null), "Not catchable");
});

test("planner groups equivalent zone rows while retaining every sublocation and bait", () => {
  const first = {
    zone: "East Sarutabaruta", fish: "Moat Carp", rod: "Carbon Fishing Rod",
    targetGain: 2.454, targetPct: 57.1, fishPct: 60, landPct: 97, escapePct: 3, snapPct: 0,
    breakPct: 0, effectiveSkill: 0, area: "Lake", bait: "Insect Paste", itemHazards: "",
  };
  const alternate = { ...first, area: "River", bait: "Other bait", itemHazards: "Rusty Bucket" };
  const changes = { zone: "West Sarutabaruta", fish: "Other fish", rod: "Other rod", targetGain: 2.45401, targetPct: 57.11, fishPct: 70, landPct: 96, escapePct: 4, snapPct: 1, breakPct: 1, effectiveSkill: 1 };
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