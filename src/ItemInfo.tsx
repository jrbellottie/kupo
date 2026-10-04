import { useState } from "react";
import { catalogData, PHOENIX_SOURCE } from "./utils/phoenixData";
import wikiData from "./data/itemWiki.json";
import { normalizeItemName } from "./utils/itemLinks";
import PurificationInfo from "./PurificationInfo";
import { getPurification, getPurificationOrigin } from "./utils/purification";
import { ArrowLeft } from "lucide-react";
import crystalFamiliesData from "./data/crystalFamilies.json";
import NpcText from "./NpcText";

type WikiItem = { title: string; url?: string; revision?: number; status: string; description?: string; fields?: Record<string, string>; notes?: string; image?: string; imageSource?: string };
const catalog = catalogData;
const modifierNames: Record<string, string> = catalog.modifierNames;
const wiki = wikiData as unknown as { items: Record<string, WikiItem> };
const crystalFamilies = crystalFamiliesData.crystals as Record<string, { name: string; families: string[] }>;
const JOBS = ["WAR", "MNK", "WHM", "BLM", "RDM", "THF", "PLD", "DRK", "BST", "BRD", "RNG", "SAM", "NIN", "DRG", "SMN", "BLU", "COR", "PUP", "DNC", "SCH", "GEO", "RUN"];
const ELEMENTS = ["Fire", "Ice", "Wind", "Earth", "Lightning", "Water", "Light", "Dark"];
const SLOTS = ["Main", "Sub", "Ranged", "Ammo", "Head", "Body", "Hands", "Legs", "Feet", "Neck", "Waist", "Left ear", "Right ear", "Left ring", "Right ring", "Back"];
const SKILLS: Record<number, string> = { 1: "Hand-to-hand", 2: "Dagger", 3: "Sword", 4: "Great sword", 5: "Axe", 6: "Great axe", 7: "Scythe", 8: "Polearm", 9: "Katana", 10: "Great katana", 11: "Club", 12: "Staff", 25: "Archery", 26: "Marksmanship", 27: "Throwing", 41: "String instrument", 42: "Wind instrument", 48: "Fishing rod" };
const SIMPLE_MODS: Record<string, string> = { HP: "HP", MP: "MP", STR: "STR", DEX: "DEX", VIT: "VIT", AGI: "AGI", INT: "INT", MND: "MND", CHR: "CHR", DEF: "Defense", ATT: "Attack", ACC: "Accuracy", RATT: "Ranged attack", RACC: "Ranged accuracy", EVA: "Evasion", MACC: "Magic accuracy", THRENODY_EFFECT: "Threnody", MINUET_EFFECT: "Minuet", MARCH_EFFECT: "March", MADRIGAL_EFFECT: "Madrigal", REQUIEM_EFFECT: "Requiem", LULLABY_EFFECT: "Lullaby", BALLAD_EFFECT: "Ballad", PAEON_EFFECT: "Paeon" };
const linkStyle = { color: "#7ec4e8", textUnderlineOffset: 2 };
const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const signed = (value: number) => value > 0 ? `+${value}` : String(value);

export default function ItemInfo({ name, onSelectName }: { name: string; onSelectName?: (name: string) => void }) {
  const [history, setHistory] = useState<string[]>([]);
  const selected = history[history.length - 1] ?? name;
  const select = (next: string) => {
    if (onSelectName) onSelectName(next);
    else if (next !== selected) setHistory([...history, next]);
  };
  return <>
    {history.length > 0 && <button type="button" onClick={() => setHistory(history.slice(0, -1))} style={{ display: "flex", alignItems: "center", gap: 6, justifySelf: "start", background: "none", border: 0, padding: "4px 0", color: "#7ec4e8", cursor: "pointer" }}><ArrowLeft size={16} />{history[history.length - 2] ?? name}</button>}
    <ItemDetails key={selected} name={selected} onSelect={select} />
  </>;
}

