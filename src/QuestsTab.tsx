// src/QuestsTab.tsx
import React, { useEffect, useMemo, useState } from "react";
import { CollapsibleSection } from "./ScreenControls";
import { loadJson, saveJson } from "./utils/storage";
import questData from "./data/quests.json";
import mapData from "./data/maps.json";
import MapView, { MapDef } from "./MapView";
import { captureScrollPosition, restoreScrollPosition, type ScrollPosition } from "./utils/scrollPosition";
import NpcLink from "./NpcLink";
import NpcText from "./NpcText";
import { peekNavQuery, peekRestoredTabState, rememberTabState, hasBackTab, goBackTab } from "./utils/tabNav";

type ChainLink = { name: string; id: string | null };

type MapRef = { zone: string; mapNo: number | null; pos: string };
type StepRef = MapRef & { step: number; occurrence?: number };
type HeadingRef = { step: number; zone: string };

type Entry = {
  id: string;
  name: string;
  pageTitle: string;
  type: "quest" | "mission";
  group: string;
  number: string | null;
  startNpc: string | null;
  startZone: string | null;
  startCoord: string | null;
  requirements: string | null;
  fame: number | null;
  fameArea: string | null;
  level: string | null;
  items: string[];
  keyItems: string[];
  titles: string[];
  repeatable: boolean | null;
  reward: string | null;
  previous: ChainLink[];
  next: ChainLink[];
  walkthrough: string[];
  client: string | null;
  summary: string | null;
  coords: string[];
  mapRefs: MapRef[];
  stepRefs?: StepRef[];
  headingRefs?: HeadingRef[];
  url: string;
};

const MAPS = (mapData as { maps: MapDef[] }).maps;

/** Tolerant zone comparison: "The Sanctuary of Zi'Tah" / "Windurst Waters (North)" etc. */
const normZone = (z: string) =>
  z.toLowerCase().replace(/^the /, "").replace(/#/g, "").replace(/\s*\((?:north|south)\)$/, "").replace(/ (?:north|south)$/, "").trim().replace(/^bibiki bay - purgonorgo isle$/, "bibiki bay");

const DATA = questData as { quests: Entry[]; missions: Entry[] };
const ALL: Entry[] = [...DATA.quests, ...DATA.missions];
const BY_ID = new Map(ALL.map((e) => [e.id, e]));

const QUEST_GROUPS = Array.from(new Set(DATA.quests.map((e) => e.group)));
const MISSION_GROUPS = Array.from(new Set(DATA.missions.map((e) => e.group)));

const zonesOf = (list: Entry[]) =>
  Array.from(new Set(list.map((e) => e.startZone).filter((z): z is string => !!z))).sort();
const QUEST_ZONES = zonesOf(DATA.quests);
const MISSION_ZONES = zonesOf(DATA.missions);

// Precomputed lowercase search blob per entry
const SEARCH = new Map(
  ALL.map((e) => [
    e.id,
    [e.name, e.number, e.startNpc, e.startZone, e.startCoord, e.requirements, e.reward, e.client, e.summary,
      ...e.items, ...e.keyItems, ...e.titles, ...e.walkthrough]
      .filter(Boolean)
      .join("\n")
      .toLowerCase(),
  ])
);

const UI_KEY = "ffxi_quests_ui_v1";

type SubTab = "quests" | "missions";

type UiState = {
  sub: SubTab;
  query: string;
  questGroup: string;
  missionGroup: string;
  zone: string;
  fame: string; // "" or "1".."9"
  repeatable: "" | "yes" | "no";
  selectedId: string | null;
};

function normalizeState(raw: unknown): UiState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    sub: o.sub === "missions" ? "missions" : "quests",
    query: typeof o.query === "string" ? o.query : "",
    questGroup: typeof o.questGroup === "string" && QUEST_GROUPS.includes(o.questGroup) ? o.questGroup : "",
    missionGroup: typeof o.missionGroup === "string" && MISSION_GROUPS.includes(o.missionGroup) ? o.missionGroup : "",
    zone: typeof o.zone === "string" ? o.zone : "",
    fame: typeof o.fame === "string" && /^[1-9]?$/.test(o.fame) ? o.fame : "",
    repeatable: o.repeatable === "yes" || o.repeatable === "no" ? o.repeatable : "",
    selectedId: typeof o.selectedId === "string" && BY_ID.has(o.selectedId) ? o.selectedId : null,
  };
}

