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
  evaluateFurnitureSetup,
  furnitureQuantityOptionsMaximum,
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
  const plan = calculateFurniturePlan(fire, 1, 1);
  assert.ok(plan);
  assert.equal(plan.targetReached, true);
  assert.equal(plan.storageTargetReached, true);
  assert.equal(plan.storageTarget, MAX_FURNITURE_STORAGE);
  assert.equal(plan.pieces[0].furniture.moghancementId, fire.id);
  assert.ok(plan.totalAura > plan.otherElementAura);
  assert.equal(plan.totalAura, plan.pieces
    .filter(piece => piece.furniture.elementId === 1)
    .reduce((total, piece) => total + piece.furniture.aura * piece.quantity, 0));
  assert.equal(plan.totalStorage, plan.pieces.reduce((total, piece) => total + piece.furniture.storage * piece.quantity, 0));
  assert.equal(plan.totalPieces, plan.pieces.reduce((total, piece) => total + piece.quantity, 0));
  assert.equal(plan.effectiveStorage, MAX_FURNITURE_STORAGE);
  assert.ok(plan.totalStorage >= MAX_FURNITURE_STORAGE);
  assert.equal(plan.effectiveStorage, Math.min(plan.totalStorage, MAX_FURNITURE_STORAGE));
});

test("storage planner meets requested storage without an artificial furniture-count limit", () => {
  const fire = MOGHANCEMENTS.find(effect => effect.id === 512);
  assert.ok(fire);
  const plan = calculateFurniturePlan(fire, 1, 1);
  assert.ok(plan);
  assert.equal(plan.targetReached, true);
  assert.equal(plan.storageTargetReached, true);
  assert.ok(plan.totalPieces > 1);
  assert.equal(calculateFurniturePlan(fire, 1, 1, MAX_FURNITURE_STORAGE + 1), null);
  const smallerTarget = calculateFurniturePlan(fire, 1, 1, 40);
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
  const plan = calculateFurniturePlan(effect, signboard.elementId, 1);
  assert.ok(plan);
  assert.ok(plan.pieces.some(piece => piece.furniture.id === signboard.id));
  assert.ok(plan.pieces.some(piece => piece.furniture.id === stall.id));
  assert.equal(plan.effectPresent, true);
  const withoutStall = evaluateFurnitureSetup(
    plan.pieces.filter(piece => piece.furniture.id !== stall.id), effect, signboard.elementId, 1,
  );
  assert.equal(withoutStall.effectPresent, false);
  assert.equal(withoutStall.targetReached, false);
});

const fire = MOGHANCEMENTS.find(effect => effect.id === 512);
const sourceFurniture = { ...FURNITURE[0], id: -1, name: "Test source", rare: false, moghancementId: 512, elementId: 1, aura: 10, storage: 1 };
const auraFurniture = { ...sourceFurniture, id: -2, name: "Test aura support", moghancementId: 0, aura: 5 };
const storageFurniture = { ...sourceFurniture, id: -3, name: "Test storage", moghancementId: 0, elementId: 2, aura: 2, storage: 80 };

test("custom quantities combine repeated aura support, one storage item, and one effect source", () => {
  const pieces = [
    { furniture: sourceFurniture, quantity: 1 },
    { furniture: auraFurniture, quantity: 19 },
    { furniture: storageFurniture, quantity: 1 },
  ];
  const plan = evaluateFurnitureSetup(pieces, fire, 1, 101);
  assert.equal(plan.totalAura, 105);
  assert.equal(plan.otherElementAura, 2);
  assert.equal(plan.totalStorage, 100);
  assert.equal(plan.effectiveStorage, 80);
  assert.equal(plan.totalPieces, 21);
  assert.equal(plan.targetReached, true);
  assert.equal(plan.storageTargetReached, true);
  const fewer = evaluateFurnitureSetup(pieces.map(piece => piece.furniture.id === -2 ? { ...piece, quantity: 18 } : piece), fire, 1, 101);
  assert.equal(fewer.totalAura, 100);
  assert.equal(fewer.targetReached, false);
  assert.equal(plan.pieces[1].quantity, 19, "Evaluation does not mutate the selection");
});

test("quantity totals honor the exact aura thresholds and storage cap", () => {
  for (const [aura, target, reached] of [[50, 51, false], [51, 51, true], [100, 101, false], [101, 101, true]]) {
    const plan = evaluateFurnitureSetup([{ furniture: { ...sourceFurniture, aura: 1 }, quantity: aura }], fire, 1, target);
    assert.equal(plan.totalAura, aura);
    assert.equal(plan.targetReached, reached);
    assert.equal(plan.effectiveStorage, Math.min(aura, 80));
    assert.equal(plan.storageTargetReached, aura >= 80);
  }
});

