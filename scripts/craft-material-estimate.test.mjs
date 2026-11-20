import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import ts from "typescript";
import { fileURLToPath } from "node:url";

async function loadUtility(name) {
  const source = readFileSync(new URL(`../src/utils/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const bundledCalculator = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/utils/craftMaterialEstimate.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { estimateCraftMaterials } = await import(`data:text/javascript;base64,${Buffer.from(bundledCalculator.outputFiles[0].text).toString("base64")}`);
const { craftSkillupAmountDistribution } = await loadUtility("craftingSkillup");
const recipes = JSON.parse(readFileSync(new URL("../src/data/recipes.json", import.meta.url), "utf8"));

const simpleRecipe = {
  id: 1,
  craft: "Woodworking",
  lvl: 1,
  crystal: "Wind",
  ing: [{ n: "Lumber", q: 2 }],
  res: { n: "Test Item", q: 1 },
  hq: [],
};

test("one-step expected materials use break chance, break loss, and skill-up rolls", () => {
  const result = estimateCraftMaterials(simpleRecipe, 0, 1);
  const skillupProbability = 0.9 * 0.6 + 0.1 * 0.3;
  const attempts = 1 / skillupProbability;
  const ingredientUsePerAttempt = 0.9 + 0.1 * 0.55;

  assert.equal(result.reachable, true);
  assert.ok(Math.abs(result.craftAttempts - attempts) < 1e-10);
  assert.ok(Math.abs(result.materials.find((item) => item.name === "Wind Crystal").quantity - attempts) < 1e-10);
  assert.ok(Math.abs(result.materials.find((item) => item.name === "Lumber").quantity - attempts * 2 * ingredientUsePerAttempt) < 1e-10);
  assert.equal(result.breakRateAtStart, 10);
});

test("support lowers expected break losses while progression recalculates near cap", () => {
  const base = estimateCraftMaterials({ ...simpleRecipe, lvl: 10 }, 80, 100, 0);
  const supported = estimateCraftMaterials({ ...simpleRecipe, lvl: 10 }, 80, 100, 3);
  const baseIngredients = base.materials.find((item) => item.name === "Lumber").quantity;
  const supportedIngredients = supported.materials.find((item) => item.name === "Lumber").quantity;

  assert.ok(supported.breakRateAtStart < base.breakRateAtStart);
  assert.ok(supportedIngredients < baseIngredients);
  assert.ok(base.craftAttempts > 0);
  assert.ok(baseIngredients < base.craftAttempts * 2, "breaks consume less than a full ingredient set on average");
});

test("multi-level Fly Lure estimate remains within a plausible attempt range", () => {
  const flyLure = recipes.find((recipe) => recipe.craft === "Clothcraft" && recipe.res.n === "Fly Lure" && recipe.d !== 1);
  assert.ok(flyLure);

  const result = estimateCraftMaterials(flyLure, 220, 300, 3);

  assert.equal(result.reachable, true);
  assert.ok(result.craftAttempts > 80, "each attempt can gain at most 0.2 skill in this range");
  assert.ok(result.craftAttempts < 500, `expected a plausible count, got ${result.craftAttempts}`);
  assert.ok(result.materials.every((item) => Number.isFinite(item.quantity) && item.quantity < 500));
});

test("skill-up amount distribution is normalized and varies with the remaining level gap", () => {
  assert.equal(craftSkillupAmountDistribution(600, 14).join(","), "1,0,0,0,0");
  assert.equal(craftSkillupAmountDistribution(0, 1).reduce((sum, weight) => sum + weight, 0), 1);
});

test("craft-desynth loop includes desynth attempts and their crystal without inventing recovery", () => {
  const crafted = recipes.find((recipe) => recipe.res.n === "Mythic Pole" && recipe.d !== 1);
  const desynth = recipes.find((recipe) => recipe.d === 1 && recipe.ing[0]?.n === "Mythic Pole");
  assert.ok(crafted);
  assert.ok(desynth);

  const result = estimateCraftMaterials(crafted, 880, 890, 0, desynth);
  assert.equal(result.reachable, true);
  assert.ok(result.desynthAttempts > 0);
  assert.equal(result.materials.find((item) => item.name === "Wind Crystal")?.quantity > 0, true);
  assert.equal(result.materials.find((item) => item.name === "Lightning Crystal")?.quantity > 0, true);
  assert.equal(result.materials.some((item) => item.name === "Mythic Pole"), false, "the crafted item is an intermediate, not a purchased input");
  const lumber = result.materials.find((item) => item.name === "Piece of Ancient Lumber").quantity;
  assert.ok(lumber > result.craftAttempts && lumber < result.craftAttempts * 2);
});

test("targets above the recipe cap and uncraftable starting skills are unreachable", () => {
  assert.equal(estimateCraftMaterials(simpleRecipe, 0, 20).reachable, false);
  assert.equal(estimateCraftMaterials(simpleRecipe, 0, 1).reachable, true);
  assert.equal(estimateCraftMaterials({ ...simpleRecipe, lvl: 20 }, 40, 50).reachable, false);
});
