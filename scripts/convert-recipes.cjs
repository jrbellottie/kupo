// Converts LSB sql/synth_recipes.sql + sql/item_basic.sql into src/data/recipes.json.
// Only active (non-commented) recipes tagged for the ToAU era (base/RotZ/CoP/ToAU) plus WotG are kept.
// Usage: node scripts/convert-recipes.cjs
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createHash } = require("crypto");

const DATA_DIR = path.join(__dirname, "lsb-data");
const BUNDLED_FILE = path.join(__dirname, "..", "src", "data", "recipes.json");
const outputArg = process.argv.indexOf("--output");
if (outputArg >= 0 && !process.argv[outputArg + 1]) throw new Error("--output requires a file path");
const OUT_FILE = outputArg >= 0 ? path.resolve(process.argv[outputArg + 1]) : BUNDLED_FILE;
if (!OUT_FILE.endsWith(".json")) throw new Error("Recipe output must end in .json");
const CHECK_ONLY = process.argv.includes("--check");
const sourceArg = process.argv.indexOf("--lsb");
if (sourceArg >= 0 && !process.argv[sourceArg + 1]) throw new Error("--lsb requires a checkout path");
const server = sourceArg >= 0 ? path.resolve(process.argv[sourceArg + 1]) : null;
const revisionArg = process.argv.indexOf("--revision");
if (revisionArg >= 0 && (!server || !process.argv[revisionArg + 1])) throw new Error("--revision requires --lsb and a Git revision");
const revision = revisionArg >= 0 ? execFileSync("git", ["-C", server, "rev-parse", "--verify", `${process.argv[revisionArg + 1]}^{commit}`], { encoding: "utf8" }).trim() : null;
const inputHashes = {};
const hash = (content) => createHash("sha256").update(content).digest("hex");
const readSql = (name) => {
  const workingFile = server ? path.join(server, "sql", name) : path.join(DATA_DIR, name);
  if (!server && !fs.existsSync(workingFile)) throw new Error(`Missing SQL snapshot: ${workingFile}`);
  const content = revision
    ? execFileSync("git", ["-C", server, "show", `${revision}:sql/${name}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    : fs.existsSync(workingFile)
    ? fs.readFileSync(workingFile, "utf8")
    : execFileSync("git", ["-C", server, "show", `HEAD:sql/${name}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  inputHashes[name] = hash(content.replace(/\r\n/g, "\n"));
  return content;
};

const ERA_MAP = {
  "": "",
  ROTZ: "RotZ",
  COP: "CoP",
  TOAU: "ToAU",
  WOTG: "WotG",
};

const CRAFT_COLUMNS = [
  ["Wood", "Woodworking"],
  ["Smith", "Smithing"],
  ["Gold", "Goldsmithing"],
  ["Cloth", "Clothcraft"],
  ["Leather", "Leathercraft"],
  ["Bone", "Bonecraft"],
  ["Alchemy", "Alchemy"],
  ["Cook", "Cooking"],
];

const CRYSTALS = {
  4096: "Fire",
  4097: "Ice",
  4098: "Wind",
  4099: "Earth",
  4100: "Lightning",
  4101: "Water",
  4102: "Light",
  4103: "Dark",
};

const SMALL_WORDS = new Set(["of", "the", "and", "de", "du", "la", "le"]);

function prettifyItemName(snake) {
  return snake
    .split("_")
    .map((word, i) => {
      if (i > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

// Splits a SQL VALUES(...) tuple body into fields, respecting quoted strings.
function splitSqlTuple(body) {
  const fields = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === "\\" && i + 1 < body.length) {
        current += body[i + 1];
        i++;
      } else if (ch === "'") {
        if (body[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inString = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === "'") {
      inString = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function loadItemNames() {
  const sql = readSql("item_basic.sql");
  const names = new Map();
  const re = /^INSERT INTO `item_basic` VALUES \((\d+),\d+,'([^']*)'/gm;
  let m;
  while ((m = re.exec(sql)) !== null) {
    names.set(Number(m[1]), prettifyItemName(m[2]));
  }
  return names;
}

function main() {
  const itemNames = loadItemNames();
  const sql = readSql("synth_recipes.sql");

  const itemName = (id) => itemNames.get(id) || `Item #${id}`;
  const recipes = [];
  // Rows may carry a trailing "-- source note" comment after the closing );
  const re = /^INSERT INTO `synth_recipes` VALUES \((.*)\);(?:\s*--.*)?$/gm;
  let m;
  let skippedEra = 0;

  while ((m = re.exec(sql)) !== null) {
    const f = splitSqlTuple(m[1]);
    if (f.length !== 31) throw new Error(`Unexpected recipe schema: ${f.length} fields`);

    const tagRaw = f[30] === "NULL" ? "" : f[30];
    if (!(tagRaw in ERA_MAP)) {
      skippedEra++;
      continue;
    }

    const num = (idx) => Number(f[idx]);
    const skills = {};
    CRAFT_COLUMNS.forEach(([, craftName], i) => {
      const value = num(3 + i);
      if (value > 0) skills[craftName] = value;
    });
    if (Object.keys(skills).length === 0) continue;

    let mainCraft = "";
    let mainLvl = -1;
    for (const [craftName, lvl] of Object.entries(skills)) {
      if (lvl > mainLvl) {
        mainCraft = craftName;
        mainLvl = lvl;
      }
    }
    const subs = Object.entries(skills)
      .filter(([craftName]) => craftName !== mainCraft)
      .map(([craftName, lvl]) => ({ c: craftName, l: lvl }));

    // Combine duplicate ingredient ids into quantities.
    const ingredientCounts = new Map();
    for (let i = 13; i <= 20; i++) {
      const id = num(i);
      if (id > 0) ingredientCounts.set(id, (ingredientCounts.get(id) || 0) + 1);
    }
    const ing = [...ingredientCounts.entries()].map(([id, q]) => ({ n: itemName(id), q }));

    const resultId = num(21);
    const hqIds = [num(22), num(23), num(24)];
    const resultQty = num(25);
    const hqQtys = [num(26), num(27), num(28)];
    const resultName = num(1) === 1 ? itemName(resultId) : f[29] || itemName(resultId);

    const recipe = {
      id: num(0),
      craft: mainCraft,
      lvl: mainLvl,
      crystal: CRYSTALS[num(11)] || `#${num(11)}`,
      era: ERA_MAP[tagRaw],
      ing,
      res: { n: resultName, q: resultQty },
      hq: hqIds.map((id, i) => ({ n: id === resultId ? resultName : itemName(id), q: hqQtys[i] })),
    };
    if (subs.length > 0) recipe.subs = subs;
    if (num(1) > 0) recipe.d = num(1); // 1 = desynth, 2 = no material loss on fail
    if (num(2) > 0) recipe.ki = true; // requires a key item

    recipes.push(recipe);
  }

  recipes.sort((a, b) => a.craft.localeCompare(b.craft) || a.lvl - b.lvl || a.res.n.localeCompare(b.res.n));

  if (!recipes.length) throw new Error("No recipes parsed; refusing to replace data");
  const unresolved = recipes.flatMap((recipe) => [recipe.res, ...recipe.hq, ...recipe.ing]).filter((item) => /^Item #\d+$/.test(item.n));
  if (unresolved.length) throw new Error(`Unresolved item names: ${[...new Set(unresolved.map((item) => item.n))].join(", ")}`);
  const existing = JSON.parse(fs.readFileSync(BUNDLED_FILE, "utf8"));
  const previous = new Map(existing.map((recipe) => [recipe.id, recipe]));
  const next = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const added = recipes.filter((recipe) => !previous.has(recipe.id));
  const removed = existing.filter((recipe) => !next.has(recipe.id));
  const changed = recipes.filter((recipe) => previous.has(recipe.id) && JSON.stringify(previous.get(recipe.id)) !== JSON.stringify(recipe));
  console.log(`Recipe diff: ${added.length} added, ${removed.length} removed, ${changed.length} changed`);
  for (const [kind, rows] of [["Added", added], ["Removed", removed], ["Changed", changed]]) {
    for (const recipe of rows.slice(0, 20)) {
      const before = previous.get(recipe.id);
      const fields = kind === "Changed" ? [...new Set([...Object.keys(before), ...Object.keys(recipe)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(recipe[key])) : [];
      console.log(`  ${kind}: ${recipe.id} ${recipe.res.n} (${recipe.era || "base"})${fields.length ? ` [${fields.join(", ")}]` : ""}`);
    }
    if (rows.length > 20) console.log(`  ... ${rows.length - 20} more ${kind.toLowerCase()}`);
  }
  if (!CHECK_ONLY) {
    const output = JSON.stringify(recipes);
    const provenance = {
      schemaVersion: 1,
      source: server ? "server checkout" : "saved SQL snapshots (revision unknown)",
      revision: revision ?? (server ? execFileSync("git", ["-C", server, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() : null),
      inputSha256: inputHashes,
      generatorSha256: hash(fs.readFileSync(__filename)),
      outputSha256: hash(output),
    };
    fs.writeFileSync(OUT_FILE, output);
    fs.writeFileSync(OUT_FILE.replace(/\.json$/, ".source.json"), JSON.stringify(provenance, null, 2) + "\n");
  }
  const byEra = {};
  for (const r of recipes) byEra[r.era || "base"] = (byEra[r.era || "base"] || 0) + 1;
  console.log(CHECK_ONLY ? `Checked ${recipes.length} recipes; no files changed` : `Wrote ${recipes.length} recipes to ${OUT_FILE}`);
  console.log(`Skipped ${skippedEra} recipes from later expansions`);
  console.log("By era:", byEra);
}

main();
