// src/DropsTab.tsx — the Items tab: mob drop tables generated from LandSandBoat
// SQL (src/data/drops.json) plus every other in-app source per item (shops,
// guilds, BCNM, gathering, fishing, digging, clamming, quests).
import React, { useEffect, useMemo, useState } from "react";
import { styles } from "./styles";
import { CollapsibleSection } from "./ScreenControls";
import { loadJson, saveJson } from "./utils/storage";
import { craftSearchName, normalizeItemName } from "./utils/itemLinks";
import { getPurificationOrigin, purificationMatches } from "./utils/purification";
import { ArrowLeft } from "lucide-react";
import { navigateToTab, peekNavQuery, hasBackTab, goBackTab } from "./utils/tabNav";
import { rememberTabState, peekRestoredTabState } from "./utils/tabNav";
import { getItemSources, sourceBadges, allSourcedItems, questRewardsFor, recipesUsingItem } from "./utils/itemSources";
import dropsData from "./data/drops.json";
import NpcLink from "./NpcLink";
import { NPCS } from "./utils/npcs";

const ItemInfo = React.lazy(() => import("./ItemInfo"));

type ItemInfo = {
  /** Display name. */
  n: string;
  /** Stack size. */
  st: number;
  /** Vendor sell price (LSB BaseSell). */
  sell: number;
  /** 1 = listable on the auction house. */
  ah: number;
};

/** [dropType, groupId, groupRate, itemId, itemRate] — rates are per-mille. */
type DropTuple = [number, number, number, number, number];

type MobEntry = {
  name: string;
  zone: string;
  drop: number;
  lv: [number, number] | null;
  nm: number;
  /** 1 = available on a Nov-2007-era (pre-WotG) server. */
  era: number;
};

type DropsData = {
  items: Record<string, ItemInfo>;
  drops: Record<string, DropTuple[]>;
  mobs: MobEntry[];
};

const DATA = dropsData as unknown as DropsData;

type DropKind = "Drop" | "Steal" | "Despoil" | "Other";

type Row = {
  item: string;
  /** normalizeItemName(item), precomputed for punctuation-tolerant search. */
  itemNorm: string;
  itemId: number;
  mob: string;
  zone: string;
  lv: [number, number] | null;
  kind: DropKind;
  /** Effective drop chance in percent. */
  rate: number;
  /** True for grouped drops (one item of the group is picked). */
  grouped: boolean;
  stack: number;
  sell: number;
  ah: boolean;
  nm: boolean;
  era: boolean;
};

function kindOf(dropType: number): DropKind {
  if (dropType === 2) return "Steal";
  if (dropType === 4) return "Despoil";
  return "Drop";
}

function isValidMobName(name: string): boolean {
  return !name.includes("INSERT INTO") && !name.includes("mob_spawn_points") && !name.includes("NULL,NULL");
}

// Flatten mobs x droplist into searchable rows once at module load.
// Grouped entries (dropType 1): groupRate/1000 chance the group drops at all,
// then itemRate acts as a weight within the group.
function buildRows(): Row[] {
  const rows: Row[] = [];
  // Per-dropId group weight totals: key `${dropId}|${groupId}` -> total weight.
  const groupTotals = new Map<string, number>();
  for (const [dropId, tuples] of Object.entries(DATA.drops)) {
    for (const [type, groupId, , , itemRate] of tuples) {
      if (type !== 1) continue;
      const key = `${dropId}|${groupId}`;
      groupTotals.set(key, (groupTotals.get(key) ?? 0) + itemRate);
    }
  }

  for (const mob of DATA.mobs) {
    if (!isValidMobName(mob.name)) continue;
    const tuples = DATA.drops[String(mob.drop)];
    if (!tuples) continue;
    for (const [type, groupId, groupRate, itemId, itemRate] of tuples) {
      if (itemId === 0) continue; // "nothing" slot inside a group
      const info = DATA.items[String(itemId)];
      if (!info) continue;
      let rate: number;
      if (type === 1) {
        const total = groupTotals.get(`${mob.drop}|${groupId}`) ?? 0;
        rate = total > 0 ? (groupRate / 1000) * (itemRate / total) * 100 : 0;
      } else {
        rate = itemRate / 10;
      }
      rows.push({
        item: info.n,
        itemNorm: normalizeItemName(info.n),
        itemId,
        mob: mob.name,
        zone: mob.zone,
        lv: mob.lv,
        kind: kindOf(type),
        rate,
        grouped: type === 1,
        stack: info.st,
        sell: info.sell,
        ah: info.ah === 1,
        nm: mob.nm === 1,
        era: mob.era === 1,
      });
    }
  }
  return rows;
}

