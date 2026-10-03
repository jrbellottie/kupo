import { useDeferredValue, useMemo, useState } from "react";
import { peekNavQuery, hasBackTab, goBackTab } from "./utils/tabNav";
import bestiaryData from "./data/bestiary.json";
import "./BestiaryTab.css";
import { CollapsibleSection } from "./ScreenControls";

type Modifier = { name: string; value: number; kind: "stat" | "mob"; note: string };
type Ability = { id: number; name: string; scope: string; radius: number; distance: number; prepareTime: number; knockback: number; effect: string };
type Calculated = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
type Monster = {
  id: string;
  name: string;
  zone: string;
  era: "TOAU" | "WOTG";
  poolId: number;
  spawnCount: number;
  level: [number, number];
  jobs: [string, string];
  ecosystem: string;
  family: string;
  species: string;
  element: string;
  aggressive: boolean;
  links: boolean;
  trueDetection: boolean;
  detects: string[];
  charmable: boolean;
  nm: boolean;
  contentTag: string | null;
  respawn: number;
  spawnType: number;
  dropId: number;
  combat: { skill: number; delay: number; damageMultiplier: number };
  lists: { spells: number; skills: number };
  flags: { behavior: number; roam: number; immunity: number; mobType: number };
  size: { model: number | null; hitbox: number | null };
  ranks: Record<string, string>;
  resistance: { name: string; damage: Record<string, number>; ranks: Record<string, number> };
  modifiers: Modifier[];
  calculated: Calculated[];
};

type Data = {
  source: { revision: string; generatedAt: string; baseline: string };
  abilityLists: Record<string, Ability[]>;
  monsters: Monster[];
};

type Mode = "all" | "yes" | "no";
type Era = "TOAU" | "WOTG";
type SortKey = "name" | "zone" | "level" | "hp" | "attack" | "evasion";
const DATA = bestiaryData as unknown as Data;
const MONSTERS = DATA.monsters;
const RESULT_LIMIT = 350;
const ZONES = [...new Set(MONSTERS.map((monster) => monster.zone))].sort((a, b) => a.localeCompare(b));
const FAMILIES = [...new Set(MONSTERS.map((monster) => monster.family))].sort((a, b) => a.localeCompare(b));
const DETECTIONS = [...new Set(MONSTERS.flatMap((monster) => monster.detects))].sort();
const STAT_LABELS = ["STR", "DEX", "VIT", "AGI", "INT", "MND", "CHR"];

function matchesMode(value: boolean, mode: Mode) {
  return mode === "all" || value === (mode === "yes");
}

function levelText(level: [number, number]) {
  return level[0] === level[1] ? String(level[0]) : `${level[0]}-${level[1]}`;
}

