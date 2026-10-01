import { useEffect, useMemo, useState } from "react";
import { JOBS_LIST, WEAPONS, WEAPON_SKILLS, canUseWeaponSkillAtLevel } from "./data/skillchains";
import {
  SKILLCHAIN_PROPERTIES,
  enumerateSkillchains,
  type SkillchainProperty,
  type WeaponSkill,
} from "./utils/skillchain";
import "./SkillchainTab.css";
import { CollapsibleSection } from "./ScreenControls";

const COMBINATIONS_PER_PAGE = 100;

const JOB_NAMES: Record<string, string> = {
  WAR: "Warrior", MNK: "Monk", WHM: "White Mage", BLM: "Black Mage", RDM: "Red Mage",
  THF: "Thief", PLD: "Paladin", DRK: "Dark Knight", BST: "Beastmaster", BRD: "Bard",
  RNG: "Ranger", SAM: "Samurai", NIN: "Ninja", DRG: "Dragoon", SMN: "Summoner",
  BLU: "Blue Mage", COR: "Corsair", PUP: "Puppetmaster", DNC: "Dancer", SCH: "Scholar",
};

function propertyClass(property: string): string {
  return `sc-property sc-${property.toLowerCase()}`;
}

function jobCanUseSkill(skill: WeaponSkill, jobCode: string, selectedLevel: number | null): boolean {
  return skill.jobs.includes(jobCode) && (selectedLevel === null || canUseWeaponSkillAtLevel(skill, selectedLevel, jobCode));
}

