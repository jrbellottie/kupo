import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: 'export * from "./src/utils/guildDecay"; export * from "./src/utils/guilds"; export { nextEarthMsForVanaDailySchedule } from "./src/vanadiel";',
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

test("guild decay validates purchase amounts and schedules a one-time timer at the selected day", () => {
  assert.match(data.guildDecayInputError(elmLumber, { ...fromItemsBought, quantityBought: elmLumber.targetStock + 1 }), /from 0 to 90/);
  assert.match(data.guildDecayInputError(elmLumber, { ...fromCurrentPrice, currentPrice: -1 }), /whole number/);
  assert.throws(() => data.guildPriceAfterDays(elmLumber, fromItemsBought, -1), /Days must be/);

  const nowMs = Date.UTC(2026, 0, 1);
  const cal = { timeOffsetMs: 0, newMoonStartEarthMs: 0 };
  const offsetHours = 2;
  const firstBoundary = data.nextEarthMsForVanaDailySchedule({
    nowEarthMs: nowMs,
    cal,
    departureMinutes: [0],
    offsetHours,
  });
  const timer = data.createGuildDecayTimer(elmLumber, fromItemsBought, 3, nowMs, cal, offsetHours);
  assert.equal(timer.kind, "EARTH_TIME");
  assert.equal(timer.targetEarthMs, firstBoundary + 2 * 86_400 * 40);
  assert.equal(timer.repeatDaily, false);
  assert.equal(timer.accentColor, data.GUILD_COLORS.WOODWORKING);
  assert.match(timer.label, /2,183 gil after 3 Vana'diel days/);

  const unchangedPriceTimer = data.createGuildDecayTimer(elmLumber, fromItemsBought, 6, nowMs, cal, offsetHours);
  assert.equal(data.guildPriceAfterDays(elmLumber, fromItemsBought, 6), data.guildPriceAfterDays(elmLumber, fromItemsBought, 5));
  assert.equal(unchangedPriceTimer.targetEarthMs, firstBoundary + 5 * 86_400 * 40);
  assert.match(unchangedPriceTimer.label, /1,723 gil after 6 Vana'diel days/);

  const floorTimer = data.createGuildDecayTimer(elmLumber, fromItemsBought, 5, nowMs, cal, offsetHours);
  assert.equal(floorTimer.targetEarthMs, firstBoundary + 4 * 86_400 * 40);
  assert.match(floorTimer.label, /1,723 gil after 5 Vana'diel days/);
});