const ROWS: Row[] = buildRows();

// Items with a non-drop source but no mob drop get a synthetic row so they're
// searchable here (kind "Other"; expand the row for details).
{
  const droppedNorms = new Set(ROWS.map((r) => normalizeItemName(r.item)));
  for (const { norm, display } of allSourcedItems()) {
    if (droppedNorms.has(norm)) continue;
    ROWS.push({
      item: display, itemNorm: norm, itemId: 0, mob: "—", zone: "—", lv: null, kind: "Other",
      rate: 0, grouped: false, stack: 1, sell: 0, ah: false, nm: false, era: true,
    });
  }
}

const ZONES: string[] = [...new Set(ROWS.map((r) => r.zone))].filter((z) => z !== "—").sort((a, b) => a.localeCompare(b));
const ERA_ZONES: string[] = [...new Set(ROWS.filter((r) => r.era).map((r) => r.zone))].filter((z) => z !== "—").sort((a, b) =>
  a.localeCompare(b)
);

const OPTIONAL_KINDS = ["Steal", "Despoil"] as const;

const KIND_COLORS: Record<DropKind, string> = {
  Drop: "#7ec4e8",
  Steal: "#ffa552",
  Despoil: "#c9a2ff",
  Other: "#9aa0b8",
};

const NM_MODES = [
  { id: "all", label: "All mobs" },
  { id: "nm", label: "NMs only" },
  { id: "normal", label: "Normal only" },
] as const;

type NmMode = (typeof NM_MODES)[number]["id"];

type SortKey = "item" | "mob" | "zone" | "lv" | "kind" | "rate" | "sell" | "src";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "item", label: "Item" },
  { key: "mob", label: "Mob" },
  { key: "zone", label: "Zone" },
  { key: "lv", label: "Lv" },
  { key: "kind", label: "Type" },
  { key: "rate", label: "Rate" },
  { key: "sell", label: "Vendor" },
  { key: "src", label: "Also From" },
];

const UI_KEY = "ffxi_drops_ui_v1";

type DropsUiState = {
  itemQuery: string;
  mobQuery: string;
  zone: string; // "" = all
  kinds: DropKind[];
  nmMode: NmMode;
  eraOnly: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
};

const DEFAULT_UI: DropsUiState = {
  itemQuery: "",
  mobQuery: "",
  zone: "",
  // Steal/Despoil are THF-only; keep synthetic "Other" rows visible so
  // shop/BCNM/gathering-only items still show up.
  kinds: ["Drop", "Other"],
  nmMode: "all",
  eraOnly: true,
  sortKey: "item",
  sortDir: "asc",
};

function normalizeState(raw: unknown): DropsUiState {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const savedKinds = Array.isArray(obj.kinds)
    ? OPTIONAL_KINDS.filter((kind) => obj.kinds instanceof Array && obj.kinds.includes(kind))
    : [];
  return {
    itemQuery: typeof obj.itemQuery === "string" ? obj.itemQuery : DEFAULT_UI.itemQuery,
    mobQuery: typeof obj.mobQuery === "string" ? obj.mobQuery : DEFAULT_UI.mobQuery,
    zone: typeof obj.zone === "string" && ZONES.includes(obj.zone) ? obj.zone : DEFAULT_UI.zone,
    kinds: ["Drop", "Other", ...savedKinds],
    nmMode: NM_MODES.some((m) => m.id === obj.nmMode) ? (obj.nmMode as NmMode) : DEFAULT_UI.nmMode,
    eraOnly: typeof obj.eraOnly === "boolean" ? obj.eraOnly : DEFAULT_UI.eraOnly,
    sortKey: COLUMNS.some((c) => c.key === obj.sortKey) ? (obj.sortKey as SortKey) : DEFAULT_UI.sortKey,
    sortDir: obj.sortDir === "desc" ? "desc" : "asc",
  };
}