const GROUP_COLORS: Record<string, string> = {
  Bastok: "#7ec4e8",
  "San d'Oria": "#e87e7e",
  Windurst: "#8fd18f",
  Jeuno: "#e8d47e",
  Outlands: "#c9a2ff",
  "Aht Urhgan": "#ffa552",
  Other: "#9aa0b8",
  "Mog House Exit": "#9aa0b8",
  "Rise of the Zilart": "#c9a2ff",
  "Chains of Promathia": "#7ea2e8",
  "Treasures of Aht Urhgan": "#ffa552",
  Assault: "#d1b26f",
};

const thStyle: React.CSSProperties = {
  background: "#161616",
  color: "#eaeaea",
  textAlign: "left",
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 800,
  borderBottom: "1px solid #444",
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const tdStyle: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 13,
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  verticalAlign: "top",
};

const inputStyle: React.CSSProperties = {
  background: "#0c0c0c",
  color: "#eaeaea",
  border: "1px solid #444",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
};

const chipStyle = (active: boolean, color: string): React.CSSProperties => ({
  background: active ? color : "#161616",
  color: active ? "#0c0c0c" : "#eaeaea",
  border: `1px solid ${active ? color : "#444"}`,
  borderRadius: 999,
  padding: "4px 12px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
});

const COORD_RE = /([A-P]-\d{1,2})/g;

/** Render step text with map coordinates highlighted (hover/click to spotlight them on the maps). */
function CoordText({
  text,
  onHover,
  onPick,
}: {
  text: string;
  onHover?: (coord: string | null, occurrence?: number) => void;
  onPick?: (coord: string, occurrence?: number) => void;
}) {
  const parts = text.split(COORD_RE);
  const occurrences = new Map<string, number>();
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <NpcText key={i} text={p} />;
        const occurrence = occurrences.get(p) ?? 0;
        occurrences.set(p, occurrence + 1);
        return (
          <span
            key={i}
            style={{ color: "#ffd166", fontWeight: 700, cursor: onPick ? "pointer" : undefined, textDecoration: onPick ? "underline dotted" : undefined }}
            onMouseEnter={onHover ? () => onHover(p, occurrence) : undefined}
            onMouseLeave={onHover ? () => onHover(null) : undefined}
            onClick={onPick ? () => onPick(p, occurrence) : undefined}
          >
            {p}
          </span>
        );
      })}
    </>
  );
}

