// src/BcnmTab.tsx
import React, { useMemo, useState } from "react";
import { styles } from "./styles";
import { CollapsibleSection } from "./ScreenControls";
import { loadJson, saveJson } from "./utils/storage";
import { findableName } from "./utils/itemLinks";
import { navigateToTab, peekNavQuery, hasBackTab, goBackTab } from "./utils/tabNav";
import bcnmData from "./data/bcnm.json";

type LootEntry = {
  /** Prettified item name; null = nothing drops from this roll. */
  item: string | null;
  weight: number;
  /** Stack size / gil amount, when > 1. */
  amount: number | null;
};

type LootSlot = {
  quantity: number;
  entries: LootEntry[];
};

type Battlefield = {
  name: string;
  desc: string | null;
  arena: string;
  type: "BCNM" | "KSNM" | "ENM" | "Other";
  levelCap: number | null;
  maxPlayers: number | null;
  timeLimitMin: number | null;
  orb: string | null;
  keyItem: string | null;
  slots: LootSlot[];
};

const BATTLEFIELDS = (bcnmData as { battlefields: Battlefield[] }).battlefields;
const ARENAS = Array.from(new Set(BATTLEFIELDS.map((b) => b.arena)));

const TYPES = ["BCNM", "KSNM", "ENM", "Other"] as const;
type BfType = (typeof TYPES)[number];

const TYPE_COLORS: Record<BfType, string> = {
  BCNM: "#7ec4e8",
  KSNM: "#ffa552",
  ENM: "#c9a2ff",
  Other: "#9aa0b8",
};

const UI_KEY = "ffxi_bcnm_ui_v1";

type BcnmUiState = {
  arena: string; // "" = all
  query: string;
  types: BfType[]; // empty = all
};

function normalizeState(raw: unknown): BcnmUiState {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const arena = typeof obj.arena === "string" && ARENAS.includes(obj.arena) ? obj.arena : "";
  const query = typeof obj.query === "string" ? obj.query : "";
  const types = Array.isArray(obj.types) ? (obj.types.filter((t) => TYPES.includes(t as BfType)) as BfType[]) : [];
  return { arena, query, types };
}

const thStyle: React.CSSProperties = {
  background: "#161616",
  color: "#eaeaea",
  textAlign: "left",
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 800,
  borderBottom: "1px solid #444",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 13,
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  whiteSpace: "nowrap",
};

function formatPct(weight: number, total: number): string {
  const p = (weight / total) * 100;
  return `${p >= 10 ? p.toFixed(1) : p.toFixed(2)}%`;
}

const highlightStyle: React.CSSProperties = {
  background: "#8af6b0",
  color: "#0c0c0c",
  borderRadius: 3,
  padding: "0 1px",
  fontWeight: 700,
};

const itemLinkStyle: React.CSSProperties = {
  color: "#7ec4e8",
  cursor: "pointer",
  textDecoration: "underline",
  textDecorationColor: "rgba(126,196,232,0.35)",
  textUnderlineOffset: 2,
};

