import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PRINT_CRAFTS, printGil as gil, printUnits as units, printPct as pct, type PrintSettings, type PrintSettingsUpdate } from "./utils/printing";
import { printAttemptsForOutput, printAttemptsFromMaterials, printingQuantityPlan, printQuantityDurationSeconds, printQuantityFromStacks, printQuantityStacks, PRINT_QUANTITY_SECONDS_PER_SYNTH } from "./utils/printingQuantities";
import { PRINT_RECIPES, printItem, printItemKey } from "./utils/printingData";
import { normalizeItemName } from "./utils/itemLinks";
import { loadJson, saveJson } from "./utils/storage";
import { CraftingLevels, NumberField } from "./ProfitControls";

type State = {
  query: string;
  craft: string;
  selected: number | null;
  mode: "target" | "materials";
  desired: number;
  targetOutput: string;
  materials: Record<string, number>;
  wotg: boolean;
  keyItems: boolean;
};

const initial: State = { query: "", craft: "", selected: null, mode: "target", desired: 100, targetOutput: "", materials: {}, wotg: false, keyItems: false };

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Unavailable";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours ? `${hours}h` : "", hours || minutes ? `${minutes}m` : "", `${remainder}s`].filter(Boolean).join(" ");
}

export default function PrintQuantityView({ settings, onSettingsChange }: { settings: PrintSettings; onSettingsChange: (patch: PrintSettingsUpdate) => void }) {
  const [state, setState] = useState<State>(() => {
    const saved = loadJson<Partial<State>>("kupo.profits.quantities.v1", {});
    return { ...initial, ...saved, mode: saved.mode === "materials" ? "materials" : "target",
      desired: typeof saved.desired === "number" && Number.isFinite(saved.desired) ? Math.min(1_000_000_000, Math.max(0, Math.floor(saved.desired))) : 100,
      materials: saved.materials ?? {} };
  });
  const [limit, setLimit] = useState(80);
  const query = normalizeItemName(useDeferredValue(state.query));
  useEffect(() => saveJson("kupo.profits.quantities.v1", state), [state]);
  const update = (patch: Partial<State>) => setState((previous) => ({ ...previous, ...patch }));
  const recipes = useMemo(() => PRINT_RECIPES.filter((recipe) =>
    (state.wotg || recipe.era !== "WotG") && (state.keyItems || !recipe.ki) &&
    (!state.craft || state.craft === recipe.craft) &&
    (!query || normalizeItemName([recipe.res.n, ...recipe.hq.map((item) => item.n), ...recipe.ing.map((item) => item.n)].join(" ")).includes(query))),
  [query, state.craft, state.wotg, state.keyItems]);
  const recipe = recipes.find((entry) => entry.id === state.selected) ?? recipes[0];
  const plan = useMemo(() => recipe ? printingQuantityPlan(recipe, settings, printItemKey) : null, [recipe, settings]);
  const target = plan?.outputs.find((output) => output.key === state.targetOutput) ??
    plan?.outputs.find((output) => output.key === printItemKey(recipe?.res.n ?? "")) ?? plan?.outputs[0];
  const targetStackSize = target ? printItem(target.name)?.stack : undefined;
  const desiredStacks = targetStackSize && targetStackSize > 1 ? printQuantityStacks(state.desired, targetStackSize) : null;
  const attempts = plan ? state.mode === "target"
    ? printAttemptsForOutput(state.desired, target?.perAttempt ?? 0)
    : printAttemptsFromMaterials(plan.inputs, state.materials) : null;
  const expectedOutputs = plan && attempts !== null
    ? plan.outputs.map((output) => ({ ...output, quantity: output.perAttempt * attempts }))
    : [];
  const desiredOutput = target && attempts !== null ? target.perAttempt * attempts : null;
  const estimatedSeconds = printQuantityDurationSeconds(attempts);
  const availableSkill = !!plan?.eligible && plan.success > 0;

  return <div className="print-calculator print-quantities">
    <div className="print-filters print-quantity-filters">
      <label><span><Search size={15} /> Search recipes</span><input type="search" placeholder="Output or ingredient" value={state.query} onChange={(event) => { update({ query: event.target.value, selected: null }); setLimit(80); }} /></label>
      <label>Craft<select value={state.craft} onChange={(event) => { update({ craft: event.target.value, selected: null }); setLimit(80); }}><option value="">All crafts</option>{PRINT_CRAFTS.map((craft) => <option key={craft}>{craft}</option>)}</select></label>
    </div>
    <div className="print-checks">
      <label><input type="checkbox" checked={state.wotg} onChange={(event) => update({ wotg: event.target.checked, selected: null })} /> Include WotG recipes</label>
      <label><input type="checkbox" checked={state.keyItems} onChange={(event) => update({ keyItems: event.target.checked, selected: null })} /> Include key-item recipes</label>
    </div>
    <div className="print-workspace">
      <aside className="print-browser" aria-label="Quantity recipes">
        <div className="print-list-title">{recipes.length} recipes</div>
        <div className="print-recipe-list">{recipes.slice(0, limit).map((entry) => <button type="button" key={entry.id} aria-pressed={entry.id === recipe?.id} onClick={() => update({ selected: entry.id })}>
          <strong>{entry.res.n}</strong><span className="print-muted">{entry.craft} {entry.lvl}{entry.subs?.map((sub) => ` / ${sub.c} ${sub.l}`).join("")}</span><span className="print-muted">NQ: {entry.res.q} x {entry.res.n}</span>
        </button>)}</div>
        {recipes.length > limit && <button className="print-command" onClick={() => setLimit((previous) => previous + 80)}>Show more recipes</button>}
        {!recipes.length && <p className="print-muted">No recipes match these filters.</p>}
      </aside>
      {recipe && plan ? <article className="print-detail">
        <header className="print-detail-title"><div><span className="print-eyebrow">Quantity planner</span><h2>{recipe.res.n}</h2><span className="print-muted">{recipe.craft} {recipe.lvl}{recipe.subs?.map((sub) => ` / ${sub.c} ${sub.l}`).join("")}</span></div></header>
        <div className="print-checks print-quantity-modes" role="group" aria-label="Quantity calculation mode">
          <label><input type="radio" name="print-quantity-mode" checked={state.mode === "target"} onChange={() => update({ mode: "target" })} /> Desired output</label>
          <label><input type="radio" name="print-quantity-mode" checked={state.mode === "materials"} onChange={() => update({ mode: "materials" })} /> Materials available</label>
        </div>
        {state.mode === "target" ? <div className="print-options">
          {plan.outputs.length > 1 && <label>Output item<select aria-label="Quantity target output" value={target?.key ?? ""} onChange={(event) => update({ targetOutput: event.target.value })}>{plan.outputs.map((output) => <option key={output.key} value={output.key}>{output.name}</option>)}</select></label>}
          <NumberField label={`Desired ${target?.name ?? recipe.res.n} items`} value={state.desired} max={1_000_000_000} onChange={(desired) => update({ desired: Math.floor(desired) })} />
          {targetStackSize && targetStackSize > 1 && desiredStacks !== null && <NumberField label={`Desired stacks (${targetStackSize} each)`} value={desiredStacks} max={1_000_000_000 / targetStackSize} step={1 / targetStackSize} onChange={(stacks) => update({ desired: printQuantityFromStacks(stacks, targetStackSize) })} />}
        </div> : <div className="print-skills print-quantity-materials">{plan.inputs.map((input) => <NumberField key={input.key} label={`${input.name} available`} value={state.materials[input.key] ?? 0} max={1_000_000_000} onChange={(quantity) => update({ materials: { ...state.materials, [input.key]: Math.floor(quantity) } })} />)}</div>}
        {!availableSkill && <p className="print-warning">Current skills cannot synthesize this recipe reliably. Quantity results are theoretical.</p>}
        <p className="print-muted">{settings.skillMode === "at-cap" ? "Using hypothetical HQ planning." : "Using your actual skill levels."} Values use expected success, HQ results, and material loss. Estimated time assumes {PRINT_QUANTITY_SECONDS_PER_SYNTH} seconds per synth; actual outcomes vary.</p>
        <div className="print-quantity-summary">
          <div><span>{state.mode === "target" ? "Synth attempts needed" : "Synth attempts from materials"}</span><strong>{attempts === null ? "Unavailable" : gil(attempts)}</strong></div>
          <div><span>Estimated time ({PRINT_QUANTITY_SECONDS_PER_SYNTH}s per synth)</span><strong>{formatDuration(estimatedSeconds)}</strong></div>
          {state.mode === "target"
            ? <div><span>Expected {target?.name ?? recipe.res.n} output</span><strong>{desiredOutput === null ? "Unavailable" : units(desiredOutput)}</strong></div>
            : expectedOutputs.map((output) => <div key={output.key}><span>Expected {output.name}</span><strong>{units(output.quantity)}</strong></div>)}
          <div><span>Success per attempt</span><strong>{pct(plan.success)}</strong></div>
        </div>
        {state.mode === "target" && <section className="print-section">
          <h3>Expected materials needed</h3>
          <div className="print-table-wrap"><table><thead><tr><th>Material</th><th>Expected quantity / synth</th><th>For {attempts === null ? "—" : gil(attempts)} synths</th></tr></thead><tbody>{plan.inputs.map((input) => <tr key={input.key}><td>{input.name}</td><td>{units(input.perAttempt)}</td><td>{attempts === null ? "Unavailable" : units(input.perAttempt * attempts)}</td></tr>)}</tbody></table></div>
        </section>}
        {state.mode === "materials" && <section className="print-section">
          <h3>Expected output</h3>
          <div className="print-table-wrap"><table><thead><tr><th>Output</th><th>Expected quantity / synth</th><th>From {attempts === null ? "—" : gil(attempts)} synths</th></tr></thead><tbody>{expectedOutputs.map((output) => <tr key={output.key}><td>{output.name}</td><td>{units(output.perAttempt)}</td><td>{units(output.quantity)}</td></tr>)}</tbody></table></div>
        </section>}
      </article> : <div className="print-empty"><p>Search for and select a recipe to plan its quantities.</p></div>}
    </div>
    <CraftingLevels settings={settings} onChange={onSettingsChange} />
  </div>;
}
