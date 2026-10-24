import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Coins, Hammer, Search, Tags, TrendingUp } from "lucide-react";
import { DEFAULT_PRINT_SETTINGS, HQ_GAPS, PRINT_CRAFTS, printingChances, restorePrintSettings, printGil as gil, printUnits as units, printPct as pct, printTone as tone, type PrintSettings, type PrintSettingsUpdate } from "./utils/printing";
import { createPrintingChain, chainTierCosts, chainBatchAllocation, type ChainNode, type SourceChoice, type SourceChoices } from "./utils/printingChain";
import { createPrintingPlanner } from "./utils/printingPlanner";
import { PRINT_SKILL_CAP, reachablePrintTiers, printTierComparisons, selectPrintTier } from "./utils/printingTiers";
import { PRINT_RECIPES, printItemKey, printBuyPrice, printSellPrice, printOffers, type PriceBook } from "./utils/printingData";
import { normalizeItemName, findableName } from "./utils/itemLinks";
import { loadJson, saveJson } from "./utils/storage";
import { itemPrices, useItemPrices } from "./utils/itemPrices";
import type { PriceSnapshot } from "./utils/itemPriceStore";
import { BreakLossSettings, CraftingLevels, NumberField, PriceUnitSelector, ProfitCostField, ProfitDualPriceField, ProfitMetrics, ProfitPriceField, type ProfitPriceUnit } from "./ProfitControls";
import DesynthesisView from "./DesynthesisView";
import { navigateToTab, rememberTabState, peekRestoredTabState, peekNavQuery, goBackTab, hasBackTab } from "./utils/tabNav";
import NpcLink from "./NpcLink";
import wikiData from "./data/itemWiki.json";
import "./PrintingTab.css";
import { CollapsibleSection } from "./ScreenControls";
import "./PricesTab.css";

const PricesTab = lazy(() => import("./PricesTab"));

type State = { settings: PrintSettings; buy: PriceBook; sell: PriceBook; costOverrides: PriceBook; sources: SourceChoices; tiers: Record<number, number>; sort: "hour" | "profit"; vendors: boolean; modernGuilds: boolean; query: string; craft: string; filter: string; wotg: boolean; keyItems: boolean; selected: number | null; batch: number };
const initial: State = { settings: DEFAULT_PRINT_SETTINGS, buy: {}, sell: {}, costOverrides: {}, sources: {}, tiers: {}, sort: "hour", vendors: true, modernGuilds: false, query: "", craft: "", filter: "all", wotg: false, keyItems: false, selected: null, batch: 100 };
const wiki = wikiData as unknown as { items: Record<string, { image?: string }> };
const getPrintingPlan = createPrintingPlanner(PRINT_RECIPES, printItemKey, printBuyPrice, printSellPrice);

function PriceField({ name, book, baseline, onChange, kind, unit }: { name: string; book: PriceBook; baseline: number | null; onChange: (name: string, value: number | null) => void; kind: "Buy" | "Sell"; unit: ProfitPriceUnit }) {
  return <ProfitPriceField name={name} kind={kind} value={book[printItemKey(name)]} baseline={baseline} onChange={(value) => onChange(name, value)} unit={unit} resetLabel={`Reset ${kind.toLowerCase()} price for ${name}`} />;
}

function ItemButton({ name }: { name: string }) {
  return <button type="button" className="print-link" onClick={() => navigateToTab("drops", findableName(name) ?? name, "printing")}>{name}</button>;
}

type SourceProps = { node: ChainNode; demand: number | null; parentQuantity: number; branchColor: number; state: State; prices: PriceSnapshot; priceUnit: ProfitPriceUnit; chain: ReturnType<typeof createPrintingChain>; onSource: (name: string, choice: SourceChoice) => void; onPrice: (name: string, value: number | null) => void; onCost: (name: string, value: number | null) => void };

