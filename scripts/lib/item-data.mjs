export function normalizeName(name) {
  const normalized = name.toLowerCase().replace(/['’.]/g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim().replace(/^[a-z]+ of (?!the )/, "");
  return ({ "scarlet linen cloth": "scarlet linen", "smooth velvet cloth": "smooth velvet" })[normalized] ?? normalized;
}

export function displayName(name) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\b(Of|The|And)\b/g, (word) => word.toLowerCase());
}

export function parseSql(sql, table) {
  const variables = new Map([...sql.matchAll(/^SET\s+(@\w+)\s*=\s*(0x[\da-f]+|\d+)\s*;/gim)].map((match) => [match[1], Number(match[2])]));
  const schema = sql.match(new RegExp('CREATE TABLE (?:IF NOT EXISTS )?`' + table + '` \\(([\\s\\S]*?)\\n\\)'));
  if (!schema) throw new Error(`Missing schema: ${table}`);
  const columns = [...schema[1].matchAll(/^\s*`([^`]+)`/gm)].map((match) => match[1]);
  const binaryColumns = new Map([...schema[1].matchAll(/^\s*`([^`]+)`\s+binary\((\d+)\)/gm)].map((match) => [match[1], Number(match[2])]));
  const rows = [];
  for (const match of sql.matchAll(new RegExp('^INSERT INTO `' + table + '` VALUES \\((.*)\\);', 'gm'))) {
    const fields = [];
    let current = "";
    let quoted = false;
    let wasQuoted = false;
    const push = () => {
      const value = current.trim();
      const number = (token) => variables.has(token.trim()) ? variables.get(token.trim()) : Number(token.trim());
      const binaryLength = binaryColumns.get(columns[fields.length]);
      if (binaryLength && !new RegExp(`^0x[\\da-f]{${binaryLength * 2}}$`, "i").test(value)) throw new Error(`Invalid binary value in ${table}: ${value}`);
      fields.push(binaryLength ? value.slice(2).toLowerCase() : wasQuoted ? current : value === "NULL" ? null : value.includes("|") ? value.split("|").reduce((total, token) => Number.isFinite(total) && Number.isFinite(number(token)) ? total | number(token) : NaN, 0) : number(value));
      current = "";
      wasQuoted = false;
    };
    for (let offset = 0; offset < match[1].length; offset++) {
      const character = match[1][offset];
      if (quoted && character === "\\") current += match[1][++offset];
      else if (character === "'") {
        if (quoted && match[1][offset + 1] === "'") { current += "'"; offset++; }
        else { quoted = !quoted; wasQuoted = true; }
      } else if (!quoted && character === ",") push();
      else current += character;
    }
    push();
    if (quoted || fields.length !== columns.length || fields.some((field) => typeof field === "number" && !Number.isFinite(field))) throw new Error(`Unsupported SQL row in ${table}: ${match[1].slice(0, 100)}`);
    rows.push(Object.fromEntries(columns.map((column, index) => [column, fields[index]])));
  }
  if (!rows.length) throw new Error(`No rows: ${table}`);
  return rows;
}