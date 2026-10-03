import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: ["src/utils/digging.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { DIGGING, DIG_RANKS, DIG_ZONES, DIG_DAY_ITEMS, nextDigReset, diggingDistribution, diggingEstimate, elementalOreActive, ORE_ZONES } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const conditions = { rank: 8, hour: 12, moonPercent: 50, waxing: true, day: "Firesday", weather: 0 };
const pool = (changes = {}, zone = "Tahrongi Canyon") => diggingDistribution(zone, { ...conditions, ...changes });

test("digging source pins the Phoenix overrides independently, not the LSB base tables", () => {
  assert.equal(DIGGING.source.revision, "0f016c5c7b1639d16233fddb93db48e9a51222de");
  for (const file of ["pxi_digging_data.lua", "pxi_digging_logic.lua", "chocobo_account_fatigue.lua"]) {
    assert.match(DIGGING.source.inputs[`modules/phoenix/lua/globals/hobbies/chocobo_digging/${file}`], /^[a-f0-9]{64}$/);
  }
  assert.equal(DIG_ZONES.length, 26);
  assert.equal(DIGGING.entries.length, 243);
  assert.equal(ORE_ZONES.length, 22);
  assert.equal(DIG_RANKS.length, 11);
  assert.deepEqual(DIGGING.accuracy, [30, 34, 38, 42, 46, 50, 51, 52, 53, 54, 55]);
  assert.equal(DIGGING.xpToLevel.length, 100);
  assert.equal(DIGGING.xpToLevel[0], 155);
  assert.equal(DIGGING.xpToLevel[99], 52200);
  const catalog = JSON.parse(readFileSync("src/data/itemInfo.json", "utf8"));
  for (const entry of DIGGING.entries) {
    assert.equal(catalog.items[entry.itemId].name, entry.item);
    assert.equal(entry.weights.length, 11);
    assert.ok(entry.weights.every(weight => Number.isInteger(weight) && weight >= 0));
    assert.ok(entry.itemRank >= 0 && entry.itemRank <= 10);
  }
});

test("digging reset is the next midnight JST, independent of local timezone", () => {
  assert.equal(nextDigReset(Date.parse("2026-09-05T14:59:59Z")), Date.parse("2026-09-05T15:00:00Z"));
  assert.equal(nextDigReset(Date.parse("2026-09-05T15:00:00Z")), Date.parse("2026-09-06T15:00:00Z"));
});

test("gold ore is a normal reward at every rank in exactly the two Phoenix zones", () => {
  const gold = DIGGING.entries.filter(entry => entry.itemId === 737);
  assert.deepEqual(gold.map(entry => entry.zone), ["Tahrongi Canyon", "Western Altepa Desert"]);
  for (const entry of gold) {
    assert.deepEqual(entry.weights, [20, 30, 40, 80, 110, 140, 170, 195, 195, 195, 195]);
    assert.equal(entry.itemRank, 7, "Artisan is the XP tier, not a minimum rank");
    assert.equal(entry.nightOnly, false);
    for (let rank = 0; rank <= 10; rank++) assert.ok(pool({ rank }, entry.zone).rewards.some(reward => reward.itemId === 737));
  }
  const amateur = pool({ rank: 0 }).rewards.find(entry => entry.itemId === 737);
  close(amateur.share, 20 / 4360);
  close(amateur.perAttempt, 0.30 * 20 / 4360);
  assert.equal(amateur.experience, 70);
  const adept = pool().rewards.find(entry => entry.itemId === 737);
  close(adept.share, 195 / 5120);
  close(adept.perAttempt, 0.53 * 195 / 5120);
});

test("each rank and zone uses a single weighted pool after the independent accuracy roll", () => {
  for (const zone of DIG_ZONES) for (let rank = 0; rank <= 10; rank++) for (const hour of [0, 4, 12, 20]) {
    const result = pool({ rank, hour }, zone);
    close(result.successChance, DIGGING.accuracy[rank] / 100);
    close(result.rewards.reduce((sum, entry) => sum + entry.share, 0), 1);
    close(result.rewards.reduce((sum, entry) => sum + entry.perAttempt, 0), result.successChance);
    assert.equal(new Set(result.rewards.map(entry => entry.itemId)).size, result.rewards.length);
    assert.ok(result.rewards.every(entry => entry.weight > 0 && entry.perAttempt > 0));
    close(result.expectedExperience, result.rewards.reduce((sum, entry) => sum + entry.perAttempt * entry.experience, 0));
    if (rank === 10) assert.equal(result.expectedExperience, 0);
  }
});

test("moon and weekday do not alter ordinary success or add day-colored rocks", () => {
  const expected = pool();
  for (const moonPercent of [0, 6, 7, 21, 22, 50, 75, 100]) for (const waxing of [false, true]) {
    assert.deepEqual(pool({ moonPercent, waxing }), expected);
  }
  assert.deepEqual(pool({ day: "Darksday" }), expected);
  assert.ok(pool({ rank: 0, day: "Watersday" }).rewards.some(entry => entry.item === "Red Rock"));
  assert.ok(!pool({ rank: 0, day: "Watersday" }).rewards.some(entry => entry.item === "Blue Rock"));
});

test("seeds and tree cuttings only compete at night: 20:00 inclusive to 04:00 exclusive", () => {
  const nightRows = DIGGING.entries.filter(entry => entry.nightOnly);
  assert.equal(new Set(nightRows.map(entry => entry.item)).size, 5);
  for (const row of nightRows) {
    for (const hour of [0, 3.999, 20, 23.999]) assert.ok(pool({ hour }, row.zone).rewards.some(entry => entry.itemId === row.itemId));
    for (const hour of [4, 12, 19.999]) assert.ok(!pool({ hour }, row.zone).rewards.some(entry => entry.itemId === row.itemId));
  }
  const zone = nightRows[0].zone;
  const day = pool({ hour: 4 }, zone);
  const night = pool({ hour: 20 }, zone);
  close(day.successChance, night.successChance);
  assert.ok(day.rewards[0].share > night.rewards.find(entry => entry.itemId === day.rewards[0].itemId).share);
});

test("single and double weather add only the matching weighted crystal or cluster", () => {
  for (const weather of DIGGING.weather.filter(entry => entry.item)) for (const rank of [0, 3, 5, 10]) {
    const result = pool({ weather: weather.id, rank });
    const reward = result.rewards.find(entry => entry.itemId === weather.itemId);
    assert.ok(reward);
    assert.equal(reward.weight, weather.weights[rank]);
    const baseline = pool({ rank });
    assert.equal(result.rewards.length, baseline.rewards.length + 1);
    const baselineWeight = baseline.rewards.reduce((sum, entry) => sum + entry.weight, 0);
    close(reward.share, weather.weights[rank] / (baselineWeight + weather.weights[rank]));
    close(result.successChance, baseline.successChance);
  }
  assert.deepEqual(pool({ weather: 3 }), pool(), "Fog adds no crystal or cluster");
});

test("elemental ore needs Journeyman, eligible zone, active weather, and waxing 6-21 percent", () => {
  const changes = { rank: 5, moonPercent: 6, waxing: true, weather: 12 };
  const hasOre = (change = {}, zone = ORE_ZONES[0]) => pool({ ...changes, ...change }, zone).rewards.some(entry => entry.itemId === 1255);
  for (const zone of ORE_ZONES) {
    assert.equal(hasOre({}, zone), true);
    assert.equal(hasOre({ moonPercent: 21 }, zone), true);
    assert.equal(hasOre({ weather: 3 }, zone), true, "Fog qualifies");
  }
  for (const change of [{ rank: 4 }, { moonPercent: 5 }, { moonPercent: 22 }, { waxing: false }, { weather: 0 }]) assert.equal(hasOre(change), false);
  for (const zone of DIG_ZONES.filter(zone => !ORE_ZONES.includes(zone))) assert.equal(hasOre({}, zone), false);
  assert.equal(elementalOreActive("Valkurm Dunes", { ...conditions, ...changes }), true);
  for (const [day, ore] of Object.entries(DIG_DAY_ITEMS)) {
    const result = pool({ ...changes, day });
    assert.ok(result.rewards.some(entry => entry.itemId === ore.itemId));
    assert.ok(result.rewards.some(entry => entry.item === "Ice Crystal"), "Ore element follows day, not weather");
    close(result.rewards.reduce((sum, entry) => sum + entry.share, 0), 1);
  }
  for (let rank = 5; rank <= 10; rank++) {
    assert.equal(pool({ ...changes, rank }).rewards.find(entry => entry.itemId === 1255).weight, [15, 30, 45, 55, 65, 80][rank - 5]);
  }
});

test("moon conditions change eligible ore and profit, not greens needed for the daily cap", () => {
  const waxing = pool({ moonPercent: 10, waxing: true, weather: 3 });
  const waning = pool({ moonPercent: 10, waxing: false, weather: 3 });
  const price = item => item === "Chunk of Fire Ore" ? 10000 : 100;
  const active = diggingEstimate(waxing, 61, price);
  const inactive = diggingEstimate(waning, 61, price);
  assert.ok(waxing.rewards.some(entry => entry.itemId === 1255));
  assert.ok(!waning.rewards.some(entry => entry.itemId === 1255));
  assert.equal(active.greens, inactive.greens);
  assert.equal(active.attempts, inactive.attempts);
  assert.equal(waxing.successChance, waning.successChance);
  assert.ok(active.net > inactive.net);
});

test("daily estimates always reach 100 successes and include greens spent on failures", () => {
  const distribution = pool({ rank: 5 });
  const successes = diggingEstimate(distribution, 61, () => 100);
  assert.equal(successes.attempts, 200);
  assert.equal(successes.greens, 200);
  assert.equal(successes.net, -2200);
  const adept = diggingEstimate(pool(), 61, () => 100);
  assert.equal(adept.greens, 189);
  close(adept.net, 10000 - 100 / 0.53 * 61);
  const goldOnlyValue = diggingEstimate(pool(), 0, item => item === "Chunk of Gold Ore" ? 1000 : 0);
  close(goldOnlyValue.net, 100 * 195 / 5120 * 1000);
  for (let rank = 0; rank <= 10; rank++) {
    const result = pool({ rank });
    const estimate = diggingEstimate(result, 61, () => 100);
    close(estimate.attempts * result.successChance, 100);
    assert.equal(estimate.greens, Math.ceil(100 / result.successChance));
    close(estimate.net, 10000 - estimate.attempts * 61);
  }
});

test("daily zone XP is weighted over 100 items, not 100 attempts, and ignores item prices", () => {
  const result = pool();
  const estimate = diggingEstimate(result, 61, () => 100);
  close(estimate.experience, 100 * 185525 / 5120);
  close(estimate.experience, 3623.53515625);
  close(diggingEstimate(result, 1000, () => 0).experience, estimate.experience);
  assert.ok(estimate.experience > result.expectedExperience * 100, "Failed digs do not consume the 100-item cap");
});

test("daily zone XP includes every eligible night and weather reward at each rank", () => {
  for (const zone of DIG_ZONES) for (let rank = 0; rank <= 10; rank++) {
    for (const change of [{ hour: 12 }, { hour: 20 }, { hour: 20, weather: 12, moonPercent: 10 }]) {
      const result = pool({ rank, ...change }, zone);
      const estimate = diggingEstimate(result, 61, () => 100);
      const totalWeight = result.rewards.reduce((sum, entry) => sum + entry.weight, 0);
      const weightedXp = result.rewards.reduce((sum, entry) => sum + entry.weight * entry.experience, 0);
      close(estimate.experience, 100 * weightedXp / totalWeight);
      if (rank === 10) assert.equal(estimate.experience, 0);
    }
  }
});

test("invalid digging settings are reported explicitly", () => {
  for (const changes of [{ rank: -1 }, { rank: 11 }, { rank: 1.5 }, { hour: 24 }, { moonPercent: NaN }, { moonPercent: 101 }, { weather: 99 }, { day: "Invalid" }]) {
    assert.throws(() => pool(changes), /Invalid digging/);
  }
  assert.throws(() => pool({}, "Unknown zone"), /Invalid digging/);
  assert.throws(() => diggingEstimate(pool(), -1, () => 100), /Invalid Gysahl Greens cost/);
});
