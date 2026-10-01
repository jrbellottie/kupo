import { useDeferredValue, useEffect, useState } from "react";
import { Axe, ExternalLink, Leaf, Pickaxe, RotateCcw, Search, Shovel } from "lucide-react";
import MapView, { type MapDef } from "./MapView";
import HelmGatheringMap from "./HelmGatheringMap";
import mapData from "./data/maps.json";
import helmMapData from "./data/helmMaps.json";
import { PHOENIX_SOURCE } from "./utils/phoenixData";
import { printSellPrice } from "./utils/printingData";
import { findableName } from "./utils/itemLinks";
import { navigateToTab } from "./utils/tabNav";
import { loadJson, saveJson } from "./utils/storage";
import { HELM_DAYS, HELM_DEFAULTS, HELM_GEAR, HELM_KINDS, HELM_ROCKS, HELM_ZONES, helmAvailable, helmCount, helmMapKey, helmRates, helmZoneKey, helmZoneName, type HelmKind, type HelmScenario } from "./utils/helm";
import "./HelmTab.css";
import { CollapsibleSection } from "./ScreenControls";

const KEY = "kupo.helm.v1";
const ICONS = { Mining: Pickaxe, Harvesting: Leaf, Excavation: Shovel, Logging: Axe };
const MAPS = (mapData as { maps: MapDef[] }).maps;
type PoolState = { depleted: number; daily: Record<string, number> };
type HelmState = {
  kind: HelmKind; selected: string; query: string; wotg: boolean;
  view: "Drops" | "Mechanics" | "Locations"; sort: "chance" | "name" | "value";
  scenario: HelmScenario; pools: Record<string, PoolState>; mapId: string;
};
const DEFAULT_STATE: HelmState = { kind: "Mining", selected: "Mining:61", query: "", wotg: false, view: "Drops", sort: "chance", scenario: HELM_DEFAULTS, pools: {}, mapId: "" };
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const gil = (value: number | null) => value === null ? "Unknown" : `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} gil`;

function ItemLink({ name }: { name: string }) {
  const target = findableName(name);
  return <span className="helm-item">
    {target ? <button type="button" className="helm-link" onClick={() => navigateToTab("drops", target, "helm")}>{name}</button> : <span>{name}</span>}
  </span>;
}

