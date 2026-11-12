import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildSync } from "esbuild";
import sharp from "sharp";

const bundle = buildSync({ entryPoints: ["src/utils/helm.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { HELM_ZONES, HELM_DEFAULTS, HELM_ROCKS, HELM_SOURCE, helmRates, helmAvailable } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const snapshot = JSON.parse(readFileSync("src/data/phoenix.json", "utf8"));
const catalog = JSON.parse(readFileSync("src/data/itemInfo.json", "utf8"));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const zone = (name, kind = "Mining") => HELM_ZONES.find(row => row.zone === name && row.kind === kind);

test("HELM has its own source revision and input fingerprints", () => {
  assert.equal(HELM_SOURCE.revision, "fffca036344db11481008895ca81a0d31eb03ac9");
  assert.equal(HELM_SOURCE.repository, snapshot.source.repository);
  assert.equal(snapshot.source.revision, "ace1415cf5643d8d45ff72067522d97f2ccb038f");
  assert.equal(HELM_SOURCE.checked, "2026-11-06");
  for (const file of [
    "scripts/enum/item.lua", "data/enums/zone.yaml", "data/enums/mod.yaml",
    "modules/init.txt", "settings/default/main.lua", "sql/item_mods.sql",
    "scripts/globals/hobbies/helm/data.lua", "scripts/globals/hobbies/helm/logic.lua",
    "modules/era/lua/globals/helm/helm_adjustments.lua",
  ]) assert.match(HELM_SOURCE.inputs[file], /^[a-f0-9]{64}$/, file);
});

test("every HELM pool matches shared item-source shares and has valid tools and points", () => {
  assert.equal(HELM_ZONES.length, 42);
  for (const entry of HELM_ZONES) {
    assert.ok(catalog.items[entry.toolId]);
    assert.ok(entry.points.length > 0);
    for (const point of entry.points) assert.ok(point.length === 3 && point.every(Number.isFinite));
    const rates = helmRates(entry, HELM_DEFAULTS);
    close(rates.drops.reduce((sum, row) => sum + row.share, 0), 1);
    close(rates.drops.reduce((sum, row) => sum + row.perAttempt, 0), entry.obtainRate / 100);
    for (const row of rates.drops) {
      assert.ok(Number.isInteger(row.itemId) && row.itemId > 0 && row.name.length > 0);
      const original = snapshot.helm.find(drop => drop.kind === entry.kind && drop.zone === entry.zone && drop.n === row.name);
      assert.ok(original, row.name);
      close(row.share * 100, original.pct);
    }
  }
});
test("corrected jungle and volcanic pools retain exact source weights and renormalize chances", () => {
  const pools = [
    ["Yuhtunga Jungle", "Logging", 82.76, [[721, 1840], [688, 1750], [689, 1160], [912, 870], [940, 600], [697, 590], [701, 240], [702, 140], [1237, 130]]],
    ["Halvung", "Mining", 76.7, [[768, 1300], [2417, 1240], [1108, 1200], [928, 1180], [1155, 1170], [1625, 400], [2161, 390], [1638, 390], [1631, 380], [2160, 380], [1632, 370], [737, 260], [739, 20], [2228, 10]]],
    ["Mount Zhayolm", "Mining", 75.06, [[643, 1580], [928, 1360], [1155, 1330], [1108, 1310], [768, 1160], [2161, 290], [902, 280], [1632, 270], [1625, 270], [1638, 270], [1631, 260], [2160, 250], [646, 100], [685, 15]]],
  ];
  for (const [name, kind, obtainRate, expected] of pools) {
    const entry = zone(name, kind);
    assert.deepEqual(entry.drops.map(drop => [drop.itemId, drop.weight]), expected, name);
    close(entry.obtainRate, obtainRate);
    const total = expected.reduce((sum, [, weight]) => sum + weight, 0);
    const rates = helmRates(entry, HELM_DEFAULTS);
    for (const [itemId, weight] of expected) {
      const drop = rates.drops.find(row => row.itemId === itemId);
      close(drop.share, weight / total);
      close(drop.perAttempt, obtainRate / 100 * weight / total);
    }
  }
  const logging = helmRates(zone("Yuhtunga Jungle", "Logging"), HELM_DEFAULTS);
  assert.equal((logging.drops.find(drop => drop.itemId === 721).perAttempt * 100).toFixed(2), "20.80");
  assert.equal((logging.drops.find(drop => drop.itemId === 1237).perAttempt * 100).toFixed(2), "1.47");
});
test("logging zone rates and movement agree with the checked wiki reference", () => {
  const expected = [
    ["Buburimu Peninsula", "62.6", "16.8", 42],
    ["Caedarva Mire", "75.6", "7.6", 24],
    ["Carpenters' Landing", "70.3", "12.2", 11],
    ["East Ronfaure", "73.2", "7.1", 30],
    ["Ghelsba Outpost", "61.6", "7.5", 32],
    ["Jugner Forest", "70.3", "12.1", 30],
    ["Lufaise Meadows", "70.4", "17.8", 12],
    ["Mamook", "79.0", "9.2", 11],
    ["Misareaux Coast", "66.7", "18.5", 12],
    ["Yhoator Jungle", "83.4", "18.2", 20],
    ["Yuhtunga Jungle", "82.8", "15.6", 25],
  ];
  assert.equal(HELM_ZONES.filter(entry => entry.kind === "Logging" && helmAvailable(entry, false)).length, expected.length);
  for (const [name, success, breakRate, points] of expected) {
    const entry = zone(name, "Logging");
    assert.equal(entry.obtainRate.toFixed(1), success, name);
    assert.equal(entry.breakRate.toFixed(1), breakRate, name);
    assert.equal(entry.points.length, points, name);
    assert.equal(entry.relocateRate, 100);
    assert.equal(entry.respawnTime, 60);
    close(entry.campMultiplier, 2.1);
    close(helmRates(entry, HELM_DEFAULTS).relocateChance, entry.obtainRate / 100);
  }
});
test("ToAU excludes past and Abyssea zones; WotG opt-in never includes Abyssea", () => {
  assert.ok(HELM_ZONES.filter(entry => helmAvailable(entry, false)).every(entry => !entry.zone.endsWith(" S")));
  assert.ok(HELM_ZONES.filter(entry => helmAvailable(entry, true)).some(entry => entry.zone.endsWith(" S")));
  assert.ok(HELM_ZONES.filter(entry => helmAvailable(entry, true)).every(entry => !entry.zone.startsWith("Abyssea")));
});
test("level and full inventory block items but not tool breaks", () => {
  const entry = zone("Mount Zhayolm");
  for (const change of [{ level: 19 }, { inventoryFull: true }]) {
    const result = helmRates(entry, { ...HELM_DEFAULTS, ...change });
    assert.equal(result.success, 0);
    close(result.breakChance, entry.breakRate / 100);
    assert.ok(result.drops.every(row => row.perAttempt === 0));
  }
});
test("tool breaks are independent; gear multiplies breaks except for excavation", () => {
  const entry = zone("Mount Zhayolm");
  const result = helmRates(entry, { ...HELM_DEFAULTS, nq: 2, hq: 1, camped: true });
  close(result.breakChance, entry.breakRate / 100 * entry.campMultiplier * 0.893 ** 2 * 0.843);
  close(result.success, entry.obtainRate / 100);
  close(result.itemAndBreak, result.success * result.breakChance);
  const excavation = zone("Tahrongi Canyon", "Excavation");
  close(helmRates(excavation, { ...HELM_DEFAULTS, nq: 9, hq: 9 }).breakChance, excavation.breakRate / 100);
});
test("Mount Zhayolm daily caps use integer weights and exclude exhausted ores", () => {
  const entry = zone("Mount Zhayolm");
  const ore = entry.drops.find(row => row.dailyCap === 2);
  assert.ok(ore);
  const reduced = helmRates(entry, { ...HELM_DEFAULTS, daily: { [ore.itemId]: 1 } });
  assert.equal(reduced.drops.find(row => row.itemId === ore.itemId).effectiveWeight, Math.floor(ore.weight / 2));
  const capped = helmRates(entry, { ...HELM_DEFAULTS, daily: { [ore.itemId]: 2 } });
  assert.equal(capped.drops.find(row => row.itemId === ore.itemId).perAttempt, 0);
  close(capped.drops.reduce((sum, row) => sum + row.perAttempt, 0), entry.obtainRate / 100);
});
test("depletion uses a shared pool count with integer rounding", () => {
  const entry = zone("Halvung");
  const result = helmRates(entry, { ...HELM_DEFAULTS, depleted: 1 });
  for (const row of result.drops) assert.equal(row.effectiveWeight, entry.depletion.pool.includes(row.itemId) ? Math.floor(row.weight * 4 / 5) : row.weight);
  const exhausted = helmRates(entry, { ...HELM_DEFAULTS, depleted: 5 });
  assert.ok(exhausted.drops.filter(row => entry.depletion.pool.includes(row.itemId)).every(row => row.perAttempt === 0));
});
test("logging visit limits share one count across rare logs and leave common logs available", () => {
  for (const [name, pool] of [["Ghelsba Outpost", [690]], ["Lufaise Meadows", [690, 699]], ["Misareaux Coast", [690, 699]]]) {
    const entry = zone(name, "Logging");
    assert.equal(entry.depletion.max, 20);
    assert.deepEqual([...entry.depletion.pool].sort(), pool);
    const halfway = helmRates(entry, { ...HELM_DEFAULTS, depleted: 10 });
    const exhausted = helmRates(entry, { ...HELM_DEFAULTS, depleted: 20 });
    for (const drop of halfway.drops) {
      assert.equal(drop.effectiveWeight, pool.includes(drop.itemId) ? Math.floor(drop.weight / 2) : drop.weight);
    }
    assert.ok(exhausted.drops.filter(drop => pool.includes(drop.itemId)).every(drop => drop.perAttempt === 0));
    close(exhausted.drops.reduce((sum, drop) => sum + drop.perAttempt, 0), entry.obtainRate / 100);
  }
});
test("colored rock results follow the Vana'diel weekday without changing probability", () => {
  const entry = HELM_ZONES.find(entry => entry.drops.some(row => row.itemId === 769));
  for (const [day, rock] of HELM_ROCKS.entries()) {
    assert.equal(catalog.items[rock.itemId].name, rock.name);
    const row = helmRates(entry, { ...HELM_DEFAULTS, day }).drops.find(row => row.sourceItemId === 769);
    assert.equal(row.itemId, rock.itemId);
    assert.equal(row.name, rock.name);
  }
});
test("HELM equipment carries named source modifiers for each supported activity", () => {
  assert.ok(snapshot.helmGear.length > 0);
  assert.deepEqual(new Set(snapshot.helmGear.map(row => row.kind)), new Set(["Harvesting", "Logging", "Mining"]));
  for (const row of snapshot.helmGear) {
    assert.ok(row.name.length > 0 && row.itemId > 0);
    assert.ok(row.nq > 0 || row.hq > 0);
  }
  for (const kind of ["Harvesting", "Logging", "Mining"]) {
    assert.ok(snapshot.helmGear.some(row => row.kind === kind && row.itemId === 14374 && row.nq === 1));
    assert.ok(snapshot.helmGear.some(row => row.kind === kind && row.itemId === 14375 && row.hq === 1));
  }
  assert.ok(!snapshot.helmGear.some(row => row.kind === "Harvesting" && row.itemId === 14817));
  assert.ok(snapshot.helmGear.some(row => row.kind === "Logging" && row.itemId === 14817 && row.nq === 1));
  assert.deepEqual(snapshot.helmGear.filter(row => row.itemId === 14298).map(row => [row.kind, row.nq, row.hq]), [
    ["Harvesting", 0, 1], ["Logging", 0, 1],
  ]);
});

test("gathering maps preserve bundled images, dimensions and wiki provenance", async () => {
  const { maps } = JSON.parse(readFileSync("src/data/helmMaps.json", "utf8"));
  assert.equal(maps.length, 47);
  assert.equal(new Set(maps.map(map => map.id)).size, maps.length);
  assert.equal(new Set(maps.map(map => map.file)).size, maps.length);
  for (const map of maps) {
    assert.ok(HELM_ZONES.some(entry => entry.zoneId === map.zoneId && entry.kind === map.kind && entry.zone === map.zone));
    assert.match(map.file, /^maps\/helm\/[a-z]+-\d+-\d+\.png$/);
    const image = readFileSync(`public/${map.file}`);
    assert.equal(createHash("sha256").update(image).digest("hex"), map.sha256, map.id);
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.width, map.width);
    assert.equal(metadata.height, map.height);
    assert.ok(map.width >= 400 && map.height >= 400);
    assert.equal(new URL(map.sourceUrl).hostname, "ffxiclopedia.fandom.com");
    assert.equal(decodeURIComponent(new URL(map.sourceUrl).pathname), `/wiki/${map.wikiFile.replaceAll(" ", "_")}`);
    assert.equal(map.activityUrl, `https://ffxiclopedia.fandom.com/wiki/${map.kind}`);
    assert.ok(Number.isFinite(Date.parse(map.imageRevision)));
  }
});

test("gathering map coverage distinguishes activities, past zones and missing annotations", () => {
  const { maps, missing } = JSON.parse(readFileSync("src/data/helmMaps.json", "utf8"));
  const references = JSON.parse(readFileSync("src/data/maps.json", "utf8")).maps;
  const matchingMaps = entry => maps.filter(map => map.zoneId === entry.zoneId && map.kind === entry.kind);
  assert.deepEqual(missing.map(entry => `${entry.kind}:${entry.zone}`).sort(), ["Harvesting:Pashhow Marshlands", "Harvesting:Yhoator Jungle"]);
  for (const entry of HELM_ZONES.filter(entry => helmAvailable(entry, true))) {
    const available = matchingMaps(entry);
    const unavailable = missing.filter(map => map.zoneId === entry.zoneId && map.kind === entry.kind);
    assert.equal(Number(available.length > 0) + unavailable.length, 1, `${entry.kind}: ${entry.zone}`);
    if (unavailable.length) assert.ok(references.some(map => map.zone.toLowerCase() === entry.zone.toLowerCase()));
  }
  assert.equal(matchingMaps(zone("Korroloka Tunnel", "Excavation")).length, 5);
  assert.equal(matchingMaps(zone("Gusgen Mines")).length, 4);
  assert.equal(matchingMaps(zone("Palborough Mines")).length, 3);
  assert.equal(matchingMaps(zone("Ifrits Cauldron")).length, 3);
  assert.equal(matchingMaps(zone("Caedarva Mire", "Logging")).length, 2);
  const present = matchingMaps(zone("West Sarutabaruta", "Harvesting"))[0];
  const past = matchingMaps(zone("West Sarutabaruta S", "Harvesting"))[0];
  assert.notEqual(present.file, past.file);
  assert.notEqual(matchingMaps(zone("Yuhtunga Jungle", "Logging"))[0].file, matchingMaps(zone("Yuhtunga Jungle", "Harvesting"))[0].file);
});