function IngredientSource({ node, demand, parentQuantity, branchColor, state, prices, priceUnit, chain, onSource, onPrice, onCost }: SourceProps) {
  const recipes = chain.options(node.name);
  const terminalWater = node.key === printItemKey("Distilled Water");
  const choice = terminalWater ? "buy" : state.sources[node.key] ?? "auto";
  const manualCost = state.costOverrides[node.key];
  const reachable = node.recipe ? reachablePrintTiers(node.recipe) : [];
  const tiers = chainTierCosts(node, state.settings, printItemKey).filter((tier) => reachable.includes(tier.tier));
  const allocation = chainBatchAllocation(node, parentQuantity, printItemKey);
  const offers = printOffers(node.name).filter((offer) => state.modernGuilds || !offer.guild);
  const sourceControl = <label>Recipe / source for {node.name}<select aria-label={`Source for ${node.name}`} disabled={terminalWater || manualCost !== undefined} value={choice} onChange={(event) => onSource(node.name, event.target.value === "auto" || event.target.value === "buy" ? event.target.value : Number(event.target.value))}>
    <option value="auto">Auto: craft every craftable ingredient</option><option value="buy">Buy / gathered (stop breakdown)</option>
    {typeof choice === "number" && !recipes.some((recipe) => recipe.id === choice) && <option value={choice}>Saved recipe unavailable in current filters</option>}
    {recipes.map((recipe) => { const chances = printingChances(recipe, state.settings); const output = chain.expectedYield(recipe, node.name); return <option key={recipe.id} value={recipe.id}>{recipe.craft} {recipe.lvl} / {recipe.ing.map((item) => `${item.n} x${item.q}`).join(", ")}{!chances.eligible || chances.success <= 0 || output <= 0 ? " / Yield unavailable" : ` / ${units(output)} usable per synth`}</option>; })}
  </select></label>;
  return <details className={`print-ingredient${node.recipe ? " print-crafted-ingredient" : ""} print-ingredient-color-${branchColor}`} data-item={node.name}>
    <summary className="print-ingredient-summary"><span className="print-tree-name"><strong>{parentQuantity} x {node.name}</strong><span className={node.issue ? "print-warning" : "print-muted"}>{manualCost !== undefined ? "Manual cost" : node.recipe ? `Craft: ${node.recipe.craft} ${node.recipe.lvl}` : node.issue ? "Needs attention" : "Buy / obtain"}{node.recipe?.subs?.map((sub) => ` + ${sub.c} ${sub.l}`).join("")}</span></span><span className={node.price === null ? "print-warning" : "print-tree-price"}>{gil(node.price === null ? null : node.price * parentQuantity)}{node.price !== null && " gil"}<small>for parent recipe</small></span></summary>
    <div className="print-ingredient-body">
    <div className="print-cost-controls">
      <div><span>Cost</span><ProfitCostField name={node.name} value={manualCost} baseline={node.price} onChange={(value) => onCost(node.name, value)} /></div>
    </div>
    <p className="print-muted">{manualCost !== undefined ? "Using your entered cost; the breakdown below is excluded from the estimate. Reset to use the calculated cost." : `${node.price === null ? "Enter a cost to include this item" : node.recipe ? "Calculated from ingredients below" : "Using the shared buy price"}.`} {demand === null ? "Expected quantity unavailable." : `${units(demand)} expected / final attempt, including upstream yields and losses.`}</p>
    {(recipes.length > 0 || typeof choice === "number") && <div className="print-source-controls">{sourceControl}</div>}
    {recipes.length > 1 && <details className="print-recipe-options">
      <summary>All {recipes.length} recipes for {node.name}</summary>
      <div className="print-table-wrap"><table aria-label={`Recipes for ${node.name}`}><thead><tr><th>Recipe</th><th>Ingredients per synthesis</th><th>NQ / HQ1 / HQ2 / HQ3</th></tr></thead><tbody>{recipes.map((recipe) => <tr key={recipe.id} className={node.recipe?.id === recipe.id ? "print-current-tier" : ""}>
        <td><button type="button" className="print-command" disabled={manualCost !== undefined} aria-pressed={node.recipe?.id === recipe.id} aria-label={`Use ${recipe.craft} ${recipe.lvl} recipe for ${node.name}: ${recipe.ing.map((item) => `${item.n} x${item.q}`).join(", ")}`} onClick={() => onSource(node.name, recipe.id)}>{node.recipe?.id === recipe.id ? "Selected" : "Use recipe"}</button><small>{recipe.craft} {recipe.lvl}{recipe.subs?.map((sub) => ` / ${sub.c} ${sub.l}`).join("")} / {recipe.era || "Base"}{recipe.ki && " / Key item"}</small></td>
        <td>{[...recipe.ing, { n: `${recipe.crystal} Crystal`, q: 1 }].map((item) => `${item.q} x ${item.n}`).join(" + ")}</td>
        <td>{[recipe.res, ...Array.from({ length: 3 }, (_, index) => recipe.hq[index] ?? recipe.res)].map((item) => `${item.q} x ${item.n}`).join(" / ")}</td>
      </tr>)}</tbody></table></div>
      <p className="print-muted">Select a recipe to use its ingredients. Auto chooses the lowest fully priced crafting cost; unpriced alternatives remain listed. Era and key-item filters still apply.</p>
    </details>}
    <details className="print-sourcing"><summary>Shared buy quote &amp; NPC offers{offers.length > 0 ? ` / ${offers.length} offers` : ""}</summary>
      <label>Shared buy quote<PriceField name={node.name} kind="Buy" book={prices.buy} baseline={printBuyPrice(node.name, prices.effectiveBuy, state.vendors, state.modernGuilds)} onChange={onPrice} unit={priceUnit} /></label>
      {offers.length > 0 ? offers.map((offer, index) => <div className="print-sources" key={index}><span>{gil(offer.price)} gil / {offer.npc ? <NpcLink name={offer.npc} zone={offer.zone} from="printing" /> : `${offer.guild} guild / ${offer.rank}`}{offer.zone && ` / ${offer.zone}`}</span></div>) : <p className="print-muted">No recorded NPC offers.</p>}
    </details>
    {node.issue && <p className="print-warning">{node.issue}</p>}
    {node.recipe ? <div className="print-stage">
      <p className="print-batch-inputs">{node.recipe.ing.map((input) => `${input.q} x ${input.n}`).join(" + ")} + 1 x {node.recipe.crystal} Crystal makes {node.recipe.res.q} x {node.recipe.res.n} (NQ).</p>
      <div className="print-ingredient-children" role="group" aria-label={`Ingredients to make ${node.name}`}>{node.children.map((child, index) => <IngredientSource key={`${child.node.key}:${index}`} {...{ state, prices, priceUnit, chain, onSource, onPrice, onCost, branchColor }} node={child.node} parentQuantity={child.recipeQuantity} demand={demand !== null && node.yield > 0 ? demand * child.quantity / node.yield : null} />)}</div>
      <details className="print-stage-analysis"><summary>Yield, batch allocation &amp; HQ details</summary>
      <p className="print-stage-yield"><strong>{units(node.yield)} usable output / attempt</strong> / {pct(node.success)} success / {pct(node.hq)} HQ / tier {node.tier < 0 ? "below cap" : node.tier}</p>
      <p className="print-muted">{printingChances(node.recipe, state.settings).requirements.map((requirement) => `${requirement.craft}: ${requirement.effective} / cap ${requirement.cap} (${requirement.gap >= 0 ? "+" : ""}${requirement.gap})`).join("; ")}</p>
      <p className="print-muted">NQ / HQ1 / HQ2 / HQ3: {[node.recipe.res, ...Array.from({ length: 3 }, (_, index) => node.recipe!.hq[index] ?? node.recipe!.res)].map((outcome) => printItemKey(outcome.n) === node.key ? `x${outcome.q}` : `${outcome.n} (not usable)`).join(" / ")}. {node.yield > 0 && demand !== null ? `${units(demand / node.yield)} stage attempts per final attempt` : "No usable output under current assumptions"}.</p>
      {allocation && <details className="print-stage-allocation" open><summary>NQ batch: {allocation.output} produced / {allocation.parentQuantity} used by parent recipe</summary><div className="print-table-wrap"><table><thead><tr><th>Input</th><th>Per batch</th><th>Parent's share</th><th>Allocated gil</th></tr></thead><tbody>{allocation.inputs.map((input, index) => <tr key={index}><td>{input.name}</td><td>{input.quantity}</td><td>{units(input.allocatedQuantity)}</td><td>{gil(input.allocatedCost)}</td></tr>)}</tbody></table></div><p className="print-muted">{allocation.parentQuantity} / {allocation.output} of this NQ batch is allocated to one parent synthesis. Before this stage's HQ and break adjustments; expected profit above includes both. Input unit costs include any earlier crafting stages.</p></details>}
      <button className="print-command" onClick={() => navigateToTab("crafting", node.recipe!.res.n, "printing", node.recipe!.id)}><Hammer size={14} /> Ingredient recipe</button>
      <details className="print-stage-tiers"><summary>Ingredient HQ cost comparison</summary><div className="print-table-wrap"><table><thead><tr><th>Tier / skill surplus</th><th>HQ chance</th><th>Usable / attempt</th><th>Cost / usable unit</th></tr></thead><tbody>{tiers.map((tier) => <tr key={tier.tier} className={node.tier === tier.tier ? "print-current-tier" : ""}><td>{tier.tier} / +{HQ_GAPS[tier.tier]}</td><td>{pct(tier.hq)}</td><td>{units(tier.yield)}</td><td>{gil(tier.price)}</td></tr>)}</tbody></table></div><p className="print-muted">Only this ingredient stage changes tier; its own ingredient costs stay fixed. Every required craft must reach the listed surplus.</p></details>
      </details>
    </div> : manualCost === undefined && <p className="print-muted">{terminalWater ? "Terminal purchased ingredient" : node.issue ? "Unresolved ingredient branch" : choice === "buy" ? "Explicit Buy / gathered: breakdown stopped" : "No synthesis recipe in current era / key-item filters"} / {node.price === null ? "price needed" : "lowest available buy price"}.</p>}
    </div>
  </details>;
}