function ChainLinks({ label, links, onOpen }: { label: string; links: ChainLink[]; onOpen: (id: string) => void }) {
  if (!links.length) return null;
  return (
    <div style={{ fontSize: 13 }}>
      <span style={{ color: "#9aa0b8", fontWeight: 700 }}>{label}: </span>
      {links.map((l, i) => (
        <React.Fragment key={i}>
          {i > 0 && ", "}
          {l.id && BY_ID.has(l.id) ? (
            <a
              style={{ color: "#7ec4e8", cursor: "pointer", textDecoration: "underline" }}
              onClick={() => onOpen(l.id!)}
            >
              {l.name}
            </a>
          ) : (
            <span>{l.name}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function Detail({ entry, onOpen, onBack }: { entry: Entry; onOpen: (id: string) => void; onBack: () => void }) {
  const color = GROUP_COLORS[entry.group] ?? "#9aa0b8";
  type Spot = { coord: string; mapIds: string[] }; // mapIds empty = all shown maps
  const [pinned, setPinned] = useState<Spot | null>(null);
  const [hovered, setHovered] = useState<Spot | null>(null);
  const active = hovered ?? pinned;

  // Structured refs from the wiki, plus a synthesized one for the start location so quests
  // without {{Location}} templates (plain-text coords) still get their zone map
  const refs = useMemo(() => {
    const out = [...(entry.mapRefs ?? []), ...(entry.stepRefs ?? []), ...(entry.headingRefs ?? []).map((r) => ({ ...r, mapNo: null, pos: "" }))];
    if (entry.startZone && !out.some((r) => normZone(r.zone) === normZone(entry.startZone!))) {
      out.unshift({ zone: entry.startZone, mapNo: null, pos: entry.startCoord ?? "" });
    }
    return out;
  }, [entry]);

  // Maps referenced by this quest's {{Location}} tooltips, in first-mention order
  const shownMaps = useMemo(() => {
    const out: MapDef[] = [];
    for (const ref of refs) {
      for (const m of MAPS) {
        if (normZone(m.zone) !== normZone(ref.zone)) continue;
        if (ref.mapNo != null && m.mapNo !== ref.mapNo) continue;
        if (!out.includes(m)) out.push(m);
      }
    }
    return out;
  }, [refs]);

  /** Should this map highlight the active coordinate? */
  const highlightFor = (m: MapDef): string | null =>
    active && (!active.mapIds.length || active.mapIds.includes(m.id)) ? active.coord : null;

  // Resolve explicit refs from the full registry. The panel's broad page-level map list can
  // contain unrelated zones (such as Ru'Lude Gardens) with the same coordinate.
  const mapsForRefs = (rs: MapRef[]) =>
    MAPS.filter((m) => rs.some((r) => normZone(r.zone) === normZone(m.zone) && (r.mapNo == null || r.mapNo === m.mapNo)));

  /** Which maps does this coordinate belong to? Step-scoped refs, then nearest zone mention, then page refs. */
  const resolveMaps = (coord: string, stepIdx?: number, occurrence?: number): MapDef[] => {
    // Start-NPC coordinate always belongs to the start zone (other zones may reuse the same cell)
    if (stepIdx == null && entry.startZone && coord === entry.startCoord) {
      const startMaps = MAPS.filter((m) => normZone(m.zone) === normZone(entry.startZone!));
      if (startMaps.length) return startMaps;
    }
    if (stepIdx != null) {
      const stepRefs = (entry.stepRefs ?? []).filter((r) => r.step === stepIdx && r.pos === coord);
      const occurrenceRefs = occurrence == null ? [] : stepRefs.filter((r) => r.occurrence === occurrence);
      const scoped = mapsForRefs(occurrenceRefs.length ? occurrenceRefs : stepRefs);
      if (scoped.length) return scoped;
      // Nearest zone name mentioned in this step or an earlier one
      for (let i = stepIdx; i >= 0; i--) {
        const text = (entry.walkthrough[i] ?? "").toLowerCase();
        const mentioned = shownMaps.filter((m) => text.includes(normZone(m.zone)) || text.includes(m.zone.toLowerCase()));
        if (mentioned.length) return mentioned;
      }
    }
    return mapsForRefs(refs.filter((r) => r.pos === coord));
  };

  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const activeMap = shownMaps.find((m) => m.id === activeMapId) ?? shownMaps[0] ?? null;
  // Chip list collapses by default when a quest references many maps
  const [mapListOpen, setMapListOpen] = useState(shownMaps.length <= 4);

  // Pin the map panel below the app's sticky nav bar (its height varies as buttons wrap)
  const [stickyTop, setStickyTop] = useState(96);
  useEffect(() => {
    const nav = document.querySelector("nav");
    const update = () => setStickyTop((nav?.getBoundingClientRect().height ?? 80) + 16);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  /** Hover/click handlers bound to a walkthrough step (or the start-NPC row when stepIdx is undefined). */
  const spot = (c: string, stepIdx?: number, occurrence?: number): Spot => {
    const maps = resolveMaps(c, stepIdx, occurrence);
    return { coord: c, mapIds: maps.map((m) => m.id) };
  };
  const handlersFor = (stepIdx?: number) =>
    shownMaps.length
      ? {
          onHover: (c: string | null, occurrence?: number) => {
            if (!c) return setHovered(null);
            const s = spot(c, stepIdx, occurrence);
            setHovered(s);
            if (s.mapIds.length) setActiveMapId(s.mapIds[0]);
          },
          onPick: (c: string, occurrence?: number) => {
            const s = spot(c, stepIdx, occurrence);
            setPinned((p) => (p?.coord === c ? null : s));
            if (s.mapIds.length) setActiveMapId(s.mapIds[0]);
          },
        }
      : {};
  const coordHandlers = handlersFor(undefined);
  const headingMaps = (stepIdx: number) =>
    mapsForRefs((entry.headingRefs ?? []).filter((ref) => ref.step === stepIdx).map((ref) => ({ ...ref, mapNo: null, pos: "" })));

  const info: Array<[string, React.ReactNode]> = [];
  if (entry.number) info.push(["Number", entry.number]);
  if (entry.startNpc)
    info.push([
      "Start NPC",
      <>
        <NpcLink name={entry.startNpc} zone={entry.startZone} from="quests" />
        {entry.startZone ? ` — ${entry.startZone}` : ""}
        {entry.startCoord ? <> (<CoordText text={entry.startCoord} {...coordHandlers} />)</> : ""}
      </>,
    ]);
  if (entry.requirements) info.push(["Requirements", entry.requirements]);
  if (entry.level) info.push(["Level", entry.level]);
  if (entry.items.length) info.push(["Items Needed", entry.items.join(", ")]);
  if (entry.keyItems.length) info.push(["Key Items", entry.keyItems.join(", ")]);
  if (entry.titles.length) info.push(["Title", entry.titles.join(", ")]);
  if (entry.repeatable != null) info.push(["Repeatable", entry.repeatable ? "Yes" : "No"]);
  if (entry.reward) info.push(["Reward", entry.reward]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: shownMaps.length ? "minmax(0, 1fr) 440px" : "1fr", gap: 16 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {/* Sticky under the app nav (zIndex 10) so the title and wiki link stay visible like the map panel */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", position: "sticky", top: stickyTop - 16, zIndex: 5, background: "#0c0c0c", padding: "6px 0" }}>
        <button style={{ ...inputStyle, cursor: "pointer" }} onClick={onBack}>← Back</button>
        <h3 style={{ margin: 0, fontSize: 18 }}>
          {entry.number && <span style={{ color: "#e8d47e" }}>{entry.number} · </span>}
          {entry.name}
        </h3>
        <span style={{ ...chipStyle(true, color), cursor: "default" }}>{entry.group}</span>
        <span style={{ color: "#9aa0b8", fontSize: 12 }}>{entry.type === "mission" ? "Mission" : "Quest"}</span>
        <a href={entry.url} target="_blank" rel="noreferrer" style={{ color: "#7ec4e8", fontSize: 12, marginLeft: "auto" }}>
          ffxiclopedia ↗
        </a>
      </div>

      <table style={{ borderCollapse: "collapse", maxWidth: 720 }}>
        <tbody>
          {info.map(([k, v]) => (
            <tr key={k}>
              <td style={{ ...tdStyle, color: "#9aa0b8", fontWeight: 700, whiteSpace: "nowrap" }}>{k}</td>
              <td style={tdStyle}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ChainLinks label="Previous" links={entry.previous} onOpen={onOpen} />
      <ChainLinks label="Next" links={entry.next} onOpen={onOpen} />

      {entry.walkthrough.length > 0 && (
        <div>
          <h4 style={{ margin: "8px 0 6px", fontSize: 15 }}>Walkthrough</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: 860 }}>
            {entry.walkthrough.map((step, i) => {
              if (step.startsWith("## ")) {
                const maps = headingMaps(i);
                return (
                  <div
                    key={i}
                    style={{ fontWeight: 800, fontSize: 14, color: "#e8d47e", marginTop: 8, cursor: maps.length ? "pointer" : undefined, textDecoration: maps.length ? "underline dotted" : undefined }}
                    onMouseEnter={maps.length ? () => setActiveMapId(maps[0].id) : undefined}
                    onClick={maps.length ? () => setActiveMapId(maps[0].id) : undefined}
                  >
                    <CoordText text={step.slice(3)} {...handlersFor(i)} />
                  </div>
                );
              }
              const indent = (step.length - step.trimStart().length) / 2;
              return (
                <div key={i} style={{ marginLeft: indent * 18, fontSize: 13, lineHeight: 1.45 }}>
                  <span style={{ color: "#9aa0b8" }}>• </span>
                  <CoordText text={step.trim()} {...handlersFor(i)} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {shownMaps.length > 0 && (
        <div style={{ fontSize: 12, color: "#9aa0b8" }}>
          Hover or click a coordinate in the walkthrough to spotlight it on the map panel
          {pinned ? ` (pinned: ${pinned.coord} — click it again to unpin)` : ""}
        </div>
      )}

      {(entry.summary || entry.client) && (
        <div>
          <h4 style={{ margin: "8px 0 6px", fontSize: 15 }}>Game Description</h4>
          {entry.client && (
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: "#9aa0b8", fontWeight: 700 }}>Client: </span>
              {entry.client}
            </div>
          )}
          {entry.summary && (
            <div style={{ fontSize: 13, color: "#c8cbe0", fontStyle: "italic", maxWidth: 860, lineHeight: 1.45 }}>
              {entry.summary}
            </div>
          )}
        </div>
      )}
    </div>

    {activeMap && (
      <div>
        <div style={{ position: "sticky", top: stickyTop, display: "flex", flexDirection: "column", gap: 8 }}>
          {shownMaps.length > 1 && (
            <button
              style={{ ...inputStyle, cursor: "pointer", alignSelf: "flex-start", padding: "4px 10px", fontSize: 12 }}
              onClick={() => setMapListOpen((o) => !o)}
            >
              {mapListOpen ? "▾" : "▸"} Maps ({shownMaps.length})
            </button>
          )}
          {mapListOpen && shownMaps.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 180, overflowY: "auto" }}>
              {shownMaps.map((m) => (
                <button
                  key={m.id}
                  style={chipStyle(m.id === activeMap.id, "#7ec4e8")}
                  onClick={() => setActiveMapId(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
          <MapView map={activeMap} width={420} highlight={highlightFor(activeMap)} />
        </div>
      </div>
    )}
    </div>
  );
}

const numKey = (n: string | null) => (n ? n.split("-").map((x) => x.padStart(3, "0")).join(".") : "999");
let listScroll: ScrollPosition | null = null;

export default function QuestsTab() {
  const [ui, setUi] = useState<UiState>(() => {
    const saved = normalizeState(peekRestoredTabState<UiState>("quests") ?? loadJson(UI_KEY, null));
    const query = peekNavQuery("quests");
    const entry = query ? BY_ID.get(query) ?? ALL.find((entry) => entry.name === query) : undefined;
    return entry ? { ...saved, sub: entry.type === "mission" ? "missions" : "quests", selectedId: entry.id } : saved;
  });

  useEffect(() => { saveJson(UI_KEY, ui); rememberTabState("quests", ui); }, [ui]);

  const set = (patch: Partial<UiState>) => setUi((u) => ({ ...u, ...patch }));
  const selectedId = ui.selectedId;
  const setSelectedId = (id: string | null) => {
    if (!selectedId && id) listScroll = captureScrollPosition();
    set({ selectedId: id });
    if (!id && listScroll) restoreScrollPosition(listScroll);
  };

  const list = ui.sub === "quests" ? DATA.quests : DATA.missions;
  const groups = ui.sub === "quests" ? QUEST_GROUPS : MISSION_GROUPS;
  const group = ui.sub === "quests" ? ui.questGroup : ui.missionGroup;
  const zones = ui.sub === "quests" ? QUEST_ZONES : MISSION_ZONES;

  const filtered = useMemo(() => {
    const q = ui.query.trim().toLowerCase();
    const fame = ui.fame ? parseInt(ui.fame, 10) : null;
    let out = list.filter((e) => {
      if (group && e.group !== group) return false;
      if (ui.zone && e.startZone !== ui.zone) return false;
      if (fame != null && (e.fame == null || e.fame > fame)) return false;
      if (ui.repeatable && (e.repeatable == null || e.repeatable !== (ui.repeatable === "yes"))) return false;
      if (q && !SEARCH.get(e.id)!.includes(q)) return false;
      return true;
    });
    if (ui.sub === "missions")
      out = [...out].sort((a, b) => a.group.localeCompare(b.group) || numKey(a.number).localeCompare(numKey(b.number)) || a.name.localeCompare(b.name));
    return out;
  }, [list, group, ui.zone, ui.fame, ui.repeatable, ui.query, ui.sub]);

  const selected = selectedId ? BY_ID.get(selectedId) : null;

  if (selected) {
    return (
      <Detail
        key={selected.id}
        entry={selected}
        onOpen={(id) => setSelectedId(id)}
        onBack={() => hasBackTab() ? goBackTab() : setSelectedId(null)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <CollapsibleSection kind="tabs">
      <div style={{ display: "flex", gap: 8 }}>
        {(["quests", "missions"] as SubTab[]).map((s) => (
          <button key={s} style={chipStyle(ui.sub === s, "#7ec4e8")} onClick={() => set({ sub: s, zone: "" })}>
            {s === "quests" ? `Quests (${DATA.quests.length})` : `Missions (${DATA.missions.length})`}
          </button>
        ))}
      </div>
      </CollapsibleSection>

      <CollapsibleSection kind="search">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={chipStyle(group === "", "#9aa0b8")} onClick={() => set(ui.sub === "quests" ? { questGroup: "" } : { missionGroup: "" })}>
          All
        </button>
        {groups.map((g) => (
          <button
            key={g}
            style={chipStyle(group === g, GROUP_COLORS[g] ?? "#9aa0b8")}
            onClick={() => set(ui.sub === "quests" ? { questGroup: group === g ? "" : g } : { missionGroup: group === g ? "" : g })}
          >
            {g}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          style={{ ...inputStyle, minWidth: 260 }}
          placeholder="Search name, NPC, item, reward, walkthrough…"
          value={ui.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        <select style={inputStyle} value={ui.zone} onChange={(e) => set({ zone: e.target.value })}>
          <option value="">All start zones</option>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        {ui.sub === "quests" && (
          <>
            <select style={inputStyle} value={ui.fame} onChange={(e) => set({ fame: e.target.value })}>
              <option value="">Any fame</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((f) => (
                <option key={f} value={String(f)}>Fame ≤ {f}</option>
              ))}
            </select>
            <select style={inputStyle} value={ui.repeatable} onChange={(e) => set({ repeatable: e.target.value as UiState["repeatable"] })}>
              <option value="">Repeatable?</option>
              <option value="yes">Repeatable</option>
              <option value="no">Not repeatable</option>
            </select>
          </>
        )}
        <span style={{ color: "#9aa0b8", fontSize: 12 }}>{filtered.length} shown</span>
      </div>
      </CollapsibleSection>

      <div style={{ overflowX: "auto", maxHeight: "70vh", overflowY: "auto", border: "1px solid #2a2a2a", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {ui.sub === "missions" && <th style={thStyle}>No.</th>}
              <th style={thStyle}>Name</th>
              <th style={thStyle}>{ui.sub === "quests" ? "Area" : "Storyline"}</th>
              <th style={thStyle}>Start NPC</th>
              <th style={thStyle}>Zone</th>
              {ui.sub === "quests" && <th style={thStyle}>Fame</th>}
              <th style={thStyle}>Items</th>
              <th style={thStyle}>Reward</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr
                key={e.id}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedId(e.id)}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "")}
              >
                {ui.sub === "missions" && <td style={{ ...tdStyle, whiteSpace: "nowrap", color: "#9aa0b8" }}>{e.number ?? ""}</td>}
                <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: "nowrap" }}>{e.name}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap", color: GROUP_COLORS[e.group] ?? "#eaeaea" }}>{e.group}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{e.startNpc ? <NpcLink name={e.startNpc} zone={e.startZone} from="quests" /> : "—"}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {e.startZone ?? "—"}
                  {e.startCoord ? <span style={{ color: "#ffd166" }}> ({e.startCoord})</span> : null}
                </td>
                {ui.sub === "quests" && (
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{e.fame != null ? `${e.fameArea ?? ""} ${e.fame}`.trim() : "—"}</td>
                )}
                <td style={{ ...tdStyle, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.items.join(", ") || "—"}
                </td>
                <td style={{ ...tdStyle, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.reward ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
