import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const bundle = buildSync({
  entryPoints: ["src/utils/moghancements.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  AURA_TIERS,
  ELEMENTS,
  FURNITURE,
  MAX_FURNITURE_STORAGE,
  MOGHANCEMENTS,
  auraTier,
  calculateFurniturePlan,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("pinned furnishing catalog includes complete storage, aura, and effect data", () => {
  const source = JSON.parse(readFileSync("src/data/moghancements.json", "utf8"));
  assert.equal(MAX_FURNITURE_STORAGE, 80);
  assert.equal(source.source.repository, "https://github.com/LandSandBoat/server");
  assert.equal(source.source.revision, "3e73b0bd38626df86481547133332f0c1e59dc1d");
  assert.equal(FURNITURE.length, 495);
  assert.equal(new Set(FURNITURE.map(item => item.id)).size, FURNITURE.length);
  assert.ok(FURNITURE.every(item => ELEMENTS.some(element => element.id === item.elementId)));
  assert.ok(FURNITURE.every(item => Number.isInteger(item.storage) && item.storage >= 0 && item.aura >= 0));
  assert.ok(MOGHANCEMENTS.some(effect => effect.id === 512 && effect.label === "Moghancement: Fire"));
  assert.ok(MOGHANCEMENTS.some(effect => effect.id === 547 && effect.label === "Moglification: Goldsmithing"));
  assert.ok(MOGHANCEMENTS.some(effect => effect.id === 556 && effect.label === "Mega Moglification: Goldsmithing"));
});

test("furniture joins to listed craft recipes and HQ results", () => {
  const table = FURNITURE.find(item => item.name === "Blue Round Table");
  assert.ok(table);
  const recipe = table.recipes.find(item => item.craft === "Woodworking");
  assert.ok(recipe);
  assert.ok(["NQ", "HQ"].includes(recipe.quality));
  assert.ok(recipe.ingredients.length > 0);
  assert.ok(recipe.ingredients.every(item => item.name && item.quantity > 0));
  assert.ok(FURNITURE.some(item => item.recipes.some(item => item.quality === "HQ")));
});

test("aura bands use the documented point thresholds", () => {
  assert.deepEqual(AURA_TIERS.map(tier => [tier.minimum, tier.label]), [
    [1, "Faint"],
    [51, "Powerful"],
    [101, "Overwhelming"],
  ]);
  assert.deepEqual([0, 1, 50, 51, 100, 101].map(auraTier), [
    "None", "Faint", "Faint", "Powerful", "Powerful", "Overwhelming",
  ]);
});

test("suggested setup selects the requested effect and reaches its aura target", () => {
  const fire = MOGHANCEMENTS.find(effect => effect.id === 512);
  assert.ok(fire);
  const plan = calculateFurniturePlan(fire, 1, 1, 10);
  assert.ok(plan);
  assert.equal(plan.targetReached, true);
  assert.equal(plan.storageTargetReached, true);
  assert.equal(plan.storageTarget, MAX_FURNITURE_STORAGE);
  assert.equal(plan.pieces[0].furniture.moghancementId, fire.id);
  assert.ok(plan.totalAura > plan.otherElementAura);
  assert.equal(plan.totalAura, plan.pieces
    .filter(piece => piece.furniture.elementId === 1)
    .reduce((total, piece) => total + piece.furniture.aura, 0));
  assert.equal(plan.totalStorage, plan.pieces.reduce((total, piece) => total + piece.furniture.storage, 0));
  assert.equal(plan.effectiveStorage, MAX_FURNITURE_STORAGE);
  assert.ok(plan.totalStorage >= MAX_FURNITURE_STORAGE);
  assert.equal(plan.effectiveStorage, Math.min(plan.totalStorage, MAX_FURNITURE_STORAGE));
});

test("storage planner reports the best attainable total under a restrictive furniture limit", () => {
  const fire = MOGHANCEMENTS.find(effect => effect.id === 512);
  assert.ok(fire);
  const plan = calculateFurniturePlan(fire, 1, 1, 1);
  assert.ok(plan);
  assert.equal(plan.targetReached, true);
  assert.equal(plan.storageTargetReached, false);
  assert.equal(plan.effectiveStorage, plan.totalStorage);
  assert.equal(calculateFurniturePlan(fire, 1, 1, 10, MAX_FURNITURE_STORAGE + 1), null);
  const smallerTarget = calculateFurniturePlan(fire, 1, 1, 10, 40);
  assert.ok(smallerTarget);
  assert.equal(smallerTarget.storageTarget, 40);
  assert.equal(smallerTarget.storageTargetReached, true);
});

test("craft Moglification plan includes the matching signboard and stall", () => {
  const effect = MOGHANCEMENTS.find(item => item.enumName === "MOGLIFICATION_GOLDSMITHING");
  assert.ok(effect?.pairedBaseId && effect.pairedMegaId);
  const signboard = FURNITURE.find(item => item.moghancementId === effect.pairedBaseId && /signboard/i.test(item.name));
  const stall = FURNITURE.find(item => item.moghancementId === effect.pairedMegaId && /stall/i.test(item.name));
  assert.ok(signboard);
  assert.ok(stall);
  const plan = calculateFurniturePlan(effect, signboard.elementId, 1, 10);
  assert.ok(plan);
  assert.ok(plan.pieces.some(piece => piece.furniture.id === signboard.id));
  assert.ok(plan.pieces.some(piece => piece.furniture.id === stall.id));
});

test("main navigation registers and renders the Mog House tab", () => {
  const shell = readFileSync("src/AppShell.tsx", "utf8");
  assert.match(shell, /id: "moghancement", label: "Moghancement"/);
  assert.match(shell, /activeTab === "moghancement"[\s\S]*?<MoghancementTab \/>/);
});