const MAX_ROWS = 500;

const thStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: "#161616",
  color: "#eaeaea",
  textAlign: "left",
  padding: "6px 8px",
  fontSize: 11,
  fontWeight: 800,
  borderBottom: "1px solid #444",
  cursor: "pointer",
  userSelect: "none",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 12,
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  whiteSpace: "nowrap",
};

const highlightStyle: React.CSSProperties = {
  background: "#8af6b0",
  color: "#0c0c0c",
  borderRadius: 3,
  padding: "0 1px",
  fontWeight: 700,
};

const craftLinkStyle: React.CSSProperties = {
  color: "#8af6b0",
  cursor: "pointer",
  textDecoration: "underline",
  textDecorationColor: "rgba(138,246,176,0.35)",
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

function formatRate(p: number): string {
  if (p >= 100) return "100%";
  if (p >= 10) return `${p.toFixed(1)}%`;
  if (p >= 1) return `${p.toFixed(2)}%`;
  return `${p.toFixed(3).replace(/0$/, "")}%`;
}

function formatLv(lv: [number, number] | null): string {
  if (!lv) return "—";
  return lv[0] === lv[1] ? String(lv[0]) : `${lv[0]}–${lv[1]}`;
}

function kindValue(k: DropKind): number {
  return k === "Drop" ? 0 : k === "Steal" ? 1 : k === "Despoil" ? 2 : 3;
}

function badgeSummary(item: string): string {
  return sourceBadges(item).map((b) => b.label).join(", ");
}

function compareRows(a: Row, b: Row, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  if (key === "rate") cmp = a.rate - b.rate;
  else if (key === "sell") cmp = a.sell - b.sell;
  else if (key === "lv") cmp = (a.lv ? a.lv[0] : -1) - (b.lv ? b.lv[0] : -1);
  else if (key === "kind") cmp = kindValue(a.kind) - kindValue(b.kind);
  else if (key === "src") cmp = badgeSummary(a.item).localeCompare(badgeSummary(b.item));
  else cmp = a[key].localeCompare(b[key]);
  if (cmp === 0) cmp = a.item.localeCompare(b.item);
  if (cmp === 0) cmp = a.mob.localeCompare(b.mob);
  if (cmp === 0) cmp = a.zone.localeCompare(b.zone);
  return dir === "asc" ? cmp : -cmp;
}

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  border: "1px solid",
  borderRadius: 999,
  padding: "0 7px",
  fontSize: 10,
  fontWeight: 700,
  marginRight: 4,
  opacity: 0.9,
  lineHeight: "16px",
};

const detailLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  minWidth: 118,
};