export default function PrintingTab() {
  const views = ["calculator", "desynthesis", "prices"] as const;
  const [view, setView] = useState<typeof views[number]>(() => peekNavQuery("printing") ? "calculator" : loadJson("kupo.profits.view.v1", "calculator"));
  const [settings, setSettings] = useState(() => restorePrintSettings(loadJson<Partial<PrintSettings>>("kupo.profits.settings.v1",
    peekRestoredTabState<State>("printing")?.settings ?? loadJson<Partial<State>>("kupo.printing.v1", {}).settings ?? {})));
  const [priceUnit, setPriceUnit] = useState<ProfitPriceUnit>(() => loadJson("kupo.profits.price-unit.v1", "each"));
  const setting = (patch: PrintSettingsUpdate) => setSettings((previous) => ({ ...previous, ...(typeof patch === "function" ? patch(previous) : patch) }));
  useEffect(() => saveJson("kupo.profits.view.v1", view), [view]);
  useEffect(() => saveJson("kupo.profits.settings.v1", settings), [settings]);
  useEffect(() => saveJson("kupo.profits.price-unit.v1", priceUnit), [priceUnit]);
  return <section className="printing-tab">
    <header className="print-heading"><h2><Coins size={23} /> Profits</h2><span className="print-muted">NPC / AH sales</span>{hasBackTab() && <button className="print-command" onClick={goBackTab}><ArrowLeft size={16} /> Back</button>}</header>
    <CollapsibleSection kind="tabs">
    <div className="profits-tabs" role="tablist" aria-label="Profits views">{views.map((tab, index) => <button key={tab} id={`profits-tab-${tab}`} role="tab" aria-selected={view === tab} aria-controls={`profits-panel-${tab}`} tabIndex={view === tab ? 0 : -1} onClick={() => setView(tab)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = views[event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + views.length) % views.length];
      setView(next);
      document.getElementById(`profits-tab-${next}`)?.focus();
    }}>{tab === "prices" ? <Tags size={16} /> : <Hammer size={16} />}{tab === "calculator" ? "Crafting" : tab === "desynthesis" ? "Desynthesis" : "Prices"}</button>)}</div>
    </CollapsibleSection>
    {view === "calculator" && <div className="print-price-unit"><PriceUnitSelector value={priceUnit} onChange={setPriceUnit} /></div>}
    <div id={`profits-panel-${view}`} role="tabpanel" aria-labelledby={`profits-tab-${view}`}>
      {view === "calculator" ? <PrintingCalculator settings={settings} onSettingsChange={setting} priceUnit={priceUnit} /> : view === "desynthesis" ? <DesynthesisView settings={settings} onSettingsChange={setting} /> : <Suspense fallback={<p className="print-muted">Loading prices...</p>}><PricesTab /></Suspense>}
    </div>
  </section>;
}

