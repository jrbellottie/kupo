import { useEffect, useState, type ReactNode } from "react";
import { Fish, Scissors, RotateCcw } from "lucide-react";
import { CollapsibleSection } from "./ScreenControls";
import { styles } from "./styles";
import snapshot from "./data/fishingPlanner.json";
import { baitData, fishData } from "./utils/phoenixData";
import { loadJson, saveJson } from "./utils/storage";
import { calculateCastOdds, calculateSnapPlan, calculateSnapTime, calculateSnapBait, formatCatchTime, fishingFatigue, isCityFishingZone, type HookFish, type SkillupRod } from "./utils/fishingSkillup";

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const fishCatalog = snapshot.fish as Record<string, Omit<HookFish, "hookBonus"> & { restricted: boolean }>;
const baitCatalog = snapshot.baits as Record<string, { poorFish: boolean; shellfishBait: boolean; fish: Record<string, number> }>;
const areaCatalog = snapshot.areas as Record<string, { difficulty: number; hasMobs: boolean; members: string[] }>;
const rods = (snapshot.rods as SkillupRod[]).filter(rod => rod.era === "TOAU" && !["Judges Rod", "Goldfish Basket"].includes(rod.rod));
const baitNames = [...new Set(baitData.filter(row => row.kind === "Bait" && row.bait && baitCatalog[row.bait]).map(row => row.bait!))].sort();
const locations = [...new Map(fishData.map(row => {
  const key = `${normalize(row.zone)}|${normalize(row.area)}`;
  return [key, { key, zone: row.zone, area: row.area }];
})).values()].filter(location => areaCatalog[location.key]).sort((left, right) => left.zone.localeCompare(right.zone) || left.area.localeCompare(right.area));
const zones = [...new Set(locations.map(location => location.zone))];
const defaultLocation = locations.find(location => location.zone === "Zeruhn Mines") ?? locations[0];
const defaults = { baseSkill: 31, bonusSkill: 0, rod: "Carbon Fishing Rod", location: defaultLocation.key,
  bait: "Ball of Crayfish Paste", landed: 0, fatigueUsed: 0, reserve: 1000 };
type Settings = typeof defaults;
const numberText = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const cell = { padding: "8px 10px", textAlign: "left" as const, borderBottom: "1px solid #333" };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: "grid", gap: 6, minWidth: 0, fontSize: 13 }}>{label}{children}</label>;
}

