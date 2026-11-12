import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: 'export * from "./src/utils/guildDecay"; export * from "./src/utils/guilds"; export { getVanaNow, nextEarthMsForVanaDailySchedule } from "./src/vanadiel";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const data = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const elmLumber = data.GUILD_DECAY_OFFERS.find(offer =>
  offer.guild === "Woodworking" && offer.n === "Piece of Elm Lumber" && offer.npc === "Chaupire");
const fromItemsBought = {
  guild: "Woodworking",
  item: "Piece of Elm Lumber",
  npc: "Chaupire",
  inputMode: "itemsBought",
  quantityBought: 60,
  currentPrice: 1723,
};
const fromCurrentPrice = {
  ...fromItemsBought,
  inputMode: "currentPrice",
  currentPrice: 5055,
};

test("guild price uses the source stock curve and per-item restock rate", () => {
  assert.ok(elmLumber);
  assert.equal(data.guildPriceAtStock(elmLumber, elmLumber.targetStock), 1723);
  assert.equal(elmLumber.buyMax, 11490);
  assert.equal(elmLumber.maxStock, 120);
  assert.equal(elmLumber.targetStock, 90);
  assert.equal(elmLumber.restockRate, 12);
  assert.equal(data.guildPriceAfterDays(elmLumber, fromItemsBought, 0), 1723);
  assert.deepEqual(data.guildDecayPreview(elmLumber, fromItemsBought).days, [
    { day: 1, stock: 42, price: 5055 },
    { day: 2, stock: 54, price: 3217 },
    { day: 3, stock: 66, price: 2183 },
    { day: 4, stock: 78, price: 1953 },
    { day: 5, stock: 90, price: 1723 },
  ]);
  assert.equal(data.guildPriceAfterDays(elmLumber, fromItemsBought, 20), 1723);
});

test("guild buy prices match the pinned source curve across stocked offers", () => {
  for (const offer of data.GUILD_DECAY_OFFERS) {
    const priceFloor = offer.priceFloor ?? offer.maxStock * 0.75;
    const knee = (2 / 3) * priceFloor;
    for (let stock = 0; stock <= offer.maxStock; stock += 1) {
      const expected = priceFloor <= 0
        ? offer.buyMax
        : stock <= knee
          ? Math.floor((offer.buyMax * (125 - Math.floor((150 * stock) / priceFloor))) / 125)
          : Math.floor((offer.buyMax * (200 - Math.floor((100 * (stock - knee)) / (offer.maxStock - knee)))) / 1000);
      assert.equal(data.guildPriceAtStock(offer, stock), expected, `${offer.npc}: ${offer.n} at stock ${stock}`);
    }
    assert.equal(data.guildPriceAtStock(offer, offer.targetStock), offer.price, `${offer.npc}: ${offer.n}`);
  }
});

test("a small purchase that is fully replenished does not invent a price change", () => {
  const oneItemBought = { ...fromItemsBought, quantityBought: 1 };
  assert.equal(data.guildPriceAfterDays(elmLumber, oneItemBought, 1), 1723);
  assert.deepEqual(data.guildDecayPreview(elmLumber, oneItemBought).days, [{ day: 1, stock: 90, price: 1723 }]);
  assert.equal(data.guildDecayPreview({ ...elmLumber, restockRate: 0 }, fromItemsBought).days.length, 0);
});

test("current price infers the closest source stock level and forecasts automatic restock", () => {
  const exactEstimate = data.inferGuildStockFromPrice(elmLumber, 5055);
  assert.deepEqual(exactEstimate, {
    enteredPrice: 5055,
    sourcePrice: 5055,
    estimatedStock: 42,
    minStock: 42,
    maxStock: 42,
    matchCount: 1,
    exact: true,
  });
  assert.deepEqual(data.guildDecayPreview(elmLumber, fromCurrentPrice).days, [
    { day: 1, stock: 54, price: 3217 },
    { day: 2, stock: 66, price: 2183 },
    { day: 3, stock: 78, price: 1953 },
    { day: 4, stock: 90, price: 1723 },
  ]);

  const nearestEstimate = data.inferGuildStockFromPrice(elmLumber, 5000);
  assert.equal(nearestEstimate.exact, false);
  assert.equal(nearestEstimate.sourcePrice, 4963);
  assert.equal(nearestEstimate.estimatedStock, 43);
});

