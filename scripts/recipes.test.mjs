import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (content) => createHash("sha256").update(content).digest("hex");
test("recipe check does not write; generation reproduces snapshots with provenance", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "kupo-recipes-"));
  const output = path.join(directory, "recipes.json");
  const bundled = path.join(root, "src/data/recipes.json");
  const before = readFileSync(bundled);
  const run = (...args) => execFileSync(process.execPath, ["scripts/convert-recipes.cjs", "--output", output, ...args], { cwd: root, encoding: "utf8" });
  try {
    assert.match(run("--check"), /Checked \d+ recipes; no files changed/);
    assert.equal(existsSync(output), false);
    assert.equal(existsSync(path.join(directory, "recipes.source.json")), false);
    run();
    const generated = readFileSync(output);
    const recipes = JSON.parse(generated);
    assert.ok(recipes.length > 0);
    const socks = recipes.find((recipe) => recipe.id === 60510);
    assert.equal(socks.d, 1);
    assert.equal(socks.ing[0].n, "Gigas Socks");
    assert.equal(socks.res.n, "Pinch of Poison Dust", "desynth labels describe the input, not the recovered result");
    assert.deepEqual([socks.res, ...socks.hq].map((item) => item.q), [2, 4, 6, 8]);
    assert.ok(recipes.filter((recipe) => recipe.d === 1).every((recipe) => [recipe.res, ...recipe.hq].every((item) => !item.n.includes("(desynth)"))));
    assert.equal(new Set(recipes.map((recipe) => recipe.id)).size, recipes.length);
    run();
    assert.deepEqual(readFileSync(output), generated);
    const source = JSON.parse(readFileSync(path.join(directory, "recipes.source.json"), "utf8"));
    assert.equal(source.outputSha256, hash(generated));
    assert.equal(source.revision, null);
    assert.equal(source.generatorSha256, hash(readFileSync(path.join(root, "scripts/convert-recipes.cjs"))));
    for (const filename of ["item_basic.sql", "synth_recipes.sql"]) {
      assert.equal(source.inputSha256[filename], hash(readFileSync(path.join(root, "scripts/lsb-data", filename), "utf8").replace(/\r\n/g, "\n")));
    }
    assert.deepEqual(readFileSync(bundled), before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});