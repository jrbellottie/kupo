import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

async function loadUtility(name) {
  const source = readFileSync(new URL(`../src/utils/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const { AH_CRAFT_CATEGORY } = await loadUtility("craftColors");
const catalog = JSON.parse(readFileSync(new URL("../src/data/itemInfo.json", import.meta.url), "utf8"));
const items = Object.values(catalog.items ?? catalog);
const categoryFor = (name) => {
  const item = items.find((entry) => entry.name === name);
  assert.ok(item, `expected ${name} in the item catalog`);
  return AH_CRAFT_CATEGORY[item.category];
};

test("raw ingredients use their Auction House craft category", () => {
  assert.equal(categoryFor("Chocobo Feather"), "Clothcraft");
  assert.equal(categoryFor("Bat Fang"), "Bonecraft");
  assert.equal(categoryFor("Bat Wing"), "Alchemy");
});

test("food Auction House categories use Cooking colors", () => {
  assert.equal(categoryFor("Bowl of Tender Navarin"), "Cooking");
  assert.equal(categoryFor("Apple Pie"), "Cooking");
});