test("removing furniture updates storage and effect validity, including an empty setup", () => {
  const withoutSource = evaluateFurnitureSetup([
    { furniture: auraFurniture, quantity: 21 },
    { furniture: storageFurniture, quantity: 1 },
  ], fire, 1, 101);
  assert.equal(withoutSource.totalAura, 105);
  assert.equal(withoutSource.effectPresent, false);
  assert.equal(withoutSource.targetReached, false);
  const withoutStorage = evaluateFurnitureSetup([{ furniture: sourceFurniture, quantity: 11 }], fire, 1, 101);
  assert.equal(withoutStorage.targetReached, true);
  assert.equal(withoutStorage.storageTargetReached, false);
  const empty = evaluateFurnitureSetup([], fire, 1, 1);
  assert.equal(empty.totalPieces, 0);
  assert.equal(empty.totalAura, 0);
  assert.equal(empty.totalStorage, 0);
  assert.equal(empty.targetReached, false);
  assert.equal(empty.storageTargetReached, false);
});

test("repeated furnishings must retain elemental dominance and individual effect priority", () => {
  for (const quantity of [5, 6]) {
    const plan = evaluateFurnitureSetup([
      { furniture: sourceFurniture, quantity: 1 },
      { furniture: storageFurniture, quantity },
    ], fire, 1, 1);
    assert.equal(plan.elementDominant, false, "A tied or stronger other element invalidates the target");
    assert.equal(plan.targetReached, false);
  }
  for (const aura of [10, 11]) {
    const plan = evaluateFurnitureSetup([
      { furniture: sourceFurniture, quantity: 20 },
      { furniture: { ...auraFurniture, aura, moghancementId: 513 }, quantity: 1 },
    ], fire, 1, 101);
    assert.equal(plan.effectPresent, true);
    assert.equal(plan.elementDominant, true);
    assert.equal(plan.effectDominant, false, "Source quantity cannot beat a higher or tied competing individual aura");
    assert.equal(plan.targetReached, false);
  }
  const sameEffect = evaluateFurnitureSetup([
    { furniture: sourceFurniture, quantity: 1 },
    { furniture: { ...auraFurniture, aura: 10, moghancementId: fire.id }, quantity: 1 },
  ], fire, 1, 1);
  assert.equal(sameEffect.effectDominant, true);
  const lowerPriorityTie = evaluateFurnitureSetup([
    { furniture: sourceFurniture, quantity: 1 },
    { furniture: { ...auraFurniture, aura: 10, moghancementId: 511 }, quantity: 1 },
  ], fire, 1, 1);
  assert.equal(lowerPriorityTie.effectDominant, true, "Individual aura ties favor the higher effect ID");
});

test("Rare furnishings have a one-copy limit, including the Fishermans Signboard", () => {
  const signboard = FURNITURE.find(item => item.id === 340);
  assert.ok(signboard?.rare);
  assert.equal(furnitureQuantityOptionsMaximum(signboard), 1);
  assert.equal(furnitureQuantityOptionsMaximum(sourceFurniture), 30);
  assert.equal(furnitureQuantityOptionsMaximum(sourceFurniture, 30), 40);
  assert.ok(FURNITURE.every(item => typeof item.rare === "boolean"));
  assert.throws(() => evaluateFurnitureSetup([{ furniture: signboard, quantity: 2 }], fire, 1, 1), /Only one .*Rare/);
  assert.throws(() => evaluateFurnitureSetup([
    { furniture: signboard, quantity: 1 },
    { furniture: signboard, quantity: 1 },
  ], fire, 1, 1), /Only one .*Rare/);
  const effect = MOGHANCEMENTS.find(item => item.id === signboard.moghancementId);
  const plan = calculateFurniturePlan(effect, signboard.elementId, 101);
  assert.ok(plan?.targetReached);
  assert.ok(plan.pieces.every(piece => !piece.furniture.rare || piece.quantity === 1));
  assert.ok(plan.pieces.some(piece => !piece.furniture.rare && piece.quantity > 1));
});

test("invalid custom quantities surface errors", () => {
  for (const quantity of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => evaluateFurnitureSetup([{ furniture: sourceFurniture, quantity }], fire, 1, 1), /Invalid furniture quantity/);
  }
});

test("suggestions repeat furniture as needed to reach the selected target", () => {
  const plan = calculateFurniturePlan(fire, 1, 101);
  assert.ok(plan?.targetReached);
  assert.ok(plan.pieces.some(piece => piece.quantity > 1));
  assert.equal(new Set(plan.pieces.map(piece => piece.furniture.id)).size, plan.pieces.length);
  assert.ok(plan.totalPieces > 1);
  const highAura = calculateFurniturePlan(fire, 1, 1000);
  assert.ok(highAura);
  assert.ok(highAura.totalPieces > 30);
  assert.equal(highAura.targetReached, true);
});

test("main navigation registers and renders the Mog House tab", () => {
  const shell = readFileSync("src/AppShell.tsx", "utf8");
  assert.match(shell, /id: "moghancement", label: "Moghancement"/);
  assert.match(shell, /activeTab === "moghancement"[\s\S]*?<MoghancementTab \/>/);
});