export default function SkillchainTab() {
  const [query, setQuery] = useState("");
  const [weapon, setWeapon] = useState("");
  const [secondWeapon, setSecondWeapon] = useState("");
  const [job, setJob] = useState("");
  const [secondJob, setSecondJob] = useState("");
  const [level, setLevel] = useState("");
  const [property, setProperty] = useState("");
  const [includeThreeStep, setIncludeThreeStep] = useState(false);
  const [combinationPage, setCombinationPage] = useState(1);

  const normalizedQuery = query.trim().toLowerCase();
  const inferredJob = JOBS_LIST.find(
    (code) => normalizedQuery === code.toLowerCase() || normalizedQuery === JOB_NAMES[code]?.toLowerCase()
  ) ?? "";
  const inferredWeapon = [...WEAPONS]
    .sort((a, b) => b.length - a.length)
    .find((item) => normalizedQuery === item.toLowerCase()) ?? "";
  const inferredProperty = SKILLCHAIN_PROPERTIES.find((item) => normalizedQuery === item.toLowerCase()) ?? "";
  const jobScope = job || inferredJob;
  const jobScopes = [...new Set([jobScope, secondJob].filter(Boolean))];
  const weaponScope = weapon || inferredWeapon;
  const weaponScopes = [...new Set([weaponScope, secondWeapon].filter(Boolean))];
  const targetProperty = (property || inferredProperty) as SkillchainProperty | "";
  const queryIsScope = Boolean(inferredJob || inferredWeapon || inferredProperty);
  const selectedLevel = level === "" ? null : Number(level);

  const combinations = useMemo(() => {
    const pool = WEAPON_SKILLS.filter((skill) => {
      if (jobScopes.length > 0 && !jobScopes.some((jobCode) => jobCanUseSkill(skill, jobCode, selectedLevel))) return false;
      if (weaponScopes.length > 0 && !weaponScopes.includes(skill.weapon)) return false;
      if (jobScopes.length === 0 && selectedLevel !== null && !canUseWeaponSkillAtLevel(skill, selectedLevel)) return false;
      return true;
    });
    const routes = enumerateSkillchains(pool, targetProperty || undefined, includeThreeStep ? 3 : 2).filter((route) => {
      const routeWeapons = [route.opener.weapon, route.closer.weapon, route.finisher?.weapon];
      const routeSkills = route.finisher ? [route.opener, route.closer, route.finisher] : [route.opener, route.closer];
      return weaponScopes.every((selectedWeapon) => routeWeapons.includes(selectedWeapon)) &&
        jobScopes.every((jobCode) => routeSkills.some((skill) => jobCanUseSkill(skill, jobCode, selectedLevel)));
    });
    if (!normalizedQuery || queryIsScope) return routes;
    return routes.filter((route) => {
      const routeText = [
        route.opener.name, route.opener.weapon, route.closer.name, route.closer.weapon,
        route.finisher?.name ?? "", route.finisher?.weapon ?? "", route.result.property,
        ...route.opener.jobs, ...route.closer.jobs, ...(route.finisher?.jobs ?? []),
      ].join(" ").toLowerCase();
      return routeText.includes(normalizedQuery);
    });
  }, [jobScope, secondJob, weaponScope, secondWeapon, selectedLevel, targetProperty, normalizedQuery, queryIsScope, includeThreeStep]);

  const databaseActive = Boolean(jobScopes.length || weaponScopes.length || targetProperty || normalizedQuery || selectedLevel);
  const combinationPageCount = Math.max(1, Math.ceil(combinations.length / COMBINATIONS_PER_PAGE));
  const currentCombinationPage = Math.min(combinationPage, combinationPageCount);
  const visibleCombinations = combinations.slice(
    (currentCombinationPage - 1) * COMBINATIONS_PER_PAGE,
    currentCombinationPage * COMBINATIONS_PER_PAGE
  );

  useEffect(() => {
    setCombinationPage(1);
  }, [jobScope, secondJob, weaponScope, secondWeapon, selectedLevel, targetProperty, normalizedQuery, includeThreeStep]);

  const resultCounts = useMemo(() => {
    const counts = new Map<SkillchainProperty, number>();
    for (const route of combinations) counts.set(route.result.property, (counts.get(route.result.property) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [combinations]);

  const matches = useMemo(() => {
    const needle = normalizedQuery;
    return WEAPON_SKILLS.filter((skill) => {
      const searchable = [skill.name, skill.weapon, skill.acquisition, skill.skill ?? "", skill.level ?? "", ...skill.jobs, ...skill.jobs.map((code) => JOB_NAMES[code]), ...skill.properties]
        .join(" ")
        .toLowerCase();
      if (needle && !queryIsScope && !searchable.includes(needle)) return false;
      if (weaponScopes.length > 0 && !weaponScopes.includes(skill.weapon)) return false;
      if (jobScopes.length > 0 && !jobScopes.some((jobCode) => jobCanUseSkill(skill, jobCode, selectedLevel))) return false;
      if (jobScopes.length === 0 && selectedLevel !== null && !canUseWeaponSkillAtLevel(skill, selectedLevel)) return false;
      if (targetProperty && !skill.properties.includes(targetProperty)) return false;
      return true;
    }).sort((a, b) => a.weapon.localeCompare(b.weapon) || (a.skill ?? a.level ?? 999) - (b.skill ?? b.level ?? 999) || a.name.localeCompare(b.name));
  }, [normalizedQuery, queryIsScope, weaponScope, secondWeapon, jobScope, secondJob, selectedLevel, targetProperty]);

  function toggleProperty(result: SkillchainProperty) {
    if (targetProperty === result) {
      setProperty("");
      if (inferredProperty === result) setQuery("");
    } else {
      setProperty(result);
    }
  }

  function resetFilters() {
    setQuery("");
    setWeapon("");
    setSecondWeapon("");
    setJob("");
    setSecondJob("");
    setLevel("");
    setProperty("");
    setIncludeThreeStep(false);
  }

  return (
    <div className="skillchain-tab">
      <header className="sc-heading">
        <div>
          <div className="sc-kicker">Level 75 era reference</div>
          <h2>Skillchain Database</h2>
          <p>Search every valid combination by jobs, level, weapons, result, weapon skill, and avatar Blood Pact.</p>
        </div>
        <div className="sc-count"><strong>{WEAPON_SKILLS.length}</strong><span>skillchain actions</span></div>
      </header>

      <CollapsibleSection kind="search">
      <section className="sc-filters" aria-label="Weapon skill filters">
        <label className="sc-search"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Samurai, Great Katana, Light, Tachi: Kasha..." /></label>
        <label><span>Weapon / Avatar 1</span><select value={weapon} onChange={(event) => setWeapon(event.target.value)}><option value="">All sources</option>{WEAPONS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Weapon / Avatar 2</span><select value={secondWeapon} onChange={(event) => setSecondWeapon(event.target.value)}><option value="">None</option>{WEAPONS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Job 1</span><select value={job} onChange={(event) => setJob(event.target.value)}><option value="">All jobs</option>{JOBS_LIST.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Job 2</span><select value={secondJob} onChange={(event) => setSecondJob(event.target.value)}><option value="">None</option>{JOBS_LIST.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Level</span><select value={level} onChange={(event) => setLevel(event.target.value)}><option value="">All levels</option>{Array.from({ length: 75 }, (_, index) => index + 1).map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Attribute</span><select value={property} onChange={(event) => setProperty(event.target.value)}><option value="">All attributes</option>{SKILLCHAIN_PROPERTIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <button className="sc-three-step-toggle" type="button" aria-pressed={includeThreeStep} onClick={() => setIncludeThreeStep((current) => !current)}>
          <span className="sc-toggle-mark" aria-hidden>{includeThreeStep ? "✓" : ""}</span>
          Include 3-step chains
        </button>
        <button className="sc-reset" type="button" onClick={resetFilters}>Reset filters</button>
      </section>
      </CollapsibleSection>

      <section className="sc-database" aria-label="Skillchain combination database">
        <div className="sc-database-heading">
          <div>
            <strong>Combination Database</strong>
            <span>
              {weaponScopes.length ? `${weaponScopes.join(" + ")} routes` : jobScopes.length ? `${jobScopes.map((jobCode) => JOB_NAMES[jobCode] ?? jobCode).join(" + ")} routes` : targetProperty ? `Ways to make ${targetProperty}` : "Search by jobs, weapons, avatar, attribute, or action"}
            </span>
          </div>
          {databaseActive && <b>{combinations.length.toLocaleString()} combinations</b>}
        </div>
        {!databaseActive ? (
          <div className="sc-database-empty">Choose a job, level, weapon, or target attribute to enumerate its complete two- and three-step skillchain routes.</div>
        ) : combinations.length === 0 ? (
          <div className="sc-database-empty">No valid combinations match this search.</div>
        ) : (
          <>
            <div className="sc-result-summary">
              {resultCounts.map(([result, count]) => (
                <button type="button" key={result} aria-pressed={targetProperty === result} onClick={() => toggleProperty(result)}>
                  <span className={propertyClass(result)}>{result}</span><b>{count}</b>
                </button>
              ))}
            </div>
            <div className="sc-combination-list">
              {visibleCombinations.map((route) => (
                <article className={`sc-combination ${route.finisher ? "sc-three-step" : ""}`} key={`${route.opener.id}|${route.closer.id}|${route.finisher?.id ?? ""}|${route.result.property}`}>
                  <div className="sc-combo-skill">
                    <small>{route.opener.weapon} · opener</small><strong>{route.opener.name}</strong>
                    <span>{route.opener.properties.join(" · ")}</span>
                  </div>
                  <div className={`sc-combo-result sc-level-${route.intermediate?.level ?? route.result.level}`}>
                    <small>Lv.{route.intermediate?.level ?? route.result.level}</small><strong>{route.intermediate?.property ?? route.result.property}</strong><span aria-hidden>→</span>
                  </div>
                  <div className="sc-combo-skill">
                    <small>{route.closer.weapon} · closer</small><strong>{route.closer.name}</strong>
                    <span>{route.closer.properties.join(" · ")}</span>
                  </div>
                  {route.finisher && (
                    <>
                      <div className={`sc-combo-result sc-level-${route.result.level}`}>
                        <small>Lv.{route.result.level}</small><strong>{route.result.property}</strong><span aria-hidden>→</span>
                      </div>
                      <div className="sc-combo-skill">
                        <small>{route.finisher.weapon} · finisher</small><strong>{route.finisher.name}</strong>
                        <span>{route.finisher.properties.join(" · ")}</span>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
            {combinationPageCount > 1 && (
              <nav className="sc-pagination" aria-label="Combination pages">
                <button type="button" onClick={() => setCombinationPage((page) => Math.max(1, page - 1))} disabled={currentCombinationPage === 1}>Previous</button>
                <span>Page {currentCombinationPage.toLocaleString()} of {combinationPageCount.toLocaleString()}</span>
                <button type="button" onClick={() => setCombinationPage((page) => Math.min(combinationPageCount, page + 1))} disabled={currentCombinationPage === combinationPageCount}>Next</button>
              </nav>
            )}
          </>
        )}
      </section>

      <div className="sc-list-heading"><strong>{matches.length} matches</strong><span>Ordered by weapon and required combat skill</span></div>
      <section className="sc-skill-grid" aria-live="polite">
        {matches.map((skill) => (
            <button className="sc-skill-card" type="button" aria-pressed={normalizedQuery === skill.name.toLowerCase()} key={skill.id} onClick={() => setQuery((current) => current.trim().toLowerCase() === skill.name.toLowerCase() ? "" : skill.name)}>
              <div className="sc-card-top"><span>{skill.weapon}</span><span className={`sc-acquisition sc-${skill.acquisition.toLowerCase().replace(" ", "-")}`}>{skill.acquisition}{skill.skill !== null ? ` ${skill.skill}` : skill.level !== null ? ` Lv.${skill.level}` : ""}</span></div>
              <strong>{skill.name}</strong>
              <div className="sc-property-row">{skill.properties.length ? skill.properties.map((item) => <span className={propertyClass(item)} key={item}>{item}</span>) : <span className="sc-none">No skillchain attributes</span>}</div>
              <div className="sc-card-bottom"><span>{skill.jobs.join(" · ")}</span></div>
            </button>
        ))}
        {matches.length === 0 && <div className="sc-no-results">No weapon skills match these filters.</div>}
      </section>

      <footer className="sc-legend">
        <strong>Chain levels</strong><span className="sc-level-1">Level 1</span><span className="sc-level-2">Level 2</span><span className="sc-level-3">Level 3</span><span className="sc-level-4">Level 4</span>
        <small>Ordered attributes follow in-game priority. Skills without attributes are included for reference but cannot form a chain.</small>
      </footer>
    </div>
  );
}