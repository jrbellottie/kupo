import { useDeferredValue, useEffect, useState } from "react";
import { ArrowLeft, MapPin, Search, Store, ScrollText, Users } from "lucide-react";
import { NPCS, findNpc, npcCoordinates, npcProfile, npcQuests, type Npc } from "./utils/npcs";
import { normalizeNpcName } from "./utils/npcLinks";
import { navigateToTab, peekNavQuery, hasBackTab, goBackTab, rememberTabState, peekRestoredTabState } from "./utils/tabNav";
import { loadJson, saveJson } from "./utils/storage";
import { findableName } from "./utils/itemLinks";
import MapView, { type MapDef } from "./MapView";
import mapData from "./data/maps.json";
import "./NpcTab.css";
import { CollapsibleSection } from "./ScreenControls";

type State = { query: string; zone: string; role: string; selected: string | null };
const zones = [...new Set(NPCS.map((npc) => npc.zone).filter(Boolean))].sort();
const roles = [...new Set(NPCS.flatMap((npc) => npc.roles))].sort();
const maps = (mapData as { maps: MapDef[] }).maps;

function NpcDetails({ npc }: { npc: Npc }) {
  const profile = npcProfile(npc);
  const coordinates = npcCoordinates(npc);
  const quests = npcQuests(npc);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [mapId, setMapId] = useState("");
  const zoneMaps = maps.filter((map) => normalizeNpcName(map.zone) === normalizeNpcName(npc.zone));
  const map = zoneMaps.find((map) => map.id === mapId) ?? zoneMaps[0];
  const stock = npc.inventory.filter((item) => item.name.toLowerCase().includes(inventoryQuery.toLowerCase()));
  return <article className="npc-detail">
    <header className="npc-detail-heading">
      <div><h2>{npc.name}</h2><div className="npc-muted">{npc.roles.join(" / ") || "NPC"}</div></div>
      <a href={profile?.url ?? `https://ffxiclopedia.fandom.com/wiki/${encodeURIComponent(npc.name.replace(/ /g, "_"))}`} target="_blank" rel="noreferrer">FFXIclopedia</a>
    </header>
    <div className="npc-overview">
      <div>
        <h3><MapPin size={17} /> Location</h3>
        <p>{npc.zone || "Zone unknown"}{coordinates.length > 0 ? ` (${coordinates.join(" / ")})` : " - grid location not recorded"}</p>
        {profile?.location && <p>{profile.location}</p>}
        <dl className="npc-facts">{Object.entries(profile?.fields ?? {}).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value}</dd></div>)}</dl>
        {npc.services.length > 0 && <><h3>Services</h3><ul>{npc.services.map((service) => <li key={service}>{service}</li>)}</ul></>}
        {npc.positions.length > 0 && <details><summary>Game coordinates</summary>{npc.positions.map((position, index) => <p key={index}>X {position.x}, Y {position.y}, Z {position.z}</p>)}</details>}
        {profile?.notes && <details><summary>Wiki notes (may include retail changes)</summary><p className="npc-notes">{profile.notes}</p></details>}
      </div>
      {map && <div className="npc-map">
        {zoneMaps.length > 1 && <label>Zone map<select value={map.id} onChange={(event) => setMapId(event.target.value)}>{zoneMaps.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
        <MapView map={map} highlight={zoneMaps.length === 1 && coordinates.length === 1 ? coordinates[0] : undefined} width={400} showHoverCell />
        {zoneMaps.length > 1 && <span className="npc-muted">NPC map floor not verified.</span>}
      </div>}
    </div>
    <section className="npc-section">
      <h3><Store size={17} /> Inventory <span className="npc-muted">{npc.inventory.length}</span></h3>
      {npc.inventory.length ? <>
        <input aria-label="Filter NPC inventory" placeholder="Filter inventory" value={inventoryQuery} onChange={(event) => setInventoryQuery(event.target.value)} />
        <div className="npc-table-wrap"><table><thead><tr><th>Item</th><th>Recorded Price</th>{npc.guild && <th>Guild Rank</th>}</tr></thead><tbody>
          {stock.map((item, index) => <tr key={`${item.name}:${index}`}><td><button type="button" className="npc-text-link" onClick={() => navigateToTab("drops", findableName(item.name) ?? item.name, "npc")}>{item.name}</button></td><td>{item.price.toLocaleString()} gil</td>{npc.guild && <td>{item.rank ?? "-"}</td>}</tr>)}
          {!stock.length && <tr><td colSpan={npc.guild ? 3 : 2}>No matching items.</td></tr>}
        </tbody></table></div>
        <p className="npc-muted">Prices and stock can vary with fame, conquest, guild rank, and availability.</p>
      </> : <p className="npc-muted">No vendor inventory recorded.</p>}
    </section>
    <section className="npc-section">
      <h3><ScrollText size={17} /> Quests &amp; Missions <span className="npc-muted">{quests.length}</span></h3>
      {quests.length ? <ul className="npc-quests">{quests.map((quest) => <li key={quest.id}>
        <button type="button" className="npc-text-link" onClick={() => navigateToTab("quests", quest.id, "npc")}>{quest.name}</button>
        <span className="npc-muted">{quest.relation} / {quest.type}</span>
        {quest.requirements && <div>Requires: {quest.requirements}</div>}
        {quest.reward && <div className="npc-muted">Reward: {quest.reward}</div>}
      </li>)}</ul> : <p className="npc-muted">No linked quests or missions in the bundled data.</p>}
    </section>
  </article>;
}

export default function NpcTab() {
  const [state, setState] = useState<State>(() => {
    const saved = peekRestoredTabState<State>("npc") ?? loadJson<State>("kupo.npc.ui", { query: "", zone: "", role: "", selected: null });
    const incoming = peekNavQuery("npc");
    const npc = incoming ? findNpc(incoming) : undefined;
    return incoming ? { query: npc?.name ?? incoming, zone: "", role: "", selected: npc?.id ?? null } : saved;
  });
  useEffect(() => { saveJson("kupo.npc.ui", state); rememberTabState("npc", state); }, [state]);
  const query = useDeferredValue(state.query);
  const filtered = NPCS.filter((npc) => (!state.zone || npc.zone === state.zone) && (!state.role || npc.roles.includes(state.role)) &&
    (!query || normalizeNpcName([npc.name, npc.zone, ...npc.services, ...npc.inventory.map((item) => item.name)].join(" ")).includes(normalizeNpcName(query))));
  const selected = filtered.find((npc) => npc.id === state.selected) ?? filtered[0];
  return <section className="npc-tab">
    <header className="npc-title"><h2><Users size={23} /> NPC</h2><span className="npc-muted">{filtered.length} {filtered.length === 1 ? "NPC" : "NPCs"}</span>{hasBackTab() && <button type="button" className="npc-back" onClick={goBackTab} title="Return to previous tab"><ArrowLeft size={17} /> Back</button>}</header>
    <div className="npc-layout">
      <aside className="npc-browser">
        <CollapsibleSection kind="search">
        <label><span><Search size={15} /> Search</span><input placeholder="NPC, location, or item" value={state.query} onChange={(event) => setState({ ...state, query: event.target.value })} /></label>
        <label>Zone<select value={state.zone} onChange={(event) => setState({ ...state, zone: event.target.value })}><option value="">All zones</option>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
        <label>Role<select value={state.role} onChange={(event) => setState({ ...state, role: event.target.value })}><option value="">All roles</option>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
        </CollapsibleSection>
        <div className="npc-list">{filtered.slice(0, 150).map((npc) => <button type="button" key={npc.id} aria-pressed={selected?.id === npc.id} onClick={() => setState({ ...state, selected: npc.id })}><strong>{npc.name}</strong><span>{npc.zone}</span><small>{npc.roles.join(" / ")}</small></button>)}</div>
        {filtered.length > 150 && <p className="npc-muted">Showing 150 of {filtered.length} NPCs.</p>}
      </aside>
      {selected ? <NpcDetails key={selected.id} npc={selected} /> : <p className="npc-empty">No matching NPCs.</p>}
    </div>
  </section>;
}