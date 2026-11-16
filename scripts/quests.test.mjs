import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const questData = JSON.parse(readFileSync(new URL("../src/data/quests.json", import.meta.url), "utf8"));
const { maps } = JSON.parse(readFileSync(new URL("../src/data/maps.json", import.meta.url), "utf8"));
const belly = JSON.parse(readFileSync(new URL("../src/data/insideBelly.json", import.meta.url), "utf8"));
const WILDCAT_SECTIONS = {
  "Lure of the Wildcat (Bastok)": [
    [";Port Bastok", "Port Bastok"],
    [";Metalworks", "Metalworks"],
    [";Bastok Markets", "Bastok Markets"],
    [";Bastok Mines", "Bastok Mines"],
  ],
  "Lure of the Wildcat (Jeuno)": [
    [";Ru'Lude Gardens", "Ru'Lude Gardens"],
    [";Upper Jeuno", "Upper Jeuno"],
    [";Lower Jeuno", "Lower Jeuno"],
    [";Port Jeuno", "Port Jeuno"],
  ],
  "Lure of the Wildcat (San d'Oria)": [
    [";Southern San d'Oria", "Southern San d'Oria"],
    [";Northern San d'Oria", "Northern San d'Oria"],
    [";Port San d'Oria", "Port San d'Oria"],
    [";Chateau d'Oraguille", "Chateau d'Oraguille"],
  ],
  "Lure of the Wildcat (Windurst)": [
    [";Windurst Woods", "Windurst Woods"],
    [";Windurst Walls", "Windurst Walls"],
    [";Windurst Waters", "Windurst Waters", 2],
    [";Port Windurst", "Port Windurst"],
  ],
};

test("Wildcat quest coordinates resolve to the map for their city section", () => {
  for (const [pageTitle, sections] of Object.entries(WILDCAT_SECTIONS)) {
    const entry = questData.quests.find((quest) => quest.pageTitle === pageTitle);
    assert.ok(entry, `Missing quest: ${pageTitle}`);
    let zone = null;
    let mapNo = null;
    const foundSections = new Set();
    for (const [step, text] of entry.walkthrough.entries()) {
      const section = sections.find(([heading]) => text.startsWith(heading));
      if (section) {
        [, zone, mapNo = null] = section;
        foundSections.add(zone);
        assert.ok(entry.mapRefs.some((ref) => ref.zone === zone && ref.mapNo === mapNo), `${pageTitle}: missing map ref for ${zone}`);
        assert.ok(maps.some((map) => map.zone === zone && (mapNo == null || map.mapNo === mapNo)), `${pageTitle}: no bundled map for ${zone}`);
      }
      if (!zone) continue;
      for (const [, pos] of text.matchAll(/([A-P]-\d{1,2})/g)) {
        const refs = entry.stepRefs.filter((ref) => ref.step === step && ref.pos === pos);
        assert.deepEqual(refs.map((ref) => [ref.zone, ref.mapNo]), [[zone, mapNo]], `${pageTitle} ${pos} at step ${step}`);
      }
    }
    assert.deepEqual([...foundSections], sections.map(([, sectionZone]) => sectionZone), pageTitle);
  }
});

test("Inside the Belly keeps all 52 fish separated by the source era gates", () => {
  assert.equal(belly.fish.length, 52);
  assert.equal(new Set(belly.fish.map(fish => fish.fish)).size, 52);
  assert.deepEqual(Object.fromEntries(["ToAU", "WotG", "Abyssea", "SoA", "RoV"].map(era =>
    [era, belly.fish.filter(fish => fish.era === era).length])), { ToAU: 18, WotG: 17, Abyssea: 11, SoA: 2, RoV: 4 });
  assert.deepEqual(belly.fish.filter(fish => fish.era === "ToAU").map(fish => fish.fish), [
    "Bhefhel Marlin", "Cave Cherax", "Dark Bass", "Emperor Fish", "Giant Catfish", "Giant Chirai",
    "Giant Donko", "Gugrusaurus", "Jungle Catfish", "Lik", "Ogre Eel", "Ryugu Titan", "Sea Zombie",
    "Silver Shark", "Takitaro", "Titanictus", "Tricorn", "Zafmlug Bass",
  ]);
  for (const fish of belly.fish) {
    assert.ok(Number.isInteger(fish.gil) && fish.gil > 0, fish.fish);
    assert.ok(fish.rewards.length > 0);
    assert.ok(fish.rewards.reduce((sum, reward) => sum + reward.chance, 0) <= 100, fish.fish);
    for (const reward of fish.rewards) {
      assert.ok(reward.item && reward.chance > 0 && reward.chance <= 100);
      assert.ok(Number.isInteger(reward.min ?? 1) && (reward.min ?? 1) >= 1);
      assert.ok(Number.isInteger(reward.max ?? 1) && (reward.max ?? 1) >= (reward.min ?? 1));
    }
  }
});

test("Turnabaligi ore and multi-result fish retain their exact rates and quantities", () => {
  const turnabaligi = belly.fish.find(fish => fish.fish === "Turnabaligi");
  assert.equal(turnabaligi.era, "WotG");
  assert.equal(turnabaligi.gil, 340);
  assert.deepEqual(turnabaligi.rewards, [
    { item: "Chunk of Dark Ore", chance: 1 },
    { item: "Chunk of Ice Ore", chance: 1.4 },
    { item: "Chunk of Water Ore", chance: 1.4 },
  ]);
  assert.deepEqual(belly.fish.find(fish => fish.fish === "Abaia").rewards.slice(0, 3), [
    { item: "Aurora Bass", chance: 1.5, min: 1, max: 1 },
    { item: "Aurora Bass", chance: 7.8, min: 2, max: 2 },
    { item: "Aurora Bass", chance: 12.5, min: 3, max: 3 },
  ]);
  assert.deepEqual(belly.fish.find(fish => fish.fish === "Bhefhel Marlin").rewards, [
    { item: "Brigand's Chart", chance: 14.3 }, { item: "Pirate's Chart", chance: 4.4 },
  ]);
});

