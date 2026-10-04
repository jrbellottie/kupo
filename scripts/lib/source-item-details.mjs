import { DatabaseSync } from "node:sqlite";
import { parseSql } from "./item-data.mjs";
import { evaluateLuaData } from "./lua-data.mjs";

export function generateSourceItemDetails({ source, files, spellFiles, catalog }) {
  const tables = ["item_equipment", "item_usable", "item_puppet", "spell_list"];
  const basic = parseSql(source("sql/item_basic.sql"), "item_basic");
  const db = new DatabaseSync(":memory:");
  try {
    for (const table of tables) {
      const rows = parseSql(source(`sql/${table}.sql`), table);
      const columns = Object.keys(rows[0]);
      db.exec(`CREATE TABLE "${table}" (${columns.map(column => `"${column}" ${typeof rows[0][column] === "number" ? "REAL" : "TEXT COLLATE NOCASE"}`).join(",")})`);
      const insert = db.prepare(`INSERT INTO "${table}" VALUES (${columns.map(() => "?").join(",")})`);
      db.exec("BEGIN");
      for (const row of rows) insert.run(...columns.map(column => row[column]));
      db.exec("COMMIT");
    }
    const enabled = source("modules/init.txt").split(/\r?\n/).map(line => line.replace(/#.*/, "").trim().replace(/\/$/, "")).filter(Boolean);
    const sqlOrder = [];
    for (const module of enabled) {
      const prefix = `modules/${module}`;
      for (const file of files.filter(file => file.endsWith(".sql") && (file === prefix || file.startsWith(`${prefix}/`))).sort()) {
        const text = source(file).replace(/--[^\n]*/g, "");
        const statements = text.split(";").map(statement => statement.trim()).filter(Boolean);
        let applied = false;
        for (const statement of statements) {
          const target = statement.match(/^(?:UPDATE|INSERT INTO|REPLACE INTO|DELETE FROM)\s+`?(\w+)`?\s/i)?.[1];
          if (!tables.includes(target)) continue;
          if (!/^UPDATE\s/i.test(statement)) throw new Error(`Unsupported metadata patch in ${file}: ${statement}`);
          // The source uses MySQL hex literals for binary job levels, not integer masks.
          db.exec(statement.replace(/0x([\da-f]{44})\b/gi, (_, hex) => `'${hex.toLowerCase()}'`).replace(/"([^"]*)"/g, "'$1'"));
          applied = true;
        }
        if (applied) sqlOrder.push(file);
      }
    }
    const items = {};
    const set = (id, field, value) => {
      if (!catalog.items[id]) return;
      (items[id] ??= {})[field] = value;
    };
    for (const row of db.prepare("SELECT * FROM item_equipment ORDER BY itemId").all()) {
      const equipment = { level: row.level, itemLevel: row.ilevel, jobs: row.jobs, slots: row.slot, shieldSize: row.shieldSize };
      if (catalog.items[row.itemId] && JSON.stringify(equipment) !== JSON.stringify(catalog.items[row.itemId].equipment)) set(row.itemId, "equipment", equipment);
    }
    for (const row of db.prepare("SELECT * FROM item_usable ORDER BY itemid").all()) {
      if (catalog.items[row.itemid] && JSON.stringify(row) !== JSON.stringify(catalog.items[row.itemid].usable)) set(row.itemid, "usable", { ...row });
    }
    const puppets = new Map(db.prepare("SELECT * FROM item_puppet ORDER BY itemid").all().map(row => [row.itemid, row]));
    for (const item of basic) {
      const puppet = puppets.get(item.subid);
      if (puppet) set(item.itemid, "puppet", { slot: puppet.slot, element: puppet.element });
    }
    const magic = source("scripts/enum/magic.lua");
    const spellEnum = magic.match(/xi\.magic\.spell\s*=\s*\{([\s\S]*?)\n\}/)?.[1];
    if (!spellEnum) throw new Error("Missing spell enum");
    const spellIds = Object.fromEntries([...spellEnum.matchAll(/^\s*(\w+)\s*=\s*(\d+),/gm)].map(match => [match[1], Number(match[2])]));
    const itemIds = new Map(basic.map(row => [row.name, row.itemid]));
    const spells = new Map(db.prepare("SELECT * FROM spell_list").all().map(row => [row.spellid, row]));
    for (const file of spellFiles.sort()) {
      const id = itemIds.get(file.replace(/^scripts\/items\//, "").replace(/\.lua$/, ""));
      if (!catalog.items[id]) continue;
      const text = source(file);
      const names = [...text.matchAll(/target:addSpell\(xi\.magic\.spell\.(\w+)\)/g)].map(match => match[1]);
      if (names.length !== 1) throw new Error(`Unsupported scroll spell mapping: ${file}`);
      const spellId = spellIds[names[0]];
      if (!spellId) throw new Error(`Unknown spell enum: ${file}`);
      const spell = spells.get(spellId);
      if (!spell) {
        set(id, "spell", { id: spellId, available: false });
        continue;
      }
      if (!/^[\da-f]{44}$/.test(spell.jobs)) throw new Error(`Invalid spell metadata: ${file}`);
      set(id, "spell", {
        id: spell.spellid, available: true,
        jobs: Array.from({ length: 22 }, (_, index) => Number.parseInt(spell.jobs.slice(index * 2, index * 2 + 2), 16)),
        mpCost: spell.mpCost, castTime: spell.castTime, recastTime: spell.recastTime,
      });
    }
    const effects = evaluateLuaData([
      `effects={}; xi={effect={DEDICATION=1},itemUtils={addItemExpEffect=function(target,effect,power,duration,cap)
        assert(effect==xi.effect.DEDICATION); effects[target]={bonus=power,duration=duration,cap=cap}
      end}}; Module={new=function() return {addOverride=function(self,name,callback)
        local item=assert(name:match("^xi%.items%.(.-)%.onItemUse$")); callback(item)
      end} end}`,
      source("modules/phoenix/lua/items/era_items.lua"),
    ], "effects");
    if (!enabled.includes("phoenix/lua")) throw new Error("Item effect module not enabled");
    for (const [name, effect] of Object.entries(effects)) {
      const id = itemIds.get(name);
      if (!id || !Object.values(effect).every(value => Number.isFinite(value) && value > 0)) throw new Error(`Invalid item EXP effect: ${name}`);
      set(id, "expEffect", effect);
    }
    return { items, sqlOrder };
  } finally {
    db.close();
  }
}