function ItemDetails({ name, onSelect }: { name: string; onSelect: (name: string) => void }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const id = catalog.names[normalizeItemName(name)];
  const item = catalog.items[id];
  const reference = wiki.items[id];
  const exchange = getPurification(name);
  const origin = getPurificationOrigin(name);
  const crystal = crystalFamilies[id];
  const url = reference?.url ?? `https://ffxiclopedia.fandom.com/wiki/${encodeURIComponent(name.replace(/ /g, "_"))}`;
  const equipment = item?.equipment;
  const weapon = item?.weapon;
  const spell = item?.spell;
  const puppet = item?.puppet;
  const readable = (item?.modifiers ?? []).filter(([modifier]) => SIMPLE_MODS[modifierNames[modifier]]);
  return (
    <div style={{ display: "grid", gap: 10, minWidth: 0, paddingBottom: 10, borderBottom: "1px solid #333" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>{name}</strong>
        <a href={url} target="_blank" rel="noreferrer" style={linkStyle}>FFXIclopedia</a>
        {id && <span style={{ fontSize: 11, color: "#aaa" }}>Item #{id}</span>}
      </div>
      {crystal && <div style={{ display: "grid", gap: 5, whiteSpace: "normal", overflowWrap: "anywhere", fontSize: 13 }}>
        <div><strong>Dropped by families:</strong> {crystal.families.join(", ")}</div>
        <div style={{ color: "#aaa", fontSize: 12 }}>Crystal type can vary by monster within a family. Crystal drops require an eligible EXP-yielding kill and the appropriate regional effect (Signet or Sanction); region restrictions apply.</div>
      </div>}
      {exchange && <PurificationInfo
        cursed={{ name, image: reference?.image }}
        purified={{ name: exchange.result, image: wiki.items[catalog.names[normalizeItemName(exchange.result)]]?.image }}
        abjuration={exchange.abjuration}
        abjurationId={catalog.names[normalizeItemName(exchange.abjuration)]}
        onSelect={onSelect}
      />}
      {origin && <div style={{ whiteSpace: "normal", color: "#bbb", fontSize: 13 }}>
        Purified from <button type="button" className="purification-link" onClick={() => onSelect(origin.cursed)}>{origin.cursed}</button>
        {" + "}<button type="button" className="purification-link" onClick={() => onSelect(origin.abjuration)}>{origin.abjuration}</button>
      </div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start", minWidth: 0 }}>
        {!exchange && reference?.image && failedImage !== reference.image && (
          <details style={{ maxWidth: "100%" }}>
            <summary style={{ color: "#aaa", fontSize: 12, cursor: "pointer" }}>Wiki tooltip image (may show later-retail values)</summary>
            <img src={`${import.meta.env.BASE_URL}${reference.image}`} alt={`${reference.title} in-game item description`} onError={() => setFailedImage(reference.image ?? null)} style={{ display: "block", maxWidth: "100%", height: "auto" }} />
          </details>
        )}
        <div style={{ flex: "1 1 280px", minWidth: 0, display: "grid", gap: 7 }}>
          {reference?.description && <div style={{ lineHeight: 1.5 }}><NpcText text={reference.description} /></div>}
          {spell && <div style={{ display: "grid", gap: 5 }}>
            <strong style={{ color: "#bcbcbc", fontSize: 12 }}>Reference ruleset spell statistics</strong>
            {spell.available ? <>
              <div style={{ color: "#e8d47e" }}>{spell.jobs.flatMap((level, index) => level > 0 ? [`${JOBS[index]} Lv. ${level}`] : []).join(" / ") || "No learnable jobs in the source snapshot"}</div>
              <div>MP: {spell.mpCost} · Cast: {spell.castTime / 1000}s · Recast: {spell.recastTime / 1000}s</div>
            </> : <div style={{ color: "#e8d47e" }}>This spell is not defined in the pinned source snapshot.</div>}
          </div>}
          {equipment && <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", color: "#e8d47e" }}>
            <span>Lv. {equipment.level}</span>
            <span>{JOBS.filter((_, index) => (equipment.jobs & (1 << index)) !== 0).join(" / ")}</span>
            <span>{SLOTS.filter((_, index) => (equipment.slots & (1 << index)) !== 0).join(" / ")}</span>
            {equipment.itemLevel > 0 && <span>Item level {equipment.itemLevel}</span>}
          </div>}
          {weapon && <div>{SKILLS[weapon.skill] ?? `Weapon skill ${weapon.skill}`}{weapon.damage > 0 ? ` · DMG ${weapon.damage} · Delay ${weapon.delay}` : ""}</div>}
          {readable.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 16px", color: "#8fd18f" }}>
            {readable.map(([modifier, value]) => <span key={modifier}>{SIMPLE_MODS[modifierNames[modifier]]} {signed(value)}</span>)}
          </div>}
          {item && <div style={{ color: "#bbb", fontSize: 12 }}>Stack: {item.stack} · Base vendor value: {item.sell.toLocaleString()} gil</div>}
          {item?.usable && <div>Usable item{item.usable.maxCharges > 0 ? ` · ${item.usable.maxCharges} charges` : ""}{item.usable.aoe ? " · Area effect" : ""}</div>}
          {item?.usable && item.usable.maxCharges > 0 && <div>Reuse: {item.usable.reuseDelay >= 3600 ? `${item.usable.reuseDelay / 3600}h` : `${item.usable.reuseDelay}s`} · Equip delay: {item.usable.useDelay}s</div>}
          {item?.expEffect && <div>EXP bonus: +{item.expEffect.bonus}% · Maximum bonus: {item.expEffect.cap} EXP · Duration: {item.expEffect.duration / 60} minutes</div>}
          {puppet && <div>Automaton {puppet.slot === 3 ? "attachment cost" : "element capacity"}: {ELEMENTS.flatMap((element, index) => {
            const value = (puppet.element >>> (index * 4)) & 15;
            return value > 0 ? [`${element} ${value}`] : [];
          }).join(" / ")}</div>}
          {item?.furnishing && <div>Furnishing · Storage +{item.furnishing.storage} · Footprint {item.furnishing.size_x} × {item.furnishing.size_y}</div>}
          {reference?.status !== "ok" && <div style={{ color: "#aaa", fontSize: 12 }}>Wiki description not cached for this item.</div>}
          {item && <div style={{ color: "#aaa", fontSize: 12 }}>Base metadata {catalog.source.revision.slice(0, 7)} with <a href={`${PHOENIX_SOURCE.repository}/tree/${PHOENIX_SOURCE.revision}`} target="_blank" rel="noreferrer" style={linkStyle}>pinned source overrides</a> ({PHOENIX_SOURCE.revision.slice(0, 7)}). Live configuration may vary.</div>}
        </div>
      </div>
      {reference?.status === "ok" && (
        <details>
          <summary style={{ color: "#bcbcbc", fontSize: 12, cursor: "pointer" }}>Wiki statistics and notes (may show later-retail values)</summary>
          <p style={{ color: "#aaa", fontSize: 12 }}>Cached wiki text is supplementary, not the reference ruleset. Levels, jobs, effects and timings below may differ; use source statistics above where available. Live configuration may also vary.</p>
          <dl style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
            {Object.entries(reference.fields ?? {}).map(([key, value]) => <div key={key} style={{ minWidth: 0, maxWidth: "100%" }}>
              <dt style={{ color: "#aaa", fontSize: 11 }}>{label(key)}</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value}</dd>
            </div>)}
          </dl>
          {reference.notes && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, overflowWrap: "anywhere" }}><NpcText text={reference.notes} /></div>}
        </details>
      )}
    </div>
  );
}