const chipStyle: React.CSSProperties = {
  display: "inline-block",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 8,
  padding: "1px 8px",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const chipLinkStyle: React.CSSProperties = {
  ...chipStyle,
  cursor: "pointer",
  color: "#7ec4e8",
  borderColor: "rgba(126,196,232,0.45)",
};

const CRAFT_COLORS: Record<string, string> = {
  Woodworking: "#8fd18f",
  Smithing: "#b6c7db",
  Goldsmithing: "#e8d47e",
  Clothcraft: "#c9a2ff",
  Leathercraft: "#efa975",
  Bonecraft: "#eee2c6",
  Alchemy: "#70d8ce",
  Cooking: "#f19bb5",
};

function craftChipStyle(craft: string): React.CSSProperties {
  const color = CRAFT_COLORS[craft] ?? "#7ec4e8";
  return { ...chipLinkStyle, color, borderColor: `${color}80` };
}

const MAX_DETAIL = 14;

/** Expanded row: every way to obtain the item, in and out of this table. */
function ItemDetail({ item: initialItem, eraOnly }: { item: string; eraOnly: boolean }) {
  const [history, setHistory] = useState<string[]>([]);
  const item = history[history.length - 1] ?? initialItem;
  const selectItem = (name: string) => {
    if (name !== item) setHistory([...history, name]);
  };
  const sources = getItemSources(item);
  const quests = useMemo(() => questRewardsFor(item), [item]);
  const recipes = recipesUsingItem(item).filter((recipe) => !eraOnly || recipe.era !== "WotG");

  const dropRows = useMemo(() => {
    const norm = normalizeItemName(item);
    const rows = ROWS.filter((r) => r.kind !== "Other" && (!eraOnly || r.era) && normalizeItemName(r.item) === norm);
    rows.sort((a, b) => b.rate - a.rate);
    return rows;
  }, [item, eraOnly]);

  const section = (label: string, color: string, chips: React.ReactNode[], extra = 0) =>
    chips.length === 0 ? null : (
      <div key={label} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ ...detailLabelStyle, color }}>{label}</span>
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
          {chips}
          {extra > 0 ? <span style={{ fontSize: 11, opacity: 0.65 }}>+{extra} more</span> : null}
        </span>
      </div>
    );

  const sections: React.ReactNode[] = [
    section(
      "Dropped by",
      KIND_COLORS.Drop,
      dropRows.slice(0, MAX_DETAIL).map((r, i) => (
        <span
          key={i}
          style={chipLinkStyle}
          title={`Open ${r.mob} in the Bestiary`}
          onClick={(e) => {
            e.stopPropagation();
            navigateToTab("bestiary", r.mob, "drops");
          }}
        >
          <span style={r.nm ? { color: "#ffa552", fontWeight: 700 } : undefined}>{r.mob}</span>
          <span style={{ opacity: 0.75 }}>
            {" · "}{r.zone} · {formatLv(r.lv)}{r.kind !== "Drop" ? ` · ${r.kind}` : ""} · {formatRate(r.rate)}
          </span>
        </span>
      )),
      Math.max(0, dropRows.length - MAX_DETAIL)
    ),
    section(
      "Sold by",
      "#D8B04B",
      sources.shops.slice(0, MAX_DETAIL).map((s, i) => (
        <span key={i} style={chipStyle}>
          <NpcLink name={s.npc} zone={s.zone} from="drops" />
          <span style={{ opacity: 0.75 }}> · {s.zone} · {s.price.toLocaleString()}g</span>
        </span>
      )),
      Math.max(0, sources.shops.length - MAX_DETAIL)
    ),
    section(
      "Guild shop",
      "#D8B04B",
      sources.guild.map((g, i) => (
        <span key={i} style={chipStyle}>
          {g.guild} Guild
          {NPCS.filter((npc) => npc.guild === g.guild).map((npc) => <span key={npc.id}> · <NpcLink name={npc.name} zone={npc.zone} from="drops" /></span>)}
          <span style={{ opacity: 0.75 }}> · rank {g.rank} · {g.price.toLocaleString()}g</span>
        </span>
      ))
    ),
    section(
      "Battlefield",
      KIND_COLORS.Drop,
      sources.bcnm.map((b, i) => (
        <span
          key={i}
          style={chipLinkStyle}
          title="Open in the BCNM tab"
          onClick={(e) => {
            e.stopPropagation();
            navigateToTab("bcnm", item, "drops");
          }}
        >
          {b.name}
          <span style={{ opacity: 0.75 }}> · {b.arena} · {b.type}</span>
        </span>
      ))
    ),
    section(
      "Craftable",
      "#8af6b0",
      sources.craft.map((c, i) => (
        <span
          key={i}
          style={craftChipStyle(c.craft)}
          title="Open in the Crafting tab"
          onClick={(e) => {
            e.stopPropagation();
            navigateToTab("crafting", craftSearchName(item) ?? item, "drops");
          }}
        >
          {c.craft} {c.lvl}{c.hq ? " (HQ result)" : ""}
        </span>
      ))
    ),
    section(
      "Used in recipes",
      "#8af6b0",
      recipes.map((recipe) => (
        <button
          key={recipe.id}
          type="button"
          style={{ ...craftChipStyle(recipe.craft), textAlign: "left", whiteSpace: "normal", maxWidth: "100%" }}
          title={`Open recipe ${recipe.id} in the Crafting tab`}
          onClick={(event) => {
            event.stopPropagation();
            navigateToTab("crafting", recipe.res.n, "drops", recipe.id);
          }}
        >
          {recipe.res.n}
          <span style={{ opacity: 0.75 }}>
            {" · "}{recipe.craft} {recipe.lvl}{recipe.d === 1 ? " · Desynth" : ""}{recipe.era === "WotG" ? " · WotG" : ""}
          </span>
        </button>
      ))
    ),
    section(
      "Gathering",
      "#a8e87e",
      sources.helm.map((h, i) => (
        <span key={i} style={chipStyle}>
          {h.kind}
          <span style={{ opacity: 0.75 }} title="Share of a fresh successful HELM pool, before daily caps or depletion. Not chance per tool use."> · {h.zone} · {h.pct.toFixed(1)}% of pool</span>
        </span>
      ))
    ),
    section(
      "Fishing",
      "#9ad1ff",
      sources.fishing.slice(0, MAX_DETAIL).map((z, i) => (
        <span key={i} style={chipStyle}>{z}</span>
      )),
      Math.max(0, sources.fishing.length - MAX_DETAIL)
    ),
    section(
      "Chocobo digging",
      "#e8c47e",
      sources.digging.map((d, i) => (
        <span key={i} style={chipStyle}>
          {d.zone}
          {d.condition ? <span style={{ opacity: 0.75 }}> · {d.condition}</span> : null}
          {d.rate != null ? <span style={{ opacity: 0.75 }}> · {d.rate}%</span> : null}
        </span>
      ))
    ),
    section(
      "Conquest points",
      "#e8a2c0",
      sources.cp.map((c, i) => (
        <span key={i} style={chipStyle}>
          {c.nation}
          <span style={{ opacity: 0.75 }}>
            {c.rank != null ? ` · rank ${c.rank}` : ""} · {c.cp.toLocaleString()} CP
          </span>
        </span>
      ))
    ),
    section("Clamming", "#9ad1ff", sources.clamming ? [<span key="c" style={chipStyle}>Bibiki Bay</span>] : []),
    section(
      "Quest reward",
      "#c9a2ff",
      quests.map((q, i) => (
        <span key={i} style={chipStyle}>
          {q.name}
          {q.zone ? <span style={{ opacity: 0.75 }}> · {q.zone}</span> : null}
        </span>
      ))
    ),
  ].filter(Boolean);

  return (
    <div className="item-detail-panel" style={{ display: "grid", gap: 7 }}>
      {history.length > 0 && <button type="button" className="purification-link" style={{ display: "flex", alignItems: "center", gap: 6, justifySelf: "start" }} onClick={() => setHistory(history.slice(0, -1))}><ArrowLeft size={16} />{history[history.length - 2] ?? initialItem}</button>}
      <React.Suspense fallback={<strong>{item}</strong>}>
        <ItemInfo key={item} name={item} onSelectName={selectItem} />
      </React.Suspense>
      {sections.length > 0 ? sections : !getPurificationOrigin(item) && <div style={{ opacity: 0.7, fontSize: 12 }}>No known sources.</div>}
    </div>
  );
}