function secondsText(seconds: number) {
  if (!seconds) return "Scripted / none";
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function flagText(value: number) {
  return `0x${value.toString(16).toUpperCase()}`;
}

function damageTaken(raw: number) {
  return (10000 + raw) / 100;
}

function resistanceClass(raw: number) {
  return raw > 0 ? "resisted" : raw < 0 ? "weak" : "neutral";
}

function ToggleFilter({ label, value, onChange }: { label: string; value: Mode; onChange: (value: Mode) => void }) {
  return (
    <div className="bestiary-field bestiary-toggle-field">
      <span>{label}</span>
      <div className="bestiary-segments">
        {(["all", "yes", "no"] as Mode[]).map((mode) => (
          <button key={mode} className={value === mode ? "active" : ""} onClick={() => onChange(mode)}>
            {mode === "all" ? "Any" : mode === "yes" ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatTile({ label, value, secondary }: { label: string; value: number | string; secondary?: string }) {
  return (
    <div className="bestiary-stat">
      <span>{label}</span>
      <strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
      {secondary ? <small>{secondary}</small> : null}
    </div>
  );
}

export default function BestiaryTab() {
  // Arriving from an Items-tab mob link pre-fills the search.
  const navQuery = peekNavQuery("bestiary");
  const [era, setEra] = useState<Era>("TOAU");
  const [query, setQuery] = useState(navQuery ?? "");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [zone, setZone] = useState("");
  const [family, setFamily] = useState("");
  const [detection, setDetection] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [maxLevel, setMaxLevel] = useState("");
  const [nmMode, setNmMode] = useState<Mode>("all");
  const [aggroMode, setAggroMode] = useState<Mode>("all");
  const [linkMode, setLinkMode] = useState<Mode>("all");
  const [trueDetectionOnly, setTrueDetectionOnly] = useState(false);
  const [weaknessOnly, setWeaknessOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [selectedId, setSelectedId] = useState("33-56");
  const [selectedLevel, setSelectedLevel] = useState<number | null>(92);

  const results = useMemo(() => {
    const minimum = minLevel === "" ? -Infinity : Number(minLevel);
    const maximum = maxLevel === "" ? Infinity : Number(maxLevel);
    const filtered = MONSTERS.filter((monster) => {
      if (era === "TOAU" && monster.era !== "TOAU") return false;
      if (zone && monster.zone !== zone) return false;
      if (family && monster.family !== family) return false;
      if (detection && !monster.detects.includes(detection)) return false;
      if (monster.level[1] < minimum || monster.level[0] > maximum) return false;
      if (!matchesMode(monster.nm, nmMode) || !matchesMode(monster.aggressive, aggroMode) || !matchesMode(monster.links, linkMode)) return false;
      if (trueDetectionOnly && !monster.trueDetection) return false;
      if (weaknessOnly && !Object.values(monster.resistance.damage).some((value) => value < 0)) return false;
      if (!deferredQuery) return true;
      const searchText = [
        monster.name, monster.zone, monster.family, monster.species, monster.ecosystem, monster.element,
        ...monster.detects, ...monster.modifiers.flatMap((modifier) => [modifier.name, modifier.note]),
        ...(DATA.abilityLists[monster.lists.skills] ?? []).flatMap((ability) => [ability.name, ability.effect]),
      ].join(" ").toLowerCase();
      return searchText.includes(deferredQuery);
    });
    return filtered.sort((left, right) => {
      if (sortKey === "level") return left.level[0] - right.level[0] || left.name.localeCompare(right.name);
      if (sortKey === "hp") return left.calculated[0][1] - right.calculated[0][1] || left.name.localeCompare(right.name);
      if (sortKey === "attack") return left.calculated[0][11] - right.calculated[0][11] || left.name.localeCompare(right.name);
      if (sortKey === "evasion") return left.calculated[0][17] - right.calculated[0][17] || left.name.localeCompare(right.name);
      return left[sortKey].localeCompare(right[sortKey]) || left.zone.localeCompare(right.zone);
    });
  }, [era, deferredQuery, zone, family, detection, minLevel, maxLevel, nmMode, aggroMode, linkMode, trueDetectionOnly, weaknessOnly, sortKey]);

  const selected = results.find((monster) => monster.id === selectedId) ?? results[0] ?? null;
  const levelRow = selected
    ? selected.calculated.find((row) => row[0] === selectedLevel) ?? selected.calculated[0]
    : null;
  const abilities = selected ? DATA.abilityLists[selected.lists.skills] ?? [] : [];
  const clearFilters = () => {
    setEra("TOAU");
    setQuery(""); setZone(""); setFamily(""); setDetection(""); setMinLevel(""); setMaxLevel("");
    setNmMode("all"); setAggroMode("all"); setLinkMode("all"); setTrueDetectionOnly(false); setWeaknessOnly(false);
  };

  return (
    <section className="bestiary">
      <header className="bestiary-header">
        <div>
          <div className="bestiary-kicker">LandSandBoat field archive</div>
          <h2>Vana&apos;diel Bestiary</h2>
        </div>
        <div className="bestiary-source" title={DATA.source.baseline}>
          <strong>{MONSTERS.length.toLocaleString()}</strong> zone-specific groups
          <span>LSB {DATA.source.revision.slice(0, 8)}</span>
        </div>
        {hasBackTab() && (
          <button className="bestiary-clear" onClick={goBackTab} title="Return to your previous search">
            ← Back
          </button>
        )}
      </header>

      <CollapsibleSection kind="search">
      <div className="bestiary-filters">
        <label className="bestiary-check">
          <input type="checkbox" checked={era === "WOTG"} onChange={(event) => { setEra(event.target.checked ? "WOTG" : "TOAU"); setZone(""); }} />
          Include WotG
        </label>
        <label className="bestiary-field bestiary-search">
          <span>Search all monster data</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, zone, family, modifier..." autoComplete="off" />
        </label>
        <label className="bestiary-field">
          <span>Zone</span>
          <select value={zone} onChange={(event) => setZone(event.target.value)}><option value="">All zones</option>{ZONES.map((value) => <option key={value}>{value}</option>)}</select>
        </label>
        <label className="bestiary-field">
          <span>Family</span>
          <select value={family} onChange={(event) => setFamily(event.target.value)}><option value="">All families</option>{FAMILIES.map((value) => <option key={value}>{titleCase(value)}</option>)}</select>
        </label>
        <label className="bestiary-field">
          <span>Detection</span>
          <select value={detection} onChange={(event) => setDetection(event.target.value)}><option value="">Any sense</option>{DETECTIONS.map((value) => <option key={value}>{titleCase(value)}</option>)}</select>
        </label>
        <div className="bestiary-filter-group">
          <label className="bestiary-field bestiary-level-field"><span>Min lvl</span><input type="number" min="0" value={minLevel} onChange={(event) => setMinLevel(event.target.value)} /></label>
          <label className="bestiary-field bestiary-level-field"><span>Max lvl</span><input type="number" min="0" value={maxLevel} onChange={(event) => setMaxLevel(event.target.value)} /></label>
        </div>
        <div className="bestiary-filter-group bestiary-mode-group">
          <ToggleFilter label="NM" value={nmMode} onChange={setNmMode} />
          <ToggleFilter label="Aggro" value={aggroMode} onChange={setAggroMode} />
          <ToggleFilter label="Links" value={linkMode} onChange={setLinkMode} />
        </div>
        <label className="bestiary-check"><input type="checkbox" checked={trueDetectionOnly} onChange={(event) => setTrueDetectionOnly(event.target.checked)} /> True detection</label>
        <label className="bestiary-check"><input type="checkbox" checked={weaknessOnly} onChange={(event) => setWeaknessOnly(event.target.checked)} /> Has damage weakness</label>
        <button className="bestiary-clear" onClick={clearFilters}>Clear filters</button>
      </div>
      </CollapsibleSection>

      <div className="bestiary-workspace">
        <aside className="bestiary-results">
          <div className="bestiary-results-toolbar">
            <span><strong>{results.length.toLocaleString()}</strong> {era} matches{results.length > RESULT_LIMIT ? ` · first ${RESULT_LIMIT}` : ""}</span>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} aria-label="Sort monsters">
              <option value="name">Name</option><option value="zone">Zone</option><option value="level">Level</option><option value="hp">HP</option><option value="attack">Attack</option><option value="evasion">Evasion</option>
            </select>
          </div>
          <div className="bestiary-result-list">
            {results.length === 0 ? <div className="bestiary-empty">No creatures match these filters.</div> : results.slice(0, RESULT_LIMIT).map((monster) => {
              const active = selected?.id === monster.id;
              return (
                <button key={monster.id} className={`bestiary-result ${active ? "active" : ""}`} onClick={() => { setSelectedId(monster.id); setSelectedLevel(monster.level[0]); }}>
                  <span className="bestiary-result-name">{monster.name}{monster.nm ? <b>NM</b> : null}</span>
                  <span className="bestiary-result-meta"><i>Lv {levelText(monster.level)}</i><i>{monster.zone}</i></span>
                  <span className="bestiary-result-tags">{monster.era} · {monster.aggressive ? "Aggro" : "Passive"} · {monster.links ? "Links" : "No links"} · {titleCase(monster.family)}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="bestiary-detail">
          {!selected || !levelRow ? <div className="bestiary-empty">Select a creature to inspect it.</div> : (
            <>
              <div className="bestiary-identity">
                <div>
                  <div className="bestiary-badges">
                    <span className="era">{selected.era} era</span>
                    {selected.nm ? <span className="danger">Notorious Monster</span> : <span>Standard monster</span>}
                    <span className={selected.aggressive ? "danger" : "calm"}>{selected.aggressive ? "Aggressive" : "Passive"}</span>
                    <span>{selected.links ? "Links" : "Does not link"}</span>
                    {selected.trueDetection ? <span className="danger">True detection</span> : null}
                  </div>
                  <h3>{selected.name}</h3>
                  <p>{selected.zone} · {titleCase(selected.ecosystem)} / {titleCase(selected.family)} / {titleCase(selected.species)}</p>
                </div>
                <label className="bestiary-level-select">
                  <span>Calculated level</span>
                  <select value={levelRow[0]} onChange={(event) => setSelectedLevel(Number(event.target.value))}>
                    {selected.calculated.map((row) => <option key={row[0]} value={row[0]}>Level {row[0]}</option>)}
                  </select>
                </label>
              </div>

              <section className="bestiary-section">
                <h4>Core attributes <small>Derived baseline</small></h4>
                <div className="bestiary-stat-grid vital">
                  <StatTile label="HP" value={levelRow[1]} /><StatTile label="MP" value={levelRow[2]} />
                  {STAT_LABELS.map((label, index) => <StatTile key={label} label={label} value={levelRow[index + 3]} secondary={`Rank ${selected.ranks[label.toLowerCase()].toUpperCase()}`} />)}
                </div>
              </section>

              <section className="bestiary-section">
                <h4>Combat ratings <small>Base modifier → total</small></h4>
                <div className="bestiary-stat-grid combat">
                  <StatTile label="Attack" value={levelRow[11]} secondary={`Base ${levelRow[10]}`} />
                  <StatTile label="Defense" value={levelRow[13]} secondary={`Base ${levelRow[12]} · Rank ${selected.ranks.def.toUpperCase()}`} />
                  <StatTile label="Accuracy" value={levelRow[15]} secondary={`Base ${levelRow[14]} · Rank ${selected.ranks.acc.toUpperCase()}`} />
                  <StatTile label="Evasion" value={levelRow[17]} secondary={`Base ${levelRow[16]}`} />
                  <StatTile label="Magic evasion" value={levelRow[18]} secondary="Natural + modifiers" />
                  <StatTile label="Damage" value={`${selected.combat.damageMultiplier}%`} secondary={`Delay ${selected.combat.delay}`} />
                </div>
              </section>

              <section className="bestiary-section bestiary-two-column">
                <div>
                  <h4>Behavior & senses</h4>
                  <dl className="bestiary-facts">
                    <div><dt>Detects</dt><dd>{selected.detects.length ? selected.detects.map(titleCase).join(", ") : "None"}</dd></div>
                    <div><dt>Linking</dt><dd>{selected.links ? "Yes" : "No"}</dd></div>
                    <div><dt>Charmable</dt><dd>{selected.charmable ? "Yes" : "No"}</dd></div>
                    <div><dt>Element</dt><dd>{titleCase(selected.element)}</dd></div>
                    <div><dt>Jobs</dt><dd>{selected.jobs.join(" / ")}</dd></div>
                    <div><dt>Respawn</dt><dd>{secondsText(selected.respawn)}</dd></div>
                  </dl>
                </div>
                <div>
                  <h4>Server references</h4>
                  <dl className="bestiary-facts">
                    <div><dt>Pool / group</dt><dd>{selected.poolId} / {selected.id}</dd></div>
                    <div><dt>Spawns</dt><dd>{selected.spawnCount}</dd></div>
                    <div><dt>Drop list</dt><dd>{selected.dropId || "None"}</dd></div>
                    <div><dt>Spell / skill list</dt><dd>{selected.lists.spells || "None"} / {selected.lists.skills || "None"}</dd></div>
                    <div><dt>Content tag</dt><dd>{selected.contentTag ?? "None"}</dd></div>
                    <div><dt>Spawn type</dt><dd>{selected.spawnType}</dd></div>
                  </dl>
                </div>
              </section>

              <section className="bestiary-section">
                <h4>Abilities <small>LSB skill list {selected.lists.skills || "none"}</small></h4>
                {abilities.length ? <div className="bestiary-abilities">{abilities.map((ability) => (
                  <div key={ability.id}>
                    <div className="bestiary-ability-heading"><strong>{titleCase(ability.name)}</strong><span>{ability.scope}</span></div>
                    <p>{ability.effect}</p>
                    <small>Range {ability.distance} yalms{ability.radius ? ` · Radius ${ability.radius}` : ""}{ability.knockback ? ` · Knockback ${ability.knockback}` : ""} · Readies in {(ability.prepareTime / 1000).toFixed(1)}s</small>
                  </div>
                ))}</div> : <p className="bestiary-none">No abilities are assigned to this monster&apos;s LSB skill list.</p>}
              </section>

              <section className="bestiary-section">
                <h4>Damage taken <small>100% is neutral</small></h4>
                <div className="bestiary-resistance-grid">
                  {Object.entries(selected.resistance.damage).map(([name, raw]) => <div key={name} className={resistanceClass(raw)}><span>{titleCase(name)}</span><strong>{damageTaken(raw).toFixed(raw % 100 === 0 ? 0 : 2)}%</strong></div>)}
                </div>
              </section>

              <section className="bestiary-section">
                <h4>Resistance ranks <small>{selected.resistance.name}</small></h4>
                <div className="bestiary-rank-grid">
                  {Object.entries(selected.resistance.ranks).map(([name, rank]) => <div key={name} className={rank < 0 ? "weak" : rank > 0 ? "resisted" : "neutral"}><span>{titleCase(name)}</span><strong>{rank > 0 ? `+${rank}` : rank}</strong></div>)}
                </div>
              </section>

              <section className="bestiary-section">
                <h4>Modifiers <small>Species, family, and pool SQL</small></h4>
                {selected.modifiers.length ? <div className="bestiary-modifiers">{selected.modifiers.map((modifier, index) => <div key={`${modifier.kind}-${modifier.name}-${index}`}><span>{titleCase(modifier.name)} <i>{modifier.kind === "mob" ? "Mob" : "Stat"}</i></span><strong>{modifier.value > 0 ? `+${modifier.value}` : modifier.value}</strong><small>{modifier.note}</small></div>)}</div> : <p className="bestiary-none">No explicit modifiers beyond the standard family profile.</p>}
              </section>

              <section className="bestiary-section bestiary-raw">
                <h4>Raw flags</h4>
                <span>Mob type {flagText(selected.flags.mobType)}</span><span>Immunity {flagText(selected.flags.immunity)}</span><span>Behavior {flagText(selected.flags.behavior)}</span><span>Roam {flagText(selected.flags.roam)}</span>
              </section>

              <div className="bestiary-caveat"><strong>Baseline note:</strong> {DATA.source.baseline} Lua initialization, server multipliers, battle state, and custom server changes can alter live command values.</div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}