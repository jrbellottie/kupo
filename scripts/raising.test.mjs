import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: ["src/utils/chocoboRaising.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { RAISING, STAT_KEYS, STAT_BANDS, PROJECTION_FOODS, foodStatText, foodEffects, projectFoodOnly, validateFoodProjection, ridingEstimate, statRank, carePlanRange, applyRaisingStatChanges } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const plannerBundle = buildSync({ entryPoints: ["src/utils/chocoboRaisingPlanner.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { RAISING_ABILITIES, RAISING_PRESETS, STORY_ATTEMPTS_95, LAST_RAISING_DAY, RAISING_START_KEY, validateRaisingGoal, planRaisingGoal, applyTrainingAction, trainingActionName, storyLearningProbability, careAvailableDay, trainingFoodLimit, groupTrainingDays, raisingDayAt, parseRaisingStart, localRaisingStart } = await import(`data:text/javascript;base64,${Buffer.from(plannerBundle.outputFiles[0].text).toString("base64")}`);
const dailyBundle = buildSync({ entryPoints: ["src/utils/raisingDaily.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { RAISING_DAILY_KEY, parseSavedRaisingDaily, dailyProgress, todayCare, feedingInputKey } = await import(`data:text/javascript;base64,${Buffer.from(dailyBundle.outputFiles[0].text).toString("base64")}`);
const feedingBundle = buildSync({ entryPoints: ["src/utils/chocoboFeeding.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { AFFECTION_TARGET, AFFECTION_REPORTS, HUNGER_REPORTS, FEEDING_FOODS, feedingOptions, feedingFood, feedingSummary, careSuccessChance } = await import(`data:text/javascript;base64,${Buffer.from(feedingBundle.outputFiles[0].text).toString("base64")}`);
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
    { ...saved, daily: { ...schedule, days: [{ ...schedule.days[0], foodId: -100 }] } },
    { ...saved, daily: { ...schedule, startedAt: "yesterday" } },
  ]) assert.throws(() => parseSavedRaisingDaily(JSON.stringify(invalid)), /invalid/);
  assert.throws(() => parseSavedRaisingDaily("{"));
});

test("feeding menus respect stage, report uncertainty, source effects and the force-feeding boundary", () => {
  assert.equal(RAISING.feeding.initialAffection, 255);
  assert.equal(RAISING.feeding.chickHungerPerEnergy, 2.25);
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

test("reported meals choose stat food at high affection and safely recover low affection", () => {
  const run = (patch = {}) => planRaisingGoal(goal({
    currentDay: 128, target: stats(0, 0, 6, 6), desiredAbilities: [],
    today: { feedingDone: false, storyDone: false },
    feedingReport: { affection: 224, fullness: 0, condition: "healthy", day: 128 }, ...patch,
  }));
  const trained = run();
  assert.equal(trained.complete, true);
  assert.deepEqual(trained.days[0].feeding.items, [5608, 5608, 5608]);
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
  assert.deepEqual(run({ today: { feedingDone: true, storyDone: false } }).days[0].feeding.items, []);
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
      energySpent = step.day === 0 || step.story ? 0 : care.energy;
      assert.equal(step.feeding.affectionAfter, affection);
      assert.equal(step.feeding.fullnessAfter, fullness);
      assert.ok(affection >= 224, `${preset.id}, day ${step.day}`);
      assert.deepEqual(step.after, current);
    }
    assert.equal(plan.foodItems, plan.days.reduce((sum, step) => sum + step.feeding.items.length, 0));
    assert.ok(plan.days.some(step => step.day < 19 && step.feeding.items.length), "hunger-aware chick meals are included");
    const saved = {
      form: { ...input, current: Object.fromEntries(STAT_KEYS.map(key => [key, "0"])), target: Object.fromEntries(STAT_KEYS.map(key => [key, String(input.target[key])])) },
      daily: { startedAt: null, plannedDay: 0, feedingReport: input.feedingReport,
        days: plan.days.map(({ day, foodId, foodCount, story, careId, feeding }) => ({ day, foodId, foodCount, story, careId, feeding })) },
    };
    saved.daily.feedingInputs = feedingInputKey(saved.form, input.feedingReport);
    assert.notEqual(feedingInputKey({ ...saved.form, current: { ...saved.form.current, strength: "32" } }, input.feedingReport),
      saved.daily.feedingInputs, "changed stats invalidate saved meals, not just changed hunger");
    assert.notEqual(feedingInputKey(saved.form, { ...input.feedingReport, fullness: 223 }), saved.daily.feedingInputs);
    assert.deepEqual(parseSavedRaisingDaily(JSON.stringify(saved)), saved);
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
    if (calculation?.status === "success") assert.ok(findElement(tree, element => element.props.className === "raising-plan-result"));
  }
  states = [view, { startedAt: start, error: null }, localRaisingStart(start), null, start + 4 * day];
  stateIndex = 0;
  const hatched = module.exports.Planner();
  const completionLabel = text => findElement(hatched, element => element.type === "label"
    && React.Children.toArray(element.props.children).includes(text));
  assert.equal(completionLabel("Care schedule checked / arranged"), undefined);
  assert.equal(findElement(hatched, element => element.type === "h4" && element.props.children === "Care to arrange today"), undefined,
    "no care section is shown without saved instructions");
  assert.ok(completionLabel("Feeding finished for today"));
  assert.ok(completionLabel("Story activities finished for today"));
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
  const careHeading = tree => findElement(tree, element => element.type === "h4" && element.props.children === "Care to arrange today");
  const careCheckbox = tree => findElement(findElement(tree, element => element.type === "label"
    && React.Children.toArray(element.props.children).includes("Care schedule checked / arranged")), element => element.type === "input");
  tree = render();
  assert.ok(careHeading(tree));
  assert.equal(careCheckbox(tree).props.disabled, false);
  assert.equal(careCheckbox(tree).props.checked, false);
  careCheckbox(tree).props.onChange({ target: { checked: true } });
  const careKey = todayCare(schedule, 4).key;
  assert.equal(states[0].progress.careKey, careKey);
  assert.equal(states[0].calculation, view.calculation, "checking care does not discard the calculated plan");
  assert.equal(careCheckbox(render()).props.checked, true);
  states[0] = { ...parseSavedRaisingDaily(JSON.stringify(states[0])), calculatedDay: null };
  assert.equal(careCheckbox(render()).props.checked, true, "saved care completion survives restoration");
  careCheckbox(render()).props.onChange({ target: { checked: false } });
  assert.equal(states[0].progress.careKey, null);
  assert.equal(careCheckbox(render()).props.checked, false);
  careCheckbox(render()).props.onChange({ target: { checked: true } });
  states[0] = { ...states[0], daily: { ...schedule, days: schedule.days.map(step =>
    step.day === 6 ? { ...step, careId: step.careId === 0 ? 3 : 0 } : step) } };
  assert.equal(careCheckbox(render()).props.checked, false, "a changed care block needs checking again");
  states[0] = { ...states[0], daily: schedule };
  states[4] = start + 5 * day;
  assert.equal(careCheckbox(render()).props.checked, false, "care completion resets on a new raising day");
  const previousProgress = states[0].progress;
  clickTime = start + 6 * day;
  careCheckbox(render()).props.onChange({ target: { checked: true } });
  assert.equal(states[0].progress, previousProgress, "a click after rollover cannot mark yesterday's care complete");
  assert.match(states[5], /raising day changed/);
  for (const age of [3, 127, 128, 129]) {
    states[4] = start + age * day;
    tree = render();
    assert.equal(careHeading(tree), undefined, `no care section at day ${age} when nothing can be arranged`);
    assert.equal(careCheckbox(tree), undefined);
  }

  const storySteps = tree => findElement(tree, element => element.type === "ol" && element.props["aria-label"]?.endsWith(" story steps"));
  const textContent = element => React.isValidElement(element)
    ? React.Children.toArray(element.props.children).map(textContent).join("")
    : String(element ?? "");
  const storyView = {
    ...view,
    form: { ...form, knownAbilities: [], feedingReport: { affection: 224, fullness: 31, condition: "healthy", day: 30 } },
    daily: { ...schedule, days: schedule.days.map(step => step.day === 30 ? { ...step, story: "Bore" } : step) },
  };
  states = [storyView, { startedAt: start, error: null }, localRaisingStart(start), null, start + 30 * day];
  clickTime = states[4];
  for (const ability of RAISING_ABILITIES) {
    states[0] = { ...storyView, daily: { ...schedule, days: schedule.days.map(step =>
      step.day === 30 ? { ...step, story: ability.name } : step) } };
    tree = render();
    const steps = storySteps(tree);
    assert.ok(steps, `${ability.name} gets today's step-by-step instructions`);
    assert.equal(React.Children.toArray(steps.props.children).length, 4);
    const text = textContent(steps);
    assert.ok(text.includes(ability.obtain), "acquisition instructions use the shared ability reference");
    assert.ok(text.includes(`Tell a Story, then ${ability.story}`));
    assert.ok(text.includes(`Discernment at ${ability.discernment} or higher`));
    assert.match(text, /14 energy even in clear weather/);
    assert.match(text, /Long walks unlock on day 29/);
    assert.match(text, /If it fails, keep the story for another day/);
    assert.match(text, /Story activities finished for today/);
    assert.match(textContent(tree), /separate hands-on action, not the Take a Walk or Act in a Play care plan/);
  }
  for (const condition of ["tired", "unwell", "sleeping", "away", "unknown"]) {
    states[0] = { ...storyView, form: { ...storyView.form, feedingReport: { ...storyView.form.feedingReport, condition } } };
    assert.equal(storySteps(render()), undefined, `no attempt instructions for ${condition} birds`);
  }
  states[0] = { ...storyView, form: { ...storyView.form, knownAbilities: ["Bore"] } };
  assert.equal(storySteps(render()), undefined, "already-learned abilities are not attempted again");
  states[0] = { ...storyView, daily: { ...schedule, days: schedule.days.map(step => ({ ...step, story: null })) } };
  assert.equal(storySteps(render()), undefined, "steps appear only when a story attempt is scheduled");
  states[0] = storyView;
  tree = render();
  const storyCompletion = findElement(findElement(tree, element => element.type === "label"
    && React.Children.toArray(element.props.children).includes("Story activities finished for today")), element => element.type === "input");
  storyCompletion.props.onChange({ target: { checked: true } });
  assert.equal(storySteps(render()), undefined, "completed story attempts no longer show action steps");
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
  assert.match(statHelp, /SS-grade RCP \(224-255\) corresponds to a 35% increase, not a flat 35% chance/);
  assert.match(statHelp, /do not list a direct Strength bonus to finds/);
  assert.match(statHelp, /source-derived digging guide/);
  assert.match(statHelp, /documentation and that snapshot differ/);
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
  assert.match(help, /Press Calculate plan for day N below the inputs, just above the divider before Estimated plan/);
  assert.match(help, /The button shows the current raising day/);
  assert.match(help, /Changing an input cancels the old calculation/);
  assert.match(help, /How often should I check in\?/);
  assert.match(help, /check this guide once per raising day/);
  assert.match(help, /one 24-hour period from egg hand-in/);
  assert.match(help, /Recalculate even if the descriptions stayed the same/);
  assert.match(help, /Leaving the app open/);
  assert.match(help, /the raising day updates automatically/);
  assert.match(help, /read the device clock immediately and replace the plan/);
  assert.match(help, /Within the same 24-hour period, the raising day stays the same/);
  assert.match(help, /do not enter the forecast&#x27;s numbers as measured stats/);
  assert.match(help, /there is nothing to write down/);
  assert.match(help, /on day 20 you can arrange care for day 22 onward; day 21 is already decided/);
  assert.match(help, /Check what is already scheduled in game and only change future activities if needed/);
  assert.match(help, /The app cannot see or change the trainer&#x27;s schedule, and it does not feed your bird/);
  assert.match(help, /missed feeding and hands-on actions are not performed for you/);
  assert.match(help, /Do not force-feed extra food to make up missed days/);
  assert.match(help, /How often can I feed it\?/);
  assert.match(help, /up to four items can be eaten per trade, not per day/);
  assert.match(help, /already at 224 or higher counts as force-feeding/);
  assert.match(help, /10% stomachache-onset chance at the next rollover/);
  assert.match(help, /<th scope="row">Vomp Carrot<\/th><td>\+64<\/td><td>4<\/td>/);
  assert.match(help, /<th scope="row">Zegham Carrot<\/th><td>\+96<\/td><td>3<\/td>/);
  assert.match(help, /adolescent and adult birds reset to starving at rollover/);
  assert.match(help, /anchored to egg hand-in/);
  assert.match(help, /80 items actually eaten, not 80 days/);
  assert.match(help, /Food totals include both training and affection meals/);
  assert.match(help, /It does not automatically feed Azouph Greens/);
  assert.match(help, /Random food bonuses are not credited as guaranteed gains/);
  assert.match(help, /lowest affection and highest fullness/);
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
  assert.match(html, /No start time saved: planning a new egg at day 0/);
  assert.doesNotMatch(html, /Refresh day and recalculate/);
  assert.match(help, /saved timestamp survives app restarts/);
  assert.match(help, /The planner includes today&#x27;s unfinished feeding and story actions/);
  assert.doesNotMatch(help, /Write down or screenshot|schedule begins tomorrow|previously noted/);
  assert.match(html, /aria-label="Today&#x27;s chocobo checklist"/);
  assert.match(html, /What to do today - raising day 0/);
  assert.match(html, /Enter the stat descriptions the trainer gives you now/);
  assert.doesNotMatch(html, /The trainer has already completed the care described in that report/);
  assert.doesNotMatch(html, /do not perform or add that training again/);
  assert.match(html, /No saved instructions for today yet/);
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
  assert.match(html, /Current reports, exact-stat mode, already-learned abilities and egg time stay unchanged/);
  assert.match(help, /Vomp Carrots still lower Discernment and Receptivity/);
  assert.match(html, /5-minute reuse cooldown/);
  assert.match(html, /30-second wait after equipping/);
  const whistleHelp = html.match(/<details><summary>Chocobo Whistle: unlock, register and ride<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(whistleHelp);
  assert.match(whistleHelp, /Retirement is not required/);
  assert.match(whistleHelp, /adulthood \(day 29 in the pinned settings\)/);
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
  const colorHelp = html.match(/<details><summary>Chocobo color: eggs, breeding and Parasite Worms<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(colorHelp, "color guide starts collapsed");
  assert.match(colorHelp, /aria-label="Egg color chances"/);
  assert.match(colorHelp, /bred egg follows its inherited genes instead of this table/);
  assert.match(colorHelp, /5% mutation roll/);
  assert.match(colorHelp, /Even matching-color parents are not a guarantee/);
  assert.match(colorHelp, /randomly replaces one of the three color genes/);
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
