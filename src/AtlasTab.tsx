// src/AtlasTab.tsx — browse FFXI zone maps with a hoverable coordinate grid.
import React, { useEffect, useMemo, useState } from "react";
import MapView, { MapDef } from "./MapView";
import mapData from "./data/maps.json";
import AlzadaalRoute from "./AlzadaalRoute";
import { loadJson, saveJson } from "./utils/storage";
import { CollapsibleSection } from "./ScreenControls";

const MAPS = (mapData as { maps: MapDef[] }).maps;

const inputStyle: React.CSSProperties = {
  background: "#0c0c0c",
  color: "#eaeaea",
  border: "1px solid #444",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
};

function AtlasMapBrowser() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [coord, setCoord] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? MAPS.filter((m) => m.name.toLowerCase().includes(q)) : MAPS;
  }, [query]);

  const selected = MAPS.find((m) => m.id === selectedId) ?? filtered[0] ?? null;
  const coordValid = /^[A-Pa-p]-\d{1,2}$/.test(coord.trim());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <CollapsibleSection kind="search">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          style={{ ...inputStyle, minWidth: 220 }}
          placeholder="Search maps…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select style={inputStyle} value={selected?.id ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
          {filtered.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <input
          style={{ ...inputStyle, width: 150 }}
          placeholder="Highlight cell (H-9)"
          title="Type a coordinate like H-9 to highlight that grid cell on the map"
          value={coord}
          onChange={(e) => setCoord(e.target.value)}
        />
        <span style={{ color: "#9aa0b8", fontSize: 12 }}>{MAPS.length} maps — hover the map to read coordinates</span>
      </div>
      </CollapsibleSection>

      {selected && (
        <MapView map={selected} width={560} showHoverCell highlight={coordValid ? coord.trim() : null} />
      )}
    </div>
  );
}

export default function AtlasTab() {
  const [mode, setMode] = useState<"maps" | "routes">(() => loadJson<unknown>("kupo.atlas.mode", "maps") === "routes" ? "routes" : "maps");
  useEffect(() => {
    try { saveJson("kupo.atlas.mode", mode); } catch {}
  }, [mode]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <CollapsibleSection kind="tabs">
      <div className="atlas-subtabs" role="tablist" aria-label="Atlas views" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "maps" : event.key === "End" ? "routes" : mode === "maps" ? "routes" : "maps";
        setMode(next);
        document.getElementById(`atlas-tab-${next}`)?.focus();
      }}>
        <button type="button" role="tab" id="atlas-tab-maps" aria-controls="atlas-panel-maps" aria-selected={mode === "maps"} tabIndex={mode === "maps" ? 0 : -1} onClick={() => setMode("maps")}>Maps</button>
        <button type="button" role="tab" id="atlas-tab-routes" aria-controls="atlas-panel-routes" aria-selected={mode === "routes"} tabIndex={mode === "routes" ? 0 : -1} onClick={() => setMode("routes")}>Alzadaal Routes</button>
      </div>
      </CollapsibleSection>
      <div role="tabpanel" id="atlas-panel-maps" aria-labelledby="atlas-tab-maps" hidden={mode !== "maps"}><AtlasMapBrowser /></div>
      <div role="tabpanel" id="atlas-panel-routes" aria-labelledby="atlas-tab-routes" hidden={mode !== "routes"}><AlzadaalRoute /></div>
    </div>
  );
}