/** Wraps every case-insensitive occurrence of q in text with a highlight span. */
function highlightText(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let pos = 0;
  let idx = lower.indexOf(q);
  while (idx >= 0) {
    if (idx > pos) parts.push(text.slice(pos, idx));
    parts.push(
      <span key={idx} style={highlightStyle}>
        {text.slice(idx, idx + q.length)}
      </span>
    );
    pos = idx + q.length;
    idx = lower.indexOf(q, pos);
  }
  if (parts.length === 0) return text;
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

function metaLine(bf: Battlefield): string {
  const bits: string[] = [];
  bits.push(bf.levelCap ? `Lv.${bf.levelCap}` : "Uncapped");
  if (bf.maxPlayers) bits.push(`${bf.maxPlayers} players`);
  if (bf.timeLimitMin) bits.push(`${bf.timeLimitMin} min`);
  if (bf.orb) bits.push(bf.orb);
  else if (bf.keyItem) bits.push(`${bf.keyItem} (KI)`);
  return bits.join(" \u00b7 ");
}

function bfKey(bf: Battlefield): string {
  return `${bf.arena}|${bf.name}`;
}

function bfMatches(bf: Battlefield, q: string): boolean {
  if (bf.name.toLowerCase().includes(q)) return true;
  if (bf.desc && bf.desc.toLowerCase().includes(q)) return true;
  if (bf.arena.toLowerCase().includes(q)) return true;
  return bf.slots.some((slot) => slot.entries.some((e) => e.item && e.item.toLowerCase().includes(q)));
}

export default function BcnmTab() {
  const [ui, setUi] = useState<BcnmUiState>(() => {
    const base = normalizeState(loadJson<unknown>(UI_KEY, {}));
    const navQuery = peekNavQuery("bcnm");
    return navQuery ? { ...base, query: navQuery, arena: "", types: [] } : base;
  });
  // Arriving via an item link auto-opens the matching battlefields.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const navQuery = peekNavQuery("bcnm");
    if (!navQuery) return {};
    const q = navQuery.trim().toLowerCase();
    const out: Record<string, boolean> = {};
    for (const bf of BATTLEFIELDS) if (bfMatches(bf, q)) out[bfKey(bf)] = true;
    return out;
  });

  const update = (patch: Partial<BcnmUiState>) => {
    setUi((prev) => {
      const next = { ...prev, ...patch };
      saveJson(UI_KEY, next);
      return next;
    });
  };

  const query = ui.query.trim().toLowerCase();

  const toggleType = (t: BfType) => {
    const next = ui.types.includes(t) ? ui.types.filter((x) => x !== t) : [...ui.types, t];
    update({ types: next });
  };

  const filtered = useMemo(() => {
    return BATTLEFIELDS.filter((bf) => {
      if (ui.arena && bf.arena !== ui.arena) return false;
      if (ui.types.length > 0 && !ui.types.includes(bf.type)) return false;
      if (query && !bfMatches(bf, query)) return false;
      return true;
    });
  }, [ui.arena, ui.types, query]);

  const allShownOpen = filtered.length > 0 && filtered.every((bf) => open[bfKey(bf)]);

  const toggleAll = () => {
    const next: Record<string, boolean> = { ...open };
    for (const bf of filtered) next[bfKey(bf)] = !allShownOpen;
    setOpen(next);
  };

  let currentArena: string | null = null;

  return (
    <section style={styles.card}>
      <div style={styles.titleRow}>
        <h3 style={styles.h3}>BCNM / KSNM Drops</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          <div style={styles.sub}>Loot tables from LandSandBoat; each slot rolls independently</div>
          {hasBackTab() && (
            <button style={styles.buttonCompact} onClick={goBackTab} title="Return to your previous search">
              ← Back
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
        <CollapsibleSection kind="search">
        <div style={styles.subCard}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={styles.field}>
              <label style={styles.label}>Arena</label>
              <select value={ui.arena} onChange={(e) => update({ arena: e.target.value })} style={styles.select}>
                <option value="">All arenas</option>
                {ARENAS.map((arena) => (
                  <option key={arena} value={arena}>
                    {arena}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Type</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  style={{
                    ...styles.buttonCompact,
                    ...(ui.types.length === 0 ? { borderColor: "#8af6b0", color: "#8af6b0" } : {}),
                  }}
                  onClick={() => update({ types: [] })}
                >
                  All
                </button>
                {TYPES.map((t) => (
                  <button
                    key={t}
                    style={{
                      ...styles.buttonCompact,
                      ...(ui.types.includes(t) ? { borderColor: TYPE_COLORS[t], color: TYPE_COLORS[t] } : {}),
                    }}
                    onClick={() => toggleType(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Search (BC name or item)</label>
              <input
                type="text"
                placeholder="e.g. peacock charm"
                value={ui.query}
                onChange={(e) => update({ query: e.target.value })}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>&nbsp;</label>
              <button style={styles.buttonCompact} onClick={toggleAll} disabled={filtered.length === 0}>
                {allShownOpen ? "Collapse all" : "Expand all"}
              </button>
            </div>
          </div>

          <div style={{ ...styles.sub, marginTop: 8 }}>
            {filtered.length} of {BATTLEFIELDS.length} battlefields
          </div>
        </div>
        </CollapsibleSection>

        {filtered.map((bf) => {
          const key = bfKey(bf);
          const isOpen = !!open[key];
          const arenaHeader =
            bf.arena !== currentArena ? (
              <div style={{ fontSize: 14, fontWeight: 800, opacity: 0.9, margin: "4px 0 -4px" }}>
                {highlightText(bf.arena, query)}
              </div>
            ) : null;
          currentArena = bf.arena;

          return (
            <React.Fragment key={key}>
              {arenaHeader}
              <div style={styles.subCard}>
                <div
                  style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline", cursor: "pointer" }}
                  onClick={() => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
                >
                  <span style={{ fontWeight: 800, color: isOpen ? "#8af6b0" : "#eaeaea" }}>
                    {isOpen ? "\u25be" : "\u25b8"} {highlightText(bf.name, query)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: TYPE_COLORS[bf.type] }}>{bf.type}</span>
                  <span style={styles.sub}>{highlightText(metaLine(bf), query)}</span>
                  {bf.desc && <span style={{ ...styles.sub, opacity: 0.55 }}>{highlightText(bf.desc, query)}</span>}
                </div>

                {isOpen && (
                  <div
                    style={{
                      marginTop: 10,
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                      alignItems: "start",
                    }}
                  >
                    {bf.slots.map((slot, idx) => {
                      const total = slot.entries.reduce((s, e) => s + e.weight, 0);
                      const rows = slot.entries.slice().sort((a, b) => b.weight - a.weight);
                      return (
                        <div key={idx} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <th style={thStyle}>
                                  Slot {idx + 1}
                                  {slot.quantity > 1 && (
                                    <span style={{ marginLeft: 6, fontWeight: 400, color: "#8af6b0" }}>
                                      {"\u00d7"}{slot.quantity} rolls
                                    </span>
                                  )}
                                </th>
                                <th style={{ ...thStyle, textAlign: "right" }}>Drop</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((e, i) => {
                                const target = e.item && e.item !== "Gil" ? findableName(e.item) : null;
                                return (
                                  <tr key={i}>
                                    <td style={{ ...tdStyle, ...(e.item ? {} : { opacity: 0.5, fontStyle: "italic" }) }}>
                                      {target ? (
                                        <span
                                          style={itemLinkStyle}
                                          title={`Find every source of ${target}`}
                                          onClick={(ev) => {
                                            ev.stopPropagation();
                                            navigateToTab("drops", target, "bcnm");
                                          }}
                                        >
                                          {highlightText(e.item!, query)}
                                        </span>
                                      ) : e.item ? (
                                        highlightText(e.item, query)
                                      ) : (
                                        "Nothing"
                                      )}
                                      {e.amount != null && e.amount > 1 && (
                                        <span style={{ color: "#ffa552" }}> {"\u00d7"}{e.amount.toLocaleString()}</span>
                                      )}
                                    </td>
                                    <td style={{ ...tdStyle, textAlign: "right" }}>{formatPct(e.weight, total)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}

        {filtered.length === 0 && <div style={styles.sub}>No battlefields match the current filters.</div>}
      </div>
    </section>
  );
}