export default function DropsTab() {
  const restored = peekRestoredTabState<{ ui: DropsUiState; openRow: number | null }>("drops");
  const [ui, setUi] = useState<DropsUiState>(() => {
    if (restored) return restored.ui;
    const base = normalizeState(loadJson<unknown>(UI_KEY, {}));
    const navQuery = peekNavQuery("drops");
    return navQuery ? { ...base, itemQuery: navQuery, mobQuery: "", zone: "" } : base;
  });
  const [openRow, setOpenRow] = useState<number | null>(restored?.openRow ?? null);
  useEffect(() => { rememberTabState("drops", { ui, openRow }); }, [ui, openRow]);

  const update = (patch: Partial<DropsUiState>) => {
    setOpenRow(null);
    setUi((prev) => {
      const next = { ...prev, ...patch };
      saveJson(UI_KEY, next);
      return next;
    });
  };

  const itemQ = ui.itemQuery.trim().toLowerCase();
  // LSB names drop apostrophes/hyphens ("Barons Saio"); match the normalized form too
  const itemQNorm = itemQ ? normalizeItemName(ui.itemQuery) : "";
  const mobQ = ui.mobQuery.trim().toLowerCase();

  const toggleKind = (k: typeof OPTIONAL_KINDS[number]) => {
    const next = ui.kinds.includes(k) ? ui.kinds.filter((x) => x !== k) : [...ui.kinds, k];
    update({ kinds: next });
  };

  const onHeaderClick = (key: SortKey) => {
    if (key === ui.sortKey) update({ sortDir: ui.sortDir === "asc" ? "desc" : "asc" });
    else update({ sortKey: key, sortDir: key === "rate" || key === "sell" ? "desc" : "asc" });
  };

  const filtered = useMemo(() => {
    const out: Row[] = [];
    for (const r of ROWS) {
      if (ui.eraOnly && !r.era) continue;
      if (ui.zone && r.zone !== ui.zone) continue;
      if ((r.kind === "Steal" || r.kind === "Despoil") && !ui.kinds.includes(r.kind)) continue;
      if (ui.nmMode === "nm" && !r.nm) continue;
      if (ui.nmMode === "normal" && r.nm) continue;
      if (itemQ && !r.item.toLowerCase().includes(itemQ) && !r.itemNorm.includes(itemQNorm) && !purificationMatches(r.item, itemQNorm)) continue;
      if (mobQ && !r.mob.toLowerCase().includes(mobQ) && !r.zone.toLowerCase().includes(mobQ)) continue;
      out.push(r);
    }
    out.sort((a, b) => compareRows(a, b, ui.sortKey, ui.sortDir));
    return out;
  }, [ui.eraOnly, ui.zone, ui.kinds, ui.nmMode, itemQ, itemQNorm, mobQ, ui.sortKey, ui.sortDir]);

  const shown = filtered.length > MAX_ROWS ? filtered.slice(0, MAX_ROWS) : filtered;

  const uniqueItems = useMemo(() => new Set(filtered.map((r) => r.itemId)).size, [filtered]);
  const uniqueMobs = useMemo(() => new Set(filtered.map((r) => `${r.zone}|${r.mob}`)).size, [filtered]);

  /** Item cell: links to the recipe browser when the item is craftable. */
  const renderItem = (r: Row) => {
    const craft = craftSearchName(r.item);
    const text = highlightText(r.item, itemQ);
    if (!craft) return text;
    return (
      <span
        style={craftLinkStyle}
        title={`Search crafting recipes for ${craft}`}
        onClick={(e) => {
          e.stopPropagation();
          navigateToTab("crafting", craft, "drops");
        }}
      >
        {text}
      </span>
    );
  };

  return (
    <section style={styles.card}>
      <div style={styles.titleRow}>
        <h3 style={styles.h3}>Items</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          <div style={styles.sub}>
            Where to get anything: mob drops, NPC & guild shops, BCNM, gathering, fishing, digging and more
          </div>
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
              <label style={styles.label}>Item search</label>
              <input
                type="text"
                placeholder="e.g. bounding boots"
                value={ui.itemQuery}
                onChange={(e) => update({ itemQuery: e.target.value })}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Mob / zone search</label>
              <input
                type="text"
                placeholder="e.g. leaping lizzy"
                value={ui.mobQuery}
                onChange={(e) => update({ mobQuery: e.target.value })}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Zone</label>
              <select value={ui.zone} onChange={(e) => update({ zone: e.target.value })} style={styles.select}>
                <option value="">All zones</option>
                {(ui.eraOnly ? ERA_ZONES : ZONES).map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.field}>
              <span style={styles.label}>Include</span>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {OPTIONAL_KINDS.map((kind) => (
                  <label key={kind} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={ui.kinds.includes(kind)} onChange={() => toggleKind(kind)} />
                    {kind}
                  </label>
                ))}
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Mobs</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {NM_MODES.map((m) => (
                  <button
                    key={m.id}
                    style={{
                      ...styles.buttonCompact,
                      ...(ui.nmMode === m.id ? { borderColor: "#8af6b0", color: "#8af6b0" } : {}),
                    }}
                    onClick={() => update({ nmMode: m.id })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>&nbsp;</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={ui.eraOnly}
                  onChange={(e) => update({ eraOnly: e.target.checked })}
                />
                Era only (pre-WotG)
              </label>
            </div>
          </div>

          <div style={{ ...styles.sub, marginTop: 8 }}>
            {filtered.length.toLocaleString()} entries · {uniqueItems.toLocaleString()} items ·{" "}
            {uniqueMobs.toLocaleString()} mobs
            {filtered.length > MAX_ROWS ? ` — showing first ${MAX_ROWS}, refine your search` : ""}
          </div>
        </div>
        </CollapsibleSection>

        <div style={{ ...styles.subCard, padding: 0, overflow: "auto", maxHeight: "70vh" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} style={thStyle} onClick={() => onHeaderClick(c.key)}>
                    <span style={ui.sortKey === c.key ? { color: "#8af6b0" } : undefined}>
                      {c.label}
                      {ui.sortKey === c.key ? (ui.sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const isOpen = openRow === i;
                return (
                  <React.Fragment key={i}>
                    <tr
                      onClick={() => setOpenRow(isOpen ? null : i)}
                      style={{ cursor: "pointer", ...(isOpen ? { background: "rgba(255,255,255,0.04)" } : {}) }}
                      title="Click for every source of this item"
                    >
                      <td style={tdStyle}>
                        <span style={{ opacity: 0.55, marginRight: 5 }}>{isOpen ? "▾" : "▸"}</span>
                        {renderItem(r)}
                      </td>
                      <td style={{ ...tdStyle, ...(r.nm ? { color: "#ffa552", fontWeight: 700 } : {}) }}>
                        {highlightText(r.mob, mobQ)}
                        {r.nm ? " (NM)" : ""}
                      </td>
                      <td style={tdStyle}>{highlightText(r.zone, mobQ)}</td>
                      <td style={tdStyle}>{formatLv(r.lv)}</td>
                      <td style={{ ...tdStyle, color: KIND_COLORS[r.kind] }}>
                        {r.kind}
                        {r.grouped ? " (group)" : ""}
                      </td>
                      <td style={tdStyle}>{r.kind === "Other" ? "—" : formatRate(r.rate)}</td>
                      <td style={tdStyle}>{r.sell > 0 ? r.sell.toLocaleString() : "—"}</td>
                      <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: 150 }}>
                        {sourceBadges(r.item).map((b) => (
                          <span key={b.label} style={{ ...badgeStyle, color: b.color, borderColor: b.color }}>
                            {b.label}
                          </span>
                        ))}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td
                          colSpan={COLUMNS.length}
                          style={{
                            ...tdStyle,
                            whiteSpace: "normal",
                            background: "rgba(255,255,255,0.025)",
                            padding: "10px 16px",
                            borderBottom: "1px solid rgba(255,255,255,0.14)",
                          }}
                        >
                          <ItemDetail key={r.item} item={r.item} eraOnly={ui.eraOnly} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, opacity: 0.7 }} colSpan={COLUMNS.length}>
                    No items match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={styles.sub}>
          Click any row to see every source: mob drops, NPC and guild shops, battlefields, gathering points,
          fishing, chocobo digging, clamming and quest rewards. Drop rates are per kill (Treasure Hunter not
          included); grouped drops share one roll, and the shown rate is the effective per-item chance.
          Steal/Despoil rates are per attempt. Vendor = LSB base sell price. Items with{" "}
          <span style={{ color: "#9aa0b8", fontWeight: 700 }}>Other</span> type don't drop from mobs but can be
          obtained elsewhere. Items in <span style={{ color: "#8af6b0", fontWeight: 700 }}>green</span> are
          craftable — click the name to open their recipe.
        </div>
      </div>
    </section>
  );
}