export default function HelmTab() {
  const [state, setState] = useState<HelmState>(() => {
    const stored = loadJson<Partial<HelmState> | null>(KEY, null);
    return { ...DEFAULT_STATE, ...stored, kind: HELM_KINDS.includes(stored?.kind as HelmKind) ? stored!.kind! : "Mining", scenario: { ...HELM_DEFAULTS, ...stored?.scenario }, pools: stored?.pools ?? {} };
  });
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    try { saveJson(KEY, state); setSaveError(false); } catch { setSaveError(true); }
  }, [state]);
  const query = useDeferredValue(state.query.trim().toLowerCase());
  const matches = (text: string) => text.toLowerCase().includes(query);
  const available = HELM_ZONES.filter(zone => helmAvailable(zone, state.wotg) && zone.kind === state.kind);
  const filtered = available.filter(zone => matches(helmZoneName(zone.zone)) || zone.drops.some(drop => matches(drop.name) || (drop.itemId === 769 && HELM_ROCKS.some(rock => matches(rock.name)))));
  const zone = filtered.find(entry => helmZoneKey(entry) === state.selected) ?? filtered[0];
  const key = zone ? helmZoneKey(zone) : "";
  const pool = state.pools[key] ?? { depleted: 0, daily: {} };
  const scenario = { ...state.scenario, ...pool, level: Math.max(1, zone?.minLevel ?? 1) };
  const rates = zone ? helmRates(zone, scenario) : null;
  const maps = zone ? MAPS.filter(map => helmMapKey(map.zone) === helmMapKey(zone.zone)) : [];
  const map = maps.find(entry => entry.id === state.mapId) ?? maps[0];
  const gatheringMaps = zone ? helmMapData.maps.filter(entry => entry.kind === zone.kind && entry.zoneId === zone.zoneId) : [];
  const gatheringMap = gatheringMaps.find(entry => entry.id === state.mapId) ?? gatheringMaps[0];
  const change = (patch: Partial<HelmState>) => setState(current => ({ ...current, ...patch }));
  const changeScenario = (patch: Partial<HelmScenario>) => setState(current => ({ ...current, scenario: { ...current.scenario, ...patch } }));
  const changePool = (patch: Partial<PoolState>) => setState(current => ({ ...current, pools: { ...current.pools, [key]: { ...pool, ...patch } } }));
  const rows = rates?.drops.filter(drop => !query || matches(helmZoneName(zone!.zone)) || matches(drop.name) || (drop.sourceItemId === 769 && HELM_ROCKS.some(rock => matches(rock.name)))).sort((first, second) => state.sort === "name" ? first.name.localeCompare(second.name) : state.sort === "value" ? (printSellPrice(second.name, {}) ?? -1) - (printSellPrice(first.name, {}) ?? -1) : second.perAttempt - first.perAttempt || second.share - first.share) ?? [];
  const sourceUrl = `${PHOENIX_SOURCE.repository}/blob/${PHOENIX_SOURCE.revision}`;

  return <section className="helm" aria-label="HELM gathering">
    <header className="helm-header">
      <div><h2>HELM</h2><p>Phoenix gathering / {state.wotg ? "Through WotG" : "ToAU"}</p></div>
      <a className="helm-source" href={`${sourceUrl}/scripts/globals/hobbies/helm/logic.lua`} target="_blank" rel="noreferrer">Source {PHOENIX_SOURCE.revision.slice(0, 8)} <ExternalLink size={14} /></a>
    </header>
    <p className="helm-notice">Pinned Phoenix beta source with pre-WotG item adjustments. Live server settings may differ; rates are source calculations, not live observations.</p>
    {saveError && <p role="alert">HELM settings could not be saved in this browser.</p>}
    <CollapsibleSection kind="search">
    <div className="helm-toolbar">
      <fieldset className="helm-kinds"><legend className="helm-sr">Gathering activity</legend>
        {HELM_KINDS.map(kind => { const Icon = ICONS[kind]; return <label key={kind} className={state.kind === kind ? "is-selected" : ""}>
          <input type="radio" name="helm-kind" value={kind} checked={state.kind === kind} onChange={() => change({ kind, selected: "", mapId: "" })} /><Icon size={16} />{kind}
        </label>; })}
      </fieldset>
      <label className="helm-check"><input type="checkbox" checked={state.wotg} onChange={event => change({ wotg: event.target.checked })} />Include WotG zones</label>
    </div>
    </CollapsibleSection>
    <div className="helm-layout">
      <aside className="helm-zones" aria-label="Gathering zones">
        <CollapsibleSection kind="search">
        <label className="helm-search"><Search size={16} /><input aria-label="Search HELM zones or items" type="search" placeholder="Zone or item" value={state.query} onChange={event => change({ query: event.target.value })} /></label>
        </CollapsibleSection>
        <p className="helm-muted">{filtered.length} / {available.length} zones</p>
        <div className="helm-zone-list">
          {filtered.map(entry => <button type="button" key={helmZoneKey(entry)} aria-pressed={entry === zone} onClick={() => change({ selected: helmZoneKey(entry), mapId: "" })}>
            <strong>{helmZoneName(entry.zone)}</strong><span>{entry.drops.length} items <span>{entry.obtainRate.toFixed(2)}% success</span></span>
          </button>)}
        </div>
      </aside>
      {!zone || !rates ? <div className="helm-empty">No gathering zones match this search.</div> : <div className="helm-detail">
        <div className="helm-zone-heading"><div><h3>{helmZoneName(zone.zone)}</h3><span className="helm-muted">{zone.kind} / Minimum main-job level {Math.max(1, zone.minLevel)}</span></div><ItemLink name={zone.tool} /></div>
        <p className="helm-muted">Chances assume the minimum main-job level is met. Below it, no items can be obtained, but tools can still break. Higher levels do not improve gathering chances.</p>
        <div className="helm-metrics">
          <div><span>Item / attempt</span><strong>{percent(rates.success)}</strong></div>
          <div><span>Nothing / attempt</span><strong>{percent(rates.nothing)}</strong></div>
          <div><span>Tool breaks / attempt</span><strong>{percent(rates.breakChance)}</strong></div>
          <div><span>Possible positions</span><strong>{zone.points.length}</strong></div>
        </div>
        <CollapsibleSection kind="search">
        <fieldset className="helm-scenario"><legend>Gathering scenario</legend>
          <label>NQ gear modifier<input type="number" min={0} max={99} disabled={zone.kind === "Excavation"} value={scenario.nq} onChange={event => changeScenario({ nq: helmCount(Number(event.target.value), 99) })} /></label>
          <label>HQ gear modifier<input type="number" min={0} max={99} disabled={zone.kind === "Excavation"} value={scenario.hq} onChange={event => changeScenario({ hq: helmCount(Number(event.target.value), 99) })} /></label>
          <label>Vana'diel day<select value={scenario.day} onChange={event => changeScenario({ day: Number(event.target.value) })}>{HELM_DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
          <label className="helm-check"><input type="checkbox" checked={scenario.camped} onChange={event => changeScenario({ camped: event.target.checked })} />Camp penalty active</label>
          <label className="helm-check"><input type="checkbox" checked={scenario.inventoryFull} onChange={event => changeScenario({ inventoryFull: event.target.checked })} />Inventory full</label>
          <button className="helm-reset" type="button" title="Reset gear, day, camping, and inventory scenario" aria-label="Reset gathering scenario" onClick={() => changeScenario(HELM_DEFAULTS)}><RotateCcw size={16} />Reset scenario</button>
        </fieldset>
        </CollapsibleSection>
        {scenario.inventoryFull && <p className="helm-warning" role="status">A full inventory prevents item rewards, but tools can still break.</p>}
        <CollapsibleSection kind="tabs">
        <div className="helm-views" role="tablist" aria-label="HELM details" onKeyDown={event => {
          const views = ["Drops", "Mechanics", "Locations"] as const;
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (views.indexOf(state.view) + (event.key === "ArrowLeft" ? 2 : 1)) % 3;
          change({ view: views[next] }); document.getElementById(`helm-${views[next]}`)?.focus();
        }}>
          {(["Drops", "Mechanics", "Locations"] as const).map(view => <button type="button" role="tab" id={`helm-${view}`} aria-controls="helm-panel" aria-selected={state.view === view} tabIndex={state.view === view ? 0 : -1} key={view} onClick={() => change({ view })}>{view}</button>)}
        </div>
        </CollapsibleSection>
        <div role="tabpanel" id="helm-panel" aria-labelledby={`helm-${state.view}`}>
          {state.view === "Drops" && <>
            {(zone.depletion || zone.drops.some(drop => drop.dailyCap !== null)) && <fieldset className="helm-pool"><legend>Pool already gathered</legend>
              {zone.depletion && <label>Shared depletion count / {zone.depletion.max}<input type="number" min={0} max={zone.depletion.max} value={pool.depleted} onChange={event => changePool({ depleted: helmCount(Number(event.target.value), zone.depletion!.max) })} /></label>}
              {zone.drops.filter(drop => drop.dailyCap !== null).map(drop => <label key={drop.itemId}>{drop.name} today / {drop.dailyCap}<input type="number" min={0} max={drop.dailyCap!} value={pool.daily[drop.itemId] ?? 0} onChange={event => changePool({ daily: { ...pool.daily, [drop.itemId]: helmCount(Number(event.target.value), drop.dailyCap!) } })} /></label>)}
              <button type="button" className="helm-reset" title="Reset this zone's gathered counts" aria-label="Reset gathered counts" onClick={() => changePool({ depleted: 0, daily: {} })}><RotateCcw size={16} />Reset counts</button>
            </fieldset>}
            {zone.depletion && <p className="helm-muted"><strong>Shared depletion limit: {zone.depletion.max} items combined per character.</strong> Applies to {zone.drops.filter(drop => zone.depletion!.pool.includes(drop.itemId)).map(drop => drop.name).join(", ")}. Each obtained item adds 1 to the shared count, reducing these items' drop weights to zero at the limit. Resets when you zone out and back in; logging out does not reset it.</p>}
            {zone.drops.some(drop => drop.dailyCap !== null) && <p className="helm-muted"><strong>Daily limits per character:</strong> {zone.drops.filter(drop => drop.dailyCap !== null).map(drop => `${drop.name}: ${drop.dailyCap}`).join("; ")}. Reset on zone-in after midnight JST, not while remaining in the zone.</p>}
            <div className="helm-table-heading"><p className="helm-muted">Pool share is conditional on an item roll. Per-attempt chance includes the success roll, not tool survival.</p><label>Sort<select value={state.sort} onChange={event => change({ sort: event.target.value as HelmState["sort"] })}><option value="chance">Item chance</option><option value="name">Item name</option><option value="value">NPC base value</option></select></label></div>
            <div className="helm-table-scroll"><table className="helm-table"><thead><tr><th>Item</th><th>Pool share</th><th>Per attempt</th><th>NPC base / item</th><th>Restrictions</th></tr></thead><tbody>
              {rows.map(drop => <tr key={drop.sourceItemId}><td><ItemLink name={drop.name} /></td><td>{percent(drop.share)}</td><td className="helm-chance">{percent(drop.perAttempt)}</td><td>{gil(printSellPrice(drop.name, {}))}</td><td>{[drop.dailyCap !== null ? `${drop.dailyCap}/JST day` : "", zone.depletion?.pool.includes(drop.sourceItemId) ? "Shared depletion" : "", drop.sourceItemId === 769 ? "Day's element" : ""].filter(Boolean).join("; ") || "None"}</td></tr>)}
            </tbody></table></div>
            <p className="helm-muted">NPC values are Phoenix BaseSell references, not fame-adjusted shop quotes. Chances describe the next attempt at the entered pool state; they change as capped or depleted items are obtained.</p>
          </>}
          {state.view === "Mechanics" && <div className="helm-mechanics">
            <h4>Success and tool loss</h4>
            <p>Base success: {zone.obtainRate.toFixed(2)}%. Base tool breakage: {zone.breakRate.toFixed(2)}%. These are independent rolls; current chance of both an item and a break is {percent(rates.itemAndBreak)}. A failed gather does not always consume a tool.</p>
            <p>{zone.kind === "Excavation" ? "Excavation ignores harvesting, logging, and mining gear modifiers." : "Break chance = base break chance x camp multiplier x 0.893^NQ x 0.843^HQ (capped at 100%). NQ and HQ inputs are summed equipment modifier values, not item-quality or drop-rate bonuses."}</p>
            {zone.kind !== "Excavation" && <div className="helm-table-scroll"><table className="helm-table"><caption>Field / Worker equipment for {zone.kind.toLowerCase()}</caption><thead><tr><th>Equipment</th><th>NQ modifier</th><th>HQ modifier</th></tr></thead><tbody>{HELM_GEAR.filter(gear => gear.kind === zone.kind).map(gear => <tr key={gear.itemId}><td><ItemLink name={gear.name} /></td><td>{gear.nq}</td><td>{gear.hq}</td></tr>)}</tbody></table></div>}
            <p>Gathering removes Invisible. A free inventory slot is required. This routine has no gathering skill progression, moon, weather, or Treasure Hunter modifier. The weekday changes colored-rock identity, not its pool weight.</p>
            <h4>Point movement and camping</h4>
            <p>{zone.relocateRate}% relocation roll after an item result; current per-attempt chance {percent(rates.relocateChance)}. The point is hidden for {zone.respawnTime} seconds and selects a random position from {zone.points.length} possible positions. That count is not the number of simultaneously active points.</p>
            <p>When a gather relocates a point, its old position is recorded for that player. Gathering at that position again multiplies tool-break chance by {zone.campMultiplier}. Gathering at a different position clears the penalty; normal zoning also clears it.</p>
            <p>The source supports an optional three-second attempt delay through ENABLE_HELM_WAIT; its default is off. The live setting and travel time are not inferred.</p>
            <h4>Pool limits</h4>
            {zone.depletion ? <p>Shared depletion: {zone.drops.filter(drop => zone.depletion!.pool.includes(drop.itemId)).map(drop => drop.name).join(", ")}. Every obtained pool item advances the shared count. Weight = floor(base weight x ({zone.depletion.max} - count) / {zone.depletion.max}); these items reach zero at {zone.depletion.max}. Normal zoning resets this count; logging out does not.</p> : <p>No shared depletion is configured for this pool.</p>}
            {zone.drops.some(drop => drop.dailyCap !== null) ? <p>Daily limits: {zone.drops.filter(drop => drop.dailyCap !== null).map(drop => `${drop.name}: ${drop.dailyCap}`).join("; ")}. Each item's weight becomes floor(base weight / (already obtained + 1)), then zero at its cap. Reset takes effect on zone-in after midnight JST, not while remaining in the zone.</p> : <p>No per-item daily caps are configured for this pool.</p>}
            <p>Remaining weights are renormalized after cap and depletion adjustments. These are per-character limits, not a server-wide stock count.</p>
            {zone.zone === "Wajaom Woodlands" && zone.kind === "Harvesting" && <><h4>Quest result</h4><p>Vanishing Act: while the quest is accepted and Rainbow Berry is missing, a non-breaking harvesting attempt can grant the key item. It is separate from the regular weighted item pool.</p></>}
            <div className="helm-source-links"><a href={`${sourceUrl}/scripts/globals/hobbies/helm/data.lua`} target="_blank" rel="noreferrer">Phoenix data <ExternalLink size={13} /></a><a href={`${sourceUrl}/modules/era/lua/globals/helm/helm_adjustments.lua`} target="_blank" rel="noreferrer">Era adjustments <ExternalLink size={13} /></a></div>
          </div>}
          {state.view === "Locations" && <div className="helm-locations">
            {gatheringMap ? <div>
              {gatheringMaps.length > 1 && <label>Gathering map<select value={gatheringMap.id} onChange={event => change({ mapId: event.target.value })}>{gatheringMaps.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>}
              <HelmGatheringMap key={gatheringMap.id} map={gatheringMap} />
              <div className="helm-source-links"><a href={gatheringMap.sourceUrl} target="_blank" rel="noreferrer">FFXIclopedia map <ExternalLink size={13} /></a><a href={gatheringMap.activityUrl} target="_blank" rel="noreferrer">{zone.kind} reference <ExternalLink size={13} /></a></div>
              <p className="helm-muted">Wiki gathering locations, not live active points. Phoenix positions may differ.</p>
            </div> : <div>
              <p className="helm-muted">No annotated {zone.kind.toLowerCase()} map is available for this zone. Zone reference only; gathering points are not marked.</p>
              {map ? <><label>Zone map<select value={map.id} onChange={event => change({ mapId: event.target.value })}>{maps.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label><MapView map={map} width={720} showHoverCell /></> : <p>No bundled map is available for this zone.</p>}
              <div className="helm-source-links"><a href={`https://ffxiclopedia.fandom.com/wiki/${zone.kind}`} target="_blank" rel="noreferrer">FFXIclopedia {zone.kind.toLowerCase()} reference <ExternalLink size={13} /></a></div>
            </div>}
          </div>}
        </div>
      </div>}
    </div>
  </section>;
}