test("buy plan gives the largest purchase that still reaches full stock by a local target time", () => {
  const cal = { timeOffsetMs: 0, newMoonStartEarthMs: 0 };
  const nowMs = 2 * 3_600 * 40;
  const targetEarthMs = 4 * 86_400 * 40 + 3_600 * 40;
  const currentPrice = { ...fromCurrentPrice, currentPrice: 1953 };
  const plan = data.guildDecayBuyPlanByEarthTime(elmLumber, currentPrice, nowMs, targetEarthMs, cal);

  assert.deepEqual(plan, {
    currentStockMin: 78,
    currentStockMax: 78,
    refreshCount: 4,
    stockAtTargetWithoutPurchase: 90,
    maxItemsToBuy: 36,
  });
  assert.equal(Math.min(elmLumber.targetStock, 78 - 30 + 4 * elmLumber.restockRate), elmLumber.targetStock);

  const tooSoonPlan = data.guildDecayBuyPlanByEarthTime(
    elmLumber,
    currentPrice,
    nowMs,
    nowMs + 5 * 60_000,
    cal,
  );
  assert.equal(tooSoonPlan.refreshCount, 0);
  assert.equal(tooSoonPlan.stockAtTargetWithoutPurchase, 78);
  assert.equal(tooSoonPlan.maxItemsToBuy, null);
  assert.throws(() => data.guildDecayBuyPlanByEarthTime(elmLumber, currentPrice, nowMs, nowMs, cal), /future local/);
});

