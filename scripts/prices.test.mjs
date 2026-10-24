import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/itemPriceStore.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { createItemPriceStore, ITEM_PRICES_KEY, selectedBuyPrice, selectedSellPrice, resolvedPriceBooks } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const key = (name) => ({ "Elm Log": "1", "Log of Elm": "1", "Rock Salt": "2" })[name] ?? name;
const storage = (values = {}) => {
  const data = new Map(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

const catalogBundle = buildSync({ stdin: { contents: 'export * from "./src/utils/printingData"; export * from "./src/utils/priceCatalog"; export * from "./src/utils/printingPlanner"; export * from "./src/utils/printing";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm" });
const data = await import(`data:text/javascript;base64,${Buffer.from(catalogBundle.outputFiles[0].text).toString("base64")}`);

test("catalog covers every craft input and output, aliases, digging items, and saved unknown items", () => {
  const rows = new Map(data.PRICE_CATALOG.map((item) => [item.key, item]));
  assert.equal(rows.size, data.PRICE_CATALOG.length);
  assert.ok(rows.size >= 9103);
  for (const recipe of [...data.PRINT_RECIPES, ...data.DESYNTH_RECIPES]) {
    for (const name of [recipe.res.n, ...recipe.hq.map((item) => item.n), ...recipe.ing.map((item) => item.n), `${recipe.crystal} Crystal`]) assert.equal(rows.get(data.printItemKey(name))?.crafting, true, name);
  }
  const rockSalt = rows.get(data.printItemKey("Rock Salt"));
  assert.equal(rockSalt.key, data.printItemKey("Chunk of Rock Salt"));
  assert.equal(rockSalt.stack, 12);
  assert.ok(rockSalt.search.includes("rock salt"));
  for (const name of ["Gysahl Greens", "Elm Log", "Fire Cluster", "Ice Crystal"]) assert.equal(rows.get(data.printItemKey(name))?.digging, true, name);
  const store = createItemPriceStore(storage(), data.printItemKey);
  store.setPrice("market", "Unlisted event material", 99);
  assert.ok(data.priceCatalogItems(store.getSnapshot()).some((row) => row.name === "Unlisted event material"));
});

test("real item aliases share quotes across market, Profits costs, revenue, and cached plans", () => {
  const salt = data.printItemKey("Rock Salt");
  const legacy = storage({ "ffxi_dig_ah_prices_v1": { "Rock Salt": 100 } });
  const store = createItemPriceStore(legacy, data.printItemKey);
  assert.equal(store.getSnapshot().market[data.printItemKey("Chunk of Rock Salt")], 100);
  const recipes = data.PRINT_RECIPES.filter((recipe) => recipe.res.n === "Tsurara");
  const planner = data.createPrintingPlanner(recipes, data.printItemKey, data.printBuyPrice, data.printSellPrice);
  let vendors = true;
  const plan = () => {
    const prices = resolvedPriceBooks(store.getSnapshot(), (key) => data.printBuyPrice(key, {}, vendors, false), (key) => data.printSellPrice(key, {}));
    return planner({ settings: data.restorePrintSettings({ skillMode: "at-cap" }), buy: prices.effectiveBuy, sell: prices.effectiveSell, sources: {}, vendors, modernGuilds: false, wotg: false, keyItems: false });
  };
  store.setPrice("market", "Distilled Water", 20);
  store.setPrice("market", "Ice Crystal", 50);
  store.setPrice("market", "Tsurara", 200);
  const first = plan();
  const before = first.chain.estimate(recipes[0]);
  assert.equal(before.inputs.find((input) => data.printItemKey(input.name) === salt).price, Math.min(100, data.printBuyPrice("Rock Salt", {})));
  assert.equal(before.outcomes[0].price, 200);
  assert.strictEqual(plan(), first);
  vendors = false;
  assert.equal(plan().chain.estimate(recipes[0]).inputs.find((input) => data.printItemKey(input.name) === salt).price, 100);
  vendors = true;
  store.setPrice("market", "Chunk of Rock Salt", 1);
  const after = plan().chain.estimate(recipes[0]);
  assert.ok(after.profit > before.profit);
  store.setPrice("buy", "Rock Salt", 5);
  assert.equal(plan().chain.estimate(recipes[0]).inputs.find((input) => data.printItemKey(input.name) === salt).price, 1);
  store.setPrice("sell", "Tsurara", 0);
  assert.equal(plan().chain.estimate(recipes[0]).revenue, 0);
  store.setPrice("sell", "Tsurara", null);
  assert.equal(plan().chain.estimate(recipes[0]).outcomes[0].price, 200);
  store.setSellMode("Tsurara", "vendor");
  const vendorPlan = plan();
  assert.equal(vendorPlan.chain.estimate(recipes[0]).outcomes[0].price, data.printSellPrice("Tsurara", {}));
  store.setPrice("market", "Tsurara", 500);
  assert.strictEqual(plan(), vendorPlan);
  store.setSellMode("Tsurara", "auto");
  assert.equal(plan().chain.estimate(recipes[0]).outcomes[0].price, 500);
  assert.ok(plan().chain.estimate(recipes[0]).profit > vendorPlan.chain.estimate(recipes[0]).profit);
  store.setPrice("market", "Tsurara", 1);
  assert.equal(plan().chain.estimate(recipes[0]).outcomes[0].price, data.printSellPrice("Tsurara", {}));
  store.setPrice("market", "Gysahl Greens", 10);
  assert.equal(data.printBuyPrice("Bunch of Gysahl Greens", store.getSnapshot().effectiveBuy), 10);
});

test("legacy digging market prices and distinct Profits quotes migrate once without conflicts", () => {
  const saved = storage({ "ffxi_dig_ah_prices_v1": { "Elm Log": 4000, "Rock Salt": 0 }, "kupo.printing.v1": { buy: { "1": 3000 }, sell: { "1": 5000 } } });
  const store = createItemPriceStore(saved, key);
  const result = store.getSnapshot();
  assert.equal(result.market["1"], 4000);
  assert.equal(result.effectiveBuy["1"], 3000);
  assert.equal(result.effectiveSell["1"], 5000);
  assert.equal(result.effectiveSell["2"], 0);
  assert.strictEqual(store.getSnapshot(), result);
  store.setPrice("buy", "Log of Elm", null);
  assert.equal(store.getSnapshot().effectiveBuy["1"], 4000);
  store.setPrice("market", "Elm Log", null);
  const reopened = createItemPriceStore(saved, key).getSnapshot();
  assert.equal(reopened.market["1"], undefined);
  assert.equal(reopened.buy["1"], undefined);
  assert.equal(reopened.sell["1"], 5000);
});

test("shared prices notify subscribers, preserve zero, reset fallbacks, and survive reopening", () => {
  const saved = storage();
  const store = createItemPriceStore(saved, key, () => "2026-09-06T12:00:00.000Z");
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  store.setPrice("market", "Elm Log", 4000);
  assert.equal(store.getSnapshot().effectiveBuy["1"], 4000);
  assert.equal(store.getSnapshot().effectiveSell["1"], 4000);
  store.setPrice("market", "Log of Elm", 4000);
  assert.equal(updates, 1);
  store.setPrice("sell", "Elm Log", 0);
  assert.equal(store.getSnapshot().effectiveSell["1"], 0);
  store.setPrice("market", "Elm Log", -1);
  store.setPrice("market", "Elm Log", Infinity);
  store.setPrice("market", "Elm Log", NaN);
  assert.equal(updates, 2);
  store.setPrice("sell", "Elm Log", null);
  assert.equal(store.getSnapshot().effectiveSell["1"], 4000);
  assert.deepEqual(createItemPriceStore(saved, key).getSnapshot(), store.getSnapshot());
  assert.equal(store.getSnapshot().updated["1"], "2026-09-06T12:00:00.000Z");
  unsubscribe();
  store.setPrice("market", "Elm Log", 5000);
  assert.equal(updates, 3);
});

test("external updates refresh snapshots and failed persistence is visible", () => {
  const saved = storage();
  const first = createItemPriceStore(saved, key);
  const second = createItemPriceStore(saved, key);
  second.getSnapshot();
  first.setPrice("market", "Elm Log", 200);
  second.reload();
  assert.equal(second.getSnapshot().market["1"], 200);
  const blocked = createItemPriceStore({ getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } }, key);
  blocked.setPrice("market", "Elm Log", 100);
  assert.equal(blocked.getSnapshot().market["1"], 100);
  assert.match(blocked.getSnapshot().error, /could not be saved/);
  assert.equal(JSON.parse(saved.getItem(ITEM_PRICES_KEY)).version, 1);
});

test("automatic prices minimize buying and maximize selling while vendor and manual sales stay forced", () => {
  const saved = storage();
  const store = createItemPriceStore(saved, key);
  const selected = () => resolvedPriceBooks(store.getSnapshot(), () => 100, () => 50);
  store.setPrice("market", "Elm Log", 80);
  assert.equal(selected().effectiveBuy["1"], 80);
  assert.equal(selected().effectiveSell["1"], 80);
  store.setPrice("market", "Elm Log", 20);
  assert.equal(selected().effectiveSell["1"], 50);
  store.setPrice("market", "Elm Log", 200);
  assert.equal(selected().effectiveBuy["1"], 100);
  store.setSellMode("Elm Log", "vendor");
  assert.equal(selected().effectiveSell["1"], 50);
  store.setPrice("market", "Elm Log", 500);
  assert.equal(selected().effectiveSell["1"], 50);
  assert.equal(createItemPriceStore(saved, key).getSnapshot().sellMode["1"], "vendor");
  store.setPrice("sell", "Elm Log", 40);
  assert.equal(selected().effectiveSell["1"], 40);
  store.setSellMode("Elm Log", "auto");
  assert.equal(selected().effectiveSell["1"], 500);
  store.setPrice("market", "Elm Log", 10);
  assert.equal(selected().effectiveSell["1"], 40);
  store.setPrice("buy", "Elm Log", 5);
  assert.equal(selected().effectiveBuy["1"], 5);
  store.setPrice("market", "Elm Log", 1);
  assert.equal(selected().effectiveBuy["1"], 1);
  assert.equal(store.getSnapshot().buy["1"], 5);
  store.setPrice("sell", "Elm Log", null);
  assert.equal(selected().effectiveSell["1"], 50);
  assert.equal(selectedBuyPrice(store.getSnapshot(), "missing", null), null);
  assert.equal(selectedSellPrice(store.getSnapshot(), "missing", null), null);
  store.setPrice("market", "Elm Log", 0);
  assert.equal(selected().effectiveBuy["1"], 0);
  assert.equal(selected().effectiveSell["1"], 50);
});

test("vendor sale quotes are independent of AH and generic sale quotes, persist, and reset to NPC values", () => {
  const saved = storage({ [ITEM_PRICES_KEY]: { version: 1, market: { "1": 200 }, sell: { "1": 175 } } });
  const store = createItemPriceStore(saved, key);
  assert.deepEqual(store.getSnapshot().vendor, {}, "old price books migrate without inventing vendor quotes");
  const selected = () => resolvedPriceBooks(store.getSnapshot(), () => 100, () => 50);
  store.setPrice("vendor", "Log of Elm", 250);
  assert.equal(store.getSnapshot().market["1"], 200);
  assert.equal(store.getSnapshot().sell["1"], 175);
  assert.equal(createItemPriceStore(saved, key).getSnapshot().vendor["1"], 250);
  store.setSellMode("Elm Log", "vendor");
  assert.equal(selected().effectiveSell["1"], 250);
  store.setPrice("vendor", "Elm Log", 0);
  assert.equal(selected().effectiveSell["1"], 0);
  store.setPrice("vendor", "Elm Log", null);
  assert.equal(selected().effectiveSell["1"], 50);
  assert.equal(store.getSnapshot().market["1"], 200);
  store.setPrice("vendor", "Unknown vendor-only item", 30);
  assert.ok(data.priceCatalogItems(store.getSnapshot()).some((item) => item.name === "Unknown vendor-only item"));
});