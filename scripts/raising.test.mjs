import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: ["src/utils/chocoboRaising.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { RAISING, STAT_KEYS, STAT_BANDS, PROJECTION_FOODS, foodStatText, foodEffects, projectFoodOnly, validateFoodProjection, ridingEstimate, statRank, carePlanRange, applyRaisingStatChanges } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const plannerBundle = buildSync({ entryPoints: ["src/utils/chocoboRaisingPlanner.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { RAISING_ABILITIES, RAISING_PRESETS, STORY_ATTEMPTS_95, LAST_RAISING_DAY, RAISING_START_KEY, RAISING_SAVED_STARTS_KEY, parseSavedRaisingStarts, validateRaisingGoal, planRaisingGoal, applyTrainingAction, trainingActionName, storyLearningProbability, careAvailableDay, maxManualShortWalks, trainingFoodLimit, trainingFoodTotals, groupTrainingDays, raisingDayAt, parseRaisingStart, localRaisingStart } = await import(`data:text/javascript;base64,${Buffer.from(plannerBundle.outputFiles[0].text).toString("base64")}`);
const dailyBundle = buildSync({ entryPoints: ["src/utils/raisingDaily.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { RAISING_DAILY_KEY, parseSavedRaisingDaily, dailyProgress, todayCare, tomorrowCare, recordArrangedCare, feedingInputKey, plannerColorGoal } = await import(`data:text/javascript;base64,${Buffer.from(dailyBundle.outputFiles[0].text).toString("base64")}`);
const colorBundle = buildSync({ entryPoints: ["src/utils/chocoboColor.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { CHOCOBO_COLORS, PARASITE_WORM_ID, geneColor, eggGeneDistribution, chocoboColorOdds, colorStrategy } = await import(`data:text/javascript;base64,${Buffer.from(colorBundle.outputFiles[0].text).toString("base64")}`);
const feedingBundle = buildSync({ entryPoints: ["src/utils/chocoboFeeding.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { AFFECTION_TARGET, AFFECTION_REPORTS, HUNGER_REPORTS, FEEDING_FOODS, BIRD_AILMENTS, healthGuidance, needsHealthAttention, treatmentFoods, recordMedicineEaten, validateFeedingReport, feedingOptions, feedingFood, feedingSummary, careSuccessChance } = await import(`data:text/javascript;base64,${Buffer.from(feedingBundle.outputFiles[0].text).toString("base64")}`);
const eventsBundle = buildSync({ entryPoints: ["src/utils/raisingEvents.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { LOST_CHICK_OWNERS, RAISING_EVENTS, RAISING_STORY_KEY_ITEMS, filterLostChickOwners, raisingEventGuidance, raisingMilestoneGuidance, raisingStoryKeyItemGuidance, validLostChickClues, validRaisingEvents, validRaisingStoryKeyItems } = await import(`data:text/javascript;base64,${Buffer.from(eventsBundle.outputFiles[0].text).toString("base64")}`);
const food = name => {
  const found = RAISING.foods.find(entry => entry.name === name);
  assert.ok(found, `Missing ${name}`);
  return found;
};
const stats = (strength = 0, endurance = 0, discernment = 0, receptivity = 0) => ({ strength, endurance, discernment, receptivity });
const goal = (patch = {}) => ({
  current: stats(), target: stats(32, 224, 160, 224), desiredAbilities: ["Bore", "Burrow"], knownAbilities: [],
  priority: "endurance", currentDay: 0, ...patch,
});

test("raising has an independent immutable source pin and complete numeric tables", () => {
  assert.equal(RAISING.source.repository, "https://github.com/phoenixffxi/Phoenix");
  assert.equal(RAISING.source.revision, "9b93232a0cc1e4a5a50b0f988f37d7ae63b8fcfa");
  assert.equal(RAISING.foods.length, 24);
  assert.equal(RAISING.plans.length, 13);
  assert.equal(RAISING.abilities.length, 6);
  assert.equal(new Set(RAISING.foods.map(entry => entry.id)).size, 24);
  for (const hash of Object.values(RAISING.source.inputs)) assert.match(hash, /^[a-f0-9]{64}$/);
  for (const path of ["modules/init.txt", "modules/custom/lua/chocobo_raising_qol.lua", "scripts/globals/hobbies/chocobo_raising/event_vm.lua", "scripts/globals/hobbies/chocobo_raising/care_plan.lua", "scripts/globals/hobbies/chocobo_raising/walks.lua"]) assert.ok(RAISING.source.inputs[path]);
  for (const entry of RAISING.foods) {
    assert.deepEqual(Object.keys(entry.stats), STAT_KEYS);
    assert.ok(entry.name && entry.id > 0);
    assert.ok(entry.random.fields.every(key => STAT_KEYS.includes(key)));
    for (const variant of [entry, entry.chick]) assert.ok(Number.isFinite(variant.affection) && Number.isFinite(variant.fullness));
  }
});

test("default day, caps and milestones do not enable the optional accelerated module", () => {
  const s = RAISING.settings;
  assert.equal(s.dayLength, 86400);
  assert.deepEqual([s.daysToChick, s.daysToAdolescent, s.daysToAdult1, s.daysToAdult2, s.daysToAdult3, s.daysToAdult4], [4, 19, 29, 43, 64, 129]);
  assert.equal(s.statGrowthCap, 640);
  assert.equal(s.statPositiveMultiplier, 1);
  assert.equal(s.statNegativeMultiplier, 1);
  assert.equal(s.disableRetirement, false);
});

test("trainer descriptions cover every point in the eight stat bands", () => {
  assert.deepEqual(STAT_BANDS.map(band => [band.description, band.grade, band.min, band.max]), [
    ["Poor", "F", 0, 31], ["Substandard", "E", 32, 63], ["A bit deficient", "D", 64, 95],
    ["Average", "C", 96, 127], ["Better than average", "B", 128, 159], ["Impressive", "A", 160, 191],
    ["Outstanding", "S", 192, 223], ["First-class", "SS", 224, 255],
  ]);
  for (let value = 0; value <= 255; value++) {
    const band = STAT_BANDS[statRank(value)];
    assert.ok(value >= band.min && value <= band.max);
    assert.equal(STAT_BANDS.filter(entry => value >= entry.min && value <= entry.max).length, 1);
  }
});

test("egg color odds retain all five pinned distributions without implying breeding odds", () => {
  const colors = ["yellow", "black", "blue", "red", "green"];
  assert.deepEqual(RAISING.eggColorOdds.map(egg => [egg.id, egg.name, ...colors.map(color => egg[color])]), [
    [2312, "Faintly warm", 95, 3, 1, 0.5, 0.5],
    [2314, "Slightly warm", 85, 5, 3.4, 3.3, 3.3],
    [2317, "A bit warm", 75, 10, 5, 5, 5],
    [2318, "A little warm", 32, 18, 18, 16, 16],
    [2319, "Somewhat warm", 12, 22, 22, 22, 22],
  ]);
  for (const egg of RAISING.eggColorOdds) {
    assert.equal(colors.reduce((sum, color) => sum + egg[color], 0), 100);
    assert.ok(colors.every(color => egg[color] > 0 && egg[color] < 100));
  }
  assert.equal(food("Parasite Worm").rerollGene, true);
  assert.equal(food("Vomp Carrot").rerollGene, false);
  assert.equal(food("Zegham Carrot").rerollGene, false);
});

test("Vomp and Zegham have opposite physical and mental tradeoffs", () => {
  assert.equal(food("Vomp Carrot").id, 5607);
  assert.deepEqual(food("Vomp Carrot").stats, stats(2, 2, -2, -2));
  assert.deepEqual(food("Zegham Carrot").stats, stats(-2, -2, 2, 2));
  assert.equal(food("Vomp Carrot").fullness, 64);
  assert.equal(food("Zegham Carrot").fullness, 96);
  assert.equal(food("Vomp Carrot").affection, 24);
});

test("one Vomp every day for 30 days reports signed contributions and floored results separately", () => {
  const initial = stats();
  const result = projectFoodOnly(food("Vomp Carrot"), initial, 30, 1);
  assert.equal(result.items, 30);
  assert.deepEqual(result.nominal, stats(60, 60, -60, -60));
  assert.deepEqual(result.result, stats(60, 60, 0, 0));
  assert.deepEqual(initial, stats(), "does not mutate caller inputs");
  assert.deepEqual(projectFoodOnly(food("Vomp Carrot"), stats(50, 50, 100, 100), 30, 1).result, stats(110, 110, 40, 40));
});

test("food simulation respects the source's sequential total cap and per-stat floor/cap", () => {
  assert.deepEqual(projectFoodOnly(food("Vomp Carrot"), stats(200, 200, 120, 120), 1, 1).result, stats(200, 200, 118, 118));
  assert.deepEqual(projectFoodOnly(food("Vomp Carrot"), stats(200, 200, 120, 120), 2, 1).result, stats(202, 202, 116, 116));
  assert.deepEqual(projectFoodOnly(food("Zegham Carrot"), stats(200, 200, 120, 120), 1, 1).result, stats(198, 198, 122, 122));
  assert.deepEqual(projectFoodOnly(food("Vomp Carrot"), stats(254, 254, 2, 2), 1, 4).result, stats(255, 255, 0, 0));
  for (const entry of PROJECTION_FOODS) {
    const result = projectFoodOnly(entry, stats(160, 160, 160, 160), 128, 4).result;
    assert.ok(Object.values(result).every(value => value >= 0 && value <= 255));
    assert.ok(Object.values(result).reduce((sum, value) => sum + value, 0) <= 640);
  }
});

test("random food changes are described as a single roll, never a deterministic projection", () => {
  assert.equal(foodStatText(food("Sharug Greens"), "strength"), "+2 (7.5%)");
  assert.equal(foodStatText(food("Azouph Greens"), "discernment"), "+2 (7.5%)");
  assert.match(foodStatText(food("Ball of Carrot Paste"), "strength"), /\+\/-2 \(25%, equal \+\/- odds\)/);
  assert.match(foodEffects(food("Ball of Carrot Paste"), true), /One random stat roll per item \(100% trigger\)/);
  assert.equal(PROJECTION_FOODS.length, 4);
  assert.throws(() => projectFoodOnly(food("Ball of Carrot Paste"), stats(), 30, 1), /deterministic/);
});

test("paste effects use chick overrides without discarding shared effects", () => {
  const herb = food("Ball of Herb Paste");
  assert.equal(herb.affection, -48);
  assert.equal(herb.chick.affection, 48);
  assert.equal(herb.fullness, 32);
  assert.equal(herb.chick.fullness, 64);
  assert.equal(herb.cures.length, 0);
  assert.deepEqual(herb.chick.cures, ["stomachache", "sick", "very ill", "injured"]);
  assert.equal(food("Ball of Carrot Paste").chick.fullness, 160);
  assert.equal(food("Ball of Carrot Paste").affection, 72);
  assert.equal(food("Ball of Worm Paste").chick.affection, 72);
});

test("medicine, worms and ability removal expose non-stat consequences", () => {
  assert.match(foodEffects(food("Chocotonic"), false), /Wakes immediately/);
  assert.equal(food("Chocotonic").affection, -48);
  assert.equal(food("Chocolixir").energy, 100);
  assert.equal(food("Gregarious Worm").energy, 20);
  assert.deepEqual(food("Gregarious Worm").stats, stats(0, 0, -2, -2));
  assert.match(foodEffects(food("Parasite Worm"), true), /Rerolls one color gene/);
  for (const entry of RAISING.foods.filter(entry => entry.forgetsAbility)) assert.match(foodEffects(entry, true), /one randomly selected learned ability/);
  assert.equal(RAISING.foods.filter(entry => entry.forgetsAbility).length, 2);
  assert.equal(RAISING.forcedFeedIllnessChance, 10);
});

test("invalid and blank inputs never become successful projections", () => {
  for (const days of [0, 129, 1.5, NaN, Infinity]) {
    assert.ok(validateFoodProjection(stats(), days, 1));
    assert.throws(() => projectFoodOnly(food("Vomp Carrot"), stats(), days, 1));
  }
  for (const items of [0, 5, -1, 1.2, NaN]) assert.ok(validateFoodProjection(stats(), 30, items));
  for (const initial of [stats(-1), stats(256), stats(NaN), stats(1.5), stats(255, 255, 255, 255)]) assert.ok(validateFoodProjection(initial, 30, 1));
  assert.equal(validateFoodProjection(stats(160, 160, 160, 160), 128, 4), null);
});

test("rank boundaries and whistle formulas use the pinned settings, not faster optional values", () => {
  for (let grade = 0; grade < 8; grade++) {
    assert.equal(statRank(grade * 32), grade);
    assert.equal(statRank(grade * 32 + 31), grade);
  }
  for (const value of [-1, 256, NaN, 32.5]) assert.throws(() => statRank(value));
  assert.deepEqual(ridingEstimate(stats(), false, false), { rentalPercent: 80, minutes: 17 });
  assert.deepEqual(ridingEstimate(stats(64, 64), false, false), { rentalPercent: 85, minutes: 25 });
  assert.deepEqual(ridingEstimate(stats(224, 224), false, false), { rentalPercent: 97.5, minutes: 45 });
  assert.deepEqual(ridingEstimate(stats(255, 255), true, true), { rentalPercent: 100, minutes: 45 });
});

test("all six story thresholds and all care plan ranges retain source values", () => {
  assert.deepEqual(RAISING.abilities.map(entry => [entry.name, entry.discernment]), [["Gallop", 64], ["Canter", 96], ["Burrow", 64], ["Bore", 160], ["Auto-Regen", 64], ["Treasure Finder", 64]]);
  assert.equal(RAISING.learnChance, 25);
  const walk = RAISING.plans.find(entry => entry.id === 2);
  assert.equal(carePlanRange(walk, "strength"), "+4 to +6");
  assert.equal(carePlanRange(walk, "discernment"), "-3 to -2");
  assert.equal(walk.affection, -4);
  assert.equal(carePlanRange(RAISING.plans[0], "strength"), "0 or +1");
  const messages = RAISING.plans.find(entry => entry.id === 10);
  assert.equal(carePlanRange(messages, "strength"), "+8 to +12");
  assert.equal(messages.energy + messages.poorEnergy, 32);
  assert.deepEqual(messages.pay, [400, 200]);
});

test("goal inputs reject impossible totals, invalid stats and occupied ability slots", () => {
  for (const value of [-1, 256, 0.5, NaN, Infinity]) {
    assert.match(validateRaisingGoal(goal({ current: stats(value) })), /Current stats/);
    assert.match(validateRaisingGoal(goal({ target: stats(0, value) })), /Target stats/);
  }
  assert.match(validateRaisingGoal(goal({ target: stats(255, 255, 160) })), /670.*640/);
  assert.match(validateRaisingGoal(goal({ current: stats(255, 255, 160) })), /Current stats total/);
  assert.match(validateRaisingGoal(goal({ knownAbilities: ["Gallop"] })), /will not fit/);
  assert.match(validateRaisingGoal(goal({ desiredAbilities: ["Bore", "Burrow", "Gallop"] })), /only two/);
  assert.match(validateRaisingGoal(goal({ knownAbilities: ["Bore", "Burrow", "Gallop"] })), /only two/);
  assert.match(validateRaisingGoal(goal({ desiredAbilities: ["Bore", "Bore"] })), /distinct/);
  assert.match(validateRaisingGoal(goal({ desiredAbilities: ["Unknown"] })), /listed story/);
  assert.match(validateRaisingGoal(goal({ priority: "speed" })), /priority/);
  for (const currentDay of [-1, 129, 1.5, NaN, Infinity]) {
    assert.match(validateRaisingGoal(goal({ currentDay })), /Current raising day/);
    assert.throws(() => planRaisingGoal(goal({ currentDay })), /Current raising day/);
  }
  assert.throws(() => planRaisingGoal(goal({ target: stats(255, 255, 255) })), /combined cap/);
  assert.equal(validateRaisingGoal(goal({ target: stats(160, 160, 160, 160) })), null);
});

test("care gains use explicit assumed rolls and losses stop on day 64, not day 63", () => {
  const carry = { kind: "care", id: 8 };
  assert.deepEqual(applyTrainingAction(stats(100, 100, 100, 100), carry, 63), stats(106, 106, 94, 94));
  assert.deepEqual(applyTrainingAction(stats(100, 100, 100, 100), carry, 64), stats(106, 106, 100, 100));
  assert.deepEqual(applyTrainingAction(stats(100, 100, 100, 100), carry, 63, 3), stats(109, 109, 91, 91));
  assert.deepEqual(applyTrainingAction(stats(200, 200, 120, 120), carry, 63), stats(200, 200, 114, 114));
  assert.deepEqual(applyTrainingAction(stats(200, 200, 120, 120), carry, 64), stats(200, 200, 120, 120));
  assert.deepEqual(applyTrainingAction(stats(100, 100, 100, 100), { kind: "food", id: 5607 }, 64), stats(102, 102, 98, 98));
  assert.deepEqual(applyTrainingAction(stats(100), { kind: "care", id: 0 }, 0), stats(100));
  assert.throws(() => applyTrainingAction(stats(), { kind: "food", id: 2211 }, 64), /Unsupported/);
  assert.throws(() => applyTrainingAction(stats(), { kind: "care", id: 1 }, 64), /Unsupported/);
  assert.throws(() => applyTrainingAction(stats(), carry, 129), /outside/);
  assert.throws(() => trainingActionName({ kind: "food", id: -1 }), /Unknown/);
  assert.equal(trainingActionName({ kind: "care", id: 0 }), "Basic Care");
});

test("complete lifetime routes replay with real stage, day, meal and story constraints", () => {
  for (const target of [stats(32, 224, 160, 224), stats(255, 255), stats(160, 160, 160, 160)]) {
    const input = goal({ target });
    const plan = planRaisingGoal(input);
    assert.equal(plan.complete, true, JSON.stringify({ target, remaining: plan.remaining }));
    assert.equal(plan.days.length, 128);
    assert.ok(plan.earlyCareDays > 0, "uses early care instead of waiting until day 64");
    assert.ok(plan.lateCareDays > 0 && plan.lateCareDays <= 65);
    assert.equal(plan.threshold, 160);
    assert.deepEqual(plan.pending.map(ability => [ability.name, ability.story, ability.discernment]),
      [["Bore", "Youthful Chocobo", 160], ["Burrow", "Worrisome Chocobo", 64]]);
    let current = input.current;
    let careDays = 0;
    let foodItems = 0;
    let attempts = 0;
    for (const [index, step] of plan.days.entries()) {
      assert.equal(step.day, input.currentDay + index + 1);
      assert.deepEqual(step.before, current);
      if (step.careId !== 0) {
        assert.ok(step.day >= input.currentDay + 2, "does not overwrite tomorrow's locked plan");
        assert.ok(step.day >= careAvailableDay(step.careId) + 2, "plan is available when it must be queued");
        careDays++;
      }
      current = applyTrainingAction(current, { kind: "care", id: step.careId }, step.day, step.carePoints);
      if (step.foodId !== null) {
        assert.ok(step.day >= 19, "does not assume chick hunger");
        assert.ok(step.foodCount >= 1 && step.foodCount <= trainingFoodLimit(step.foodId));
        const item = PROJECTION_FOODS.find(food => food.id === step.foodId);
        assert.equal(item.forgetsAbility, false);
        let fullness = 0;
        for (let i = 0; i < step.foodCount; i++) {
          assert.ok(fullness < 224, "never force feeds");
          fullness = Math.min(255, fullness + item.fullness);
          current = applyRaisingStatChanges(current, item.stats);
        }
        foodItems += step.foodCount;
      } else assert.equal(step.foodCount, 0);
      if (attempts < plan.pending.length * STORY_ATTEMPTS_95) {
        assert.ok(current.discernment >= Math.min(step.before.discernment, plan.threshold), "does not undermine preparation before learning");
      }
      if (step.story !== null) {
        assert.ok(step.day >= plan.firstStoryDay);
        assert.ok(current.discernment >= plan.threshold, "full threshold reached before story point");
        assert.equal(step.story, plan.pending[Math.floor(attempts / STORY_ATTEMPTS_95)].name);
        assert.equal(step.attempt, attempts % STORY_ATTEMPTS_95 + 1);
        assert.equal(step.assumedLearned, step.attempt === STORY_ATTEMPTS_95);
        current = applyRaisingStatChanges(current, stats(0, 0, 1));
        attempts++;
      }
      assert.ok(Object.values(current).every(value => value >= 0 && value <= 255 && Number.isInteger(value)));
      assert.ok(Object.values(current).reduce((a, b) => a + b, 0) <= 640);
      assert.deepEqual(step.after, current);
    }
    assert.deepEqual(plan.result, current);
    assert.equal(plan.careDays, careDays);
    assert.equal(plan.earlyCareDays + plan.lateCareDays, careDays);
    assert.equal(plan.foodItems, foodItems);
    assert.equal(attempts, 2 * STORY_ATTEMPTS_95);
    assert.deepEqual(plan.finalAbilities, ["Bore", "Burrow"]);
    assert.ok(STAT_KEYS.every(key => current[key] >= target[key]));
    assert.deepEqual(plan.remaining, []);
    assert.deepEqual(input, goal({ target }), "does not mutate inputs");
    assert.equal(plan.groups.reduce((sum, group) => sum + group.days, 0), 128);
    assert.ok(plan.groups.every(group => !(group.day < 64 && group.endDay >= 64)), "keeps day64 boundary visible");
  }
});

test("zero targets mean no minimum; already-met goals need no training", () => {
  const result = planRaisingGoal(goal({ currentDay: 125, current: stats(120, 100, 80, 60), target: stats(64, 96), desiredAbilities: [] }));
  assert.equal(result.complete, true);
  assert.equal(result.days.length, 3);
  assert.ok(result.days.every(day => day.careId === 0 && day.foodCount === 0));
  assert.equal(result.foodItems, 0);
  assert.equal(result.careDays, 0);
  assert.deepEqual(result.result, stats(120, 100, 80, 60));
});

test("digging and community racing presets have valid goals and explain every stat", () => {
  assert.deepEqual(RAISING_PRESETS.map(preset => preset.id), ["digging", "racing", "circuit"]);
  const [digging, racing, circuit] = RAISING_PRESETS;
  assert.deepEqual(digging.target, stats(32, 224, 160, 224));
  assert.deepEqual(digging.desiredAbilities, ["Bore", "Burrow"]);
  assert.equal(digging.priority, "endurance");
  assert.deepEqual(racing.target, stats(224, 128, 160, 96));
  assert.deepEqual(racing.desiredAbilities, ["Gallop", "Canter"]);
  assert.equal(racing.priority, "strength");
  assert.equal(Object.values(racing.target).reduce((sum, value) => sum + value, 0), 608);
  assert.deepEqual(circuit.target, stats(254, 34, 224, 128));
  assert.deepEqual(circuit.desiredAbilities, ["Gallop", "Canter"]);
  assert.equal(circuit.priority, "strength");
  assert.equal(Object.values(circuit.target).reduce((sum, value) => sum + value, 0), 640);
  assert.match(circuit.summary, /not a universal C1 optimum/);
  assert.match(circuit.reasons.endurance, /Elm saddle/);
  assert.match(circuit.reasons.strength, /cap is 255, not 254/);
  for (const preset of RAISING_PRESETS) {
    assert.equal(validateRaisingGoal(goal(preset)), null);
    assert.ok(STAT_KEYS.every(key => preset.reasons[key].length > 30));
    assert.ok(preset.abilityReason.length > 30);
  }
  assert.match(racing.summary, /leaving 32 points flexible/);
  assert.match(racing.reasons.discernment, /stamina/);
  assert.match(racing.reasons.receptivity, /accidents/);
  assert.match(racing.abilityReason, /64 and 96 DSC/);
});

for (const preset of RAISING_PRESETS.filter(entry => entry.id !== "digging")) {
test(`${preset.id} preset reaches its minimums and learns Gallop and Canter in the lifetime model`, () => {
  const before = structuredClone(preset);
  const plan = planRaisingGoal(goal(preset));
  assert.equal(plan.complete, true, JSON.stringify(plan.remaining));
  assert.equal(plan.threshold, 96);
  assert.deepEqual(plan.pending.map(ability => ability.name), ["Canter", "Gallop"]);
  assert.deepEqual(plan.finalAbilities, ["Canter", "Gallop"]);
  assert.equal(plan.days.length, 128);
  let current = stats();
  for (const step of plan.days) {
    assert.deepEqual(step.before, current);
    current = applyTrainingAction(current, { kind: "care", id: step.careId }, step.day, step.carePoints);
    if (step.foodId !== null) {
      assert.ok(step.day >= 19 && step.foodCount <= trainingFoodLimit(step.foodId));
      for (let item = 0; item < step.foodCount; item++) {
        current = applyTrainingAction(current, { kind: "food", id: step.foodId }, step.day);
      }
    }
    if (step.story) {
      assert.ok(current.discernment >= 96);
      current = applyRaisingStatChanges(current, stats(0, 0, 1));
    }
    assert.deepEqual(step.after, current);
  }
  assert.deepEqual(plan.result, current);
  assert.ok(STAT_KEYS.every(key => current[key] >= preset.target[key]));
  assert.ok(Object.values(current).reduce((sum, value) => sum + value, 0) <= 640);
  assert.deepEqual(preset, before, "calculations must not modify reusable presets");
});
}

test("late starts use only remaining days and do not claim unlearned abilities", () => {
  const result = planRaisingGoal(goal({ currentDay: 126 }));
  assert.equal(result.complete, false);
  assert.deepEqual(result.days.map(day => day.day), [127, 128]);
  assert.equal(result.days[0].careId, 0, "tomorrow is already locked");
  assert.ok(result.careDays <= 1);
  assert.equal(result.earlyCareDays, 0);
  assert.ok(result.remaining.length > 0);
  assert.deepEqual(result.finalAbilities, []);
  const last = planRaisingGoal(goal({ currentDay: 128, current: stats(32, 224, 160, 224) }));
  assert.equal(last.days.length, 0);
  assert.equal(last.complete, false, "stat targets met does not mean stories are learned");
  assert.ok(last.remaining.every(message => message.includes("story-attempt allowance")));
  const finished = planRaisingGoal(goal({ currentDay: 128, current: stats(32, 224, 160, 224), knownAbilities: ["Bore", "Burrow"] }));
  assert.equal(finished.complete, true);
  assert.equal(finished.days.length, 0);
  assert.deepEqual(finished.finalAbilities, ["Bore", "Burrow"]);
});

test("today mode plans unfinished meals and stories without repeating reported care or completed activities", () => {
  const current = stats(200, 128, 160, 96);
  for (const currentDay of [31, 63, 64, 127, 128]) {
    const request = goal({
      currentDay, current, target: stats(224, 128, 160, 96), desiredAbilities: ["Gallop", "Canter"], knownAbilities: ["Canter"],
      today: { feedingDone: false, storyDone: false },
    });
    const plan = planRaisingGoal(request);
    assert.equal(plan.days[0].day, currentDay);
    assert.equal(plan.days.length, 129 - currentDay);
    assert.equal(plan.days[0].careId, 0, "today's care is already in reported stats");
    assert.equal(plan.days[0].story, "Gallop");
    for (const step of plan.days) {
      assert.ok(step.careId === 0 || step.day >= currentDay + 2, "no newly selected care today or tomorrow");
    }
    let replay = current;
    for (const step of plan.days) {
      assert.deepEqual(step.before, replay);
      replay = applyTrainingAction(replay, { kind: "care", id: step.careId }, step.day, step.carePoints);
      for (let count = 0; count < step.foodCount; count++) replay = applyTrainingAction(replay, { kind: "food", id: step.foodId }, step.day);
      if (step.story) replay = applyRaisingStatChanges(replay, stats(0, 0, 1));
      assert.deepEqual(step.after, replay);
    }
    assert.deepEqual(replay, plan.result);
  }
  for (const feedingDone of [false, true]) {
    for (const storyDone of [false, true]) {
      const plan = planRaisingGoal(goal({
        currentDay: 128, current: stats(200, 0, 160, 0), target: stats(224), desiredAbilities: ["Gallop"], knownAbilities: [],
        today: { feedingDone, storyDone },
      }));
      assert.equal(plan.days.length, 1);
      assert.equal(plan.days[0].foodCount > 0, !feedingDone);
      assert.equal(plan.days[0].story !== null, !storyDone);
      assert.equal(plan.days[0].careId, 0);
    }
  }
  const egg = planRaisingGoal(goal({ today: { feedingDone: false, storyDone: false } }));
  assert.equal(egg.days[0].day, 0);
  assert.ok(egg.days.filter(step => step.day < 19).every(step => step.foodId === null && step.story === null));
});

test("daily checklist persists valid reports and resets completion only for a different day or egg", () => {
  const startedAt = 1700000000000;
  const form = {
    current: { strength: "32", endurance: "64", discernment: "160", receptivity: "96" },
    target: { strength: "224", endurance: "128", discernment: "160", receptivity: "96" },
    desiredAbilities: ["Gallop", "Canter"], knownAbilities: ["Gallop"], priority: "strength", useExactStats: false,
    storyKeyItems: ["bore"],
  };
  const schedule = { startedAt, plannedDay: 120, days: Array.from({ length: 9 }, (_, index) => ({
    day: 120 + index, foodId: null, foodCount: 0, story: null, careId: index < 2 ? 0 : 3,
  })) };
  const progress = { startedAt, day: 120, feedingDone: true, storyDone: true, careKey: "122:3:7" };
  const saved = { form, defaultsVersion: 1, daily: schedule, progress };
  assert.equal(RAISING_DAILY_KEY, "kupo.raising.daily.v1");
  assert.deepEqual(parseSavedRaisingDaily(JSON.stringify(saved)), saved);
  assert.equal(dailyProgress(progress, startedAt, 120), progress, "same-day refresh retains completion");
  for (const [start, day] of [[startedAt, 121], [startedAt, 124], [startedAt + 1, 120]]) {
    assert.deepEqual(dailyProgress(progress, start, day), { startedAt: start, day, feedingDone: false, storyDone: false, careKey: null });
  }
  assert.deepEqual(todayCare(schedule, 120), { careId: 3, firstDay: 122, lastDay: 128, count: 7, key: "122:3:7" });
  assert.equal(todayCare(schedule, 127), null);
  assert.equal(todayCare(schedule, 0), null);
  for (const invalid of [
    null, {}, { ...saved, form: {} }, { ...saved, progress: { ...progress, feedingDone: "yes" } },
    { ...saved, form: { ...form, storyKeyItems: ["unknown"] } },
    { ...saved, form: { ...form, storyKeyItems: ["bore", "bore"] } },
    { ...saved, daily: { ...schedule, days: [{ ...schedule.days[0], foodId: -100 }] } },
    { ...saved, daily: { ...schedule, startedAt: "yesterday" } },
  ]) assert.throws(() => parseSavedRaisingDaily(JSON.stringify(invalid)), /invalid/);
  assert.throws(() => parseSavedRaisingDaily("{"));
});

test("feeding menus respect stage, report uncertainty, source effects and the force-feeding boundary", () => {
  assert.equal(RAISING.feeding.initialAffection, 255);
  assert.equal(RAISING.feeding.chickHungerPerEnergy, 2.25);
  assert.equal(maxManualShortWalks(0), 3);
  assert.equal(maxManualShortWalks(2), 3);
  assert.equal(AFFECTION_TARGET, 224);
  assert.deepEqual(AFFECTION_REPORTS.at(-1), { label: "Regards you as a parent", min: 224, max: 255 });
  assert.ok(FEEDING_FOODS.every(food => !food.forgetsAbility && !food.rerollGene && !food.random.eitherWay));
  for (const day of [0, 3, 4, 18, 19, 64, 128]) {
    for (const fullness of [0, ...HUNGER_REPORTS.map(report => report.max), 224]) {
      for (const meal of feedingOptions(stats(), 192, fullness, day)) {
        let filled = fullness;
        let affection = 192;
        let current = stats();
        assert.ok(meal.items.length <= 4);
        for (const id of meal.items) {
          assert.ok(day >= 4 && filled < 224);
          const food = feedingFood(id);
          const variant = day < 19 ? food.chick : food;
          filled = Math.min(255, filled + variant.fullness);
          affection = Math.min(255, affection + variant.affection);
          current = applyRaisingStatChanges(current, food.stats);
        }
        assert.equal(meal.fullness, filled);
        assert.equal(meal.affection, affection);
        assert.deepEqual(meal.stats, current, "random bonuses are not presented as guaranteed gains");
      }
    }
  }
  assert.ok(feedingOptions(stats(), 224, 223, 4).every(meal => meal.items.length === 1));
  assert.deepEqual(feedingOptions(stats(), 224, 224, 4)[0].items, []);
  assert.deepEqual(feedingOptions(stats(), 0, 0, 4, false)[0].items, []);
  assert.ok(feedingOptions(stats(), 224, 0, 4).some(meal => meal.items.every(id => id === food("Zegham Carrot").id)
    && meal.stats.discernment === 6 && meal.stats.receptivity === 6), "chicks can train both mental stats without negative stat debt");
  assert.ok(feedingOptions(stats(), 160, 0, 19).some(meal => new Set(meal.items).size === 2));
  assert.equal(feedingSummary([5608, 5608, 5606]), "2 Zegham Carrot, then 1 Azouph Greens");
  assert.throws(() => feedingOptions(stats(), -1, 0, 4), /valid affection/);
  assert.throws(() => feedingFood(-1), /Unsupported/);
});

test("locked care survives rollover, recalculation and storage with explicit estimate fallback", () => {
  const startedAt = 1700000000000;
  const form = {
    current: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
    target: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
    desiredAbilities: [], knownAbilities: [], priority: "endurance",
  };
  const daily = { startedAt, plannedDay: 6, days: Array.from({ length: 123 }, (_, index) => ({
    day: 6 + index, foodId: null, foodCount: 0, story: null, careId: index < 2 ? 0 : 3,
  })) };
  const saved = { form, daily };
  assert.deepEqual(tomorrowCare(saved, startedAt, 7), { careId: 3, source: "estimated" });
  const care = todayCare(daily, 6);
  saved.arrangedCare = recordArrangedCare(undefined, startedAt, care.firstDay, care.lastDay, care.careId);
  let restored = parseSavedRaisingDaily(JSON.stringify(saved));
  for (const day of [7, 8, 13]) assert.deepEqual(tomorrowCare(restored, startedAt, day), { careId: 3, source: "confirmed" });
  restored.daily = { ...daily, days: daily.days.map(step => ({ ...step, careId: 0 })) };
  assert.deepEqual(tomorrowCare(restored, startedAt, 8), { careId: 3, source: "confirmed" },
    "recalculating a recommendation does not erase arranged care");
  restored.arrangedCare = recordArrangedCare(restored.arrangedCare, startedAt, 9, 9, 2);
  assert.deepEqual(tomorrowCare(restored, startedAt, 8), { careId: 2, source: "confirmed" });
  assert.deepEqual(tomorrowCare(restored, startedAt, 9), { careId: 3, source: "confirmed" });
  assert.deepEqual(tomorrowCare(restored, startedAt + 1, 8), { careId: undefined, source: "unknown" });
  assert.deepEqual(tomorrowCare({ form }, startedAt, 6), { careId: undefined, source: "unknown" });
  assert.deepEqual(tomorrowCare({ form }, startedAt, 3), { careId: 0, source: "basic" });
  for (const days of [[{ day: 9, careId: 999 }], [{ day: 2, careId: 3 }], [{ day: 9, careId: 3 }, { day: 9, careId: 2 }]]) {
    assert.throws(() => parseSavedRaisingDaily(JSON.stringify({ ...saved, arrangedCare: { startedAt, days } })), /invalid/);
  }
});

test("health guidance matches pinned remedies, stages and safe treatment boundaries", () => {
  const report = { day: 6, affection: 224, fullness: 223, condition: "unwell", ailments: ["sick"] };
  let guide = healthGuidance(report, 6);
  assert.equal(guide.canTreat, true);
  assert.match(guide.treatmentAction, /^Give 1 Clump of Tokopekko Wildgrass/);
  assert.equal(guide.remedies[0].foods[0].name, "Clump of Tokopekko Wildgrass");
  assert.ok(guide.remedies[0].foods.some(food => food.name === "Ball of Herb Paste"));
  for (const [ailment, name] of [["very ill", "Clump of Tokopekko Wildgrass"], ["injured", "Clump of Gausebit Wildgrass"], ["stomachache", "Garidav Wildgrass"]]) {
    assert.equal(healthGuidance({ ...report, ailments: [ailment] }, 6).remedies[0].foods[0].name, name);
  }
  for (const { id } of BIRD_AILMENTS) for (const day of [6, 19, 29]) {
    guide = healthGuidance({ ...report, day, ailments: [id] }, day);
    assert.ok(guide.remedies[0].foods.length);
    assert.ok(guide.treatmentAction.includes(`Give 1 ${guide.remedies[0].foods[0].name}`));
    assert.ok(guide.treatmentAction.includes(BIRD_AILMENTS.find(ailment => ailment.id === id).label));
    for (const food of guide.remedies[0].foods) assert.ok((day < 19 ? food.chick : food).cures.includes(id));
    if (day >= 19) assert.ok(!guide.remedies[0].foods.some(food => food.name === "Ball of Herb Paste"));
    const fullGuide = healthGuidance({ ...report, day, fullness: 255, ailments: [id] }, day);
    assert.equal(fullGuide.canForceFeedRemedy, true);
    assert.match(fullGuide.treatmentAction, /Completely full.*Optional tradeoff/);
    assert.match(fullGuide.treatmentAction, /queues? (its|their) cure for the next raising-day update/);
    assert.match(fullGuide.treatmentAction, /10% chance of a stomachache/);
    assert.match(fullGuide.treatmentAction, /Rest instead has a 50% cure roll/);
    assert.ok(fullGuide.remedies[0].foods.some(food => fullGuide.treatmentAction.includes(food.name)));
    assert.doesNotMatch(fullGuide.treatmentAction, /Wait until the bird is present, awake and has feeding room/);
    assert.doesNotMatch(fullGuide.treatmentAction, /^Give 1/);
  }
  guide = healthGuidance({ ...report, ailments: ["sick", "lovesick"] }, 6);
  assert.match(guide.treatmentAction, /Give 1 Celerity Salad, alone, for Sick \/ minor illness, Lovesick/);
  for (const patch of [{ fullness: -1 }, { condition: "unknown" }, { condition: "sleeping" }, { condition: "away" }]) {
    const blocked = healthGuidance({ ...report, ...patch, ailments: ["lovesick"] }, 6);
    assert.equal(blocked.canTreat, false);
    assert.ok(blocked.remedies[0].foods.some(food => food.name === "Celerity Salad"));
    assert.doesNotMatch(blocked.treatmentAction, /^Give 1/);
  }
  for (const fullness of [224, 255]) {
    guide = healthGuidance({ ...report, fullness }, 6);
    assert.equal(guide.canTreat, false);
    assert.equal(guide.canForceFeedRemedy, true);
    assert.match(guide.messages.join(" "), /Optional tradeoff/);
    assert.doesNotMatch(guide.treatmentAction, /^Give 1/);
    assert.match(guide.messages.join(" "), /10% (?:chance of a )?stomachache/);
  }
  const unconfirmedFull = healthGuidance({ ...report, fullness: 255, ailments: [] }, 6);
  assert.match(unconfirmedFull.treatmentAction, /do not force-feed an unverified remedy/);
  assert.equal(unconfirmedFull.canForceFeedRemedy, false);
  assert.doesNotMatch(unconfirmedFull.treatmentAction, /Optional tradeoff/);
  guide = healthGuidance({ ...report, fullness: 255, treatmentGiven: true }, 6);
  assert.equal(guide.canTreat, false);
  assert.match(guide.treatmentAction, /Treatment already given/);
  assert.match(guide.messages.join(" "), /Treatment already given/);
  assert.match(guide.messages.join(" "), /do not feed another remedy to undo/);
  assert.equal(healthGuidance({ ...report, treatmentGiven: true }, 6).canTreat, false);
  assert.equal(healthGuidance({ ...report, fullness: -1 }, 6).canTreat, false);
  assert.equal(healthGuidance({ ...report, condition: "unknown" }, 6).canTreat, false);
  for (const condition of ["away", "sleeping"]) assert.equal(healthGuidance({ ...report, condition }, 6).canTreat, false);
  for (const condition of ["away", "sleeping", "unknown"]) {
    assert.equal(healthGuidance({ ...report, fullness: 255, condition }, 6).canForceFeedRemedy, false);
  }
  assert.match(healthGuidance({ ...report, condition: "sleeping" }, 6).messages.join(" "), /Chocotonic.*32.*-48/);
  assert.match(healthGuidance({ ...report, condition: "away" }, 6).messages.join(" "), /cannot feed or treat/);
  assert.equal(healthGuidance(report, 3).canTreat, false);
  assert.match(healthGuidance({ ...report, ailments: [] }, 6).messages.join(" "), /not specific enough/);
  assert.match(healthGuidance({ ...report, ailments: [], condition: "tired" }, 6).messages.join(" "), /not an illness diagnosis/);
  assert.equal(needsHealthAttention({ ...report, condition: "healthy" }), true, "selected ailments override healthy readiness");
  assert.equal(needsHealthAttention({ ...report, condition: "healthy", ailments: [] }), false);
});

test("non-food ailment recovery respects stage, energy costs and pinned action effects", () => {
  const report = { day: 30, affection: 224, fullness: 255, condition: "healthy", ailments: [] };
  const spoiled = healthGuidance({ ...report, ailments: ["spoiled"] }, 30);
  assert.match(spoiled.careActions.join(" "), /Scold.*20\+ energy.*10 affection/);
  assert.match(spoiled.treatmentAction, /Completely full.*Optional tradeoff/);
  const bored = healthGuidance({ ...report, ailments: ["bored"] }, 30);
  assert.match(bored.careActions.join(" "), /Compete with Others.*rivals.*34\+ energy.*healthy and awake/);
  assert.match(bored.careActions.join(" "), /next report even on a loss/);
  assert.match(healthGuidance({ ...report, day: 6, ailments: ["bored"] }, 6).careActions.join(" "), /not available until day 19/);
  assert.match(healthGuidance({ ...report, ailments: ["lonely"] }, 30).careActions.join(" "), /rebuild affection.*Watch Over does not boost affection/);
  assert.match(healthGuidance({ ...report, condition: "sleeping" }, 30).careActions.join(" "), /Scold.*20 energy.*wakes.*10 affection/);
  assert.match(healthGuidance({ ...report, condition: "away" }, 30).careActions.join(" "), /No food or hands-on care.*without training/);
  assert.deepEqual(healthGuidance({ ...report, day: 3, ailments: ["spoiled"] }, 3).careActions, []);
});

test("reported raising events give source-specific next steps without inventing ailments or bonuses", () => {
  const report = { day: 30, affection: 224, fullness: 191, condition: "healthy" };
  for (const event of RAISING_EVENTS) {
    const reported = { ...report, events: [event.id] };
    assert.equal(validRaisingEvents(reported.events), true);
    assert.ok(raisingEventGuidance(reported, 30).length > 0, event.id);
    assert.equal(needsHealthAttention(reported), false, "reported events alone are not ailments");
    assert.equal(validateFeedingReport(reported, 30), null);
  }
  assert.deepEqual(raisingEventGuidance(report, 30), []);
  for (const invalid of [["unknown"], ["high-spirits", "high-spirits"], "high-spirits", null, [1]]) {
    assert.equal(validRaisingEvents(invalid), false);
    assert.throws(() => raisingEventGuidance({ ...report, events: invalid }, 30), /valid raising report events/);
  }
  for (const day of [7, 8, 14]) {
    const messages = raisingEventGuidance({ ...report, day, events: ["white-handkerchief"] }, day);
    assert.equal(messages.length, 1, "reported handkerchief has event-specific guidance");
    assert.match(messages[0], /raising-report day.*next report.*zone out and back.*before day 15/);
    assert.match(messages[0], /not a food trade/);
  }
  assert.match(raisingEventGuidance({ ...report, events: ["white-handkerchief"] }, 15).join(" "), /expires on day 15.*key item is taken back.*does not block the adult Whistle quest/);
  const highSpirits = raisingEventGuidance({ ...report, events: ["high-spirits"] }, 30).join(" ");
  assert.match(highSpirits, /Happiness.*care plans are more effective.*does not directly add affection or stat points/);
  assert.match(highSpirits, /increases the chance.*Full of energy.*Bright and focused/);
  const fullOfEnergy = raisingEventGuidance({ ...report, events: ["full-of-energy"] }, 30).join(" ");
  assert.match(fullOfEnergy, /Vitality.*physical care plans.*Strength and Endurance/);
  assert.match(fullOfEnergy, /higher chance to teach an unlearned ability/);
  assert.match(fullOfEnergy, /not extra stored energy/);
  const brightAndFocused = raisingEventGuidance({ ...report, events: ["bright-and-focused"] }, 30).join(" ");
  assert.match(brightAndFocused, /Intelligence.*mental care plans.*Discernment and Receptivity/);
  assert.match(brightAndFocused, /higher chance to teach an unlearned ability/);
  assert.match(brightAndFocused, /not a direct Discernment gain or a guarantee of learning/);
  assert.match(raisingEventGuidance({ ...report, events: ["returned"] }, 30).join(" "),
    /away days passed without care or training.*no catch-up bonus/);
  assert.match(raisingEventGuidance({ ...report, events: ["lost-chick"] }, 30).join(" "),
    /Take it home.*short walk.*first initial, race\/gender and occupation.*Kiria-Romaria.*separate NPC from Pulonono.*Enter the clues above to filter the owner list/);
  assert.equal(LOST_CHICK_OWNERS.length, 25);
  assert.equal(validLostChickClues({ firstLetter: "G", raceGender: "Mithra", occupation: "Hunter" }), true);
  assert.equal(validLostChickClues({ firstLetter: "GG" }), false);
  const gMithraOwners = filterLostChickOwners({ firstLetter: "g", raceGender: "mithra" });
  assert.deepEqual(gMithraOwners.map(owner => owner.name), ["Gioh Ajihri", "Gottah Maporushanoh"]);
  assert.deepEqual(filterLostChickOwners({ firstLetter: "G", raceGender: "Mithra", occupation: "Hunter" }).map(owner => owner.name),
    ["Gioh Ajihri"]);
  assert.deepEqual(filterLostChickOwners({ firstLetter: "G", raceGender: "Mithra", occupation: "Adventurer" }).map(owner => owner.name),
    ["Gottah Maporushanoh"]);
  assert.equal(filterLostChickOwners({ firstLetter: "Z" }).length, 0);
  for (const day of [7, 14, 15]) {
    assert.doesNotMatch(raisingMilestoneGuidance(day).join(" "), /White Handkerchief/);
    assert.doesNotMatch(raisingEventGuidance({ ...report, day }, day).join(" "), /White Handkerchief/);
  }
  assert.deepEqual(raisingEventGuidance(report, 29), [], "age milestones are separate from selected-event guidance");
  for (const id of ["high-spirits", "full-of-energy", "bright-and-focused"]) {
    assert.match(raisingEventGuidance({ ...report, events: [id] }, 30).join(" "), /No medicine|no remedy/i);
  }
  const found = raisingEventGuidance({ ...report, events: ["whistle-search", "whistle-found"] }, 30);
  assert.equal(found.length, 1, "finding the item takes priority over searching");
  assert.match(found[0], /Hantileon.*receive the Chocobo Whistle.*not the chick's White Handkerchief/);
  assert.match(raisingEventGuidance({ ...report, events: ["whistle-search"] }, 19).join(" "), /begins at adulthood, day 29/);
  for (const condition of ["away", "sleeping", "unwell", "tired", "unknown"]) {
    const advice = raisingEventGuidance({ ...report, condition, events: ["whistle-search", "held-item"] }, 30).join(" ");
    assert.match(advice, /Wait until healthy, awake, present and energetic enough/);
    assert.match(advice, /Watch Over.*4\+ energy/);
  }
  assert.match(raisingEventGuidance({ ...report, events: ["recovered"] }, 30).join(" "), /Clear only the conditions.*do not repeat medicine/i);
  const input = goal({ currentDay: 128, desiredAbilities: [], today: { feedingDone: false, storyDone: false },
    feedingReport: { ...report, day: 128 } });
  assert.deepEqual(planRaisingGoal({ ...input, feedingReport: { ...input.feedingReport, events: ["high-spirits"] } }),
    planRaisingGoal(input), "positive event reports do not silently change the numeric model");
});

test("story key item checklist covers each ability with its acquisition, effect and use", () => {
  assert.equal(RAISING_STORY_KEY_ITEMS.length, RAISING_ABILITIES.length);
  for (const item of RAISING_STORY_KEY_ITEMS) {
    const ability = RAISING_ABILITIES.find(entry => entry.name === item.ability);
    assert.ok(ability, `Missing ability reference for ${item.ability}`);
    assert.equal(validRaisingStoryKeyItems([item.id]), true);
    const [guidance] = raisingStoryKeyItemGuidance([item.id]);
    assert.match(guidance, new RegExp(item.keyItem));
    assert.match(guidance, new RegExp(`teaches ${ability.name}`));
    assert.ok(guidance.includes(ability.obtain), `${ability.name} acquisition guidance`);
    assert.ok(guidance.includes(ability.effect), `${ability.name} effect guidance`);
    assert.match(guidance, /Tell a Story/);
    assert.match(guidance, new RegExp(`${ability.discernment} DSC after the story's \\+1`));
    assert.match(guidance, /energy and a free ability slot/);
    assert.match(guidance, /daily attempt has a 25% learning chance/);
    assert.match(guidance, /failed roll leaves the key item available for another day/);
  }
  assert.equal(validRaisingStoryKeyItems(undefined), true);
  for (const invalid of [["unknown"], ["bore", "bore"], "bore", null, [1]]) {
    assert.equal(validRaisingStoryKeyItems(invalid), false);
    assert.throws(() => raisingStoryKeyItemGuidance(invalid), /valid chocobo story key items/);
  }
});

test("age reminders stay on exact timeline days and event selections persist with validated reports", () => {
  const milestoneDays = [4, 19, 29, 43, 64, 128, 129];
  for (const day of milestoneDays) assert.equal(raisingMilestoneGuidance(day).length, 1, `day ${day}`);
  for (const day of [0, 3, 6, 7, 8, 13, 14, 15, 16, 18, 20, 28, 30, 42, 44, 63, 65, 127]) {
    assert.deepEqual(raisingMilestoneGuidance(day), []);
  }
  assert.match(raisingMilestoneGuidance(29)[0], /outside San d'Oria.*Hantileon.*outcome does not block/);
  assert.match(raisingMilestoneGuidance(129)[0], /Raising has ended/);
  const days = Array.from({ length: 129 }, (_, day) => ({
    day, careId: 0, carePoints: 2, foodId: null, foodCount: 0, story: null, attempt: 0,
    before: stats(), after: stats(), assumedLearned: false,
  }));
  const groups = groupTrainingDays(days, milestoneDays);
  for (const day of milestoneDays.filter(day => day <= 128)) {
    const group = groups.find(group => day >= group.day && day <= group.endDay);
    assert.equal(group.day, day);
    assert.equal(group.endDay, day, "reminders do not label multi-day blocks");
  }
  assert.equal(groups.reduce((sum, group) => sum + group.days, 0), 129);
  const form = { current: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
    target: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])), desiredAbilities: [], knownAbilities: [], priority: "endurance",
    feedingReport: { day: 7, affection: 224, fullness: 191, condition: "healthy", events: ["white-handkerchief"] },
  };
  assert.deepEqual(parseSavedRaisingDaily(JSON.stringify({ form })).form.feedingReport.events, ["white-handkerchief"]);
  for (const events of [["unknown"], ["high-spirits", "high-spirits"], "high-spirits"]) {
    assert.throws(() => parseSavedRaisingDaily(JSON.stringify({ form: { ...form,
      feedingReport: { ...form.feedingReport, events },
    } })), /invalid/);
  }
  assert.notEqual(feedingInputKey(form, form.feedingReport),
    feedingInputKey(form, { ...form.feedingReport, events: [] }));
});

test("recorded medicine updates pre-dose reports once and keeps recovery hypothetical", () => {
  const before = { day: 6, affection: 224, fullness: 191, condition: "unwell", ailments: ["sick"] };
  const after = recordMedicineEaten(before, 2201, 6);
  assert.equal(before.fullness, 191, "does not mutate pre-dose reports");
  assert.equal(after.fullness, 255, "one Tokopekko adds 64 fullness");
  assert.equal(after.affection, 248);
  assert.equal(after.condition, "unwell");
  assert.deepEqual(after.ailments, ["sick"]);
  assert.equal(after.treatmentGiven, true);
  assert.equal(after.medicineId, 2201);
  assert.throws(() => recordMedicineEaten(after, 2201, 6), /already recorded/);
  assert.throws(() => recordMedicineEaten({ ...after, treatmentGiven: false }, 2201, 6), /already recorded/);
  assert.throws(() => recordMedicineEaten({ ...before, treatmentGiven: true }, 2201, 6), /already recorded/);
  assert.throws(() => recordMedicineEaten(before, 2201, 7), /current hunger/);
  assert.throws(() => recordMedicineEaten({ ...before, day: 3 }, 2201, 3), /growth stage/);
  assert.throws(() => recordMedicineEaten(before, PARASITE_WORM_ID, 6), /medicine/);
  assert.throws(() => recordMedicineEaten({ ...before, condition: "sleeping" }, 2201, 6), /cannot be eaten/);
  assert.throws(() => recordMedicineEaten({ ...before, condition: "away" }, 2201, 6), /cannot be eaten/);
  assert.equal(recordMedicineEaten({ ...before, affection: 250, fullness: 255 }, 2201, 6).affection, 255,
    "already eaten force-fed medicine may be recorded without recommending it");
  assert.equal(recordMedicineEaten({ ...before, affection: 0, condition: "sleeping" }, 2197, 6).affection, 0);
  assert.ok(treatmentFoods(6).some(food => food.id === 2208));
  assert.ok(!treatmentFoods(19).some(food => food.id === 2208), "Herb Paste loses its chick cures");
  const form = {
    current: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
    target: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
    desiredAbilities: [], knownAbilities: [], priority: "endurance", feedingReport: after,
  };
  assert.deepEqual(parseSavedRaisingDaily(JSON.stringify({ form })).form.feedingReport, after);
  const input = goal({
    currentDay: 6, today: { feedingDone: false, storyDone: false }, tomorrowCareId: 3,
    feedingReport: after, colorGoal: { eggId: 2312, wormsFed: 0 },
  });
  const plan = planRaisingGoal(input);
  assert.deepEqual(plan.days[0].feeding.items, []);
  assert.equal(plan.days[1].feeding.fullnessBefore, 255, "tomorrow starts from medicine-adjusted fullness, not 191");
  assert.deepEqual(plan.days[1].feeding.items, [], "no hypothetical worm on day 7 after the recorded dose");
  assert.ok(plan.days.flatMap(day => day.feeding.items).every(id => id !== 2201),
    "medicine already eaten is not included again in remaining meals");
});

test("ailments and treatment persist, invalidate food estimates and stop today's training meals and stories", () => {
  const report = { day: 128, affection: 224, fullness: 31, condition: "healthy", ailments: ["sick", "injured"], treatmentGiven: true };
  const form = {
    current: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
    target: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
    desiredAbilities: [], knownAbilities: [], priority: "endurance", feedingReport: report,
  };
  assert.deepEqual(parseSavedRaisingDaily(JSON.stringify({ form })).form.feedingReport, report);
  for (const patch of [{ ailments: ["fake"] }, { ailments: ["sick", "sick"] }, { ailments: "sick" }, { treatmentGiven: "yes" }]) {
    assert.throws(() => parseSavedRaisingDaily(JSON.stringify({ form: { ...form, feedingReport: { ...report, ...patch } } })), /invalid/);
    assert.match(validateFeedingReport({ ...report, ...patch }, 128), /ailments/);
  }
  for (const patch of [{ ailments: [] }, { treatmentGiven: false }]) {
    assert.notEqual(feedingInputKey(form, report), feedingInputKey(form, { ...report, ...patch }));
  }
  for (const patch of [{ ailments: ["sick"], treatmentGiven: false }, { ailments: [], treatmentGiven: true }]) {
    const plan = planRaisingGoal(goal({
      currentDay: 128, current: stats(0, 0, 160, 0), target: stats(), desiredAbilities: ["Bore"],
      today: { feedingDone: false, storyDone: false }, feedingReport: { ...report, ...patch },
    }));
    assert.deepEqual(plan.days[0].feeding.items, []);
    assert.equal(plan.days[0].story, null);
  }
});

test("tomorrow's locked care trains stats and is not optimized away after reaching a goal", () => {
  const input = goal({
    currentDay: 120, current: stats(0, 0, 64, 64), target: stats(), desiredAbilities: [],
    today: { feedingDone: false, storyDone: false }, tomorrowCareId: 3,
    feedingReport: { day: 120, affection: 224, fullness: 255, condition: "healthy" },
  });
  const plan = planRaisingGoal(input);
  assert.equal(plan.days[0].careId, 0, "today's reported care is not applied twice");
  assert.equal(plan.days[1].careId, 3, "locked care stays scheduled even with met targets");
  const locked = plan.days[1];
  let replay = applyTrainingAction(locked.before, { kind: "care", id: 3 }, locked.day, locked.carePoints);
  assert.ok(replay.discernment > locked.before.discernment);
  for (const id of locked.feeding.items) replay = applyRaisingStatChanges(replay, feedingFood(id).stats);
  assert.deepEqual(locked.after, replay, "locked training and subsequent meals are both included");
  assert.equal(plan.days[1].feeding.affectionBefore, plan.days[0].feeding.affectionAfter - 4);
  for (const tomorrowCareId of [-1, 1, 99, NaN]) {
    assert.match(validateRaisingGoal({ ...input, tomorrowCareId }), /locked care/);
  }
  assert.match(validateRaisingGoal({ ...input, currentDay: 3, tomorrowCareId: 3 }), /locked care/);
});

test("day-six digging color goal trains Discernment without giving up non-yellow odds", () => {
  for (const tomorrowCareId of [0, 3]) {
    const plan = planRaisingGoal(goal({
      currentDay: 6, today: { feedingDone: false, storyDone: false }, tomorrowCareId,
      feedingReport: { affection: 224, fullness: 255, condition: "unwell", day: 6 },
      colorGoal: { eggId: 2312, wormsFed: 0 },
    }));
    assert.equal(plan.days[0].feeding.items.length, 0, "no food today for an unwell, full chick");
    assert.equal(plan.days[1].careId, tomorrowCareId);
    assert.equal(plan.days[2].careId, 3, "arrange Listen to Music rather than an affection-only Basic Care route");
    assert.ok(plan.days[2].after.discernment > 0);
    const energy = RAISING.plans.find(care => care.id === tomorrowCareId).energy;
    const walks = plan.days[1].manualShortWalks ?? 0;
    const walkEnergy = RAISING.actionEnergy[42]["2"];
    assert.equal(plan.days[2].feeding.fullnessBefore,
      plan.days[1].feeding.fullnessAfter - Math.floor(2.25 * (energy + walks * walkEnergy)),
      "locked care and planned walks affect the following day's hunger");
    assert.ok(plan.color.plannedWorms >= 1, "preserve or improve the reported one-worm color strategy");
    assert.equal(plan.complete, true);
  }
});

test("color probabilities match an exhaustive gene transition, including repeated rolls and source egg patterns", () => {
  assert.deepEqual(RAISING.eggColorOdds.map(egg => egg.genePatterns), [
    [25, 50, 25], [17.5, 60, 22.5], [16, 65, 19], [15, 70, 15], [10, 75, 15],
  ]);
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
  const dna = Array.from({ length: 125 }, (_, index) => [Math.floor(index / 25), Math.floor(index / 5) % 5, index % 5]);
  const displayed = genes => {
    const counts = [0, 0, 0, 0, 0];
    for (const value of genes) counts[value]++;
    const majority = counts.findIndex(count => count > 1);
    return majority >= 0 ? majority : counts[0] || !counts[1] ? 0 : 1;
  };
  for (const genes of dna) assert.equal(geneColor(genes), displayed(genes));
  assert.equal(geneColor([0, 0, 2]), 0);
  assert.equal(geneColor([2, 3, 4]), 0);
  assert.equal(geneColor([1, 3, 4]), 1);
  for (const egg of RAISING.eggColorOdds) {
    let distribution = eggGeneDistribution(egg.id);
    close(distribution.reduce((sum, probability) => sum + probability, 0), 1);
    close(distribution[0], egg.yellow / 100 * egg.genePatterns[0] / 100);
    close(distribution[62], egg.blue / 100 * egg.genePatterns[0] / 100);
    for (let worms = 0; worms <= 12; worms++) {
      const odds = chocoboColorOdds(egg.id, worms);
      const expected = [0, 0, 0, 0, 0];
      distribution.forEach((probability, index) => { expected[displayed(dna[index])] += probability; });
      CHOCOBO_COLORS.forEach((color, index) => {
        close(odds[color], expected[index]);
        if (!worms) close(odds[color], egg[color] / 100);
        assert.ok(odds[color] >= 0 && odds[color] <= 1);
      });
      close(Object.values(odds).reduce((sum, probability) => sum + probability, 0), 1);
      const next = Array(125).fill(0);
      distribution.forEach((probability, index) => {
        for (let slot = 0; slot < 3; slot++) for (let color = 0; color < 5; color++) {
          const genes = [...dna[index]];
          genes[slot] = color;
          next[genes[0] * 25 + genes[1] * 5 + genes[2]] += probability / 15;
        }
      });
      distribution = next;
    }
    close(1 - chocoboColorOdds(egg.id, 1000).yellow, 0.56);
  }
  close(1 - chocoboColorOdds(2312, 1).yellow, 0.19041666666666667);
  close(1 - chocoboColorOdds(2312, 4).yellow, 0.4337067901234568);
  for (const eggId of [2312, 2314, 2317]) assert.equal(colorStrategy({ eggId, wormsFed: 0 }, 12).best.worms, 12);
  for (const eggId of [2318, 2319]) assert.equal(colorStrategy({ eggId, wormsFed: 0 }, 60).best.worms, 0);
  assert.equal(colorStrategy({ eggId: 2318, wormsFed: 2 }, 12).best.worms, 12, "prior worms can change which strategy is best");
  for (const [egg, worms] of [[0, 0], [2312, -1], [2312, 1.5], [2312, NaN], [2312, Infinity]]) {
    assert.throws(() => chocoboColorOdds(egg, worms));
  }
  assert.throws(() => geneColor([0, 1]));
  assert.throws(() => colorStrategy({ eggId: 2312, wormsFed: 0 }, 61));
});

test("color worm meals are opt-in, affection-aware and safe across the chick cutoff", () => {
  for (const day of [3, 4, 18, 19]) for (const fullness of [0, 31, 95, 159, 191, 223, 224, 255]) {
    assert.ok(feedingOptions(stats(), 224, fullness, day).every(meal => !meal.items.includes(PARASITE_WORM_ID)));
    for (const meal of feedingOptions(stats(), 224, fullness, day, true, true)) {
      let filled = fullness;
      let affection = 224;
      for (const id of meal.items) {
        assert.ok(filled < 224);
        if (id === PARASITE_WORM_ID) assert.ok(day >= 4 && day < 19);
        const entry = feedingFood(id);
        const variant = day < 19 ? entry.chick : entry;
        filled = Math.min(255, filled + variant.fullness);
        affection = Math.min(255, affection + variant.affection);
      }
      assert.equal(filled, meal.fullness);
      assert.equal(affection, meal.affection);
      assert.ok(meal.items.length <= 4);
    }
  }
  assert.equal(feedingSummary([PARASITE_WORM_ID, PARASITE_WORM_ID, 5606]), "2 Parasite Worm, then 1 Azouph Greens");
});

test("color planner uses safe capacity before day 19 and respects completed feeding and previous worms", () => {
  const run = (patch = {}) => planRaisingGoal(goal({
    currentDay: 18, target: stats(), desiredAbilities: [],
    today: { feedingDone: false, storyDone: false },
    feedingReport: { affection: 224, fullness: 0, condition: "healthy", day: 18 },
    colorGoal: { eggId: 2312, wormsFed: 2 }, ...patch,
  }));
  const planned = run();
  assert.equal(planned.color.plannedWorms, 4);
  assert.deepEqual(planned.days[0].feeding.items, Array(4).fill(PARASITE_WORM_ID));
  assert.deepEqual(planned.color.before, chocoboColorOdds(2312, 2));
  assert.deepEqual(planned.color.after, chocoboColorOdds(2312, 6));
  assert.ok(planned.days.slice(1).every(day => !day.feeding.items.includes(PARASITE_WORM_ID)));
  assert.deepEqual(trainingFoodTotals(planned.days).find(food => food.id === PARASITE_WORM_ID),
    { id: PARASITE_WORM_ID, name: "Parasite Worm", count: 4 });
  for (const patch of [
    { today: { feedingDone: true, storyDone: false } },
    ...["unwell", "sleeping", "away"].map(condition => ({ feedingReport: { affection: 224, fullness: 0, condition, day: 18 } })),
    { feedingReport: { affection: 224, fullness: 224, condition: "healthy", day: 18 } },
    { currentDay: 19, feedingReport: { affection: 224, fullness: 0, condition: "healthy", day: 19 } },
  ]) {
    const plan = run(patch);
    assert.equal(plan.color.plannedWorms, 0);
    assert.deepEqual(plan.color.before, plan.color.after);
    assert.equal(plan.color.wormsFed, 2, "completed feeding does not invent or erase eaten worms");
    assert.equal(plan.color.locked, patch.currentDay === 19);
  }
  const low = run({ feedingReport: { affection: 0, fullness: 0, condition: "healthy", day: 18 } });
  const bestAffection = Math.min(224, Math.max(...feedingOptions(stats(), 0, 0, 18, true, true).map(meal => meal.affection)));
  assert.equal(low.color.plannedWorms, 4, "the best non-yellow odds take priority over affection");
  assert.ok(Math.min(224, low.days[0].feeding.affectionAfter) < bestAffection,
    "the color goal may accept lower affection when that improves the odds");
  const normal = run({ colorGoal: undefined });
  assert.equal(normal.color, undefined);
  assert.ok(normal.days.every(day => !day.feeding.items.includes(PARASITE_WORM_ID)));
  const favorable = run({ colorGoal: { eggId: 2319, wormsFed: 0 } });
  assert.equal(favorable.color.plannedWorms, 0);
  assert.deepEqual(favorable.days, normal.days, "a favorable egg keeps the ordinary training plan");
  assert.match(validateRaisingGoal(goal({ colorGoal: { eggId: 0, wormsFed: 0 } })), /starting egg/);
  assert.match(validateRaisingGoal(goal({ colorGoal: { eggId: 2312, wormsFed: 0 } })), /feeding reports/);
  assert.match(validateRaisingGoal(goal({ colorGoal: { eggId: 2312, wormsFed: 1 },
    feedingReport: { affection: 255, fullness: 255, condition: "healthy", day: 0 } })), /Eggs cannot be fed/);
});

test("color lifetime route prioritizes odds over affection and still meets the digging build", () => {
  const plan = planRaisingGoal(goal({
    today: { feedingDone: false, storyDone: false },
    feedingReport: { affection: 255, fullness: 255, condition: "healthy", day: 0 },
    colorGoal: { eggId: 2312, wormsFed: 0 },
  }));
  assert.equal(plan.complete, true);
  assert.equal(plan.color.plannedWorms, 48, "walk-assisted hunger permits more safe chick worm meals");
  assert.ok(plan.color.after.yellow < plan.color.before.yellow);
  let count = 0;
  let fullness = 255;
  let affection = 255;
  let energySpent = 0;
  for (const day of plan.days) {
    const care = RAISING.plans.find(entry => entry.id === day.careId);
    if (day.day > 0) {
      affection = Math.max(0, Math.min(255, affection + care.affection));
      fullness = day.day <= 4 ? 255 : day.day < 19 ? Math.max(0, fullness - Math.floor(2.25 * energySpent)) : 0;
    }
    assert.equal(day.feeding.fullnessBefore, fullness);
    assert.equal(day.feeding.affectionBefore, affection);
    let current = applyTrainingAction(day.before, { kind: "care", id: day.careId }, day.day, day.carePoints);
    for (const id of day.feeding.items) {
      assert.ok(day.day >= 4 && fullness < 224);
      if (id === PARASITE_WORM_ID) { assert.ok(day.day < 19); count++; }
      const entry = feedingFood(id);
      const variant = day.day < 19 ? entry.chick : entry;
      fullness = Math.min(255, fullness + variant.fullness);
      affection = Math.min(255, affection + variant.affection);
      current = applyRaisingStatChanges(current, entry.stats);
    }
    if (day.story) current = applyRaisingStatChanges(current, stats(0, 0, 1, 0));
    assert.deepEqual(current, day.after);
    energySpent = day.day === 0 || day.day >= 19 ? 0 : care.energy
      + (day.manualShortWalks ?? 0) * RAISING.actionEnergy[42]["2"];
    assert.equal(fullness, day.feeding.fullnessAfter);
    assert.equal(affection, day.feeding.affectionAfter);
  }
  assert.equal(count, plan.color.plannedWorms);
});

test("color form and worm meals persist without treating planned or skipped food as eaten", () => {
  const form = {
    current: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
    target: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
    desiredAbilities: [], knownAbilities: [], priority: "endurance",
    avoidYellow: true, eggId: "2312", wormsFed: "2",
  };
  const report = { affection: 224, fullness: 191, condition: "healthy", day: 18 };
  const progress = { startedAt: 100, day: 18, feedingDone: true, storyDone: false, careKey: null };
  const daily = { startedAt: 100, plannedDay: 18, days: Array.from({ length: 111 }, (_, index) => ({
    day: index + 18, foodId: null, foodCount: 0, story: null, careId: 0,
    feeding: { items: index === 0 ? [PARASITE_WORM_ID] : [], affectionBefore: 224, affectionAfter: 224,
      fullnessBefore: index === 0 ? 191 : 255, fullnessAfter: 255, careSuccess: 95 },
  })) };
  const saved = { form, daily, progress, defaultsVersion: 1 };
  const parsed = parseSavedRaisingDaily(JSON.stringify(saved));
  assert.deepEqual(parsed, saved);
  assert.deepEqual(plannerColorGoal(parsed.form), { eggId: 2312, wormsFed: 2 });
  assert.equal(plannerColorGoal({ ...form, avoidYellow: false }), undefined);
  assert.ok(Number.isNaN(plannerColorGoal({ ...form, wormsFed: "" }).wormsFed));
  for (const patch of [{ avoidYellow: false }, { eggId: "2319" }, { wormsFed: "3" }]) {
    assert.notEqual(feedingInputKey(form, report), feedingInputKey({ ...form, ...patch }, report));
  }
  for (const patch of [{ avoidYellow: "yes" }, { eggId: 2312 }, { wormsFed: 2 }]) {
    assert.throws(() => parseSavedRaisingDaily(JSON.stringify({ ...saved, form: { ...form, ...patch } })), /invalid/);
  }
  const invalid = structuredClone(saved);
  invalid.daily.days[1].feeding.items = [PARASITE_WORM_ID];
  invalid.daily.days[1].feeding.fullnessBefore = 191;
  assert.throws(() => parseSavedRaisingDaily(JSON.stringify(invalid)), /invalid/, "no post-lock worm meal in saved plans");
});

test("start-of-day worker request ignores completion and treatment history but preserves reports and locked care", () => {
  const { outputFiles } = buildSync({
    stdin: { contents: 'export { default as Planner } from "./src/ChocoboRaisingPlanner";', resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", external: ["react"],
    define: { "import.meta.url": JSON.stringify("file:///E:/kupo/src/ChocoboRaisingPlanner.tsx") },
  });
  const require = createRequire(import.meta.url);
  const React = require("react");
  let states;
  let stateIndex;
  const effects = [];
  let request;
  const module = { exports: {} };
  new Function("require", "module", "exports", "Worker", outputFiles[0].text)(
    name => name === "react" ? {
      ...React, useId: () => "color-worker-test", useEffect: callback => { effects.push(callback); },
      useState: () => [states[stateIndex++], () => {}],
    } : require(name), module, module.exports,
    class {
      postMessage(input) { request = input; }
      terminate() {}
    },
  );
  for (const avoidYellow of [true, false]) {
    states = [{
      form: {
        current: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
        target: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])),
        desiredAbilities: [], knownAbilities: [], priority: "endurance",
        feedingReport: { affection: 224, fullness: 31, condition: "unwell", day: 18, ailments: ["sick"], events: ["high-spirits"], treatmentGiven: true, medicineId: 2201 },
        avoidYellow, eggId: "2312", wormsFed: "2",
      },
      defaultsVersion: 1, calculatedDay: 18, calculatedStart: 0, todayMode: true, feedingMode: true,
      arrangedCare: { startedAt: 0, days: [{ day: 19, careId: 3 }] },
      progress: { startedAt: 0, day: 18, feedingDone: true, storyDone: true, careKey: null },
    }, { startedAt: 0, error: null }, "", null, 18 * 86400000, null];
    stateIndex = 0;
    effects.length = 0;
    module.exports.Planner();
    const cleanup = effects.at(-1)();
    assert.equal(request.currentDay, 18);
    assert.equal(request.tomorrowCareId, 3);
    assert.deepEqual(request.feedingReport.ailments, ["sick"]);
    assert.deepEqual(request.feedingReport.events, ["high-spirits"]);
    assert.deepEqual(request.today, { feedingDone: false, storyDone: false });
    assert.equal(request.feedingReport.treatmentGiven, undefined);
    assert.equal(request.feedingReport.medicineId, undefined);
    assert.equal(request.feedingReport.affection, 224);
    assert.equal(request.feedingReport.fullness, 31);
    assert.deepEqual(request.colorGoal, avoidYellow ? { eggId: 2312, wormsFed: 2 } : undefined);
    cleanup();
  }
});

test("food totals combine repeated mixed meals by item without double-counting legacy fields", () => {
  const days = [
    { foodId: 5608, foodCount: 3, feeding: { items: [5608, 5606, 5608] } },
    { foodId: 5608, foodCount: 3, feeding: { items: [5608, 5608, 5606] } },
    { foodId: 5607, foodCount: 4 },
    { foodId: 5607, foodCount: 4, feeding: { items: [] } },
    { foodId: null, foodCount: 0 },
  ];
  const before = structuredClone(days);
  assert.deepEqual(trainingFoodTotals(days), [
    { id: 5606, name: "Azouph Greens", count: 2 },
    { id: 5607, name: "Vomp Carrot", count: 4 },
    { id: 5608, name: "Zegham Carrot", count: 4 },
  ]);
  assert.deepEqual(days, before);
  assert.deepEqual(trainingFoodTotals([]), []);
  assert.deepEqual(trainingFoodTotals([{ foodId: null, foodCount: 0, feeding: { items: [] } }]), []);
  assert.throws(() => trainingFoodTotals([{ foodId: -1, foodCount: 1 }]), /Unknown food/);
});

test("reported meals choose stat food at high affection and safely recover low affection", () => {
  const run = (patch = {}) => planRaisingGoal(goal({
    currentDay: 128, target: stats(0, 0, 6, 6), desiredAbilities: [],
    today: { feedingDone: false, storyDone: false },
    feedingReport: { affection: 224, fullness: 0, condition: "healthy", day: 128 }, ...patch,
  }));
  const trained = run();
  assert.equal(trained.complete, true);
  assert.deepEqual(trained.days[0].feeding.items, [5608, 5608, 5608]);
  assert.deepEqual(trainingFoodTotals(trained.days), [{ id: 5608, name: "Zegham Carrot", count: 3 }]);
  assert.equal(trained.days[0].feeding.affectionAfter, 255);
  const recovery = run({ target: stats(), feedingReport: { affection: 0, fullness: 0, condition: "healthy", day: 128 } });
  assert.ok(recovery.days[0].feeding.affectionAfter >= 224);
  assert.ok(recovery.days[0].feeding.items.some(id => feedingFood(id).affection > 24));
  assert.deepEqual(recovery.result, stats(), "no stat debt below zero");
  for (const condition of ["unwell", "sleeping", "away"]) {
    const paused = run({ feedingReport: { affection: 0, fullness: 0, condition, day: 128 } });
    assert.deepEqual(paused.days[0].feeding.items, []);
    assert.equal(paused.complete, false);
  }
  const alreadyFed = run({ today: { feedingDone: true, storyDone: false } });
  assert.deepEqual(alreadyFed.days[0].feeding.items, []);
  assert.deepEqual(trainingFoodTotals(alreadyFed.days), []);
  assert.deepEqual(run({ feedingReport: { affection: 0, fullness: 255, condition: "healthy", day: 128 } }).days[0].feeding.items, []);
  const tired = run({
    current: stats(0, 0, 160), desiredAbilities: ["Bore"],
    feedingReport: { affection: 224, fullness: 0, condition: "tired", day: 128 },
  });
  assert.ok(tired.days[0].feeding.items.length > 0, "tired is not the same as unable to eat");
  assert.equal(tired.days[0].story, null);
  assert.match(validateRaisingGoal(goal({ feedingReport: { affection: 224, fullness: 31, condition: "healthy", day: 4 } })), /Enter current/);
  assert.throws(() => run({ feedingReport: { affection: -1, fullness: 0, condition: "healthy", day: 128 } }), /affection report/);
  assert.ok(careSuccessChance(stats(), 224, 2) > careSuccessChance(stats(), 0, 2));
  assert.equal(careSuccessChance(stats(224, 224), 255, 2), 95);
});

test("report-aware full routes meet all preset goals while maintaining affection and replaying every meal", () => {
  for (const preset of RAISING_PRESETS) {
    const input = goal({
      target: preset.target, desiredAbilities: preset.desiredAbilities, priority: preset.priority,
      currentDay: 0, today: { feedingDone: false, storyDone: false },
      feedingReport: { affection: 255, fullness: 255, condition: "healthy", day: 0 },
    });
    const plan = planRaisingGoal(input);
    assert.equal(plan.complete, true, `${preset.id}: ${plan.remaining.join("; ")}`);
    assert.ok(STAT_KEYS.every(key => plan.result[key] >= preset.target[key]));
    assert.ok(plan.days.some(step => (step.manualShortWalks ?? 0) > 0), `${preset.id}: the route uses walks when they improve feeding capacity`);
    let current = stats();
    let affection = 255;
    let fullness = 255;
    let energySpent = 0;
    for (const step of plan.days) {
      assert.deepEqual(step.before, current);
      const care = RAISING.plans.find(care => care.id === step.careId);
      if (step.day !== 0) {
        affection = Math.max(0, Math.min(255, affection + care.affection));
        fullness = step.day <= 4 ? 255 : step.day < 19 ? Math.max(0, fullness - Math.floor(2.25 * energySpent)) : 0;
      }
      current = applyTrainingAction(current, { kind: "care", id: step.careId }, step.day, step.carePoints);
      assert.equal(step.feeding.affectionBefore, affection);
      assert.equal(step.feeding.fullnessBefore, fullness);
      for (const id of step.feeding.items) {
        assert.ok(step.day >= 4 && fullness < 224);
        const item = feedingFood(id);
        const variant = step.day < 19 ? item.chick : item;
        current = applyRaisingStatChanges(current, item.stats);
        affection = Math.min(255, affection + variant.affection);
        fullness = Math.min(255, fullness + variant.fullness);
      }
      if (step.story) current = applyRaisingStatChanges(current, stats(0, 0, 1));
      assert.ok((step.manualShortWalks ?? 0) <= maxManualShortWalks(step.careId));
      energySpent = step.day === 0 || step.story ? 0
        : care.energy + (step.manualShortWalks ?? 0) * RAISING.actionEnergy[42]["2"];
      assert.equal(step.feeding.affectionAfter, affection);
      assert.equal(step.feeding.fullnessAfter, fullness);
      assert.ok(affection >= 224, `${preset.id}, day ${step.day}`);
      assert.deepEqual(step.after, current);
    }
    assert.equal(plan.foodItems, plan.days.reduce((sum, step) => sum + step.feeding.items.length, 0));
    const totals = trainingFoodTotals(plan.days);
    assert.equal(totals.reduce((sum, food) => sum + food.count, 0), plan.foodItems);
    const items = plan.days.flatMap(step => step.feeding.items);
    assert.equal(totals.length, new Set(items).size);
    for (const food of totals) assert.equal(food.count, items.filter(id => id === food.id).length);
    assert.ok(plan.days.some(step => step.day < 19 && step.feeding.items.length), "hunger-aware chick meals are included");
    const saved = {
      form: { ...input, current: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])), target: Object.fromEntries(STAT_KEYS.map(key => [key, String(input.target[key])])) },
      daily: { startedAt: null, plannedDay: 0, feedingReport: input.feedingReport,
        days: plan.days.map(({ day, foodId, foodCount, story, careId, feeding, manualShortWalks }) =>
          ({ day, foodId, foodCount, story, careId, feeding, manualShortWalks })) },
    };
    saved.daily.feedingInputs = feedingInputKey(saved.form, input.feedingReport);
    assert.notEqual(feedingInputKey({ ...saved.form, current: { ...saved.form.current, strength: "32" } }, input.feedingReport),
      saved.daily.feedingInputs, "changed stats invalidate saved meals, not just changed hunger");
    assert.notEqual(feedingInputKey(saved.form, { ...input.feedingReport, fullness: 223 }), saved.daily.feedingInputs);
    assert.deepEqual(parseSavedRaisingDaily(JSON.stringify(saved)), saved);
    const excessiveWalks = structuredClone(saved);
    const chickStep = excessiveWalks.daily.days.find(step => step.day >= 4 && step.day < 19);
    assert.ok(chickStep);
    chickStep.manualShortWalks = 4;
    assert.throws(() => parseSavedRaisingDaily(JSON.stringify(excessiveWalks)), /invalid/, "saved walk counts cannot exceed the energy budget");
    const bad = structuredClone(saved);
    const fed = bad.daily.days.find(step => step.feeding.items.length);
    fed.feeding.fullnessBefore = 255;
    assert.throws(() => parseSavedRaisingDaily(JSON.stringify(bad)), /invalid/);
    for (const field of ["affection", "fullness", "day"]) {
      const badReport = structuredClone(saved);
      badReport.form.feedingReport[field] = "bad";
      assert.throws(() => parseSavedRaisingDaily(JSON.stringify(badReport)), /invalid/);
    }
  }
});

test("known and partially known abilities do not consume additional learning slots or time", () => {
  const known = planRaisingGoal(goal({ currentDay: 120, current: stats(32, 224, 160, 224), knownAbilities: ["Bore", "Burrow"] }));
  assert.equal(known.threshold, 0);
  assert.equal(known.pending.length, 0);
  assert.ok(known.days.every(day => day.story === null));
  const partly = planRaisingGoal(goal({ currentDay: 117, current: stats(0, 0, 64), target: stats(), knownAbilities: ["Bore"] }));
  assert.equal(partly.threshold, 64);
  assert.deepEqual(partly.pending.map(ability => ability.name), ["Burrow"]);
  assert.equal(partly.complete, true);
  assert.equal(partly.days.filter(day => day.story === "Burrow").length, 11);
  assert.deepEqual(partly.finalAbilities, ["Bore", "Burrow"]);
});

test("care and meal limits match available stages and source fullness", () => {
  assert.deepEqual([0, 2, 4, 10].map(careAvailableDay), [0, 4, 19, 29]);
  assert.equal(trainingFoodLimit(5607), 4);
  assert.equal(trainingFoodLimit(5608), 3);
  assert.equal(trainingFoodLimit(2205), 2);
  assert.throws(() => trainingFoodLimit(-1), /Unsupported/);
  assert.throws(() => careAvailableDay(1), /Unsupported/);
  assert.deepEqual(groupTrainingDays([]), []);
});

test("raising clock uses exact elapsed 24-hour periods, including DST changes", () => {
  const start = Date.parse("2026-11-01T00:30:00-05:00");
  const day = 86400000;
  assert.equal(RAISING_START_KEY, "kupo.raising.startedAt.v1");
  assert.equal(RAISING_SAVED_STARTS_KEY, "kupo.raising.savedStarts.v1");
  assert.deepEqual(parseSavedRaisingStarts(JSON.stringify([
    { name: "First egg", startedAt: start },
    { name: "Second egg", startedAt: start + 1000 },
  ])), [
    { name: "First egg", startedAt: start },
    { name: "Second egg", startedAt: start + 1000 },
  ]);
  for (const saved of [
    "not json", "{}", JSON.stringify([{ name: " ", startedAt: start }]),
    JSON.stringify([{ name: "Egg", startedAt: NaN }]),
    JSON.stringify([{ name: "Egg", startedAt: start }, { name: "egg", startedAt: start + 1 }]),
  ]) assert.throws(() => parseSavedRaisingStarts(saved));
  assert.equal(LAST_RAISING_DAY, 128);
  assert.equal(raisingDayAt(start, start), 0);
  assert.equal(raisingDayAt(start, start + day - 1), 0);
  assert.equal(raisingDayAt(start, start + day), 1);
  assert.equal(raisingDayAt(start, Date.parse("2026-11-02T00:30:00-06:00")), 1);
  assert.equal(raisingDayAt(start, start + 64 * day), 64);
  assert.equal(raisingDayAt(start, start + 128 * day), 128);
  assert.equal(raisingDayAt(start, start + 129 * day), 129, "does not clamp retirement back to a training day");
  assert.throws(() => raisingDayAt(start + 1, start), /future/);
  assert.throws(() => raisingDayAt(NaN, start), /valid date/);
  const local = new Date(2026, 5, 15, 14, 35, 22).getTime();
  assert.equal(localRaisingStart(local), "2026-06-15T14:35:22");
  assert.equal(parseRaisingStart(localRaisingStart(local), local), local);
  assert.equal(parseRaisingStart("2026-06-15T14:35", local), local - 22000);
  for (const value of ["", "bad date", "2026-02-30T10:00", "2026-06-15T25:35", "2026-06-15T14:35junk"]) {
    assert.throws(() => parseRaisingStart(value, local), /valid local date/);
  }
  assert.throws(() => parseRaisingStart("2027-01-01T00:00", local), /future/);
});

test("refresh calculates from click-time age, preserves inputs and rejects retirement without waiting for a clock tick", t => {
  const { outputFiles } = buildSync({
    stdin: { contents: `export { default as Planner } from "./src/ChocoboRaisingPlanner";`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", external: ["react"],
    logOverride: { "empty-import-meta": "silent" },
  });
  const require = createRequire(import.meta.url);
  const React = require("react");
  const start = Date.parse("2026-10-01T12:00:00Z");
  const day = 86400000;
  const form = {
    current: { strength: "45", endurance: "64", discernment: "160", receptivity: "96" },
    target: { strength: "224", endurance: "128", discernment: "160", receptivity: "96" },
    desiredAbilities: ["Gallop", "Canter"], knownAbilities: ["Gallop"], priority: "strength", useExactStats: false,
  };
  const view = {
    form, defaultsVersion: 1, calculatedDay: 3, calculatedStart: start,
    calculation: { status: "error", message: "Previous calculation" },
  };
  let states;
  let stateIndex;
  let clickTime;
  t.mock.method(Date, "now", () => clickTime);
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(
    name => name === "react" ? {
      ...React, useId: () => "refresh-test", useEffect: () => {},
      useState: () => {
        const index = stateIndex++;
        return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
    } : require(name), module, module.exports,
  );
  const findElement = (element, predicate) => {
    if (!React.isValidElement(element)) return undefined;
    if (predicate(element)) return element;
    return React.Children.toArray(element.props.children).map(child => findElement(child, predicate)).find(Boolean);
  };
  const storageValues = new Map();
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, String(value)),
  } });
  t.after(() => {
    if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    else delete globalThis.localStorage;
  });
  const savedView = { ...view, calculatedDay: null, calculatedStart: undefined };
  states = [savedView, { startedAt: null, error: null }, localRaisingStart(start), null, start, null, { entries: [], error: null }, "", null, "", null];
  stateIndex = 0;
  clickTime = start + 4 * day;
  const savedTimeSelect = tree => findElement(findElement(tree, element => element.type === "label"
    && React.Children.toArray(element.props.children).includes("Saved egg times")), element => element.type === "select");
  const saveButton = tree => findElement(tree, element => element.type === "button" && element.props.children === "Save start time");
  const deleteButton = tree => findElement(tree, element => element.type === "button" && element.props.children === "Delete saved time");
  const nameInput = tree => findElement(findElement(tree, element => element.type === "label"
    && React.Children.toArray(element.props.children).includes("Name for saved egg time")), element => element.type === "input");
  const saveNamedButton = tree => findElement(tree, element => element.type === "button" && element.props.children === "Save named time");
  const confirmDeleteButton = tree => findElement(tree, element => element.type === "button" && element.props.children === "Confirm delete");
  const cancelDeleteButton = tree => findElement(tree, element => element.type === "button" && element.props.children === "Cancel delete");
  const saveWithName = name => {
    stateIndex = 0;
    saveButton(module.exports.Planner()).props.onClick();
    stateIndex = 0;
    nameInput(module.exports.Planner()).props.onChange({ target: { value: name } });
    stateIndex = 0;
    saveNamedButton(module.exports.Planner()).props.onClick();
  };
  saveWithName("First egg");
  assert.equal(states[1].startedAt, start);
  assert.equal(storageValues.get(RAISING_START_KEY), JSON.stringify(start));
  assert.deepEqual(JSON.parse(storageValues.get(RAISING_SAVED_STARTS_KEY)), [{ name: "First egg", startedAt: start }]);
  states[2] = localRaisingStart(start + day);
  saveWithName("Backup egg");
  assert.deepEqual(JSON.parse(storageValues.get(RAISING_SAVED_STARTS_KEY)), [
    { name: "First egg", startedAt: start }, { name: "Backup egg", startedAt: start + day },
  ]);
  stateIndex = 0;
  savedTimeSelect(module.exports.Planner()).props.onChange({ target: { value: "First egg" } });
  assert.equal(states[1].startedAt, start, "selecting a named time restores its clock");
  stateIndex = 0;
  let savedTree = module.exports.Planner();
  deleteButton(savedTree).props.onClick();
  stateIndex = 0;
  savedTree = module.exports.Planner();
  cancelDeleteButton(savedTree).props.onClick();
  assert.equal(JSON.parse(storageValues.get(RAISING_SAVED_STARTS_KEY)).length, 2, "cancelled confirmation preserves the saved time");
  stateIndex = 0;
  deleteButton(module.exports.Planner()).props.onClick();
  stateIndex = 0;
  confirmDeleteButton(module.exports.Planner()).props.onClick();
  assert.deepEqual(JSON.parse(storageValues.get(RAISING_SAVED_STARTS_KEY)), [{ name: "Backup egg", startedAt: start + day }]);
  assert.equal(storageValues.get(RAISING_START_KEY), "null", "deleting the active saved time clears its active clock");
  assert.equal(states[1].startedAt, null);
  assert.equal(states[7], "");

  for (const [elapsed, expectedDay] of [[4 * day - 1, 3], [4 * day, null], [6 * day, null], [128 * day, null], [129 * day, null], [-1, null]]) {
    // Keep the rendered clock on day 3 to model a suspended app that has not ticked yet.
    states = [view, { startedAt: start, error: null }, localRaisingStart(start), null, start + 3 * day];
    stateIndex = 0;
    clickTime = start + elapsed;
    const tree = module.exports.Planner();
    const refresh = findElement(tree, element => element.type === "button" && element.props.children === "Calculate plan for day 3");
    assert.equal(refresh.props.disabled, false);
    const inputs = findElement(tree, element => element.type === "form");
    assert.equal(refresh.props.form, inputs.props.id);
    inputs.props.onSubmit({ preventDefault() {} });
    assert.equal(states[4], clickTime, "visible clock refreshes immediately");
    assert.equal(states[0].calculatedDay, expectedDay, "click-time age is used; missing hatched-bird reports block an unsafe request");
    assert.equal(states[0].form, form, "all reports, mode, goals and learned abilities are retained");
    assert.equal(states[0].calculatedStart, start);
    assert.equal(states[1].startedAt, start, "refresh never resets egg time");
    assert.equal(states[0].calculation, undefined, "old result is invalidated");
    stateIndex = 0;
    assert.ok(findElement(module.exports.Planner(), element => element.type === "button"
      && element.props.children === `Calculate plan for day ${Math.max(0, Math.floor(elapsed / day))}`), "button label follows the refreshed raising day");
  }
  const result = planRaisingGoal({
    current: { strength: 32, endurance: 64, discernment: 160, receptivity: 96 },
    target: { strength: 224, endurance: 128, discernment: 160, receptivity: 96 },
    desiredAbilities: form.desiredAbilities, knownAbilities: form.knownAbilities,
    priority: form.priority, currentDay: 3, today: { feedingDone: false, storyDone: false },
  });
  const textContent = element => React.isValidElement(element)
    ? element.type.name === "RaisingFoodText" ? element.props.text
      : React.Children.toArray(element.props.children).map(textContent).join("")
    : String(element ?? "");
  for (const calculation of [undefined, { status: "error", message: "Try again" }, { status: "success", plan: result }]) {
    states = [{ ...view, todayMode: true, feedingMode: true, calculation }, { startedAt: start, error: null }, localRaisingStart(start), null, start + 3 * day];
    stateIndex = 0;
    const tree = module.exports.Planner();
    const children = React.Children.toArray(tree.props.children);
    const divider = children.findIndex(element => element.type === "hr" && element.props.className === "raising-plan-divider");
    const calculate = findElement(children[divider - 1], element => element.type === "button" && element.props.children === "Calculate plan for day 3");
    assert.ok(calculate, "Calculate remains directly above the divider while loading, after failure and after success");
    assert.equal(calculate.props.disabled, calculation === undefined, "only loading disables Calculate for valid inputs");
    assert.equal(calculate.props.form, findElement(tree, element => element.type === "form").props.id);
    if (!calculation) assert.ok(findElement(tree, element => element.props.className === "raising-plan-spinner"), "loading spinner remains");
    if (calculation?.status === "success") {
      assert.ok(findElement(tree, element => element.props.className === "raising-plan-result"));
      const totals = findElement(tree, element => element.props["aria-label"] === "Estimated food totals");
      assert.ok(totals);
      assert.match(totals.props.className, /raising-food-totals/);
      const expectedTotals = trainingFoodTotals(result.days).map(food => `${food.count} ${food.name}`).join("; ");
      assert.ok(findElement(totals, element => element.type.name === "RaisingFoodText"
        && element.props.text === expectedTotals));
    } else {
      assert.equal(findElement(tree, element => element.props["aria-label"] === "Estimated food totals"), undefined);
    }
  }
  states = [view, { startedAt: start, error: null }, localRaisingStart(start), null, start + 4 * day];
  stateIndex = 0;
  const hatched = module.exports.Planner();
  const completionLabel = text => findElement(hatched, element => element.type === "label"
    && React.Children.toArray(element.props.children).includes(text));
  assert.equal(completionLabel("Care schedule checked / arranged"), undefined);
  assert.equal(findElement(hatched, element => element.type === "h4" && element.props.children === "Care to arrange today"), undefined,
    "no care section is shown without saved instructions");
  assert.equal(completionLabel("Feeding finished for today"), undefined);
  assert.equal(completionLabel("Story activities finished for today"), undefined);
  assert.equal(findElement(hatched, element => element.type === "legend" && element.props.children === "Completed today"), undefined);
  assert.equal(findElement(hatched, element => element.type === "label"
    && React.Children.toArray(element.props.children).some(child => typeof child === "string" && child.startsWith("These reports are from"))), undefined);
  const render = () => { stateIndex = 0; return module.exports.Planner(); };
  const calculateButton = tree => findElement(tree, element => element.type === "button"
    && typeof element.props.children === "string" && element.props.children.startsWith("Calculate plan for day"));
  const reportSelect = (tree, label) => findElement(findElement(tree, element => element.type === "label"
    && React.Children.toArray(element.props.children).includes(label)), element => element.type === "select");
  const fields = [["Affection report", "224"], ["Hunger report", "31"], ["Condition / activity readiness", "healthy"]];
  let tree = hatched;
  assert.equal(calculateButton(tree).props.disabled, true);
  for (const [index, [label, value]] of fields.entries()) {
    const select = reportSelect(tree, label);
    assert.equal(select.props.required, true);
    assert.equal(select.props.value, "");
    select.props.onChange({ target: { value } });
    tree = render();
    assert.equal(calculateButton(tree).props.disabled, index < fields.length - 1, "fields alone unlock Calculate; no confirmation checkbox");
    assert.equal(states[0].form.feedingReport.day, 4);
  }
  reportSelect(tree, "Hunger report").props.onChange({ target: { value: "63" } });
  tree = render();
  assert.equal(calculateButton(tree).props.disabled, false, "valid report changes do not require reconfirmation");
  const completeForm = states[0].form;
  states[0] = { ...states[0], form: { ...completeForm, target: { ...completeForm.target, strength: "" } } };
  assert.equal(calculateButton(render()).props.disabled, true, "other required fields still gate calculation");
  states[0] = { ...states[0], form: completeForm };
  states[4] = start + 5 * day;
  tree = render();
  assert.equal(calculateButton(tree).props.disabled, true);
  for (const [label] of fields) assert.equal(reportSelect(tree, label).props.value, "", "yesterday's reports are not silently reused");
  reportSelect(tree, "Affection report").props.onChange({ target: { value: "192" } });
  tree = render();
  assert.equal(calculateButton(tree).props.disabled, true);
  assert.equal(reportSelect(tree, "Hunger report").props.value, "", "a single new report does not revive yesterday's other fields");
  assert.equal(reportSelect(tree, "Condition / activity readiness").props.value, "");

  const schedule = { startedAt: start, plannedDay: 3, days: result.days };
  states = [{ ...view, daily: schedule }, { startedAt: start, error: null }, localRaisingStart(start), null, start + 4 * day];
  clickTime = states[4];
  const careButton = tree => findElement(tree, element => element.type === "button"
    && element.props["aria-label"] === "Confirm recommended care schedule");
  const todayRow = tree => findElement(tree, element => element.type === "tr" && element.props["aria-label"] === "Today's remaining actions");
  for (const [age, careId, count] of [[4, 3, 7], [4, 3, 1], [20, 0, 3], [126, 4, 1]]) {
    states[4] = start + age * day;
    const days = schedule.days.map(step => ({
      ...step, careId: step.day >= age + 2 && step.day < age + 2 + count ? careId : careId === 0 ? 3 : 0,
    }));
    states[0] = { ...view, calculatedDay: age, todayMode: true, feedingMode: true,
      form: { ...form, feedingReport: { day: age, affection: 224, fullness: 31, condition: "healthy" } },
      calculation: { status: "success", plan: { ...result, days } }, daily: { ...schedule, days },
    };
    const instructions = textContent(todayRow(render()));
    assert.ok(instructions.includes(`Plan 1: ${trainingActionName({ kind: "care", id: careId })}, ${count} days (${age + 2}-${age + 1 + count})`));
    assert.match(instructions, /Leave it unchanged if already correct/);
    const help = textContent(findElement(render(), element => element.type === "details"
      && textContent(element).startsWith("How to use the calculator and care plans")));
    assert.match(help, /Plan 2 runs after Plan 1 finishes/);
    assert.match(help, /Do not add Basic Care days to cover the delay/);
  }
  states[0] = { ...view, daily: schedule };
  states[4] = start + 4 * day;
  tree = render();
  assert.doesNotMatch(textContent(tree), /What to do today/);
  assert.equal(careButton(tree).props.disabled, false);
  assert.equal(careButton(tree).props.children, "Confirm care schedule");
  careButton(tree).props.onClick();
  const careKey = todayCare(schedule, 4).key;
  assert.equal(states[0].progress.careKey, careKey);
  assert.equal(states[0].arrangedCare.days[0].day, 6, "checking care records its future execution days");
  assert.equal(states[0].arrangedCare.days[0].careId, todayCare(schedule, 4).careId);
  assert.equal(states[0].calculation, view.calculation, "checking care does not discard the calculated plan");
  assert.equal(careButton(render()).props.children, "Clear care confirmation");
  states[0] = { ...parseSavedRaisingDaily(JSON.stringify(states[0])), calculatedDay: null };
  assert.equal(careButton(render()).props.children, "Clear care confirmation", "saved care confirmation survives restoration");
  careButton(render()).props.onClick();
  assert.equal(states[0].progress.careKey, null);
  assert.deepEqual(states[0].arrangedCare.days, [], "unchecking removes that block's confirmation");
  assert.equal(careButton(render()).props.children, "Confirm care schedule");
  careButton(render()).props.onClick();
  states[0] = { ...states[0], daily: { ...schedule, days: schedule.days.map(step =>
    step.day === 6 ? { ...step, careId: step.careId === 0 ? 3 : 0 } : step) } };
  assert.equal(careButton(render()).props.children, "Confirm care schedule", "a changed care block needs checking again");
  states[0] = { ...states[0], daily: schedule };
  states[4] = start + 5 * day;
  assert.equal(careButton(render()).props.children, "Confirm care schedule", "care confirmation resets on a new raising day");
  const previousProgress = states[0].progress;
  clickTime = start + 6 * day;
  careButton(render()).props.onClick();
  assert.equal(states[0].progress, previousProgress, "a click after rollover cannot mark yesterday's care complete");
  assert.match(states[5], /raising day changed/);
  for (const age of [3, 127, 128, 129]) {
    states[4] = start + age * day;
    tree = render();
    assert.equal(careButton(tree), undefined);
  }

  states = [{ ...view, calculatedDay: null }, { startedAt: start, error: null }, localRaisingStart(start), null, start + 6 * day];
  clickTime = states[4];
  assert.equal(reportSelect(render(), "Already-scheduled activity").props.value, "", "unknown care is not silently Basic Care");
  assert.equal(calculateButton(render()).props.disabled, true);
  reportSelect(render(), "Already-scheduled activity").props.onChange({ target: { value: "3" } });
  assert.equal(reportSelect(render(), "Already-scheduled activity").props.value, 3, "can correct care before entering feeding reports");
  assert.deepEqual(tomorrowCare(states[0], start, 6), { careId: 3, source: "confirmed" });
  assert.match(textContent(render()), /Recorded as arranged or corrected by you/);
  states[0] = { ...states[0], daily: { ...schedule, feedingInputs: "old feeding inputs" } };
  reportSelect(render(), "Already-scheduled activity").props.onChange({ target: { value: "2" } });
  assert.equal(states[0].daily.feedingInputs, undefined, "correcting care requires refreshed food recommendations");
  states[0] = { ...view, calculatedDay: null, daily: schedule };
  assert.match(textContent(render()), /Unconfirmed estimate from your last calculated plan/);

  states = [{ ...view, calculatedDay: null, form: { ...form,
    feedingReport: { day: 6, affection: 224, fullness: 255, condition: "unwell" },
  } }, { startedAt: start, error: null }, localRaisingStart(start), null, start + 6 * day];
  clickTime = states[4];
  const ailmentGuidance = tree => findElement(tree, element => element.props["aria-label"] === "Ailment guidance");
  const assertTreatmentInTable = tree => {
    const action = React.Children.toArray(ailmentGuidance(tree).props.children)[0];
    const tableText = textContent(todayRow(tree));
    assert.ok(tableText.includes(textContent(action)), "the food/treatment cell repeats the explicit treatment action");
    assert.doesNotMatch(tableText, /See the ailment guidance above/);
  };
  const ailmentBox = tree => findElement(tree, element => element.type === "fieldset"
    && textContent(element).includes("Ailments reported by the trainer"));
  const healthCheckbox = (tree, label) => findElement(findElement(tree, element => element.type === "label"
    && React.Children.toArray(element.props.children).includes(label)), element => element.type === "input");
  const storyKeyItemCheckbox = (tree, keyItem) => {
    const group = findElement(tree, element => element.props["aria-label"] === "Ability story key items");
    const label = findElement(group, element => element.type === "label" && textContent(element).includes(keyItem));
    return findElement(label, element => element.type === "input");
  };
  assert.ok(findElement(ailmentBox(render()), element => element.props["aria-label"] === "Ailment guidance"),
    "ailment guidance is inside the ailments box");
  assert.equal(ailmentGuidance(render()).type, "ul", "ailment advice is a bulleted list");
  assert.match(textContent(ailmentGuidance(render())), /not specific enough/);
  healthCheckbox(render(), "Sick / minor illness").props.onChange({ target: { checked: true } });
  assert.deepEqual(states[0].form.feedingReport.ailments, ["sick"]);
  let healthText = textContent(ailmentGuidance(render()));
  assert.match(healthText, /Clump of Tokopekko Wildgrass/);
  assert.match(healthText, /Completely full.*Optional tradeoff/);
  assert.match(healthText, /Reference only: a matching remedy is an optional force-feeding tradeoff described above/);
  assert.equal((healthText.match(/Completely full:/g) ?? []).length, 1, "the full-food guidance appears once");
  assert.match(healthText, /Listen to Music is stat training, not treatment/);
  assert.equal(states[0].calculatedDay, null, "health advice does not require a plan calculation");
  healthCheckbox(render(), "Sick / minor illness").props.onChange({ target: { checked: false } });
  healthCheckbox(render(), "Lovesick").props.onChange({ target: { checked: true } });
  assert.match(textContent(ailmentGuidance(render())), /Lovesick:.*Celerity Salad/);
  assert.match(textContent(ailmentGuidance(render())), /Completely full.*Optional tradeoff/);
  reportSelect(render(), "Hunger report").props.onChange({ target: { value: "191" } });
  assert.match(textContent(ailmentGuidance(render())), /Give 1 Celerity Salad, alone, for Lovesick/);
  healthCheckbox(render(), "Lovesick").props.onChange({ target: { checked: false } });
  assert.match(textContent(ailmentGuidance(render())), /not specific enough/, "unwell readiness still requires an exact ailment");
  healthCheckbox(render(), "Sick / minor illness").props.onChange({ target: { checked: true } });
  const eventGuidance = tree => findElement(tree, element => element.props["aria-label"] === "Other event guidance");
  const handkerchiefGuidance = tree => findElement(tree, element => element.props["aria-label"] === "White Handkerchief guidance");
  healthCheckbox(render(), "Crying at night / holding White Handkerchief").props.onChange({ target: { checked: true } });
  assert.deepEqual(states[0].form.feedingReport.events, ["white-handkerchief"]);
  assert.match(textContent(handkerchiefGuidance(render())), /key item.*raising-report day.*zone out and back/);
  assert.doesNotMatch(textContent(eventGuidance(render())), /White Handkerchief/);
  assert.equal(healthCheckbox(render(), "Treatment already given today - do not recommend another dose"), undefined);
  assert.equal(findElement(render(), element => element.type === "button" && element.props.children === "Record one eaten medicine"), undefined);
  states[0] = { ...parseSavedRaisingDaily(JSON.stringify(states[0])), calculatedDay: null };
  assert.equal(healthCheckbox(render(), "Sick / minor illness").props.checked, true);
  assert.equal(healthCheckbox(render(), "Crying at night / holding White Handkerchief").props.checked, true);
  states[4] = start + 7 * day;
  assert.equal(healthCheckbox(render(), "Sick / minor illness").props.checked, false, "new day requires fresh health reports");
  assert.equal(healthCheckbox(render(), "Crying at night / holding White Handkerchief").props.checked, false, "event selections reset on a new raising day");
  assert.equal(handkerchiefGuidance(render()), undefined, "handkerchief guidance stays with its checked event");
  assert.doesNotMatch(textContent(eventGuidance(render())), /White Handkerchief/, "handkerchief guidance requires the event checkbox");
  const boreKeyItem = "Story of a Youthful Chocobo";
  storyKeyItemCheckbox(render(), boreKeyItem).props.onChange({ target: { checked: true } });
  assert.deepEqual(states[0].form.storyKeyItems, ["bore"]);
  const storyKeyGuidance = tree => findElement(tree, element => element.props["aria-label"] === "Ability story key item guidance");
  assert.match(textContent(storyKeyGuidance(render())), /Story of a Youthful Chocobo teaches Bore/);
  assert.match(textContent(storyKeyGuidance(render())), /Third meeting with Pulonono/);
  assert.match(textContent(storyKeyGuidance(render())), /Tell a Story.*Youthful Chocobo/);
  states[4] = start + 8 * day;
  assert.equal(storyKeyItemCheckbox(render(), boreKeyItem).props.checked, true,
    "story key item checks persist when daily trainer report events reset");
  assert.match(textContent(storyKeyGuidance(render())), /teaches Bore/);

  states[4] = start + 6 * day;
  clickTime = states[4];
  states[0] = { ...view, calculatedDay: 6, calculatedStart: start, todayMode: true, feedingMode: true,
    arrangedCare: { startedAt: start, days: [{ day: 7, careId: 3 }] },
    calculation: { status: "success", plan: result },
    form: { ...form, feedingReport: { day: 6, affection: 224, fullness: 191, condition: "unwell", ailments: ["sick"] } },
  };
  tree = render();
  assert.match(textContent(tree), /Hypothetical recovery forecast, not feeding instructions/);
  assert.match(textContent(todayRow(tree)), /Today - day 6/);
  assert.match(textContent(ailmentGuidance(tree)), /Give 1 Clump of Tokopekko Wildgrass/);
  assert.match(textContent(ailmentGuidance(tree)), /cure normally waits for the next raising-day update/);
  assert.match(textContent(todayRow(tree)), /Give 1 Clump of Tokopekko Wildgrass/);
  assertTreatmentInTable(tree);
  assert.match(textContent(todayRow(tree)), /Skip stories until healthy/);
  assert.match(textContent(todayRow(tree)), /Today's care is already in your reports/);
  assert.equal(findElement(tree, element => element.props["aria-label"] === "Today's chocobo checklist"), undefined);
  const timeline = findElement(tree, element => element.type === "table" && element.props["aria-label"] === "Goal training steps");
  const rows = React.Children.toArray(findElement(timeline, element => element.type === "tbody").props.children);
  assert.equal(rows[0].props["aria-label"], "Today's remaining actions", "today precedes tomorrow's forecast");
  for (const row of rows) {
    const cells = React.Children.toArray(row.props.children);
    if (/items total/.test(textContent(cells[2]))) {
      assert.match(textContent(cells[2]), /Only after confirmed recovery and a fresh hunger check/);
    }
  }
  const healthTimelineView = states[0];
  states[0] = { ...healthTimelineView, calculation: { status: "success", plan: { ...result, days: [] } },
    form: { ...healthTimelineView.form, feedingReport: {
      ...healthTimelineView.form.feedingReport, condition: "healthy", fullness: 255, ailments: [],
    } },
  };
  const fullChickInstructions = textContent(todayRow(render()));
  assert.match(fullChickInstructions, /Optional today: a Short Walk spends 24-30 energy/);
  assert.match(fullChickInstructions, /lowers chick fullness by 2\.25 per energy at the next daily update/);
  assert.match(fullChickInstructions, /requires at least 30 energy/);
  states[0] = { ...states[0], form: { ...states[0].form, feedingReport: {
    ...states[0].form.feedingReport, condition: "tired",
  } } };
  assert.doesNotMatch(textContent(todayRow(render())), /Optional today: a Short Walk/,
    "walk advice is not shown when the report says the chick is too tired for activities");
  states[0] = healthTimelineView;
  states[0] = { ...healthTimelineView, form: { ...healthTimelineView.form, feedingReport: {
    ...healthTimelineView.form.feedingReport, condition: "healthy", fullness: 255, ailments: [],
  } }, calculation: { status: "success", plan: { ...result, days: result.days.map(step => step.day === 7
    ? { ...step, manualShortWalks: 2 } : step) } } };
  const walkTimeline = findElement(render(), element => element.type === "table" && element.props["aria-label"] === "Goal training steps");
  assert.match(textContent(walkTimeline), /Manual Short Walks: 2 per day, minimum for these meals; budgeted at 30 energy each/);
  states[0] = { ...healthTimelineView, form: { ...healthTimelineView.form,
    feedingReport: { ...healthTimelineView.form.feedingReport, events: ["white-handkerchief", "high-spirits"] },
  } };
  const selectedEventTree = render();
  assert.match(textContent(findElement(selectedEventTree, element => element.props["aria-label"] === "White Handkerchief guidance")),
    /White Handkerchief \/ nighttime crying.*not a food trade/);
  assert.match(textContent(eventGuidance(selectedEventTree)), /High spirits.*Happiness.*increases the chance/);
  const otherEventsFieldset = findElement(selectedEventTree, element => element.type === "fieldset"
    && textContent(element).includes("Other events in the trainer's report"));
  assert.ok(findElement(otherEventsFieldset, element => element.props["aria-label"] === "Other event guidance"),
    "checked-event guidance is shown inside the event section");
  assert.match(textContent(otherEventsFieldset), /These guide-described benefits are not included in the numeric forecast/);
  assert.match(textContent(otherEventsFieldset), /condition effects guide/);
  assert.doesNotMatch(textContent(todayRow(selectedEventTree)), /High spirits.*Happiness/);
  assert.doesNotMatch(textContent(todayRow(selectedEventTree)), /White Handkerchief \/ nighttime crying/);
  states[0] = { ...healthTimelineView, form: { ...healthTimelineView.form,
    feedingReport: { ...healthTimelineView.form.feedingReport, events: ["lost-chick"] },
  } };
  const lostChickSearch = tree => findElement(tree, element => element.props["aria-label"] === "Lost Chick clue search");
  const lostChickOwnerTable = tree => findElement(tree, element => element.props["aria-label"] === "Lost Chick owner candidates");
  const lostChickInput = (tree, label) => findElement(findElement(lostChickSearch(tree), element =>
    element.type === "label" && textContent(element).startsWith(label)), element => element.type === "input");
  assert.match(textContent(lostChickOwnerTable(render())), /25 of 25 possible owners match/);
  lostChickInput(render(), "Owner's first letter").props.onChange({ target: { value: "G" } });
  lostChickInput(render(), "Owner's race and gender").props.onChange({ target: { value: "Mithra" } });
  assert.match(textContent(lostChickOwnerTable(render())), /2 of 25 possible owners match/);
  assert.match(textContent(lostChickOwnerTable(render())), /Gioh Ajihri.*Gottah Maporushanoh/);
  lostChickInput(render(), "Owner's occupation").props.onChange({ target: { value: "Hunter" } });
  assert.match(textContent(lostChickOwnerTable(render())), /1 of 25 possible owners match/);
  assert.match(textContent(lostChickOwnerTable(render())), /Gioh Ajihri/);
  assert.doesNotMatch(textContent(lostChickOwnerTable(render())), /Gottah Maporushanoh/);
  assert.deepEqual(parseSavedRaisingDaily(JSON.stringify(states[0])).form.lostChickClues,
    { firstLetter: "G", raceGender: "Mithra", occupation: "Hunter" });
  assert.throws(() => parseSavedRaisingDaily(JSON.stringify({ ...states[0], form: {
    ...states[0].form, lostChickClues: { firstLetter: "GG" },
  } })), /saved raising checklist is invalid/);
  healthCheckbox(render(), "Found a lost chick on a walk").props.onChange({ target: { checked: false } });
  assert.equal(lostChickSearch(render()), undefined, "clue inputs and candidate list require the checked Lost Chick event");
  assert.deepEqual(states[0].form.lostChickClues, { firstLetter: "G", raceGender: "Mithra", occupation: "Hunter" },
    "clues are preserved if the event checkbox is accidentally cleared");
  for (const [ailment, expected] of [["spoiled", /Scold.*20\+ energy/], ["bored", /not available until day 19/], ["lonely", /rebuild affection/]]) {
    states[0] = { ...healthTimelineView, form: { ...healthTimelineView.form,
      feedingReport: { ...healthTimelineView.form.feedingReport, ailments: [ailment] },
    } };
    assert.match(textContent(ailmentGuidance(render())), expected);
    assertTreatmentInTable(render());
  }
  for (const { id, label } of BIRD_AILMENTS) for (const fullness of [191, 255]) {
    states[0] = { ...healthTimelineView, form: { ...healthTimelineView.form,
      feedingReport: { ...healthTimelineView.form.feedingReport, condition: "healthy", fullness, ailments: [id] },
    } };
    const expectedRemedy = healthGuidance(states[0].form.feedingReport, 6).remedies[0].foods[0].name;
    const rendered = render();
    const text = textContent(ailmentGuidance(rendered));
    assert.ok(text.includes(label), `${id} is named in today's report`);
    assert.ok(text.includes(expectedRemedy), `${id} has a remedy even when full`);
    assert.match(text, fullness === 255 ? /Completely full.*Optional tradeoff/ : /Give 1/);
    assertTreatmentInTable(rendered);
  }
  for (const [patch, expected] of [
    [{ fullness: 255 }, /Completely full.*Optional tradeoff/],
    [{ condition: "sleeping" }, /Sleeping birds refuse other foods/],
    [{ condition: "away" }, /cannot feed or treat/],
  ]) {
    states[0] = { ...healthTimelineView, form: { ...healthTimelineView.form,
      feedingReport: { ...healthTimelineView.form.feedingReport, ...patch },
    } };
    const rendered = render();
    const text = textContent(ailmentGuidance(rendered));
    assert.match(text, expected);
    assertTreatmentInTable(rendered);
    assert.doesNotMatch(text, /Give 1 Clump of Tokopekko/);
  }
  states[0] = { ...healthTimelineView, progress: { startedAt: start, day: 6, feedingDone: true, storyDone: true, careKey: null } };
  assert.match(textContent(ailmentGuidance(render())), /Give 1 Clump of Tokopekko Wildgrass/,
    "legacy completion does not suppress today's treatment guidance");
  assertTreatmentInTable(render());
  assert.match(textContent(todayRow(render())), /Skip stories until healthy/);
  states[0] = { ...healthTimelineView, form: { ...healthTimelineView.form,
    feedingReport: { ...healthTimelineView.form.feedingReport, condition: "healthy", ailments: [] },
  }, calculation: { status: "success", plan: { ...result, days: result.days.map(step => step.day === 6
    ? { ...step, feeding: { items: [5608] }, story: null } : step) } } };
  assert.match(textContent(todayRow(render())), /Feed 1 Zegham Carrot/);
  states[0] = { ...healthTimelineView,
    progress: { startedAt: start, day: 6, feedingDone: true, storyDone: true, careKey: null },
    form: { ...healthTimelineView.form, feedingReport: {
      ...healthTimelineView.form.feedingReport, treatmentGiven: true, medicineId: 2201,
    } },
  };
  assert.match(textContent(ailmentGuidance(render())), /Give 1 Clump of Tokopekko Wildgrass/,
    "legacy treatment marks do not suppress the start-of-day recommendation");
  assertTreatmentInTable(render());
  findElement(render(), element => element.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(states[0].progress, { startedAt: start, day: 6, feedingDone: false, storyDone: false, careKey: null });
  assert.equal(states[0].form.feedingReport.treatmentGiven, undefined);
  assert.equal(states[0].form.feedingReport.medicineId, undefined);
  assert.equal(states[0].form.feedingReport.fullness, 191, "resetting completion does not change entered hunger");
  assert.deepEqual(states[0].arrangedCare, healthTimelineView.arrangedCare, "recalculating retains tomorrow's confirmed care");

  const storyInstruction = tree => findElement(todayRow(tree), element => element.props["aria-label"] === "Today's story instruction");
  const storyView = {
    ...view, calculatedDay: 30, todayMode: true, feedingMode: true,
    form: { ...form, knownAbilities: [], feedingReport: { affection: 224, fullness: 31, condition: "healthy", day: 30 } },
    daily: { ...schedule, days: schedule.days.map(step => step.day === 30 ? { ...step, story: "Bore" } : step) },
    calculation: { status: "success", plan: { ...result, days: result.days.map(step =>
      step.day === 30 ? { ...step, story: "Bore" } : step) } },
  };
  const colorStrategy = {
    locked: false, plannedWorms: 1, wormsFed: 0,
    before: { yellow: 0.95, black: 0.03, blue: 0.01, red: 0.005, green: 0.005 },
    after: { yellow: 0.8, black: 0.08, blue: 0.04, red: 0.04, green: 0.04 },
  };
  states = [storyView, { startedAt: start, error: null }, localRaisingStart(start), null, start + 30 * day];
  clickTime = states[4];
  for (const ability of RAISING_ABILITIES) {
    states[0] = { ...storyView, calculation: { status: "success", plan: { ...result, pending: [ability],
      color: colorStrategy, days: result.days.map(step => step.day === 30 ? { ...step, story: ability.name } : step) } } };
    tree = render();
    const instruction = storyInstruction(tree);
    assert.ok(instruction, `${ability.name} gets a concise table instruction`);
    const text = textContent(instruction);
    assert.ok(text.includes(`Tell a Story: ${ability.story}, once (${ability.name})`));
    assert.ok(text.includes(`Requires ${ability.discernment} DSC`));
    assert.match(text, /14\+ energy and a free ability slot/);
    const reference = findElement(tree, element => element.type === "details"
      && textContent(element).startsWith("Ability preparation and learning checkpoint"));
    assert.ok(textContent(reference).includes(ability.obtain), "acquisition remains in collapsed reference");
    assert.notEqual(reference.props.open, true);
    const colorDetails = findElement(tree, element => element.type === "details"
      && element.props["aria-label"] === "Estimated non-yellow strategy");
    assert.ok(colorDetails);
    assert.notEqual(colorDetails.props.open, true, "non-yellow strategy starts collapsed");
    assert.ok(findElement(colorDetails, element => element.type === "table"
      && element.props["aria-label"] === "Planned plumage color chances"));
    const plannerText = textContent(tree);
    assert.ok(plannerText.indexOf("Estimated training timeline") < plannerText.indexOf("Estimated result"));
    assert.ok(plannerText.lastIndexOf("Grade") < plannerText.indexOf("Total food needed for this plan"));
    assert.ok(plannerText.indexOf("Total food needed for this plan")
      < plannerText.indexOf("Ability preparation and learning checkpoint"));
    assert.ok(plannerText.indexOf("Ability preparation and learning checkpoint")
      < plannerText.indexOf("Non-yellow feeding strategy"));
    assert.doesNotMatch(plannerText, /food items total, including affection meals|Queue care plans two days before execution/);
    assert.doesNotMatch(plannerText, /Some days remain below the highest affection band/);
    assert.ok(findElement(tree, element => element.type.name === "RaisingFoodText"
      && element.props.text.includes("Vomp Carrot")));
    assert.ok(findElement(tree, element => element.type.name === "RaisingFoodText"
      && element.props.text === "Parasite Worms"));
    assert.ok(findElement(tree, element => element.type.name === "RaisingFoodText"
      && element.props.text === "Azouph Greens"));
  }
  for (const condition of ["tired", "unwell", "sleeping", "away", "unknown"]) {
    states[0] = { ...storyView, form: { ...storyView.form, feedingReport: { ...storyView.form.feedingReport, condition } } };
    assert.equal(storyInstruction(render()), undefined, `no attempt instructions for ${condition} birds`);
  }
  states[0] = { ...storyView, form: { ...storyView.form, knownAbilities: ["Bore"] } };
  assert.equal(storyInstruction(render()), undefined, "already-learned abilities are not attempted again");
  states[0] = { ...storyView, calculation: { status: "success", plan: { ...result,
    days: result.days.map(step => ({ ...step, story: null })) } } };
  assert.equal(storyInstruction(render()), undefined, "instruction appears only when a story attempt is scheduled");
  states[0] = { ...storyView, progress: { startedAt: start, day: 30, feedingDone: true, storyDone: true, careKey: null } };
  assert.ok(storyInstruction(render()), "legacy story completion is ignored by start-of-day instructions");
  states[0] = { ...storyView, form: { ...storyView.form, feedingReport: { ...storyView.form.feedingReport, events: ["high-spirits"] } } };
  findElement(render(), element => element.type === "button" && element.props.children === "Clear start time").props.onClick();
  assert.equal(states[0].form.feedingReport.events, undefined, "switching away from an egg clears its reported events");
});

test("story odds are per eligible attempt and acquisition references are shared", () => {
  assert.equal(STORY_ATTEMPTS_95, 11);
  assert.equal(storyLearningProbability(0), 0);
  assert.equal(storyLearningProbability(1), 0.25);
  assert.ok(storyLearningProbability(11) > 0.95);
  assert.ok(storyLearningProbability(10) < 0.95);
  assert.ok(storyLearningProbability(11) ** 2 < 0.95, "per-ability confidence is not joint confidence");
  for (const value of [-1, 1.5, NaN]) assert.throws(() => storyLearningProbability(value));
  assert.equal(RAISING_ABILITIES.length, 6);
  assert.match(RAISING_ABILITIES.find(ability => ability.name === "Bore").obtain, /Pulonono.*Windurst/);
  assert.match(RAISING_ABILITIES.find(ability => ability.name === "Burrow").obtain, /Zopago.*Bastok/);
});

test("top tabs keep Digging, Raising and Weather adjacent without losing existing rendering", () => {
  const shell = readFileSync("src/AppShell.tsx", "utf8");
  assert.match(shell, /id: "chocobo"[^\n]+\n\s*\{ id: "raising"[^\n]+\n\s*\{ id: "weather"/);
  assert.match(shell, /activeTab === "raising"[\s\S]*?<ChocoboRaisingTab \/>/);
  assert.match(shell, /<ChocoboTab cal=\{cal\} \/>/);
  assert.match(shell, /<WeatherTab cal=\{cal\}/);
  assert.match(readFileSync("src/ScreenControls.tsx", "utf8"), /COLLAPSIBLE_SCOPES.*"raising"/);
});

test("background planner returns cloneable results and explicit calculation errors", () => {
  const { outputFiles } = buildSync({
    entryPoints: ["src/workers/chocoboRaisingPlanner.worker.ts"],
    bundle: true, write: false, platform: "browser", format: "iife",
  });
  const messages = [];
  const worker = { onmessage: null, postMessage: message => messages.push(structuredClone(message)) };
  new Function("self", outputFiles[0].text)(worker);
  const request = goal({ currentDay: 126 });
  worker.onmessage({ data: request });
  assert.equal(messages[0].status, "success");
  assert.deepEqual(messages[0].plan, planRaisingGoal(request));
  worker.onmessage({ data: goal({ currentDay: 129 }) });
  assert.equal(messages[1].status, "error");
  assert.match(messages[1].message, /retir/i);
  assert.equal(messages[1].plan, undefined, "failure must not masquerade as a plan");
  worker.onmessage({ data: goal({ currentDay: 128 }) });
  assert.equal(messages[2].status, "success", "a later valid request can succeed");
  assert.equal(messages[2].plan.days.length, 0);
});

test("tab renders food reference, default digging goals and source caveats offline", () => {
  const { outputFiles } = buildSync({
    stdin: { contents: 'import React from "react"; import { renderToStaticMarkup } from "react-dom/server"; import Raising from "./src/ChocoboRaisingTab"; export const render = () => renderToStaticMarkup(<Raising />);', resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
    logOverride: { "empty-import-meta": "silent" },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const html = module.exports.render();
  const wikiLink = '<a href="https://wiki.phoenix-xi.com/Chocobo_raising" target="_blank" rel="noreferrer">Chocobo raising wiki guide</a>';
  assert.ok(html.includes(wikiLink));
  assert.ok(html.indexOf(wikiLink) < html.indexOf('aria-label="Chocobo goal planner"'), "wiki link is visible above the planner, outside collapsed help");
  assert.match(html, /24 of 24 foods/);
  assert.doesNotMatch(html, /Food-only what-if|Food-only projection|Food-only result/);
  assert.match(html, /Correctly return the lost chick/);
  assert.match(html, /not verification of live-server settings/);
  assert.match(html, /does not apply personal-chocobo stats/);
  const statHelp = html.match(/<details><summary>Stats, goals and abilities<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(statHelp);
  assert.match(statHelp, /224 END corresponds to \+112 digs/);
  assert.match(statHelp, /A-grade DSC \(160-191\) corresponds to a 20% chance/);
  assert.match(statHelp, /Story of a Youthful Chocobo key item.*teaches Bore/);
  assert.match(statHelp, /select <strong>Youthful Chocobo<\/strong>/);
  assert.match(statHelp, /160 DSC after the story&#x27;s \+1.*free ability slot/);
  assert.match(statHelp, /Each daily attempt has a 25% learning chance/);
  assert.match(statHelp, /If Bore is already known or both slots are full, the story is consumed for inspiration instead/);
  assert.match(statHelp, /SS-grade RCP \(224-255\) corresponds to a 35% increase, not a flat 35% chance/);
  assert.match(statHelp, /do not list a direct Strength bonus to finds/);
  assert.match(statHelp, /source-derived digging guide/);
  assert.match(statHelp, /documentation and override differ/);
  assert.match(statHelp, /not included in the current Digging tab estimates/);
  assert.match(html, /224 or higher/);
  assert.match(html, /Plan my chocobo/);
  assert.match(html, /aria-label="Calculated chocobo plan" aria-busy="false"/);
  assert.match(html, /<hr class="raising-plan-divider"\/><section aria-label="Calculated chocobo plan"/);
  assert.match(html, /No plan available for the current day and inputs/);
  assert.match(html, />Calculate plan for day 0<\/button><\/div><hr class="raising-plan-divider"/);
  assert.doesNotMatch(html, /improves trainer-encounter chances and breeding inheritance rolls/);
  assert.doesNotMatch(html, /class="raising-plan-result"/);
  assert.match(html, /<details><summary>How to use the calculator and care plans<\/summary>/, "calculator help starts collapsed");
  const help = html.match(/<details><summary>How to use the calculator and care plans<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(help);
  const helpHeadings = [...help.matchAll(/<h4>(.*?)<\/h4>/g)].map(match => match[1]);
  assert.deepEqual(helpHeadings, ["Set up your first plan", "How often should I check in?", "What is a care plan?", "How often can I feed it?", "One timeline through day 128"]);
  assert.match(help, /Choose Build preset/);
  assert.match(help, /Digging is the default/);
  assert.match(help, /Racing is the community starter build/);
  assert.match(help, /Circuit is a specialized community build for an Elm saddle/);
  assert.match(help, /Editing those goals changes the selector to Custom goals/);
  assert.match(help, /uses the current device time/);
  assert.match(help, /This works even when an estimate is already displayed/);
  assert.match(help, /Calculating a plan in this app does not queue anything in game/);
  assert.match(help, /Plan 1 is the first editable block; Plan 2 runs after Plan 1 finishes, not two days from now/);
  assert.match(help, /Do not add Basic Care days to cover the delay/);
  assert.match(help, /Press Calculate plan for day N below the inputs, just above the divider before Estimated plan/);
  assert.match(help, /Each calculation simulates the start of the current day/);
  assert.match(help, /Recalculating does not remember actions or medicine already given/);
  assert.match(help, /How often should I check in\?/);
  assert.match(help, /check this guide once per raising day/);
  assert.match(help, /one 24-hour period from egg hand-in/);
  assert.match(help, /Recalculate even if the descriptions stayed the same/);
  assert.match(help, /Leaving the app open/);
  assert.match(help, /the raising day updates automatically/);
  assert.match(help, /read the device clock immediately and replace the plan/);
  assert.match(help, /Within the same 24-hour period, the raising day stays the same/);
  assert.match(help, /do not enter the forecast&#x27;s numbers as measured stats/);
  assert.match(help, /start-of-day simulation, not a completion log/);
  assert.match(help, /on day 20 you can arrange care for day 22 onward; day 21 is already decided/);
  assert.match(help, /Check what is already scheduled in game and only change future activities if needed/);
  assert.match(help, /The app cannot see or change the trainer&#x27;s schedule, and it does not feed your bird/);
  assert.match(help, /missed feeding and hands-on actions are not performed for you/);
  assert.match(help, /Do not force-feed extra food to make up missed days/);
  assert.match(help, /How often can I feed it\?/);
  assert.match(help, /up to four items can be eaten per trade, not per day/);
  assert.match(help, /already at 224 or higher counts as force-feeding/);
  assert.match(help, /10% stomachache-onset chance at the next rollover/);
  assert.match(help, /a matching illness remedy is a separate optional tradeoff explained in today&#x27;s health guidance/);
  assert.match(help, /<th scope="row"><span class="raising-food raising-food-vomp-carrot">Vomp Carrot<\/span><\/th><td>\+64<\/td><td>4<\/td>/);
  assert.match(help, /<th scope="row"><span class="raising-food raising-food-zegham-carrot">Zegham Carrot<\/span><\/th><td>\+96<\/td><td>3<\/td>/);
  assert.match(html, /class="raising-food raising-food-azouph-greens">Azouph Greens<\/span>/);
  assert.match(html, /class="raising-food raising-food-tokopekko-wildgrass">Tokopekko<\/span> treats minor\/serious illness/);
  assert.match(html, /class="raising-food raising-food-parasite-worm">Parasite Worm<\/span>/);
  assert.match(html, /class="raising-food raising-food-chocotonic">Chocotonic<\/span>/);
  const displayedFoodClasses = new Map([...html.matchAll(/<span class="raising-food (raising-food-[\w-]+)">([^<]+)<\/span>/g)]
    .map(([, className, name]) => [name, className]));
  const foodClasses = RAISING.foods.map(food => displayedFoodClasses.get(food.name));
  assert.ok(foodClasses.every(Boolean), "every food has an individual display class");
  assert.equal(new Set(foodClasses).size, RAISING.foods.length, "each food has its own display class");
  const foodColorRules = new Map([...readFileSync("src/ChocoboRaisingTab.css", "utf8")
    .matchAll(/\.raising \.(raising-food-[\w-]+) \{ color: (#[\da-f]{6}); \}/gi)]
    .map(([, className, color]) => [className, color]));
  const foodColors = foodClasses.map(className => foodColorRules.get(className));
  assert.ok(foodColors.every(Boolean), "every food has a color rule");
  assert.equal(new Set(foodColors).size, RAISING.foods.length, "every food has its own color or shade");
  assert.match(help, /adolescent and adult birds reset to starving at rollover/);
  assert.match(help, /anchored to egg hand-in/);
  assert.match(help, /80 items actually eaten, not 80 days/);
  assert.match(help, /Food totals include both training and affection meals/);
  assert.match(help, /It does not automatically feed <span class="raising-food raising-food-azouph-greens">Azouph Greens<\/span>/);
  assert.match(help, /Random food bonuses are not credited as guaranteed gains/);
  assert.match(help, /lowest affection and highest fullness/);
  assert.match(help, /plans up to three manual Short Walks when needed to fit its selected meals/);
  assert.match(help, /It budgets 30 energy per walk, the higher-weather cost; chicks lose 2\.25 fullness per energy at the next daily update/);
  assert.match(help, /Walks do not directly change stats, and daily care refills energy; they do use energy needed for other manual actions, which are not modeled/);
  assert.match(help, /timeline shows the minimum walks needed for its meals/);
  assert.match(help, /Calculate becomes available when all required fields are valid/);
  assert.doesNotMatch(html, /These reports are from today|requires confirmation again/);
  const affectionHelp = html.match(/<details><summary>Affection: levels, feeding and care<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(affectionHelp, "affection has its own collapsed resource section");
  assert.match(affectionHelp, /highest band is 224-255/);
  assert.match(affectionHelp, /separate from the four-stat cap/);
  assert.match(affectionHelp, /not the 25% story-learning roll/);
  assert.match(affectionHelp, /training carrots can often maintain the top band/);
  assert.match(affectionHelp, /do not force-feed to chase extra affection/);
  assert.match(affectionHelp, /Do not use Watch Over as an affection grind/);
  assert.match(affectionHelp, /after hatching it costs energy/);
  assert.match(affectionHelp, /collect an item the bird brought back from a walk/);
  assert.match(affectionHelp, /Feeding and Watch Over behavior/);
  assert.doesNotMatch(html, /maintenanceFeedingGuidance|Maintenance only; not modeled/);
  assert.match(html, /daily routine you ask the stable trainer/);
  assert.match(html, /Take a Walk care plan is not the same as taking a hands-on walk/);
  assert.match(html, /four care-plan blocks of 1-7 days/);
  assert.match(html, /day N \+ 2/);
  assert.match(html, /Food penalties do not stop/);
  assert.match(html, /<label>Most important stat<select/);
  assert.match(html, /Egg hand-in date and time \(local\)/);
  assert.match(html, /type="datetime-local"/);
  assert.match(html, /Use current time/);
  assert.match(html, /Save start time/);
  assert.match(html, /<label>Saved egg times<select/);
  assert.match(html, /Choose a saved egg time/);
  assert.match(html, /Delete saved time/);
  assert.match(html, /Save names appear in the saved egg times menu/);
  assert.match(html, /No start time saved: planning a new egg at day 0/);
  assert.doesNotMatch(html, /Refresh day and recalculate/);
  assert.match(help, /saved timestamp survives app restarts/);
  assert.match(help, /no feeding, stories or treatment done yet/);
  assert.doesNotMatch(help, /Write down or screenshot|schedule begins tomorrow|previously noted/);
  assert.doesNotMatch(html, /aria-label="Today&#x27;s chocobo checklist"|What to do today/);
  assert.match(help, /Read today&#x27;s stable care report, then select each stat description/);
  assert.doesNotMatch(html, /The trainer has already completed the care described in that report/);
  assert.doesNotMatch(html, /do not perform or add that training again/);
  assert.match(html, /Follow the table&#x27;s Today row/);
  assert.match(help, /One timeline through day 128/);
  assert.match(help, /you cannot choose that roll in game/);
  assert.match(html, /It does not change your targets/);
  assert.doesNotMatch(html, /<label>Priority stat|<label>Age during final care-plan training|Assume care training happens|35 or 65 care days/);
  assert.match(html, /Read quantities as totals, not a daily diet/);
  assert.match(html, /already-learned or inherited ability/);
  for (const key of STAT_KEYS) {
    const label = key[0].toUpperCase() + key.slice(1);
    assert.match(html, new RegExp(`aria-label="Current ${label} description"`));
    assert.doesNotMatch(html, new RegExp(`aria-label="Current ${label}"`));
  }
  assert.match(html, /<summary>Advanced: exact current stats<\/summary>/);
  assert.match(html, /<input type="checkbox"\/>Use exact current stats/);
  assert.match(html, /Possible current range/);
  assert.match(html, /0-31 points/);
  assert.match(html, /Starting estimate: 0/);
  assert.match(html, /Impressive \(A\)/);
  assert.match(html, /First-class \(SS\)/);
  assert.match(html, /not a guaranteed worst-case forecast/);
  assert.match(help, /An unchanged description does not mean no points were gained/);
  assert.match(html, /aria-label="Target Strength"/);
  assert.match(html, /Desired abilities \(up to two\)/);
  assert.match(html, /Already learned \(occupies a slot\)/);
  assert.equal((html.match(/<button[^>]*>Calculate plan for day \d+<\/button>/g) ?? []).length, 1);
  assert.doesNotMatch(html, />Calculate plan<\/button>|>Bore \+ Burrow \/ END \+ RCP digging build<\/button>/);
  const formId = html.match(/<form id="([^"]+)"/)?.[1];
  assert.ok(formId);
  assert.ok(html.includes(`type="submit" form="${formId}"`), "calculate submits the inputs form");
  assert.match(html, new RegExp(`type="submit" form="${formId}">Calculate plan for day 0</button>`), "Calculate uses native form validation and allows a day-zero preview without a saved egg time");
  const desiredAbilities = html.match(/<fieldset><legend>Desired abilities \(up to two\)<\/legend>[\s\S]*?<\/fieldset>/)?.[0];
  assert.ok(desiredAbilities);
  assert.match(desiredAbilities, /<input type="checkbox" checked=""\/>Bore/);
  assert.match(desiredAbilities, /<input type="checkbox" checked=""\/>Burrow/);
  assert.equal((desiredAbilities.match(/checked=""/g) ?? []).length, 2);
  assert.match(html, /value="endurance" selected="">Endurance/);
  for (const [label, value] of [["Strength", 32], ["Endurance", 224], ["Discernment", 160], ["Receptivity", 224]]) {
    assert.match(html, new RegExp(`aria-label="Target ${label}"[^>]*value="${value}"`));
  }
  assert.match(help, /Digging is the default, with Bore \+ Burrow/);
  assert.match(html, /<label>Build preset<select/);
  assert.match(html, /value="digging" selected="">Digging - Bore \+ Burrow/);
  assert.match(html, /value="racing">Racing - Gallop \+ Canter/);
  const buildHelp = html.match(/<details><summary>Why these build stats and abilities\?<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(buildHelp, "build explanation is collapsed by default");
  assert.match(buildHelp, /Digging - Bore \+ Burrow stat choices/);
  assert.match(buildHelp, /\+112 digs/);
  assert.match(buildHelp, /20% chance to save greens/);
  assert.match(buildHelp, /35% increase, not a flat 35%/);
  assert.match(buildHelp, /broader pools do not guarantee higher profit/);
  assert.match(help, /Applying another preset keeps/);
  assert.match(help, /Vomp Carrots still lower Discernment and Receptivity/);
  assert.match(html, /5-minute reuse cooldown/);
  assert.match(html, /30-second wait after equipping/);
  const whistleHelp = html.match(/<details><summary>Chocobo Whistle: unlock, register and ride<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(whistleHelp);
  assert.match(whistleHelp, /Retirement is not required/);
  assert.match(whistleHelp, /adulthood \(day 29\)/);
  assert.match(whistleHelp, /continuing to raise and train it through day 128/);
  assert.match(whistleHelp, /How to re-register after training/);
  assert.match(whistleHelp, /250 gil each time/);
  assert.match(whistleHelp, /Keep using the same Chocobo Whistle/);
  assert.match(whistleHelp, /including any decreases/);
  assert.match(whistleHelp, /Trading the whistle to the trainer is for recharging/);
  assert.match(whistleHelp, /VCS Registration Card/);
  assert.match(whistleHelp, /card is returned, not consumed/);
  assert.match(whistleHelp, /does not refill charges/);
  assert.match(html, /Zero means no minimum/);
  assert.match(html, /Receptivity/);
  const activityHelp = html.match(/<details><summary>Hands-on activities and keeping the bird healthy<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(activityHelp);
  assert.match(activityHelp, /destination zone&#x27;s current weather when you start the action/);
  assert.match(activityHelp, /Watch Over, Tell a Story, Scold and Compete with Others use your current stable\/city zone&#x27;s weather/);
  assert.match(activityHelp, /including Clouds and Fog/);
  assert.match(activityHelp, /still requires at least 30 energy to start/);
  assert.match(activityHelp, /turn off <strong>Elemental ore<\/strong>/);
  assert.match(activityHelp, /not a live reading or a guarantee/);
  assert.match(activityHelp, /no elemental icon alone does not prove Clear/);
  for (const [stable, short, regular, long] of [
    ["Southern San d&#x27;Oria", "West Ronfaure", "La Theine Plateau", "Jugner Forest"],
    ["Bastok Mines", "North Gustaberg", "Konschtat Highlands", "Pashhow Marshlands"],
    ["Windurst Woods", "East Sarutabaruta", "Tahrongi Canyon", "Meriphataud Mountains"],
  ]) {
    assert.ok(activityHelp.includes(`<th scope="row">${stable}</th><td>${short}</td><td>${regular}</td><td>${long}</td>`));
  }
  const colorHelp = html.match(/<details><summary>Chocobo color: eggs, breeding and <span class="raising-food raising-food-parasite-worm">Parasite Worms<\/span><\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(colorHelp, "color guide starts collapsed");
  assert.match(colorHelp, /aria-label="Egg color chances"/);
  assert.match(colorHelp, /bred egg follows its inherited genes instead of this table/);
  assert.match(colorHelp, /5% mutation roll/);
  assert.match(colorHelp, /Even matching-color parents are not a guarantee/);
  assert.match(colorHelp, /randomly replaces one of the three color genes/);
  const wormOdds = colorHelp.match(/<table aria-label="Parasite Worm gene color chances">[\s\S]*?<\/table>/)?.[0];
  assert.ok(wormOdds);
  assert.match(wormOdds, /not final plumage odds/);
  for (const color of ["Yellow", "Black", "Blue", "Red", "Green"]) {
    assert.ok(wormOdds.includes(`<th scope="row">${color}</th><td>20%</td>`));
  }
  assert.equal((wormOdds.match(/<td>20%<\/td>/g) ?? []).length, 5);
  assert.match(colorHelp, /1-in-3 chance of being selected/);
  assert.match(colorHelp, /20% chance of staying the same and an 80% chance of changing to a different color/);
  assert.match(colorHelp, /not an 80% chance of changing plumage/);
  assert.match(colorHelp, /three yellow genes, one worm has a 0% chance/);
  assert.match(colorHelp, /Exact plumage odds require knowing the hidden genes/);
  assert.match(colorHelp, /From adolescence onward \(day 19\)/);
  assert.match(colorHelp, /the displayed color is fixed/);
  assert.match(colorHelp, /they do not dye the bird/);
  assert.match(colorHelp, /source-derived raising guide/);
  assert.match(colorHelp, /breeding\.lua/);
  const visible = html.replace(/<[^>]*>/g, "");
  assert.doesNotMatch(visible, /Phoenix/i, "source identity belongs in provenance URLs, not UI branding");
  for (const entry of RAISING.foods) assert.ok(html.includes(entry.name.replaceAll("'", "&#x27;")), entry.name);
});

test("restored planner state requires an explicit opt-in for exact current stats", () => {
  const { outputFiles } = buildSync({
    stdin: { contents: 'import React from "react"; import { renderToStaticMarkup } from "react-dom/server"; import Planner from "./src/ChocoboRaisingPlanner"; export const render = () => renderToStaticMarkup(<Planner />);', resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs",
    external: ["./utils/tabNav"], define: { "process.env.NODE_ENV": '"production"' },
    logOverride: { "empty-import-meta": "silent" },
  });
  let restored;
  const module = { exports: {} };
  const require = createRequire(import.meta.url);
  new Function("require", "module", "exports", outputFiles[0].text)(
    name => name === "./utils/tabNav" ? { peekRestoredTabState: () => restored, rememberTabState: () => {} } : require(name),
    module, module.exports,
  );
  const form = {
    current: { strength: "173", endurance: "173", discernment: "173", receptivity: "173" },
    target: { strength: "32", endurance: "224", discernment: "160", receptivity: "224" },
    desiredAbilities: ["Bore", "Burrow"], knownAbilities: [], priority: "endurance",
  };
  restored = {
    form, calculatedDay: 0, calculatedStart: null,
    calculation: { status: "error", message: "Old exact-stat calculation" },
  };
  const legacy = module.exports.render();
  assert.match(legacy, /<input type="checkbox"\/>Use exact current stats/);
  assert.match(legacy, /aria-label="Current Strength description"/);
  assert.match(legacy, /Starting estimate: 160/);
  assert.doesNotMatch(legacy, /role="alert"/, "640 estimated points are valid even though the legacy raw numbers total 692");
  assert.doesNotMatch(legacy, /Old exact-stat calculation/, "discard calculations based on the old implicit exact mode");
  for (const useExactStats of [false, true]) {
    restored = { form: { ...form, useExactStats }, defaultsVersion: 1, calculatedDay: null };
    const html = module.exports.render();
    if (useExactStats) {
      assert.match(html, /<input type="checkbox" checked=""\/>Use exact current stats/);
      assert.match(html, /aria-label="Current Strength"/);
      assert.match(html, /173 \(exact override\)/);
      assert.match(html, /role="alert"/, "explicit exact numbers still receive total-cap validation");
    } else {
      assert.match(html, /<input type="checkbox"\/>Use exact current stats/);
      assert.match(html, /aria-label="Current Strength description"/);
      assert.match(html, /Starting estimate: 160/);
      assert.doesNotMatch(html, /role="alert"/);
    }
  }
  restored = {
    form: {
      ...form, target: { strength: "255", endurance: "255", discernment: "0", receptivity: "0" },
      desiredAbilities: ["Bore", "Burrow"], knownAbilities: ["Bore"], priority: "strength", useExactStats: true,
    },
    calculatedDay: 0, calculatedStart: null,
    calculation: { status: "error", message: "Old physical-build calculation" },
  };
  const migrated = module.exports.render();
  for (const [label, value] of [["Strength", 32], ["Endurance", 224], ["Discernment", 160], ["Receptivity", 224]]) {
    assert.match(migrated, new RegExp(`aria-label="Target ${label}"[^>]*value="${value}"`));
  }
  assert.match(migrated, /value="endurance" selected="">Endurance/);
  assert.match(migrated, /<input type="checkbox"\/>Use exact current stats/);
  assert.match(migrated, /Starting estimate: 160/, "current stat reports are retained");
  const known = migrated.match(/<fieldset><legend>Already learned \(occupies a slot\)<\/legend>[\s\S]*?<\/fieldset>/)?.[0];
  assert.match(known, /<input type="checkbox" checked=""\/>Bore/, "learned abilities are retained");
  assert.doesNotMatch(migrated, /Old physical-build calculation/);
  restored = { ...restored, defaultsVersion: 1, calculatedDay: null };
  const customized = module.exports.render();
  assert.match(customized, /aria-label="Target Strength"[^>]*value="255"/, "later intentional goal edits still survive tab switches");
  assert.match(customized, /value="" disabled="" selected="">Custom goals/);
  const racing = RAISING_PRESETS[1];
  restored = {
    form: { ...form, target: Object.fromEntries(STAT_KEYS.map(key => [key, String(racing.target[key])])), desiredAbilities: racing.desiredAbilities, priority: racing.priority, useExactStats: false },
    defaultsVersion: 1, calculatedDay: null,
  };
  const racingHtml = module.exports.render();
  assert.match(racingHtml, /value="racing" selected="">Racing - Gallop \+ Canter/);
  const racingHelp = racingHtml.match(/<details><summary>Why these build stats and abilities\?<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(racingHelp);
  assert.match(racingHelp, /Racing - Gallop \+ Canter stat choices/);
  assert.doesNotMatch(racingHelp, /Digging - Bore \+ Burrow stat choices/);
  assert.match(racingHelp, /608, leaving 32 points flexible/);
  assert.match(racingHelp, /marks racing disabled/);
  assert.match(racingHelp, /community raising guide/);
  assert.match(racingHelp, /retail racing reference/);
  assert.match(racingHtml, /Confirm live availability before raising a racer/);
  const circuit = RAISING_PRESETS[2];
  restored = {
    form: { ...form, target: Object.fromEntries(STAT_KEYS.map(key => [key, String(circuit.target[key])])), desiredAbilities: circuit.desiredAbilities, priority: circuit.priority, useExactStats: false },
    defaultsVersion: 1, calculatedDay: null,
  };
  const circuitHtml = module.exports.render();
  assert.match(circuitHtml, /value="circuit" selected="">Circuit - Elm saddle \(community\)/);
  const circuitHelp = circuitHtml.match(/<details><summary>Why these build stats and abilities\?<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(circuitHelp, "Circuit explanation starts collapsed");
  assert.match(circuitHelp, /254\/34\/224\/128 uses all 640 points/);
  assert.match(circuitHelp, /community Circuit build discussion/);
  assert.match(circuitHelp, /community racing stat discussion/);
  assert.match(circuitHelp, /marks racing disabled/);
  assert.doesNotMatch(circuitHelp, /The SS\/B\/A\/C recommendation/);
  assert.match(circuitHtml, /Confirm live availability before raising a racer/);
  assert.match(circuitHtml, /Circuit assumes an Elm saddle and NPC-heavy competition/);
  assert.match(circuitHtml, /Trainer descriptions cannot confirm the exact 254\/34\/224\/128 allocation/);
  assert.match(circuitHtml, /<input type="checkbox"\/>Use exact current stats/);
  assert.match(circuitHtml, /<input type="checkbox"\/>Avoid a yellow bird/);
  assert.match(circuitHtml, /Starting egg warmth/);
  restored = {
    form: { ...form, avoidYellow: true, eggId: "2312", wormsFed: "0" },
    defaultsVersion: 1, calculatedDay: null,
  };
  const colorHtml = module.exports.render();
  assert.ok(colorHtml.indexOf('aria-label="Chocobo color goal"') < colorHtml.indexOf("<label>Build preset<select"),
    "color preference appears in its own section before the build preset");
  assert.match(colorHtml, /<input type="checkbox" checked=""\/>Avoid a yellow bird/);
  assert.match(colorHtml, /value="2312" selected="">Faintly warm/);
  assert.match(colorHtml, /<span class="raising-food raising-food-parasite-worm">Parasite Worms<\/span> already eaten before day 19/);
  assert.match(colorHtml, /never increase that count automatically/);
  assert.doesNotMatch(colorHtml, /role="alert"/);
  for (const patch of [{ eggId: "" }, { wormsFed: "" }, { wormsFed: "1" }]) {
    restored = { ...restored, form: { ...restored.form, eggId: "2312", wormsFed: "0", ...patch } };
    assert.match(module.exports.render(), /role="alert"/, "missing egg/history or feeding an egg cannot become a valid estimate");
  }
});

test("food reference starts closed and the food-only calculator is absent", () => {
  const { outputFiles } = buildSync({
    stdin: { contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import Raising from "./src/ChocoboRaisingTab";
      import { ScreenControlsProvider, CollapsibleSection } from "./src/ScreenControls";
      export const render = () => renderToStaticMarkup(<ScreenControlsProvider scope="raising"><Raising /></ScreenControlsProvider>);
      export const standard = () => renderToStaticMarkup(<ScreenControlsProvider scope="weather"><CollapsibleSection kind="search">Weather search</CollapsibleSection></ScreenControlsProvider>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
    logOverride: { "empty-import-meta": "silent" },
  });
  let collapsed = false;
  const module = { exports: {} };
  new Function("require", "module", "exports", "localStorage", outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports,
    { getItem: () => JSON.stringify({ "raising:search": collapsed, "weather:search": collapsed }) },
  );
  for (const storedCollapsed of [false, true]) {
    collapsed = storedCollapsed;
    const html = module.exports.render();
    const foodSection = html.match(/<details><summary>What happens when I feed it\?<\/summary>[\s\S]*?<\/details>/)?.[0];
    assert.ok(foodSection, "food disclosure is closed regardless of old screen-control preference");
    assert.match(foodSection, /Search food or effect/);
    assert.match(foodSection, /aria-label="Food effects table"/);
    assert.match(foodSection, /Feeding behavior/);
    assert.doesNotMatch(html, /Food-only|Feeding days|Items per day \(one trade\)/);
    assert.doesNotMatch(html, /data-screen-section="search"|aria-label="(?:Collapse|Expand) search"/);
    assert.match(html, /Plan my chocobo/);
  }
  assert.match(module.exports.standard(), /data-screen-section="search" hidden="" style="[^"]*display:none/);
});
