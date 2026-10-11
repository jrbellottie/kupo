import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const snapshot = JSON.parse(readFileSync("src/data/phoenix.json", "utf8"));
const bundle = buildSync({
  stdin: { contents: 'export * from "./src/utils/guildSelling"; export { GUILD_COLORS, GUILD_PRESETS } from "./src/utils/guilds"; export { WEEKDAYS } from "./src/utils/weekday";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "esm",
});
const data = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("guild presets have distinct, readable colors on dark cards and buttons", () => {
  const presetIds = [...new Set(data.GUILD_PRESETS.map(guild => guild.id)), "TENSHODO"];
  const craftColors = [...new Set(data.GUILD_PRESETS.map(guild => guild.id.replace(/_WHITEGATE$/, "")))];
  assert.deepEqual(Object.keys(data.GUILD_COLORS).sort(), presetIds.sort());
  assert.equal(new Set([...craftColors.map(id => data.GUILD_COLORS[id]), data.GUILD_COLORS.TENSHODO]).size, craftColors.length + 1);
  const luminance = hex => {
    const channels = hex.slice(1).match(/.{2}/g).map(channel => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const id of presetIds) {
    const color = data.GUILD_COLORS[id];
    assert.match(color, /^#[0-9a-f]{6}$/i, id);
    const contrast = (luminance(color) + 0.05) / (luminance("#2b2b2b") + 0.05);
    assert.ok(contrast >= 4.5, `${id}: ${contrast.toFixed(2)}:1 must meet normal-text contrast`);
  }
});

test("Whitegate guild presets use distinct source shop schedules without changing other guild timers", () => {
  const alchemy = data.GUILD_PRESETS.find(guild => guild.id === "ALCHEMY_WHITEGATE");
  const fishing = data.GUILD_PRESETS.find(guild => guild.id === "FISHING_WHITEGATE");
  const sourceAlchemy = data.SELLING_GUILDS.find(shop => shop.pool === "Wahraga");
  const sourceFishing = data.SELLING_GUILDS.find(shop => shop.pool === "Wahnid");
  assert.ok(alchemy && fishing && sourceAlchemy && sourceFishing);
  assert.deepEqual([alchemy.schedule.openHour, alchemy.closeHour, alchemy.schedule.closedOn],
    [sourceAlchemy.hours[0], sourceAlchemy.hours[1], data.WEEKDAYS[sourceAlchemy.holiday]]);
  assert.deepEqual([fishing.schedule.openHour, fishing.closeHour, fishing.schedule.closedOn],
    [sourceFishing.hours[0], sourceFishing.hours[1], data.WEEKDAYS[sourceFishing.holiday]]);
  assert.notEqual(alchemy.schedule.closedOn, data.GUILD_PRESETS.find(guild => guild.id === "ALCHEMY").schedule.closedOn);
  assert.notEqual(fishing.schedule.openHour, data.GUILD_PRESETS.find(guild => guild.id === "FISHING").schedule.openHour);
  assert.notEqual(fishing.schedule.closedOn, data.GUILD_PRESETS.find(guild => guild.id === "FISHING").schedule.closedOn);
});

test("all nine guilds have unique, located stock pools with source provenance", () => {
  assert.deepEqual(data.SELLING_GUILD_NAMES, ["Alchemy", "Bonecraft", "Clothcraft", "Cooking", "Fishing", "Goldsmithing", "Leathercraft", "Smithing", "Woodworking"]);
  assert.equal(data.SELLING_GUILDS.length, 28);
  assert.equal(new Set(data.SELLING_GUILDS.map(shop => shop.pool)).size, 28);
  for (const path of ["scripts/data/guild_shops.lua", "scripts/globals/guild_shops.lua", "modules/phoenix/lua/data/era_guild_shops.lua"]) {
    assert.match(snapshot.source.inputs[path], /^[a-f0-9]{64}$/);
  }
  for (const shop of data.SELLING_GUILDS) {
    assert.ok(shop.merchants.length && shop.stock.length, shop.pool);
    assert.equal(new Set(shop.stock.map(row => row.itemId)).size, shop.stock.length);
    for (const merchant of shop.merchants) {
      assert.ok(merchant.zones.length, merchant.name);
      assert.ok(snapshot.guildNpcs.includes(merchant.name));
    }
    for (const stock of shop.stock) {
      assert.ok(stock.maxStock >= stock.targetStock);
      assert.ok(stock.baseSell >= 0);
      assert.ok(stock.restockRate >= 0);
      const result = data.guildSaleScenarios(stock);
      assert.equal(result.freshStock + result.freshCapacity, stock.maxStock);
      assert.equal(result.dailyStock + result.dailyCapacity, stock.maxStock);
      assert.equal(result.freshGil, result.freshCapacity * result.freshPrice);
      assert.equal(result.dailyGil, result.dailyCapacity * result.dailyPrice);
      assert.ok(result.freshPrice >= result.dailyPrice);
    }
  }
});

test("Silver Shark reproduces fresh and daily totals without duplicate merchants or ferries", () => {
  const rows = data.guildSellRows(4451, "Fishing");
  assert.equal(rows.length, 9);
  assert.equal(rows.filter(row => row.shop.ferry).length, 6);
  const selbina = rows.find(row => row.shop.pool === "Graegham");
  assert.deepEqual(selbina.shop.merchants.map(npc => npc.name), ["Graegham", "Mendoline"]);
  assert.equal(selbina.freshCapacity, 240);
  assert.equal(selbina.dailyCapacity, 150);
  assert.equal(selbina.trimPercent, 62.5);
  assert.equal(selbina.freshPrice, 750);
  assert.equal(selbina.dailyPrice, 656);
  assert.deepEqual(data.totalGuildSales(rows), {
    emptyCapacity: 1680, freshCapacity: 1680, freshGil: 1260000, dailyCapacity: 510, dailyGil: 300720,
  });
  assert.deepEqual(data.totalGuildSales(data.guildSellRows(4451, "Fishing", false)), {
    emptyCapacity: 480, freshCapacity: 480, freshGil: 360000, dailyCapacity: 210, dailyGil: 132120,
  });
  for (const row of rows.filter(row => row.shop.ferry)) {
    assert.equal(row.freshCapacity, 200);
    assert.equal(row.dailyCapacity, 50);
    assert.equal(row.dailyPrice, 562);
  }
  assert.deepEqual(rows.find(row => row.shop.pool === "Rajmonda").shop.merchants[0].zones, ["Ship bound for Selbina"]);
  assert.equal(data.guildSellRows(4451).length, 9);
});

test("crafting initial inventory is not mistaken for empty inventory or daily restock", () => {
  const maple = data.guildSellRows(691, "Woodworking").find(row => row.shop.pool === "Chaupire");
  assert.ok(maple);
  assert.equal(maple.stock.restockRate, 12);
  assert.equal(maple.emptyCapacity, 240);
  assert.equal(maple.emptyPrice, 22);
  assert.equal(maple.freshStock, 120);
  assert.equal(maple.freshCapacity, 120);
  assert.equal(maple.freshPrice, 18);
  assert.equal(maple.dailyStock, 180);
  assert.equal(maple.dailyCapacity, 60);
  assert.equal(maple.dailyPrice, 16);
  assert.equal(maple.dailyGil, 960);
  assert.equal(maple.shop.merchants.length, 2);
});

test("payout uses both source floors, honors zero fixed prices and clamps initial overstock", () => {
  const stock = { itemId: 1, item: "Test", initial: 240, maxStock: 240, targetStock: 90, restockRate: 0, baseSell: 501, sellPrice: null, hidden: false };
  assert.equal(data.guildSellPrice(stock, 0), 751);
  assert.equal(data.guildSellPrice(stock, 1), 751);
  assert.equal(data.guildSellPrice(stock, 2), 750);
  assert.equal(data.guildSellPrice(stock, 240), 501);
  assert.equal(data.guildSaleScenarios(stock).freshStock, 90);
  assert.equal(data.guildSaleScenarios(stock).freshCapacity, 150);
  for (const sellPrice of [0, 17]) {
    assert.equal(data.guildSellPrice({ ...stock, sellPrice }, 0), sellPrice);
    assert.equal(data.guildSellPrice({ ...stock, sellPrice }, 240), sellPrice);
  }
  for (const invalid of [-1, 241, NaN, 0.5]) {
    assert.throws(() => data.guildSellPrice(stock, invalid), /whole number within the stock cap/);
  }
});

test("search is normalized, guild-scoped and excludes non-guild buy-only offers", () => {
  assert.deepEqual(data.findGuildSellItems(" SILVER-SHARK ", "Fishing"), [{ itemId: 4451, item: "Silver Shark" }]);
  assert.ok(data.findGuildSellItems("iron ingot", "Smithing").some(row => row.item === "Iron Ingot"));
  assert.deepEqual(data.findGuildSellItems("Silver Shark", "Woodworking"), []);
  assert.deepEqual(data.findGuildSellItems("not a real item"), []);
  assert.deepEqual(data.guildSellRows(-1), []);
  assert.deepEqual(data.totalGuildSales([]), { emptyCapacity: 0, freshCapacity: 0, freshGil: 0, dailyCapacity: 0, dailyGil: 0 });
  const all = data.findGuildSellItems("");
  assert.equal(new Set(all.map(row => row.itemId)).size, all.length);
  assert.deepEqual(data.findGuildSellItems("Red Chip"), []);
});

const calibration = { timeOffsetMs: 0, newMoonStartEarthMs: 1 };
const dayMs = 3456000;
const hourMs = dayMs / 24;
const shop = pool => data.SELLING_GUILDS.find(entry => entry.pool === pool);

test("opening countdowns respect exact open/close boundaries and source-specific hours", () => {
  const babubu = shop("Babubu");
  assert.equal(data.SOURCE_GUILD_SHOP_HOLIDAYS, false);
  assert.equal(data.DEFAULT_GUILD_SHOP_HOLIDAYS, true);
  const before = data.guildOpeningStatus(babubu, 3 * hourMs - 1, calibration, false);
  assert.equal(before.isOpen, false);
  assert.equal(before.nextOpenAt, 3 * hourMs);
  const open = data.guildOpeningStatus(babubu, 3 * hourMs, calibration, false);
  assert.equal(open.isOpen, true);
  assert.equal(open.closeAt, 18 * hourMs);
  assert.equal(open.nextOpenAt, dayMs + 3 * hourMs);
  assert.equal(data.guildOpeningStatus(babubu, 18 * hourMs - 1, calibration, false).isOpen, true);
  assert.equal(data.guildOpeningStatus(babubu, 18 * hourMs, calibration, false).isOpen, false);
  assert.equal(data.guildOpeningStatus(shop("Wahnid"), 2 * hourMs, calibration, false).isOpen, true);
  assert.equal(data.guildOpeningStatus(shop("Rajmonda"), 22 * hourMs, calibration, false).isOpen, true);
  for (const entry of data.SELLING_GUILDS) {
    assert.equal(data.guildOpeningStatus(entry, entry.hours[0] * hourMs, calibration, false).isOpen, true, entry.pool);
    assert.equal(data.guildOpeningStatus(entry, entry.hours[1] * hourMs, calibration, false).isOpen, false, entry.pool);
  }
});

test("optional holidays skip the closed day, including week rollover", () => {
  const babubu = shop("Babubu");
  const holidayMorning = 5 * dayMs + 4 * hourMs;
  assert.equal(data.guildOpeningStatus(babubu, holidayMorning, calibration, false).isOpen, true);
  const closed = data.guildOpeningStatus(babubu, holidayMorning, calibration, true);
  assert.equal(closed.isOpen, false);
  assert.equal(closed.isHoliday, true);
  assert.equal(closed.nextOpenAt, 6 * dayMs + 3 * hourMs);
  assert.equal(data.guildOpeningStatus(babubu, 4 * dayMs + 19 * hourMs, calibration, true).nextOpenAt, closed.nextOpenAt);
  assert.equal(data.guildOpeningStatus(shop("Wahnid"), holidayMorning, calibration, true).isOpen, true);
  assert.equal(data.guildOpeningStatus(shop("Wahnid"), 6 * dayMs + 4 * hourMs, calibration, true).isHoliday, true);
  const woodworking = data.guildOpeningStatus(shop("Chaupire"), 7 * dayMs + 22 * hourMs, calibration, true);
  assert.equal(woodworking.nextOpenAt, 9 * dayMs + 6 * hourMs);
});

test("opening reminders are stable, calibrated, one-shot timers with shared-pool identities", () => {
  const cal = { ...calibration, timeOffsetMs: 4753281 };
  const now = 10 * dayMs + 137;
  const guild = shop("Graegham");
  const first = data.createGuildOpeningTimer(guild, now, cal, true);
  const second = data.createGuildOpeningTimer(guild, now + 1001, cal, true);
  assert.equal(first.id, second.id);
  assert.equal(first.targetEarthMs, second.targetEarthMs);
  assert.equal(first.kind, "EARTH_TIME");
  assert.equal(first.enabled, true);
  assert.equal(first.repeatDaily, false);
  assert.equal(Date.parse(first.rawInput), first.targetEarthMs);
  assert.match(first.label, /Selbina.*Graegham.*Mendoline/);
  assert.equal((first.targetEarthMs + cal.timeOffsetMs) % dayMs, 3 * hourMs);
  assert.equal(first.targetEarthMs, data.guildOpeningStatus(guild, now, cal, true).nextOpenAt);
  assert.notEqual(first.id, data.createGuildOpeningTimer(guild, first.targetEarthMs, cal, true).id);
  assert.throws(() => data.guildOpeningStatus({ ...guild, hours: [18, 3] }, now, cal, false), /Invalid guild opening/);
});
