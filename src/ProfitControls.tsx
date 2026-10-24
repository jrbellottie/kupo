import { PRINT_CRAFTS, printGil as gil, printTone as tone, type PrintSettings, type PrintSettingsUpdate } from "./utils/printing";
import { printItem } from "./utils/printingData";
import { RotateCcw } from "lucide-react";
import PriceInput from "./PriceInput";

export type ProfitPriceUnit = "each" | "stack";

export function PriceUnitSelector({ value, onChange, label = "Price entry" }: { value: ProfitPriceUnit; onChange: (unit: ProfitPriceUnit) => void; label?: string }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value === "stack" ? "stack" : "each")}><option value="each">Gil per item</option><option value="stack">Gil per stack (item's stack size)</option></select></label>;
}

export function ProfitPriceField({ name, kind, value, baseline, onChange, unit, resetLabel }: {
  name: string; kind: string; value: number | undefined; baseline: number | null; onChange: (value: number | null) => void;
  unit: ProfitPriceUnit; resetLabel?: string;
}) {
  const stack = printItem(name)?.stack ?? null;
  const quantity = unit === "stack" && stack !== null ? stack : 1;
  const description = unit === "stack" && stack !== null ? `stack of ${stack}` : "each";
  return <div className="print-unit-price"><PriceInput key={unit} label={`${kind} ${name} gil ${description}`} value={value} baseline={baseline} onChange={onChange} quantity={quantity} resetLabel={resetLabel} /><small>{stack === null ? "Unknown stack size: enter gil each" : stack === 1 ? "Unstackable / 1 item" : unit === "stack" ? `Gil per stack of ${stack}` : `Gil each / stack of ${stack}`}</small></div>;
}

function PairedPriceFields({ name, kind, value, baseline, onChange, resetLabel, resetText, useBaseline }: {
  name: string; kind: string; value: number | undefined; baseline: number | null; onChange: (value: number | null) => void;
  resetLabel: string; resetText: string; useBaseline: boolean;
}) {
  const stack = printItem(name)?.stack ?? null;
  const displayedValue = useBaseline ? value ?? baseline : value;
  return <div className="print-paired-price-field">
    <div className="print-paired-price-inputs">
      <label>Gil each<PriceInput label={`${kind} ${name} gil each`} value={displayedValue ?? undefined} baseline={baseline} onChange={onChange} showReset={false} roundDown /></label>
      {stack === null
        ? <label>Gil per stack<div className="item-price-input"><input type="number" aria-label={`${kind} ${name} gil per stack`} placeholder="Unknown stack size" disabled /></div></label>
        : <label>Gil per stack of {stack}<PriceInput label={`${kind} ${name} gil stack of ${stack}`} value={displayedValue ?? undefined} baseline={baseline} quantity={stack} onChange={onChange} showReset={false} roundDown /></label>}
    </div>
    <button type="button" className="print-command print-paired-price-reset" disabled={value === undefined} aria-label={resetLabel} onClick={() => onChange(null)}><RotateCcw size={14} /> {resetText}</button>
  </div>;
}

export function ProfitDualPriceField({ name, kind, value, baseline, onChange, useBaseline = false, resetText = "Reset price", resetLabel }: {
  name: string; kind: string; value: number | undefined; baseline: number | null; onChange: (value: number | null) => void;
  useBaseline?: boolean; resetText?: string; resetLabel?: string;
}) {
  return <PairedPriceFields name={name} kind={kind} value={value} baseline={baseline} onChange={onChange} resetLabel={resetLabel ?? `Reset ${kind.toLowerCase()} price for ${name}`} resetText={resetText} useBaseline={useBaseline} />;
}

export function ProfitCostField({ name, value, baseline, onChange }: {
  name: string; value: number | undefined; baseline: number | null; onChange: (value: number | null) => void;
}) {
  return <PairedPriceFields name={name} kind="Cost" value={value} baseline={baseline} onChange={onChange} resetLabel={`Use calculated cost for ${name}`} resetText="Use calculated cost" useBaseline />;
}

export function NumberField({ label, value, onChange, min = 0, max = 1000000000, step = 1 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return <label>{label}<input type="number" aria-label={label} min={min} max={max} step={step} value={value} onChange={(event) => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next))); }} /></label>;
}

export function CraftingLevels({ settings, onChange, planning = true }: { settings: PrintSettings; onChange: (patch: PrintSettingsUpdate) => void; planning?: boolean }) {
  return <section className="print-section print-levels">
    <div className="print-section-heading"><h3>Your crafting levels</h3>{planning && <label>Calculate using<select value={settings.skillMode ?? "character"} onChange={(event) => onChange({ skillMode: event.target.value === "at-cap" ? "at-cap" : "character" })}><option value="character">My crafting levels</option><option value="at-cap">Hypothetical HQ planning</option></select></label>}</div>
    <div className="print-skills">{PRINT_CRAFTS.map((craft) => <NumberField key={craft} label={`${craft} level`} value={settings.skills[craft] ?? 0} max={110} step={0.1} onChange={(value) => onChange((current) => ({ skillMode: "character", skills: { ...current.skills, [craft]: value } }))} />)}</div>
    <p className="print-muted">{planning && settings.skillMode === "at-cap" ? "Planning mode ignores your levels. Switch to My crafting levels for your actual success and HQ estimates." : "These levels apply to the main recipe, every subcraft, and every ingredient you craft. Unentered levels are 0."}</p>
    <details><summary>Skill bonuses from support / equipment</summary><div className="print-skills">{PRINT_CRAFTS.map((craft) => <NumberField key={craft} label={`${craft} bonus`} value={settings.bonuses[craft] ?? 0} max={30} onChange={(value) => onChange((current) => ({ skillMode: "character", bonuses: { ...current.bonuses, [craft]: value } }))} />)}</div></details>
  </section>;
}

export function ProfitMetrics({ cost, profit, gilPerHour, available = true }: { cost: number | null; profit: number | null; gilPerHour: number | null; available?: boolean }) {
  const values = [
    { label: "Cost per synth", value: cost, className: "" },
    { label: "Profit per 100 synths", value: profit === null ? null : profit * 100, className: tone(profit) },
    { label: "Profit / gil per hour", value: gilPerHour, className: tone(gilPerHour) },
  ];
  return <div className="print-metrics">{values.map(({ label, value, className }) => <div key={label}><span>{label}</span><strong className={available ? className : "print-warning"}>{available ? `${gil(value)}${value === null ? "" : " gil"}` : "Unavailable"}</strong></div>)}</div>;
}

export function BreakLossSettings({ settings, onChange }: { settings: PrintSettings; onChange: (patch: Partial<PrintSettings>) => void }) {
  return <>
    <label>Material loss on failure<select value={settings.lossMode ?? "fixed"} onChange={(event) => onChange({ lossMode: event.target.value === "skill" ? "skill" : "fixed" })}><option value="skill">From crafting skill / difficulty</option><option value="fixed">Custom loss percentage</option></select></label>
    {settings.lossMode !== "skill" && <NumberField label="Material loss on break (%)" value={settings.lossPct} max={100} onChange={(lossPct) => onChange({ lossPct })} />}
  </>;
}