test("guild decay validates purchase amounts and schedules a one-time timer at the selected day", () => {
  assert.match(data.guildDecayInputError(elmLumber, { ...fromItemsBought, quantityBought: elmLumber.targetStock + 1 }), /from 0 to 90/);
  assert.match(data.guildDecayInputError(elmLumber, { ...fromCurrentPrice, currentPrice: -1 }), /whole number/);
  assert.throws(() => data.guildPriceAfterDays(elmLumber, fromItemsBought, -1), /Days must be/);

  const nowMs = Date.UTC(2026, 0, 1);
  const cal = { timeOffsetMs: 0, newMoonStartEarthMs: 0 };
  const offsetVanaHours = 125 / 60;
  const vanaHourMs = 3_600 * 40;
  const vanaDayMs = 86_400 * 40;
  const firstBoundary = data.nextEarthMsForVanaDailySchedule({
    nowEarthMs: nowMs,
    cal,
    departureMinutes: [0],
    offsetHours: 0,
  });
  const timer = data.createGuildDecayTimer(elmLumber, fromItemsBought, 3, nowMs, cal, offsetVanaHours, false);
  const sameTargetTimer = data.createGuildDecayTimer(elmLumber, fromItemsBought, 3, nowMs, cal, offsetVanaHours, false);
  assert.equal(timer.kind, "EARTH_TIME");
  assert.notEqual(timer.id, sameTargetTimer.id);
  assert.equal(timer.targetEarthMs, firstBoundary + 2 * vanaDayMs + 6 * vanaHourMs - 5 * 60_000);
  assert.equal(data.getVanaNow(timer.targetEarthMs, cal).hour, 3);
  assert.equal(data.getVanaNow(timer.targetEarthMs, cal).minute, 55);
  assert.equal(timer.repeatDaily, false);
  assert.equal(timer.accentColor, data.GUILD_COLORS.WOODWORKING);
  assert.match(timer.label, /2,183 gil after 3 Vana'diel days/);
  assert.match(timer.label, /pre-opening reminder/);
  assert.match(timer.label, /fires \w+ 03:55 Vana'diel/);

  const timerPair = data.createGuildDecayTimers(elmLumber, fromItemsBought, 3, nowMs, cal, offsetVanaHours, false);
  assert.equal(timerPair.length, 2);
  assert.notEqual(timerPair[0].id, timerPair[1].id);
  assert.equal(timerPair[0].targetEarthMs, firstBoundary + 2 * vanaDayMs + 6 * vanaHourMs - 5 * 60_000);
  assert.equal(timerPair[1].targetEarthMs, firstBoundary + 2 * vanaDayMs + 6 * vanaHourMs);
  assert.match(timerPair[1].label, /shop opening alarm/);

  const openingOnlyTimer = data.createGuildDecayTimers(elmLumber, fromItemsBought, 3, nowMs, cal, 0, false);
  assert.equal(openingOnlyTimer.length, 1);
  assert.equal(openingOnlyTimer[0].targetEarthMs, timerPair[1].targetEarthMs);

  const twoVanaHourSchedule = data.guildDecayTimerSchedule(elmLumber, 3, nowMs, cal, 2, false);
  assert.equal(data.getVanaNow(twoVanaHourSchedule.targetEarthMs, cal).hour, 4);
  assert.equal(data.getVanaNow(twoVanaHourSchedule.targetEarthMs, cal).minute, 0);

  const unchangedPriceTimer = data.createGuildDecayTimer(elmLumber, fromItemsBought, 6, nowMs, cal, offsetVanaHours, false);
  assert.equal(data.guildPriceAfterDays(elmLumber, fromItemsBought, 6), data.guildPriceAfterDays(elmLumber, fromItemsBought, 5));
  assert.equal(unchangedPriceTimer.targetEarthMs, firstBoundary + 5 * vanaDayMs + 6 * vanaHourMs - 5 * 60_000);
  assert.match(unchangedPriceTimer.label, /1,723 gil after 6 Vana'diel days/);

  const floorTimer = data.createGuildDecayTimer(elmLumber, fromItemsBought, 5, nowMs, cal, offsetVanaHours, false);
  assert.equal(floorTimer.targetEarthMs, firstBoundary + 4 * vanaDayMs + 6 * vanaHourMs - 5 * 60_000);
  assert.match(floorTimer.label, /1,723 gil after 5 Vana'diel days/);
});

test("guild decay reminders use the selected shop opening and skip its weekly holiday", () => {
  const cal = { timeOffsetMs: 0, newMoonStartEarthMs: 0 };
  const nowMs = 0;
  const days = 8;
  const offsetVanaHours = 125 / 60;
  const dayMs = 86_400 * 40;
  const hourMs = 3_600 * 40;
  const schedule = data.guildDecayTimerSchedule(elmLumber, days, nowMs, cal, offsetVanaHours, true);

  assert.equal(schedule.closedWeekday, "Firesday");
  assert.equal(schedule.openingWeekday, "Earthsday");
  assert.equal(schedule.openingHour, 6);
  assert.equal(schedule.closingHour, 21);
  assert.equal(schedule.forecastDays, days + 1);
  assert.equal(schedule.targetEarthMs, 9 * dayMs + 6 * hourMs - 5 * 60_000);

  const noHolidaySchedule = data.guildDecayTimerSchedule(elmLumber, days, nowMs, cal, offsetVanaHours, false);
  assert.equal(noHolidaySchedule.closedWeekday, null);
  assert.equal(noHolidaySchedule.forecastDays, days);
  assert.equal(noHolidaySchedule.targetEarthMs, 8 * dayMs + 6 * hourMs - 5 * 60_000);

  const timer = data.createGuildDecayTimer(elmLumber, fromItemsBought, days, nowMs, cal, offsetVanaHours, true);
  assert.match(timer.label, /after 9 Vana'diel days; closed on Firesday, moved to Earthsday opening/);
  const timerPair = data.createGuildDecayTimers(elmLumber, fromItemsBought, days, nowMs, cal, offsetVanaHours, true);
  assert.equal(timerPair[0].targetEarthMs, schedule.targetEarthMs);
  assert.equal(timerPair[1].targetEarthMs, schedule.targetEarthMs + 5 * 60_000);
  assert.match(timerPair[1].label, /shop opening alarm/);
});