function PrintingCalculator({ settings, onSettingsChange: setting, priceUnit }: { settings: PrintSettings; onSettingsChange: (patch: PrintSettingsUpdate) => void; priceUnit: ProfitPriceUnit }) {
  const [uiState, setState] = useState<State>(() => {
    const saved = peekRestoredTabState<State>("printing") ?? loadJson<Partial<State>>("kupo.printing.v1", {});
    return { ...initial, ...saved, settings: restorePrintSettings(saved.settings), query: peekNavQuery("printing") ?? saved.query ?? "" };
  });
  const prices = useItemPrices(uiState.vendors, uiState.modernGuilds);
  const state = { ...uiState, settings, buy: prices.effectiveBuy, sell: prices.effectiveSell };
  const [limit, setLimit] = useState(80);
  useEffect(() => { const saved = { ...uiState, settings }; saveJson("kupo.printing.v1", saved); rememberTabState("printing", saved); }, [uiState, settings]);
  const update = (patch: Partial<State>) => setState((previous) => ({ ...previous, ...patch }));
  const priceChange = (kind: "buy" | "sell", name: string, value: number | null) => {
    setState((previous) => ({ ...previous, selected: selected?.recipe.id ?? previous.selected }));
    itemPrices.setPrice(kind, name, value);
  };
  const query = normalizeItemName(useDeferredValue(state.query));
  const { available, chain } = getPrintingPlan(state);
  const matches = useMemo(() => available.filter((recipe) => (settings.skillMode !== "at-cap" || reachablePrintTiers(recipe).length > 0) && (!state.craft || state.craft === recipe.craft) &&
    (!query || normalizeItemName([recipe.res.n, ...recipe.hq.map((item) => item.n), ...recipe.ing.map((item) => item.n)].join(" ")).includes(query))), [available, state.craft, query, settings.skillMode]);
  const candidates = useMemo(() => matches.map((recipe) => ({ recipe, estimate: settings.skillMode === "at-cap" ? selectPrintTier(printTierComparisons(chain, recipe), state.tiers[recipe.id])! : chain.estimate(recipe) })), [matches, chain, state.tiers, settings.skillMode]);
  const ranked = useMemo(() => candidates.filter(({ estimate }) => state.filter === "all" || (estimate.eligible && estimate.success > 0 &&
    (state.filter === "eligible" || (state.filter === "profitable" ? estimate.profit !== null && estimate.profit > 0 : estimate.profit === null))))
    .sort((first, second) => Number(second.estimate.eligible && second.estimate.success > 0) - Number(first.estimate.eligible && first.estimate.success > 0) ||
    Number(second.estimate.profit !== null) - Number(first.estimate.profit !== null) || ((state.sort === "hour" ? second.estimate.gilPerHour : second.estimate.profit) ?? -Infinity) - ((state.sort === "hour" ? first.estimate.gilPerHour : first.estimate.profit) ?? -Infinity) ||
    (second.estimate.revenue ?? 0) - (first.estimate.revenue ?? 0) || first.recipe.res.n.localeCompare(second.recipe.res.n) || first.recipe.id - second.recipe.id), [candidates, state.filter, state.sort]);
  const selected = candidates.find(({ recipe }) => recipe.id === state.selected) ?? ranked[0] ?? candidates[0];
  const sourceChange = (name: string, choice: SourceChoice) => setState((previous) => ({ ...previous, sources: { ...previous.sources, [printItemKey(name)]: choice }, selected: selected?.recipe.id ?? previous.selected }));
  const costChange = (name: string, value: number | null) => setState((previous) => {
    const costOverrides = { ...previous.costOverrides };
    if (value === null) delete costOverrides[printItemKey(name)]; else costOverrides[printItemKey(name)] = value;
    return { ...previous, costOverrides, selected: selected?.recipe.id ?? previous.selected };
  });
  const profitable = candidates.filter(({ estimate }) => estimate.eligible && estimate.success > 0 && estimate.profit !== null && estimate.profit > 0);
  const missing = candidates.filter(({ estimate }) => estimate.eligible && estimate.success > 0 && estimate.profit === null);
  const recipe = selected?.recipe;
  const estimate = selected?.estimate;
  const comparisons = recipe ? printTierComparisons(chain, recipe) : [];
  const best = selectPrintTier(comparisons);
  const manualTier = recipe && comparisons.some((comparison) => comparison.tier === state.tiers[recipe.id]) ? state.tiers[recipe.id] : undefined;
  const selectTier = (tier: number | undefined) => {
    if (!recipe) return;
    setState((previous) => {
      const tiers = { ...previous.tiers };
      if (tier === undefined) delete tiers[recipe.id]; else tiers[recipe.id] = tier;
      return { ...previous, tiers, selected: recipe.id };
    });
  };
  const image = recipe ? wiki.items[printItemKey(recipe.res.n)]?.image : undefined;

  return <div className="print-calculator">
    {prices.error && <p role="alert" className="print-warning">{prices.error}</p>}
    <CollapsibleSection kind="search">
    <details className="print-settings"><summary>Economy &amp; crafting assumptions</summary>
      <div className="print-options">
        <NumberField label="Seconds per synth" value={settings.seconds} min={20} max={22} step={0.1} onChange={(seconds) => setting({ seconds })} />
        <NumberField label="Extra seconds per attempt" value={settings.overhead} max={3600} onChange={(overhead) => setting({ overhead })} />
        <BreakLossSettings settings={settings} onChange={setting} />
        <NumberField label="Sell-value multiplier (%)" value={settings.sellMultiplier} max={1000} step={0.1} onChange={(sellMultiplier) => setting({ sellMultiplier })} />
        <NumberField label="Success bonus (percentage points)" value={settings.successBonus} min={-95} max={99} step={0.1} onChange={(successBonus) => setting({ successBonus })} />
        {HQ_GAPS.map((gap, index) => <NumberField key={gap} label={`Tier ${index} HQ chance (%)`} value={settings.hqRates[index]} max={80} step={0.01} onChange={(value) => setting((current) => ({ hqRates: current.hqRates.map((rate, rateIndex) => rateIndex === index ? value : rate) }))} />)}
      </div>
      <div className="print-checks">
        <label><input type="checkbox" checked={state.vendors} onChange={(event) => update({ vendors: event.target.checked })} /> Recorded NPC buy prices</label>
        <label><input type="checkbox" checked={state.modernGuilds} onChange={(event) => update({ modernGuilds: event.target.checked })} /> Modern guild-rank stock</label>
        <label><input type="checkbox" checked={state.keyItems} onChange={(event) => update({ keyItems: event.target.checked })} /> Include key-item recipes (ownership unverified)</label>
        <label><input type="checkbox" checked={state.wotg} onChange={(event) => update({ wotg: event.target.checked })} /> Include WotG recipes</label>
      </div>
      <p className="print-muted">LSB tier model, not verified live-server rates. Success is rolled per required craft; the lowest effective skill surplus limits HQ. HQ upgrades: tier 0 = HQ1 only; tier 1 = 75/25/0%; tiers 2-3 = 75/18.75/6.25% of HQs. No automatic day, moon, food, or gear modifiers.</p>
      <p className="print-muted">Skill-based material loss is 50% at cap and rises with the difficulty of the craft roll that fails. Custom loss percentages override that model; no-loss recipes retain their materials. Crystals are always consumed. NPC sale defaults are bundled BaseSell values, not actual server quotes; NoSale items default to zero proceeds. Sell multiplier applies to all sale values, including overrides. Confirm NPC acceptance in game.</p>
    </details>
    <div className="print-summary"><span>{settings.skillMode === "at-cap" ? "Hypothetical HQ planning" : "Using your main and subcraft levels"}</span><span><strong className="print-profit">{profitable.length}</strong> profitable recipes</span><span><strong>{missing.length}</strong> need prices</span></div>
    <div className="print-filters"><label><span><Search size={15} /> Search recipes</span><input placeholder="Output or ingredient" value={state.query} onChange={(event) => { update({ query: event.target.value, selected: null }); setLimit(80); }} /></label><label>Craft<select value={state.craft} onChange={(event) => update({ craft: event.target.value, selected: null })}><option value="">All crafts</option>{PRINT_CRAFTS.map((craft) => <option key={craft}>{craft}</option>)}</select></label><label>View<select value={state.filter} onChange={(event) => update({ filter: event.target.value, selected: null })}><option value="eligible">Available recipes</option><option value="profitable">Profitable only</option><option value="missing">Needs prices</option><option value="all">All recipes</option></select></label><label>Rank by<select value={state.sort} onChange={(event) => update({ sort: event.target.value as State["sort"] })}><option value="hour">Whole-chain gil/hour</option><option value="profit">Profit / final attempt</option></select></label></div>
    </CollapsibleSection>
    <div className="print-workspace"><aside className="print-browser" aria-label="Ranked recipes"><div className="print-list-title">{ranked.length} recipes / {state.sort === "hour" ? "whole-chain gil/hour" : "gil per final attempt"}</div><div className="print-recipe-list">{ranked.slice(0, limit).map(({ recipe, estimate }, index) => <button type="button" key={recipe.id} aria-pressed={selected?.recipe.id === recipe.id} onClick={() => update({ selected: recipe.id })}><span className="print-recipe-title"><strong>{recipe.res.n}</strong><span className={tone(estimate.profit)}>{gil(state.sort === "hour" ? estimate.gilPerHour : estimate.profit)}</span></span><span className="print-muted">{index + 1}. {recipe.craft} {recipe.lvl}{recipe.subs?.map((sub) => ` / ${sub.c} ${sub.l}`).join("")}</span><span className="print-muted">{!estimate.eligible || estimate.success <= 0 ? "Recipe or ingredient chain unavailable" : `Final HQ tier ${estimate.tier} / ${pct(estimate.hq)}`}{estimate.profit !== null && ` / ${gil(estimate.profit)} gil per final attempt`}{recipe.ki && " / Key item"}</span></button>)}</div>{ranked.length > limit && <button className="print-command" onClick={() => setLimit(limit + 80)}>Show more recipes</button>}{!ranked.length && <p className="print-muted">No recipes match these filters.</p>}</aside>
      {recipe && estimate ? <article className="print-detail" key={recipe.id}>
        <header className="print-detail-title">{image && <img src={`${import.meta.env.BASE_URL}${image.replace(/^\//, "")}`} alt={recipe.res.n} width="40" height="40" />}<div><h2>{recipe.res.n}</h2><span className="print-muted">{recipe.craft} {recipe.lvl} / {recipe.era || "Base"}{recipe.ki ? " / Key item required" : ""}</span></div><button className="print-command" onClick={() => navigateToTab("crafting", recipe.res.n, "printing", recipe.id)}><Hammer size={15} /> Recipe</button></header>
        {(!estimate.eligible || estimate.success <= 0) && <p className="print-warning">Final recipe or ingredient chain unavailable under current assumptions and source choices. {estimate.issues.join(". ")} Values below are theoretical.</p>}
        <ProfitMetrics cost={estimate.cost} profit={estimate.profit} gilPerHour={estimate.gilPerHour} available={estimate.eligible && estimate.success > 0} />
        <p className="print-metric-note">Expected averages, not guaranteed returns. 100 synths means 100 attempts at <strong>{recipe.res.n}</strong>; ingredient crafting time is included in gil/hour.</p>
        <div className="print-result-strip"><span>Sale revenue / synth: <strong>{gil(estimate.revenue)} gil</strong></span><span>Success: <strong>{pct(estimate.success)}</strong></span><span>HQ on success: <strong>{pct(estimate.hq)}</strong></span><span>Time / final synth: <strong>{gil(estimate.seconds)}s</strong></span></div>
        <CraftingLevels settings={settings} onChange={(patch) => { update({ selected: recipe.id }); setting(patch); }} />
        <div className="print-requirements">{estimate.requirements.map((requirement) => <span key={requirement.craft} className={requirement.gap < 0 ? "print-warning" : "print-muted"}>{requirement.craft}: {requirement.effective} / cap {requirement.cap} ({requirement.gap >= 0 ? "+" : ""}{requirement.gap})</span>)}</div>
        <section className="print-section"><h3>Ingredients &amp; crafting tree</h3>
          <p className="print-muted">Open an item to see its ingredients, choose a recipe, or adjust its cost. Each cost shows both the per-item and per-stack amount; reset to restore the calculated cost.</p>
          <details className="print-production" open><summary className="print-root-summary"><strong>Make {recipe.res.q} x {recipe.res.n}</strong><span>NQ output / one final synth</span></summary><div className="print-ingredient-children" role="group" aria-label={`Ingredients to make ${recipe.res.n}`}>{estimate.sources.map((source, index) => <IngredientSource key={`${source.node.key}:${index}`} node={source.node} demand={source.quantity} parentQuantity={estimate.inputs[index].quantity} branchColor={(index % 9) + 1} state={state} prices={prices} priceUnit={priceUnit} chain={chain} onSource={sourceChange} onCost={costChange} onPrice={(name, value) => priceChange("buy", name, value)} />)}</div></details>
        </section>
        <details className="print-section"><summary>Combined shopping list &amp; whole-chain ceilings</summary><div className="print-table-wrap"><table className="print-raw-inputs"><thead><tr><th>Input to obtain</th><th>Expected qty / final attempt</th><th>Applied gil each</th><th>Max gil each</th></tr></thead><tbody>{estimate.rawCeilings.map((input) => <tr key={input.key}><td><ItemButton name={input.name} /></td><td>{units(input.quantity)}</td><td>{gil(input.price)}{state.costOverrides[input.key] !== undefined && <small>Manual cost</small>}</td><td className={input.maximum !== null && input.maximum < 0 ? "print-loss" : ""}>{gil(input.maximum)}</td></tr>)}</tbody></table></div><p className="print-muted">Edit costs in the tree above. Break-even prices hold all other costs and recipe choices fixed. Shared materials and crystals are combined across every stage; manually priced items replace their ingredients. Unknown prices are not zero; negative ceilings cannot break even with that input free.</p></details>
        <details className="print-section"><summary>Final-ingredient break-even costs</summary><div className="print-table-wrap"><table><thead><tr><th>Final ingredient</th><th>Recipe qty</th><th>Effective cost each</th><th>Max cost each</th></tr></thead><tbody>{estimate.ceilings.map((input) => <tr key={input.name}><td><ItemButton name={input.name} /></td><td>{input.quantity}</td><td>{gil(input.price)}</td><td>{gil(input.maximum)}</td></tr>)}</tbody></table></div></details>
        <section className="print-section"><h3>Output sale prices</h3><div className="print-table-wrap"><table><thead><tr><th>Roll</th><th>Output</th><th>Qty</th><th>Chance / attempt</th><th>Sell price</th></tr></thead><tbody>{estimate.outcomes.map((outcome, index) => <tr key={index}><td>{index ? `HQ${index}` : "NQ"}</td><td><ItemButton name={outcome.n} /><small>NPC base {gil(printSellPrice(outcome.n, {}))} gil each</small></td><td>{outcome.q}</td><td>{pct(outcome.probability)}</td><td><ProfitDualPriceField name={outcome.n} kind="Sell" value={prices.sell[printItemKey(outcome.n)]} baseline={printSellPrice(outcome.n, prices.effectiveSell)} onChange={(value) => priceChange("sell", outcome.n, value)} /><small>Applied {gil(outcome.price)} gil each</small></td></tr>)}</tbody></table></div><p className="print-muted">Sale quotes apply across recipes and HQ rows. Stack prices use each item's recorded stack size, not its synthesis output quantity. AH fees, unsold listings and time to sell are not included.</p></section>
        {settings.skillMode === "at-cap" && <details className="print-section print-hq-comparison"><summary><TrendingUp size={16} /> Hypothetical final recipe HQ comparison</summary>
          <label className="print-tier-choice print-tier-auto"><input type="radio" name={`final-tier-${recipe.id}`} checked={manualTier === undefined} onChange={() => selectTier(undefined)} /> Auto: best gil/hour{best?.gilPerHour === null ? " (prices needed)" : best ? ` / tier ${best.tier}` : ""}</label>
          <div className="print-table-wrap"><table><thead><tr><th>Tier</th><th>Required effective skills</th><th>HQ</th><th>Profit / final attempt</th><th>Chain gil / hour</th></tr></thead><tbody>{comparisons.map((comparison) => <tr key={comparison.tier} className={`print-tier-row${estimate.tier === comparison.tier ? " print-current-tier" : ""}`} onClick={() => selectTier(comparison.tier)}><td><label className="print-tier-choice"><input type="radio" name={`final-tier-${recipe.id}`} aria-label={`Use HQ tier ${comparison.tier}`} checked={manualTier === comparison.tier} onChange={() => selectTier(comparison.tier)} />{comparison.tier} (+{HQ_GAPS[comparison.tier]})</label></td><td>{comparison.requirements.map((requirement) => `${requirement.craft} ${requirement.cap + HQ_GAPS[comparison.tier]}`).join(", ")}</td><td>{pct(comparison.hq)}</td><td className={tone(comparison.profit)}>{gil(comparison.profit)}</td><td className={tone(comparison.gilPerHour)}>{gil(comparison.gilPerHour)}</td></tr>)}</tbody></table></div><p className="print-muted">Effective skill limit: {PRINT_SKILL_CAP} in every required craft. Only the final recipe changes tier; ingredient stages stay at the at-cap, HQ tier 0 baseline. Equal or unknown returns default to the lowest required tier.</p>
        </details>}
        <section className="print-section print-batch"><NumberField label="Final batch attempts" value={state.batch} min={1} max={100000} onChange={(batch) => update({ batch })} /><span>Expected profit <strong className={tone(estimate.profit)}>{gil(estimate.profit === null ? null : estimate.profit * state.batch)}</strong> gil</span><span>{gil(state.batch * estimate.seconds / 60)} minutes / {gil(state.batch * estimate.totalAttempts)} total synths</span></section>
      </article> : <div><CraftingLevels settings={settings} onChange={setting} /><div className="print-empty"><Coins size={30} /><p>Choose a recipe or change your search filters.</p></div></div>}
    </div>
  </div>;
}