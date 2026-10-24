import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Hammer, Search } from "lucide-react";
import { BreakLossSettings, CraftingLevels, NumberField, ProfitCostField, ProfitDualPriceField, ProfitMetrics } from "./ProfitControls";
import { desynthesisBatchEstimate, desynthesisEstimate } from "./utils/desynthesis";
import { PRINT_CRAFTS, printGil as gil, printPct as pct, printUnits as units, type PrintSettings, type PrintSettingsUpdate } from "./utils/printing";
import { DESYNTH_RECIPES, printBuyPrice, printItemKey, printSellPrice } from "./utils/printingData";
import { itemPrices, useItemPrices } from "./utils/itemPrices";
import { normalizeItemName } from "./utils/itemLinks";
import { loadJson, saveJson } from "./utils/storage";
import { navigateToTab } from "./utils/tabNav";

type State = { query: string; craft: string; selected: number | null; wotg: boolean; keyItems: boolean; vendors: boolean; costOverrides: Record<string, number>; batchMode: "input-count" | "target-output"; batchCount: number; targetOutput: string };

export default function DesynthesisView({ settings, onSettingsChange }: { settings: PrintSettings; onSettingsChange: (patch: PrintSettingsUpdate) => void }) {
  const [state, setState] = useState(() => {
    const saved = loadJson<Partial<State>>("kupo.desynthesis.v1", {});
    const count = saved.batchCount;
    return { query: saved.query ?? "", craft: saved.craft ?? "", selected: saved.selected ?? null, wotg: saved.wotg ?? false, keyItems: saved.keyItems ?? false, vendors: saved.vendors ?? true, costOverrides: saved.costOverrides ?? {},
      batchMode: saved.batchMode === "target-output" ? "target-output" as const : "input-count" as const,
      batchCount: typeof count === "number" && Number.isFinite(count) ? Math.min(1_000_000_000, Math.max(0, Math.floor(count))) : 100,
      targetOutput: saved.targetOutput ?? "" };
  });
  const [limit, setLimit] = useState(80);
  const prices = useItemPrices(state.vendors);
  const query = normalizeItemName(useDeferredValue(state.query));
  useEffect(() => saveJson("kupo.desynthesis.v1", state), [state]);
  const update = (patch: Partial<State>) => setState((previous) => ({ ...previous, ...patch }));
  const recipes = useMemo(() => DESYNTH_RECIPES.filter((recipe) =>
    (state.wotg || recipe.era !== "WotG") && (state.keyItems || !recipe.ki) && (!state.craft || recipe.craft === state.craft) &&
    (!query || normalizeItemName([...recipe.ing, recipe.res, ...recipe.hq].map((item) => item.n).join(" ")).includes(query)))
    .sort((a, b) => a.ing[0].n.localeCompare(b.ing[0].n) || a.lvl - b.lvl || a.id - b.id), [query, state.craft, state.wotg, state.keyItems]);
  const recipe = recipes.find((entry) => entry.id === state.selected) ?? recipes[0];
  const vendorPrice = (name: string) => printSellPrice(name, prices.vendor);
  const calculatedCost = (name: string) => printBuyPrice(name, prices.effectiveBuy, state.vendors);
  const inputCost = (name: string) => state.costOverrides[printItemKey(name)] ?? calculatedCost(name);
  const estimate = recipe ? desynthesisEstimate(recipe, settings,
    inputCost,
    (name) => prices.sell[printItemKey(name)] ?? vendorPrice(name)) : null;
  const result = estimate;
  const available = !!result?.eligible && result.success > 0;
  const outputs = result ? [...new Map(result.outcomes.map((outcome) => [printItemKey(outcome.n), outcome.n])).values()] : [];
  const targetOutputKey = outputs.some((name) => printItemKey(name) === state.targetOutput) ? state.targetOutput : outputs[0] ? printItemKey(outputs[0]) : "";
  const targetOutput = outputs.find((name) => printItemKey(name) === targetOutputKey) ?? null;
  const batchEstimate = recipe && result && targetOutput
    ? desynthesisBatchEstimate(recipe, result.outcomes, targetOutput, state.batchCount, state.batchMode)
    : null;
  const batchAttempts = batchEstimate?.attempts;
  const requiredInputText = recipe && typeof batchAttempts === "number"
    ? recipe.ing.map((input) => `${units(batchAttempts * input.q)} x ${input.n}`).join(" + ")
    : "Unavailable";
  const setCostOverride = (key: string, value: number | null) => setState((previous) => {
    const costOverrides = { ...previous.costOverrides };
    if (value === null) delete costOverrides[key]; else costOverrides[key] = value;
    return { ...previous, costOverrides };
  });

  return <div className="print-calculator">
    {prices.error && <p role="alert" className="print-warning">{prices.error}</p>}
    <div className="print-filters print-desynth-filters">
      <label><span><Search size={15} /> Item to desynthesize</span><input type="search" placeholder="Item or recovered material" value={state.query} onChange={(event) => { update({ query: event.target.value, selected: null }); setLimit(80); }} /></label>
      <label>Craft<select value={state.craft} onChange={(event) => update({ craft: event.target.value, selected: null })}><option value="">All crafts</option>{PRINT_CRAFTS.map((craft) => <option key={craft}>{craft}</option>)}</select></label>
    </div>
    <div className="print-workspace">
      <aside className="print-browser" aria-label="Desynthesis recipes"><div className="print-list-title">{recipes.length} items / recipes</div><div className="print-recipe-list">{recipes.slice(0, limit).map((entry) => <button key={entry.id} type="button" aria-pressed={entry.id === recipe?.id} onClick={() => update({ selected: entry.id })}><strong>{entry.ing.map((item) => item.n).join(" + ")}</strong><span className="print-muted">{entry.craft} {entry.lvl}{entry.subs?.map((sub) => ` / ${sub.c} ${sub.l}`).join("")}</span><span className="print-muted">NQ: {entry.res.q} x {entry.res.n}</span></button>)}</div>{recipes.length > limit && <button className="print-command" onClick={() => setLimit(limit + 80)}>Show more items</button>}</aside>
      <article className="print-detail">
        {recipe && result && estimate ? <>
          <header className="print-detail-title"><div><span className="print-eyebrow">Desynthesize</span><h2>{recipe.ing.map((item) => item.n).join(" + ")}</h2><span className="print-muted">{recipe.craft} {recipe.lvl} / {recipe.crystal} Crystal{recipe.ki && " / Key item required"}</span></div><button className="print-command" onClick={() => navigateToTab("crafting", recipe.ing[0].n, "printing", recipe.id)}><Hammer size={15} /> Recipe</button></header>
          <ProfitMetrics cost={result.cost} profit={result.profit} gilPerHour={result.gilPerHour} available={available} />
          <p className="print-metric-note">Expected results for attempts, not successful recoveries. Failed attempts can lose the item; the crystal is always consumed. Selling fees and time are not included.</p>
          <div className="print-result-strip"><span>Success: <strong>{pct(result.success)}</strong></span><span>Failure: <strong>{pct(1 - result.success)}</strong></span><span>Attempts / hour: <strong>{gil(result.attemptsPerHour)}</strong></span></div>
          <section className="print-section"><h3>Batch estimate</h3><div className="print-options">
            <label>Count by<select aria-label="Batch count mode" value={state.batchMode} onChange={(event) => update({ batchMode: event.target.value === "target-output" ? "target-output" : "input-count" })}><option value="input-count">Input items</option><option value="target-output">Desired recovered amount</option></select></label>
            <NumberField label={state.batchMode === "input-count" ? "Items to desynthesize" : `Desired ${targetOutput ?? "recovered item"} count`} value={state.batchCount} max={1_000_000_000} step={1} onChange={(batchCount) => update({ batchCount: Math.floor(batchCount) })} />
            {outputs.length > 1 && <label>Recovered material<select aria-label="Recovered material" value={targetOutputKey} onChange={(event) => update({ targetOutput: event.target.value })}>{outputs.map((name) => <option key={printItemKey(name)} value={printItemKey(name)}>{name}</option>)}</select></label>}
          </div><div className="print-result-strip">
            {state.batchMode === "input-count"
              ? <span>Expected {targetOutput}: <strong>{!batchEstimate || batchEstimate.expectedOutput === null ? "Unavailable" : units(batchEstimate.expectedOutput)}</strong></span>
              : <><span>Inputs needed: <strong>{requiredInputText}</strong></span><span>Expected {targetOutput}: <strong>{!batchEstimate || batchEstimate.expectedOutput === null ? "Unavailable" : units(batchEstimate.expectedOutput)}</strong></span></>}
          </div><p className="print-muted">Recovered counts are expected averages; input items needed are rounded up to whole attempts.</p></section>
          {!available && <p className="print-warning" role="status">This desynthesis is unavailable at your current crafting levels or has no success chance.</p>}
        </> : <p className="print-empty">No desynthesis recipes match your search.</p>}
        <CraftingLevels settings={settings} onChange={onSettingsChange} planning={false} />
        {recipe && result && estimate && <>
          <div className="print-requirements">{result.requirements.map((requirement) => <span key={requirement.craft} className={requirement.gap < 0 ? "print-warning" : "print-muted"}>{requirement.craft}: {requirement.effective} / cap {requirement.cap}</span>)}</div>
          <section className="print-section"><h3>What you spend</h3><div className="print-table-wrap"><table><thead><tr><th>Input</th><th>Per attempt</th><th>Cost</th><th>Applied cost each</th></tr></thead><tbody>{result.inputs.map((input) => {
            const key = printItemKey(input.name);
            return <tr key={key}><td>{input.name}</td><td>{input.quantity}</td><td><ProfitCostField name={input.name} value={state.costOverrides[key]} baseline={calculatedCost(input.name)} onChange={(value) => setCostOverride(key, value)} /></td><td>{gil(input.price)}</td></tr>;
          })}</tbody></table></div><p className="print-muted">Cost defaults to the lowest known buy price. Unknown prices are not zero; enter 0 only for items obtained at no cost.</p></section>
          <section className="print-section"><h3>What you recover</h3><div className="print-table-wrap"><table><thead><tr><th>Result</th><th>Recovered item</th><th>Quantity</th><th>Chance per attempt</th><th>Expected units / 100 attempts</th></tr></thead><tbody>{result.outcomes.map((outcome, index) => <tr key={index}><td>{index === 0 ? "NQ" : `HQ${index}`}</td><td>{outcome.n}</td><td>{outcome.q}</td><td>{pct(outcome.probability)}</td><td>{available ? units(100 * outcome.probability * outcome.q) : "Unavailable"}</td></tr>)}</tbody></table></div></section>
          <section className="print-section"><h3>Price the recovered materials</h3><div className="print-table-wrap"><table><thead><tr><th>Material</th><th>Sale price</th><th>Applied sale each</th></tr></thead><tbody>{outputs.map((name) => {
            const key = printItemKey(name);
            return <tr key={key}><td>{name}</td><td><ProfitDualPriceField name={name} kind="Sale" value={prices.sell[key]} baseline={vendorPrice(name)} onChange={(value) => itemPrices.setPrice("sell", name, value)} useBaseline resetText="Reset to vendor price" resetLabel={`Reset sale price to vendor value for ${name}`} /></td><td>{gil(result.outcomes.find((outcome) => printItemKey(outcome.n) === key)?.price ?? null)}</td></tr>;
          })}</tbody></table></div><p className="print-muted">Vendor price is the default; reset to restore it.</p></section>
        </>}
        <details className="print-section"><summary>Desynthesis assumptions &amp; recipe filters</summary>
          <div className="print-options">
            <NumberField label="Seconds per synth" value={settings.seconds} min={20} max={22} step={0.1} onChange={(seconds) => onSettingsChange({ seconds })} />
            <NumberField label="Extra seconds per attempt" value={settings.overhead} max={3600} onChange={(overhead) => onSettingsChange({ overhead })} />
            <BreakLossSettings settings={settings} onChange={onSettingsChange} />
            <NumberField label="Desynth success bonus (percentage points)" value={settings.desynthSuccessBonus ?? 0} min={-100} max={100} onChange={(desynthSuccessBonus) => onSettingsChange({ desynthSuccessBonus })} />
            <NumberField label="Desynth HQ chance (%)" value={settings.desynthHqRate ?? 60} max={80} onChange={(desynthHqRate) => onSettingsChange({ desynthHqRate })} />
            <NumberField label="Sell-value multiplier (%)" value={settings.sellMultiplier} max={1000} step={0.1} onChange={(sellMultiplier) => onSettingsChange({ sellMultiplier })} />
          </div>
          <div className="print-checks"><label><input type="checkbox" checked={state.vendors} onChange={(event) => update({ vendors: event.target.checked })} /> Recorded NPC buy prices</label><label><input type="checkbox" checked={state.wotg} onChange={(event) => update({ wotg: event.target.checked, selected: null })} /> Include WotG recipes</label><label><input type="checkbox" checked={state.keyItems} onChange={(event) => update({ keyItems: event.target.checked, selected: null })} /> Include key-item recipes (ownership unverified)</label></div>
          <p className="print-muted">Success is rolled independently for every required craft: 40% at or above cap before bonuses. On success, default NQ / HQ1 / HQ2 / HQ3 chances are 40 / 30 / 20 / 10%, not normal crafting HQ tiers. No automatic ring, food, day, moon, or equipment modifiers. Live-server rates may differ.</p>
        </details>
      </article>
    </div>
  </div>;
}