export default function SnapSkillTab() {
  const [settings, setSettings] = useState<Settings>(() => ({ ...defaults, ...loadJson<Partial<Settings>>("ffxi_snap_skill_v1", {}) }));
  const [recordFish, setRecordFish] = useState("");
  useEffect(() => saveJson("ffxi_snap_skill_v1", settings), [settings]);
  const update = <Key extends keyof Settings>(key: Key, value: Settings[Key]) => setSettings(previous => ({ ...previous, [key]: value }));
  const location = locations.find(entry => entry.key === settings.location) ?? defaultLocation;
  const rod = rods.find(entry => entry.rod === settings.rod) ?? rods.find(entry => entry.rod === defaults.rod)!;
  const baitName = baitNames.includes(settings.bait) ? settings.bait : defaults.bait;
  const area = areaCatalog[location.key];
  const members = area.members.map(name => fishCatalog[name]).filter(member => member && !member.restricted);
  const effectiveSkill = Math.floor(settings.baseSkill) + Math.floor(settings.bonusSkill);
  const estimate = (name: string) => {
    const bait = baitCatalog[name];
    const pool = members.filter(member => !member.item && bait.fish[member.fish] !== undefined)
      .map(member => ({ ...member, hookBonus: bait.fish[member.fish] }));
    const odds = calculateCastOdds(effectiveSkill, rod, pool, { ...area, ...bait,
      city: isCityFishingZone(location.zone), hasItems: members.some(member => member.item) });
    const plan = calculateSnapPlan({ ...settings, zone: location.zone, rod, fish: pool, weights: odds.targetPct });
    return { pool, plan, time: calculateSnapTime(plan, odds.fishPct), baitNeeded: calculateSnapBait(plan, odds) };
  };
  const { pool, plan, time, baitNeeded } = estimate(baitName);
  const comparisons = baitNames.map(name => ({ name, ...estimate(name) })).filter(entry => entry.plan.status === "Ready")
    .sort((left, right) => right.plan.expectedGain - left.plan.expectedGain || left.name.localeCompare(right.name));
  const selectedFish = pool.find(member => member.fish === recordFish) ?? pool[0];
  const ready = plan.status === "Ready";
  const canRecord = settings.landed < 200 && settings.fatigueUsed < 20000 && selectedFish;
  const record = (landed: boolean) => {
    if (!canRecord) return;
    const cost = fishingFatigue(effectiveSkill, selectedFish, rod, !landed);
    setSettings(previous => ({ ...previous, landed: Math.min(200, previous.landed + Number(landed)),
      fatigueUsed: Math.min(20000, previous.fatigueUsed + cost) }));
  };
  const numeric = (key: "baseSkill" | "bonusSkill" | "landed" | "fatigueUsed" | "reserve", max: number) =>
    <input type="number" min={0} max={max} step={1} style={styles.inputCompact} value={settings[key]}
      onChange={event => update(key, Math.max(0, Math.min(max, Math.floor(Number(event.target.value) || 0))))} />;

  return <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, minWidth: 0 }}>
    <div style={styles.titleRow}>
      <h3 style={styles.h3}>Fatigue fishing</h3>
      <span style={styles.sub}>Source estimate / 200 catches / 20,000 fatigue</span>
    </div>
    <CollapsibleSection kind="search">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, padding: 12, border: "1px solid #333", borderRadius: 8 }}>
        <Field label="Base fishing skill">{numeric("baseSkill", 110)}</Field>
        <Field label="Gear/support skill">{numeric("bonusSkill", 8)}</Field>
        <Field label="Rod"><select style={styles.inputCompact} value={rod.rod} onChange={event => update("rod", event.target.value)}>
          {rods.map(entry => <option key={entry.rod}>{entry.rod}</option>)}
        </select></Field>
        <Field label="Zone"><select style={styles.inputCompact} value={location.zone}
          onChange={event => update("location", locations.find(entry => entry.zone === event.target.value)!.key)}>
          {zones.map(zone => <option key={zone}>{zone}</option>)}
        </select></Field>
        <Field label="Area"><select style={styles.inputCompact} value={location.key} onChange={event => update("location", event.target.value)}>
          {locations.filter(entry => entry.zone === location.zone).map(entry => <option key={entry.key} value={entry.key}>{entry.area}</option>)}
        </select></Field>
        <Field label="Consumable bait"><select style={styles.inputCompact} value={baitName} onChange={event => update("bait", event.target.value)}>
          {baitNames.map(name => <option key={name}>{name}</option>)}
        </select></Field>
        <Field label="Landed today">{numeric("landed", 200)}</Field>
        <Field label="Fatigue used (estimate)">{numeric("fatigueUsed", 20000)}</Field>
        <Field label="Fatigue safety reserve">{numeric("reserve", 20000)}</Field>
      </div>
    </CollapsibleSection>

    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "10px 0", borderBottom: "1px solid #333" }}>
      <span><strong>{plan.remaining}</strong> landings left</span>
      <span><strong>{numberText(Math.max(0, 20000 - settings.fatigueUsed))}</strong> fatigue left</span>
      <span><strong>{numberText(plan.budget)}</strong> fatigue after reserve</span>
      <span>Effective skill <strong>{effectiveSkill}</strong></span>
    </div>
    {!ready ? <div role="status" style={{ color: "#ffc77d", padding: "8px 0" }}>{plan.status}</div> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16 }}>
        <div title="Estimated fishing skill points from the remaining snap and finish phases. Skill and pool conditions are held constant; this is not simulated progression or guaranteed gain."><div style={styles.sub}>Estimated remaining skill gain*</div><strong style={{ fontSize: 24, color: "#8fe7ad" }}>+{plan.expectedGain.toFixed(2)}</strong><span style={styles.sub}> skill points</span></div>
        <div><div style={styles.sub}>Planned bad-feeling fights</div><strong style={{ fontSize: 24 }}>{numberText(plan.badFights)}</strong></div>
        <div><div style={styles.sub}>Expected natural snaps</div><strong style={{ fontSize: 24 }}>{numberText(plan.snaps, 1)}</strong></div>
        <div><div style={styles.sub}>Expected accidental landings</div><strong style={{ fontSize: 24 }}>{numberText(plan.accidentalLandings, 1)}</strong></div>
        <div><div style={styles.sub}>Expected eligible opportunities</div><strong style={{ fontSize: 24, color: "#8fe7ad" }}>{numberText(plan.opportunities, 1)}</strong></div>
        <div><div style={styles.sub}>Estimated remaining cast time</div><strong style={{ fontSize: 24 }}>{time ? formatCatchTime(time.seconds) : "Unavailable"}</strong></div>
        <div><div style={styles.sub}>Estimated bait needed to finish</div><strong style={{ fontSize: 24 }}>{baitNeeded === null ? "Unavailable" : numberText(Math.ceil(baitNeeded))}</strong></div>
      </div>
      <div style={styles.sub}>35s per landing; 15s per other cast, including natural snaps, cancelled feelings, monsters, items, no bites, and escapes. Includes both phases; excludes downtime. Rounded up to a minute.</div>
      <div style={styles.sub}>Bait: {baitName}. Includes landings, natural snaps, and cancelled fish, items, and monsters. No-bite rolls and pre-rolled finishing escapes keep bait. Rounded up; no extra supply buffer.</div>
      <ol style={{ margin: 0, paddingLeft: 24, lineHeight: 1.8 }}>
        <li>Snap phase: finish about <strong>{numberText(plan.badFights)} bad-feeling fish fights</strong>; cancel other feelings, items, and monsters.</li>
        <li>Finish phase: aim for about <strong>{numberText(plan.finishLandings, 1)} more landings</strong>; cancel bad, terrible, and epic feelings, items, and monsters.</li>
      </ol>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
        {time && <span>Expected total casts: <strong>{numberText(time.casts, 1)}</strong></span>}
        {time && <span>Expected cancelled / no-bite casts: <strong>{numberText(time.cancelledOrEmpty, 1)}</strong></span>}
        <span>Landing given bad feeling: <strong>{(plan.badLandingChance * 100).toFixed(2)}%</strong></span>
        <span>Extra opportunities vs landing-only: <strong>{numberText(plan.extraOpportunities, 1)}</strong></span>
        <span>Projected fatigue use: <strong>{numberText(plan.fatigueProjected)}</strong></span>
        <span>Expected finishing escapes: <strong>{numberText(plan.finishFailures, 1)}</strong></span>
      </div>
    </>}

    <div style={{ display: "grid", gap: 8, padding: "12px 0", borderTop: "1px solid #333", borderBottom: "1px solid #333" }}>
      <h4 style={{ margin: 0 }}>Daily progress</h4>
      <div style={{ display: "flex", alignItems: "end", gap: 8, flexWrap: "wrap" }}>
        <Field label="Outcome fish"><select style={{ ...styles.inputCompact, maxWidth: "100%" }} value={selectedFish?.fish ?? ""}
          disabled={!pool.length} onChange={event => setRecordFish(event.target.value)}>
          {!pool.length && <option value="">No fish</option>}
          {pool.map(member => <option key={member.fish}>{member.fish}</option>)}
        </select></Field>
        <button type="button" style={styles.buttonCompact} disabled={!canRecord} onClick={() => record(true)}><Fish size={16} aria-hidden="true" /> Record landing</button>
        <button type="button" style={styles.buttonCompact} disabled={!canRecord} onClick={() => record(false)}><Scissors size={16} aria-hidden="true" /> Record natural snap</button>
        <button type="button" style={styles.buttonCompact} title="Reset daily catches and fatigue" onClick={() => setSettings(previous => ({ ...previous, landed: 0, fatigueUsed: 0 }))}><RotateCcw size={16} aria-hidden="true" /> New day</button>
      </div>
    </div>

    <details>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Catch pool ({plan.rows.length} fish)</summary>
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 680 }}>
          <thead><tr>{["Fish", "Cap", "Fish share", "Land / bad", "Fatigue: land / fail", "Skill-up chance"].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead>
          <tbody>{plan.rows.map(row => <tr key={row.fish}>
            <td style={cell}>{row.fish}</td><td style={cell}>{row.level}</td><td style={cell}>{(row.share * 100).toFixed(1)}%</td>
            <td style={cell}>{row.warning.bad ? `${(100 * row.warning.badLand / row.warning.bad).toFixed(2)}%` : "No bad feeling"}</td>
            <td style={cell}>{row.cost} / {row.failedCost}</td><td style={cell}>{row.skillup.eligible ? `${row.skillup.chancePct.toFixed(1)}%` : "Not eligible"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
    <details>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Bait comparison at this spot ({comparisons.length} viable)</summary>
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 530 }}>
          <thead><tr>{["Consumable bait", "Bad fights", "Eligible opportunities", "Expected skill gain*"].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead>
          <tbody>{comparisons.map(entry => <tr key={entry.name}>
            <td style={cell}><button type="button" style={styles.buttonCompact} onClick={() => update("bait", entry.name)}>{entry.name}</button></td>
            <td style={cell}>{entry.plan.badFights}</td><td style={cell}>{numberText(entry.plan.opportunities, 1)}</td><td style={cell}>{entry.plan.expectedGain.toFixed(2)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
    <div style={{ fontSize: 12, color: "#bdbdbd", lineHeight: 1.7 }}>
      <strong>Estimate, not a guaranteed 200 catches.</strong> Random outcomes can exhaust fatigue or fill the catch limit early. A reserve is not a confidence guarantee.
      <br />All pool fish are included; a feeling does not identify a species. Epic messages hide risk, so large-fish pools are excluded.
      <br />Natural snaps require a completed fight. Early-reel snaps and ordinary escapes spend fatigue without skill-ups; cancellations give no skill-ups. Both landings and natural snaps spend bait.
      <br />*Skill and pool conditions are held constant, with neutral time/moon/weather and the standard skill-up multiplier. Projected skill gain is not simulated progression. Recalculate after a skill or setup change; actual fatigue requires the full day history.
      <br />Daily counters are manual and account-wide, with a Japanese-midnight reset. No automatic reset or game connection. Source: <a href={`${snapshot.source.repository}/tree/${snapshot.source.revision}`} target="_blank" rel="noreferrer">Revision {snapshot.source.revision.slice(0, 7)}</a>.
    </div>
  </section>;
}