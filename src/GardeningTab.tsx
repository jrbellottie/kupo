import { useEffect, useMemo, useState } from "react";
import { styles } from "./styles";
import { CollapsibleSection } from "./ScreenControls";
import { peekRestoredTabState, rememberTabState } from "./utils/tabNav";
import {
  GARDENING, GARDEN_ROWS, DEFAULT_GARDEN_FILTERS, crystalName, filterGardenRows,
  gardenDuration, gardenDurationRange, gardenOutcomes, gardenQuantity, gardenSeed, gardenTiming,
  type GardenFilters, type GardenRecipe,
} from "./utils/gardening";
import "./GardeningTab.css";

const PAGE_SIZE = 50;
const SOURCE_ROOT = `${GARDENING.source.repository}/blob/${GARDENING.source.revision}/`;
const RESULT_NAMES = [...new Set(GARDEN_ROWS.map(row => row.outcome.name))].sort();
type GardenView = { filters: GardenFilters; page: number; selected: string | null };
const percentage = (value: number) => `${(value * 100).toFixed(2)}%`;

function SourceLink({ file, children }: { file: string; children: React.ReactNode }) {
  return <a href={`${SOURCE_ROOT}${file}`} target="_blank" rel="noreferrer">{children}</a>;
}

function RecipeDetails({ recipe, pot, onClose }: { recipe: GardenRecipe; pot: string; onClose: () => void }) {
  const seed = gardenSeed(recipe.seedId);
  const timing = gardenTiming(recipe);
  const outcomes = gardenOutcomes(recipe);
  return <section className="gardening-detail" aria-label="Selected gardening recipe">
    <div style={styles.titleRow}>
      <h4>{seed.name}: {crystalName(recipe.first)}{seed.feeds === 2 ? ` then ${crystalName(recipe.second)}` : ""}</h4>
      <button type="button" style={styles.buttonCompact} onClick={onClose}>Close recipe</button>
    </div>
    <p><strong>Ingredients:</strong> one {seed.name.toLowerCase()}, one {pot || "supported planting pot"}, and one crystal for each non-skipped feeding below. The pot is reused; the seed and fed crystals are consumed. Harvest gives one result type, not every listed item.</p>
    <p><strong>Time to harvest:</strong> {gardenDurationRange(timing)} Earth time from planting ({timing.minDays}-{timing.maxDays} Vana'diel days). The early end assumes immediate feeding; the late end approaches the end of each feeding window. Skipped feeds must time out. Both assume prompt stage updates and a healthy plant; time offline or late updates can extend this.</p>
    <div className="gardening-table-wrap">
      <table aria-label="Feeding timeline">
        <thead><tr><th>Step</th><th>Use</th><th>Window opens after planting</th><th>Window length</th></tr></thead>
        <tbody>{timing.windows.map(window => <tr key={window.label}>
          <th scope="row">{window.label}</th><td>{crystalName(window.crystal)}{window.crystal === 0 && " (let window expire)"}</td>
          <td>{gardenDurationRange({ minDays: window.earliest, maxDays: window.latest })}</td><td>{gardenDuration(window.duration)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="gardening-small">Feed when the Moogle offers it, not solely by these estimates. The second window shifts with the first feeding. Continue examining even when deliberately skipping a crystal.</p>
    <div className="gardening-table-wrap">
      <table aria-label="All recipe outcomes">
        <caption>All outcomes, including source-listed results the default model cannot select</caption>
        <thead><tr><th>Harvest</th><th>Modeled chance</th><th>Reachable quantities</th><th>Source quantity range</th><th>Expected items / planted pot</th></tr></thead>
        <tbody>{outcomes.map(outcome => <tr key={outcome.id} className={outcome.rolls === 0 ? "gardening-unreachable" : ""}>
          <th scope="row">{outcome.name}</th><td>{percentage(outcome.chance)} ({outcome.rolls}/33)</td>
          <td>{outcome.quantities.length ? outcome.quantities.join(", ") : "Not reachable"}</td><td>{outcome.min}-{outcome.max}</td><td>{outcome.expected.toFixed(2)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="gardening-small">Chances are across new plantings, conditioned on reaching harvest. The hidden roll is stored at planting; reopening the harvest menu does not reroll it. Quantities and result type use the same roll, so they are not independent. Expected items count other harvests as zero and exclude wilting losses.</p>
  </section>;
}

export default function GardeningTab() {
  const [view, setView] = useState<GardenView>(() => peekRestoredTabState<GardenView>("gardening") ?? {
    filters: { ...DEFAULT_GARDEN_FILTERS }, page: 0, selected: null,
  });
  useEffect(() => rememberTabState("gardening", view), [view]);
  const { filters } = view;
  const filtered = useMemo(() => filterGardenRows(filters), [filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(view.page, pages - 1);
  const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const recipeCount = new Set(filtered.map(row => row.recipe.id)).size;
  const selected = GARDENING.recipes.find(recipe => recipe.id === view.selected);
  const pot = GARDENING.pots.find(entry => String(entry.id) === filters.pot);
  const update = (patch: Partial<GardenFilters>) => setView(previous => ({ filters: { ...previous.filters, ...patch }, page: 0, selected: null }));

  return <section className="gardening" style={styles.card}>
    <div style={styles.titleRow}><h3 style={styles.h3}>Gardening</h3><span style={styles.sub}>Mog House pots - {GARDENING.recipes.length} recipes / {RESULT_NAMES.length} harvest items</span></div>
    <p className="gardening-notice">Find what to plant for an item, or explore a seed and crystal combination. This reference uses LSB-based gardening code from a pinned public source snapshot. Private-server modules and settings may override these rules; unpublished overrides cannot be reviewed or verified here. In the pinned settings, pot choice, weekday, moon phase and room aura do not modify results. This is flowerpot gardening, not Mog Garden gathering.</p>
    <CollapsibleSection kind="search">
      <div className="gardening-controls">
        <label>Search pot, seed, crystal or item<input style={styles.input} value={filters.query} onChange={event => update({ query: event.target.value })} placeholder="Arcane, tree saplings, fire..." /></label>
        <label>Desired harvest item<input style={styles.input} list="gardening-result-names" value={filters.result} onChange={event => update({ result: event.target.value })} placeholder="Vomp Carrot, Fire Ore..." /></label>
        <datalist id="gardening-result-names">{RESULT_NAMES.map(name => <option key={name} value={name} />)}</datalist>
        <label>Pot<select style={styles.select} value={filters.pot} onChange={event => update({ pot: event.target.value })}>
          <option value="">All supported pots</option>
          <optgroup label="Standard flowerpots">{GARDENING.pots.filter(entry => entry.standard).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</optgroup>
          <optgroup label="Additional source types - availability unverified">{GARDENING.pots.filter(entry => !entry.standard).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</optgroup>
        </select></label>
        <label>Seed or cutting<select style={styles.select} value={filters.seed} onChange={event => update({ seed: event.target.value })}>
          <option value="">All seed types</option>{GARDENING.seeds.map(seed => <option key={seed.id} value={seed.id}>{seed.name}</option>)}
        </select></label>
        <label>First feeding<select style={styles.select} value={filters.first} onChange={event => update({ first: event.target.value })}>
          <option value="">Any first feed</option>{GARDENING.crystals.map(crystal => <option key={crystal.id} value={crystal.id}>{crystal.name}</option>)}
        </select></label>
        <label>Second feeding<select style={styles.select} value={filters.second} onChange={event => update({ second: event.target.value })}>
          <option value="">Any second feed</option><option value="single">Not needed (one-feed plants)</option>{GARDENING.crystals.map(crystal => <option key={crystal.id} value={crystal.id}>{crystal.name}</option>)}
        </select></label>
        <label>Sort by<select style={styles.select} value={filters.sort} onChange={event => update({ sort: event.target.value as GardenFilters["sort"] })}>
          <option value="chance">Highest result chance</option><option value="time">Earliest harvest</option><option value="item">Harvest name</option><option value="seed">Seed name</option>
        </select></label>
        <button type="button" style={styles.buttonCompact} onClick={() => setView({ filters: { ...DEFAULT_GARDEN_FILTERS }, page: 0, selected: null })}>Reset filters</button>
      </div>
      <label className="gardening-checkbox"><input type="checkbox" checked={filters.includeUnreachable} onChange={event => update({ includeUnreachable: event.target.checked })} /> Include source-listed outcomes with 0% modeled chance</label>
    </CollapsibleSection>
    {selected && <RecipeDetails recipe={selected} pot={pot?.name ?? ""} onClose={() => setView(previous => ({ ...previous, selected: null }))} />}
    <div className="gardening-results-header">
      <p role="status"><strong>{filtered.length.toLocaleString()} matching outcomes</strong> across {recipeCount} recipes. {filtered.length > 0 && `Showing ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, filtered.length)}.`}</p>
      <div className="gardening-pages">
        <button type="button" style={styles.buttonCompact} disabled={page === 0} onClick={() => setView(previous => ({ ...previous, page: page - 1 }))}>Previous</button>
        <span>Page {page + 1} of {pages}</span>
        <button type="button" style={styles.buttonCompact} disabled={page + 1 >= pages} onClick={() => setView(previous => ({ ...previous, page: page + 1 }))}>Next</button>
      </div>
    </div>
    <div className="gardening-table-wrap gardening-results" tabIndex={0} role="region" aria-label="Gardening search results">
      <table>
        <caption>Per-pot harvest possibilities - time is Earth time; feed order is chronological</caption>
        <thead><tr><th>Harvest item</th><th>Seed / cutting</th><th>Pot</th><th>First feed</th><th>Second feed</th><th>Modeled chance</th><th>Quantity if obtained</th><th>Harvest after planting</th><th>Recipe</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.outcome.id} className={row.outcome.rolls === 0 ? "gardening-unreachable" : ""}>
          <th scope="row">{row.outcome.name}</th><td>{row.seed.name}</td><td>{pot?.name ?? "Any supported pot"}</td>
          <td>{crystalName(row.recipe.first)}</td><td>{crystalName(row.recipe.second)}</td><td>{percentage(row.outcome.chance)}</td>
          <td title={row.outcome.quantities.join(", ")}>{gardenQuantity(row.outcome)}</td>
          <td className="gardening-time">{gardenDurationRange(row.timing)}</td>
          <td><button type="button" style={styles.buttonCompact} aria-expanded={view.selected === row.recipe.id} onClick={() => setView(previous => ({ ...previous, selected: previous.selected === row.recipe.id ? null : row.recipe.id }))}>View recipe</button></td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <p className="gardening-empty">No gardening recipes match these filters. Try fewer filters or include source-listed outcomes.</p>}
    </div>
    <p className="gardening-small">Open a recipe for every alternative harvest, exact reachable quantities and feeding windows. A quantity range may contain gaps; details list the exact values. Modeled chances are not raw SQL weights, and 0% means unreachable with these settings, not an item missing from the database. Each plant produces only one result type.</p>

    <details>
      <summary>Getting started and keeping plants alive</summary>
      <ol>
        <li>Obtain a planting pot and a seed, cutting or sapling. Place the pot as furniture on the first floor of your Mog House. The ordinary furniture item named Flowerpot is not a planting pot in the source.</li>
        <li>Keep the seed and crystals in your Mog Safe or accessible Mog Safe 2. Use the Moogle's Gardening menu to plant and examine. Gardening guides describe a ten-pot room limit; availability and client restrictions should be checked in game.</li>
        <li>Examine regularly, including before long absences and during every growth stage. Feeding marks the new stage as examined. Do not treat a long growth estimate as permission to ignore the plant.</li>
        <li>Feed a single crystal when the appropriate option appears. Herbs, grains, vegetables and wildgrass have one feeding; fruit, cactus, cuttings and saplings have two. To use No crystal, let that window expire while continuing to tend the plant.</li>
        <li>Harvest at maturity with enough free safe slots. The pot stays and can be replanted. Emptying a growing pot abandons that crop. Drying freezes growth for decoration; avoid it when aiming for a harvest.</li>
      </ol>
      <p>The wilt calculation is stage-based, not a simple countdown since the last examination. The base allowance is 36 Vana'diel days ({gardenDuration(36)}); Moghancement: Gardening adds another 36. A plant left too far beyond a stage deadline can still wilt even if previously examined. Inspecting daily is a practical habit, not a guarantee for every login pattern.</p>
      <p>Moghancement: Gardening adds wilt tolerance in this source, not a harvest-yield multiplier. It must actually be the active moghancement; owning a pot is not proof it is active. Moon phase, planting weekday, room aura and pot-element modifiers are disabled in the public defaults.</p>
    </details>
    <details>
      <summary>Growth times by seed and how to read the estimates</summary>
      <div className="gardening-table-wrap"><table>
        <caption>Reference times with a crystal at every feeding, versus skipping all feeds</caption>
        <thead><tr><th>Seed</th><th>Feedings</th><th>First window opens</th><th>All feeds used: early to late</th><th>No crystals</th></tr></thead>
        <tbody>{GARDENING.seeds.map(seed => {
          const fed = GARDENING.recipes.find(recipe => recipe.seedId === seed.id && recipe.first === 1 && (recipe.second === 1 || recipe.second === null));
          const skipped = GARDENING.recipes.find(recipe => recipe.seedId === seed.id && recipe.first === 0 && (recipe.second === 0 || recipe.second === null));
          if (!fed || !skipped) throw new Error(`Missing timing reference for ${seed.name}.`);
          const fedTiming = gardenTiming(fed);
          return <tr key={seed.id}><th scope="row">{seed.name}</th><td>{seed.feeds}</td><td>{gardenDuration(fedTiming.windows[0].earliest)}</td><td>{gardenDurationRange(fedTiming)}</td><td>{gardenDurationRange(gardenTiming(skipped))}</td></tr>;
        })}</tbody>
      </table></div>
      <p>One Vana'diel day is 57 minutes 36 seconds of Earth time. Estimates sum the implemented growth stages, not wiki day counts. Feeding immediately advances the crystal stage but changes the next stage's length. Waiting to feed delays the schedule; skipping uses the whole crystal window and a different following duration.</p>
      <p>The source advances one stage per update and schedules the next relative to that update. Delayed updates or time offline can therefore make harvest later than the table's late estimate. No plant's live progress is read by Kupo. Pot choice does not change the stage-duration function.</p>
    </details>
    <details>
      <summary>Results, probabilities and useful gardening goals</summary>
      <p>Every planting receives one hidden integer roll from 0 through 32. Seed affinity and the crystals fed establish a starting strength; the hidden roll raises it toward 100. The source walks the result table's cumulative weights using that strength, then derives quantity from the same value. Kupo enumerates all 33 rolls, so displayed chances advance in steps of about 3.03%, not the database's apparent weight percentages.</p>
      <p>These are predictions for new plantings under the pinned defaults, conditioned on a healthy harvest. They do not reveal an existing plant's hidden roll, predict how many attempts guarantee an item, or account for a live operator enabling optional modifiers. A source-listed result can have zero reachable rolls.</p>
      <p><strong>Chocobo food:</strong> use the harvest search for Vomp/Zegham Carrots, greens and wildgrasses, then compare crystal choices and alternative crops. <strong>Elemental ores:</strong> explore Tree Saplings; even matching crystal feeds do not guarantee an ore. <strong>Growing your inputs:</strong> Tree Cuttings can produce Tree Saplings, but other results compete for the harvest.</p>
      <p>Wiki advice about city-pot bonuses, stronger room aura, full-moon harvesting, special clothing or waiting longer for a better yield is not used by this default calculation. Nor does this harvest handler apply the later-retail 90-day character-age one-item restriction. Live customizations can differ.</p>
    </details>
    <details>
      <summary>Sources and coverage</summary>
      <p>{GARDENING.source.attribution} Checked {GARDENING.source.checkedOn}, revision <code>{GARDENING.source.revision}</code>. Bundled coverage: {GARDENING.pots.length} source-classified pots, {GARDENING.seeds.length} seed types, {GARDENING.recipes.length} crystal combinations and {GARDEN_ROWS.length.toLocaleString()} result rows. The reference works offline; source links require a connection.</p>
      <p><SourceLink file="sql/gardening_results.sql">Recipe tables</SourceLink> / <SourceLink file="src/map/utils/gardenutils.cpp">Growth and result formulas</SourceLink> / <SourceLink file="settings/default/map.lua">Public default settings</SourceLink> / <SourceLink file="src/map/packets/c2s/0x0fc_myroom_plant_add.cpp">Planting and feeding</SourceLink> / <SourceLink file="scripts/tests/systems/gardening.lua">Source gardening tests</SourceLink></p>
      <p><a href={GARDENING.source.wiki} target="_blank" rel="noreferrer">Community gardening guide (retail context; may differ)</a> / <a href={GARDENING.source.licenseUrl} target="_blank" rel="noreferrer">Source license (GPL-3.0)</a>. Wiki advice is supplementary, not a replacement for source mechanics. No wiki recipe prose or images are bundled.</p>
    </details>
  </section>;
}