test("source-verified quest overrides survive wiki refreshes and resolve Zaldon's map", () => {
  const quest = questData.quests.find(entry => entry.id === "inside-the-belly");
  for (const [field, value] of Object.entries(belly.quest)) assert.deepEqual(quest[field], value, field);
  assert.ok(maps.some(map => map.zone === "Selbina"));
  assert.match(quest.requirements, /Complete The Real Gift/);
  assert.ok(quest.titles.includes("Cordon Bleu Fisher (Giant Catfish or Ogre Eel)"));
  assert.doesNotMatch(quest.walkthrough.join("\n"), /!!|<!--|Riftcinder|November 2021|Larger fish have increased odds/);
  const importer = readFileSync(new URL("./fetch-quests.mjs", import.meta.url), "utf8");
  assert.match(importer, /Object\.assign\(bellyQuest, belly\.quest\)/);
});

test("rendered reward tables label every row, separate later eras, and support fish/item search", () => {
  const bundle = buildSync({
    stdin: {
      contents: 'import React from "react"; import { renderToStaticMarkup } from "react-dom/server"; import QuestsTab from "./src/QuestsTab"; export const render = () => renderToStaticMarkup(<QuestsTab />);',
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "node", format: "cjs", external: ["react", "react-dom/server"],
  });
  const module = { exports: {} };
  let state = { selectedId: "inside-the-belly" };
  const storage = { getItem: key => key === "ffxi_quests_ui_v1" ? JSON.stringify(state) : null };
  new Function("require", "module", "exports", "localStorage", bundle.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, storage);
  const html = module.exports.render();
  const tables = [...html.matchAll(/<table aria-label="Inside the Belly[^"]*"[^>]*>([\s\S]*?)<\/table>/g)];
  assert.equal(tables.length, 2);
  for (const [index, table] of tables.entries()) {
    const fish = belly.fish.filter(fish => (fish.era === "ToAU") === (index === 0));
    const rows = [...table[1].matchAll(/<tr[^>]*>(<th scope="row"[\s\S]*?)<\/tr>/g)];
    assert.equal(rows.length, fish.reduce((count, entry) => count + entry.rewards.length, 0));
    const expectedNames = fish.flatMap(entry => entry.rewards.map(() => entry.fish));
    rows.forEach((row, rowIndex) => assert.ok(row[1].includes(`>${expectedNames[rowIndex]}`), expectedNames[rowIndex]));
    assert.doesNotMatch(table[1], /rowspan=/i);
  }
  assert.match(html, /<details><summary[^>]*>Later-era reference: 34 fish - not eligible in ToAU/);
  assert.match(html, /Title: Cordon Bleu Fisher/);
  for (const query of ["Turnabaligi", "Mildewy Ingot", "Aurora Bass", "Green Rock"]) {
    state = { query };
    assert.match(module.exports.render(), /Inside the Belly/, query);
  }
});

test("all fish, rewards, quantities, titles, estimates, and era gates match the pinned upstream scripts", {
  skip: !process.env.VERIFY_BELLY_SOURCE,
}, async () => {
  const source = async path => {
    const response = await fetch(`${belly.source.repository.replace("github.com", "raw.githubusercontent.com")}/${belly.source.revision}/${path}`);
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.text();
  };
  const [quest, era] = await Promise.all([source(belly.source.questPath), source(belly.source.eraPath)]);
  const normalize = name => name.replace(/_1$/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const fishBlocks = [...quest.split("local function tradeFish")[0].matchAll(/\[xi\.item\.(\w+)\]\s*=\s*(?:--[^\n]*)?\s*\{([\s\S]*?)\n    \},/g)];
  assert.equal(fishBlocks.length, belly.fish.length);
  const gates = new Map();
  for (const [, gate, block] of era.matchAll(/blocked = xi\.pre\(xi\.expansion\.(\w+)\),\s*items =\s*\{([\s\S]*?)\}/g)) {
    for (const [, item] of block.matchAll(/xi\.item\.(\w+)/g)) gates.set(normalize(item), gate.toLowerCase());
  }
  for (const [, symbol, block] of fishBlocks) {
    const fish = belly.fish.find(fish => normalize(fish.fish) === normalize(symbol));
    assert.ok(fish, symbol);
    assert.equal(fish.era.toLowerCase(), gates.get(normalize(symbol)) ?? "toau", symbol);
    assert.equal(fish.gil, Number(block.match(/gil = (\d+)/)[1]), symbol);
    assert.equal(normalize(fish.title ?? ""), normalize(block.match(/title = xi\.title\.(\w+)/)?.[1] ?? ""), symbol);
    const rewards = [...block.matchAll(/\{ chance =\s*([\d.]+), itemId = xi\.item\.(\w+)(?:, min = (\d+), max = (\d+))? \},([^\n]*)/g)];
    assert.equal(fish.rewards.length, rewards.length, symbol);
    rewards.forEach(([, chance, item, min, max, comment], index) => {
      const reward = fish.rewards[index];
      assert.equal(normalize(reward.item), normalize(item), `${symbol}: item ${index}`);
      assert.equal(reward.chance, Number(chance), symbol);
      assert.equal(reward.min, min ? Number(min) : undefined, symbol);
      assert.equal(reward.max, max ? Number(max) : undefined, symbol);
      assert.equal(Boolean(reward.estimated), /guessing/i.test(comment), symbol);
    });
  }
});
