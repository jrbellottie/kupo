import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Coins, Hammer, Search, Tags, TrendingUp } from "lucide-react";
import { DEFAULT_PRINT_SETTINGS, HQ_GAPS, PRINT_CRAFTS, printingChances, restorePrintSettings, type PrintSettings } from "./utils/printing";
import { createPrintingChain, chainTierCosts, chainBatchAllocation, MAX_CHAIN_DEPTH, type ChainNode, type SourceChoice, type SourceChoices } from "./utils/printingChain";
import { createPrintingPlanner } from "./utils/printingPlanner";
import { PRINT_SKILL_CAP, reachablePrintTiers, printTierComparisons, selectPrintTier } from "./utils/printingTiers";
import { PRINT_RECIPES, printItemKey, printBuyPrice, printSellPrice, printOffers, type PriceBook } from "./utils/printingData";
import { normalizeItemName, findableName } from "./utils/itemLinks";
import { loadJson, saveJson } from "./utils/storage";
import { itemPrices, useItemPrices } from "./utils/itemPrices";
import type { PriceSnapshot } from "./utils/itemPriceStore";
import PriceInput from "./PriceInput";
import { navigateToTab, rememberTabState, peekRestoredTabState, peekNavQuery, goBackTab, hasBackTab } from "./utils/tabNav";
import NpcLink from "./NpcLink";
import wikiData from "./data/itemWiki.json";
import "./PrintingTab.css";
import { CollapsibleSection } from "./ScreenControls";
import "./PricesTab.css";

const PricesTab = lazy(() => import("./PricesTab"));

type State = { settings: PrintSettings; buy: PriceBook; sell: PriceBook; sources: SourceChoices; tiers: Record<number, number>; sort: "hour" | "profit"; vendors: boolean; modernGuilds: boolean; query: string; craft: string; filter: string; wotg: boolean; keyItems: boolean; selected: number | null; batch: number };
const initial: State = { settings: DEFAULT_PRINT_SETTINGS, buy: {}, sell: {}, sources: {}, tiers: {}, sort: "hour", vendors: true, modernGuilds: false, query: "", craft: "", filter: "eligible", wotg: false, keyItems: false, selected: null, batch: 100 };
const wiki = wikiData as unknown as { items: Record<string, { image?: string }> };
const gil = (amount: number | null) => amount === null ? "Needs price" : amount.toLocaleString(undefined, { maximumFractionDigits: 1 });
const units = (amount: number) => amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
const pct = (amount: number) => `${(amount * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
const tone = (amount: number | null) => amount === null ? "print-muted" : amount > 0 ? "print-profit" : amount < 0 ? "print-loss" : "";
const getPrintingPlan = createPrintingPlanner(PRINT_RECIPES, printItemKey, printBuyPrice, printSellPrice);

function NumberField({ label, value, onChange, min = 0, max = 1000000000, step = 1 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return <label>{label}<input type="number" aria-label={label} min={min} max={max} step={step} value={value} onChange={(event) => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next))); }} /></label>;
}

function PriceField({ name, book, baseline, onChange, kind }: { name: string; book: PriceBook; baseline: number | null; onChange: (name: string, value: number | null) => void; kind: "Buy" | "Sell" }) {
  return <PriceInput label={`${kind} ${name} gil each`} value={book[printItemKey(name)]} baseline={baseline} onChange={(value) => onChange(name, value)} resetLabel={`Reset ${kind.toLowerCase()} price for ${name}`} />;
}

function ItemButton({ name }: { name: string }) {
  return <button type="button" className="print-link" onClick={() => navigateToTab("drops", findableName(name) ?? name, "printing")}>{name}</button>;
}

type SourceProps = { node: ChainNode; demand: number | null; parentQuantity: number; state: State; prices: PriceSnapshot; chain: ReturnType<typeof createPrintingChain>; onSource: (name: string, choice: SourceChoice) => void; onPrice: (name: string, value: number | null) => void };

function IngredientSource({ node, demand, parentQuantity, state, prices, chain, onSource, onPrice }: SourceProps) {
  const recipes = chain.options(node.name);
  const terminalWater = node.key === printItemKey("Distilled Water");
  const choice = terminalWater ? "buy" : state.sources[node.key] ?? "auto";
  const reachable = node.recipe ? reachablePrintTiers(node.recipe) : [];
  const tiers = chainTierCosts(node, state.settings, printItemKey).filter((tier) => reachable.includes(tier.tier));
  const allocation = chainBatchAllocation(node, parentQuantity, printItemKey);
  const offers = printOffers(node.name).filter((offer) => state.modernGuilds || !offer.guild);
  const sourceControl = <label>Source for {node.name}<select aria-label={`Source for ${node.name}`} disabled={terminalWater} value={choice} onChange={(event) => onSource(node.name, event.target.value === "auto" || event.target.value === "buy" ? event.target.value : Number(event.target.value))}>
    <option value="auto">Auto: craft every craftable ingredient</option><option value="buy">Buy / gathered (stop breakdown)</option>
    {typeof choice === "number" && !recipes.some((recipe) => recipe.id === choice) && <option value={choice}>Recipe #{choice} unavailable in current filters</option>}
    {recipes.map((recipe) => { const chances = printingChances(recipe, state.settings); const output = chain.expectedYield(recipe, node.name); return <option key={recipe.id} value={recipe.id}>{recipe.craft} {recipe.lvl} / #{recipe.id} / {recipe.ing.map((item) => `${item.n} x${item.q}`).join(", ")}{!chances.eligible || chances.success <= 0 || output <= 0 ? " / Yield unavailable" : ` / ${units(output)} usable per synth`}</option>; })}
  </select></label>;
  return <div className={`print-ingredient${node.recipe ? " print-crafted-ingredient" : ""}`} data-item={node.name}>
    <div className="print-ingredient-heading"><h3><ItemButton name={node.name} /></h3><span className="print-muted">{demand === null ? "Quantity unavailable" : `${units(demand)} needed / final attempt`}</span><strong>{gil(node.price)} gil each</strong></div>
    <details className="print-sourcing"><summary>Sourcing &amp; NPC offers <span className="print-muted">/ {terminalWater || choice === "buy" ? "Buy" : choice === "auto" ? "Auto-craft" : `Recipe #${choice}`}{offers.length > 0 ? ` / ${offers.length} offers` : ""}</span></summary>
      <div className="print-source-controls">{sourceControl}<label>Buy quote / gil each<PriceField name={node.name} kind="Buy" book={prices.buy} baseline={printBuyPrice(node.name, prices.effectiveBuy, state.vendors, state.modernGuilds)} onChange={onPrice} /></label></div>
      {offers.length > 0 ? offers.map((offer, index) => <div className="print-sources" key={index}><span>{gil(offer.price)} gil / {offer.npc ? <NpcLink name={offer.npc} zone={offer.zone} from="printing" /> : `${offer.guild} guild / ${offer.rank}`}{offer.zone && ` / ${offer.zone}`}</span></div>) : <p className="print-muted">No recorded NPC offers.</p>}
    </details>
    {node.issue && <p className="print-warning">{node.issue}</p>}
    {node.recipe ? <details className="print-stage" open>
      <summary><span className="print-stage-name">Craft {node.name}</span><span className="print-stage-meta">{node.recipe.craft} {node.recipe.lvl} / #{node.recipe.id}</span></summary>
      <p className="print-stage-yield"><strong>{units(node.yield)} usable output / attempt</strong> / {pct(node.success)} success / {pct(node.hq)} HQ / tier {node.tier < 0 ? "below cap" : node.tier}</p>
      <p className="print-muted">{printingChances(node.recipe, state.settings).requirements.map((requirement) => `${requirement.craft}: ${requirement.effective} / cap ${requirement.cap} (${requirement.gap >= 0 ? "+" : ""}${requirement.gap})`).join("; ")}</p>
      <p className="print-muted">NQ / HQ1 / HQ2 / HQ3: {[node.recipe.res, ...Array.from({ length: 3 }, (_, index) => node.recipe!.hq[index] ?? node.recipe!.res)].map((outcome) => printItemKey(outcome.n) === node.key ? `x${outcome.q}` : `${outcome.n} (not usable)`).join(" / ")}. {node.yield > 0 && demand !== null ? `${units(demand / node.yield)} stage attempts per final attempt` : "No usable output under current assumptions"}.</p>
      <p className="print-batch-inputs">Per synthesis: {node.recipe.ing.map((input) => `${input.q} x ${input.n}`).join(" + ")} + 1 x {node.recipe.crystal} Crystal.</p>
      {allocation && <details className="print-stage-allocation" open><summary>NQ batch: {allocation.output} produced / {allocation.parentQuantity} used by parent recipe</summary><div className="print-table-wrap"><table><thead><tr><th>Input</th><th>Per batch</th><th>Parent's share</th><th>Allocated gil</th></tr></thead><tbody>{allocation.inputs.map((input, index) => <tr key={index}><td>{input.name}</td><td>{input.quantity}</td><td>{units(input.allocatedQuantity)}</td><td>{gil(input.allocatedCost)}</td></tr>)}</tbody></table></div><p className="print-muted">{allocation.parentQuantity} / {allocation.output} of this NQ batch is allocated to one parent synthesis. Before this stage's HQ and break adjustments; expected profit above includes both. Input unit costs include any earlier crafting stages.</p></details>}
      <button className="print-command" onClick={() => navigateToTab("crafting", node.recipe!.res.n, "printing", node.recipe!.id)}><Hammer size={14} /> Ingredient recipe</button>
      <details className="print-stage-tiers"><summary>Ingredient HQ cost comparison</summary><div className="print-table-wrap"><table><thead><tr><th>Tier / skill surplus</th><th>HQ chance</th><th>Usable / attempt</th><th>Cost / usable unit</th></tr></thead><tbody>{tiers.map((tier) => <tr key={tier.tier} className={node.tier === tier.tier ? "print-current-tier" : ""}><td>{tier.tier} / +{HQ_GAPS[tier.tier]}</td><td>{pct(tier.hq)}</td><td>{units(tier.yield)}</td><td>{gil(tier.price)}</td></tr>)}</tbody></table></div><p className="print-muted">Only this ingredient stage changes tier; its own ingredient costs stay fixed. Every required craft must reach the listed surplus.</p></details>
      <div className="print-ingredient-children">{node.children.map((child, index) => <IngredientSource key={`${child.node.key}:${index}`} {...{ state, prices, chain, onSource, onPrice }} node={child.node} parentQuantity={child.recipeQuantity} demand={demand !== null && node.yield > 0 ? demand * child.quantity / node.yield : null} />)}</div>
    </details> : <p className="print-muted">{terminalWater ? "Terminal purchased ingredient" : node.issue ? "Unresolved ingredient branch" : choice === "buy" ? "Explicit Buy / gathered: breakdown stopped" : "No synthesis recipe in current era / key-item filters"} / {node.price === null ? "price needed" : "lowest available buy price"}.</p>}
  </div>;
}

export default function PrintingTab() {
  const [view, setView] = useState<"calculator" | "prices">(() => peekNavQuery("printing") ? "calculator" : loadJson("kupo.profits.view.v1", "calculator"));
  useEffect(() => saveJson("kupo.profits.view.v1", view), [view]);
  return <section className="printing-tab">
    <header className="print-heading"><h2><Coins size={23} /> Profits</h2><span className="print-muted">NPC / AH sales</span>{hasBackTab() && <button className="print-command" onClick={goBackTab}><ArrowLeft size={16} /> Back</button>}</header>
    <CollapsibleSection kind="tabs">
    <div className="profits-tabs" role="tablist" aria-label="Profits views">{(["calculator", "prices"] as const).map((tab) => <button key={tab} id={`profits-tab-${tab}`} role="tab" aria-selected={view === tab} aria-controls={`profits-panel-${tab}`} tabIndex={view === tab ? 0 : -1} onClick={() => setView(tab)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "calculator" : event.key === "End" ? "prices" : tab === "prices" ? "calculator" : "prices";
      setView(next);
      document.getElementById(`profits-tab-${next}`)?.focus();
    }}>{tab === "calculator" ? <Hammer size={16} /> : <Tags size={16} />}{tab === "calculator" ? "Calculator" : "Prices"}</button>)}</div>
    </CollapsibleSection>
    <div id={`profits-panel-${view}`} role="tabpanel" aria-labelledby={`profits-tab-${view}`}>
      {view === "calculator" ? <PrintingCalculator /> : <Suspense fallback={<p className="print-muted">Loading prices...</p>}><PricesTab /></Suspense>}
    </div>
  </section>;
}

function PrintingCalculator() {
  const [uiState, setState] = useState<State>(() => {
    const saved = peekRestoredTabState<State>("printing") ?? loadJson<Partial<State>>("kupo.printing.v1", {});
    return { ...initial, ...saved, settings: restorePrintSettings(saved.settings), query: peekNavQuery("printing") ?? saved.query ?? "" };
  });
  const prices = useItemPrices(uiState.vendors, uiState.modernGuilds);
  const state = { ...uiState, buy: prices.effectiveBuy, sell: prices.effectiveSell };
  const [limit, setLimit] = useState(80);
  useEffect(() => { saveJson("kupo.printing.v1", uiState); rememberTabState("printing", uiState); }, [uiState]);
  const update = (patch: Partial<State>) => setState((previous) => ({ ...previous, ...patch }));
  const setting = (patch: Partial<PrintSettings>) => setState((previous) => ({ ...previous, settings: { ...previous.settings, ...patch } }));
  const priceChange = (kind: "buy" | "sell", name: string, value: number | null) => {
    setState((previous) => ({ ...previous, selected: selected?.recipe.id ?? previous.selected }));
    itemPrices.setPrice(kind, name, value);
  };
  const query = normalizeItemName(useDeferredValue(state.query));
  const { available, chain } = getPrintingPlan(state);
  const matches = useMemo(() => available.filter((recipe) => reachablePrintTiers(recipe).length > 0 && (!state.craft || state.craft === recipe.craft) &&
    (!query || normalizeItemName([recipe.res.n, ...recipe.hq.map((item) => item.n), ...recipe.ing.map((item) => item.n)].join(" ")).includes(query))), [available, state.craft, query]);
  const candidates = useMemo(() => matches.map((recipe) => ({ recipe, estimate: selectPrintTier(printTierComparisons(chain, recipe), state.tiers[recipe.id])! })), [matches, chain, state.tiers]);
  const ranked = useMemo(() => candidates.filter(({ estimate }) => state.filter === "all" || (estimate.eligible && estimate.success > 0 &&
    (state.filter === "eligible" || (state.filter === "profitable" ? estimate.profit !== null && estimate.profit > 0 : estimate.profit === null))))
    .sort((first, second) => Number(second.estimate.eligible && second.estimate.success > 0) - Number(first.estimate.eligible && first.estimate.success > 0) ||
    Number(second.estimate.profit !== null) - Number(first.estimate.profit !== null) || ((state.sort === "hour" ? second.estimate.gilPerHour : second.estimate.profit) ?? -Infinity) - ((state.sort === "hour" ? first.estimate.gilPerHour : first.estimate.profit) ?? -Infinity) ||
    (second.estimate.revenue ?? 0) - (first.estimate.revenue ?? 0) || first.recipe.res.n.localeCompare(second.recipe.res.n) || first.recipe.id - second.recipe.id), [candidates, state.filter, state.sort]);
  const selected = candidates.find(({ recipe }) => recipe.id === state.selected) ?? ranked[0];
  const sourceChange = (name: string, choice: SourceChoice) => setState((previous) => ({ ...previous, sources: { ...previous.sources, [printItemKey(name)]: choice }, selected: selected?.recipe.id ?? previous.selected }));
  const profitable = candidates.filter(({ estimate }) => estimate.eligible && estimate.success > 0 && estimate.profit !== null && estimate.profit > 0);
  const missing = candidates.filter(({ estimate }) => estimate.eligible && estimate.success > 0 && estimate.profit === null);
  const settings = state.settings;
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
        <NumberField label="Material loss on break (%)" value={settings.lossPct} max={100} onChange={(lossPct) => setting({ lossPct })} />
        <NumberField label="Sell-value multiplier (%)" value={settings.sellMultiplier} max={1000} step={0.1} onChange={(sellMultiplier) => setting({ sellMultiplier })} />
        <NumberField label="Success bonus (percentage points)" value={settings.successBonus} min={-95} max={99} step={0.1} onChange={(successBonus) => setting({ successBonus })} />
        {HQ_GAPS.map((gap, index) => <NumberField key={gap} label={`Tier ${index} HQ chance (%)`} value={settings.hqRates[index]} max={80} step={0.01} onChange={(value) => setting({ hqRates: settings.hqRates.map((rate, rateIndex) => rateIndex === index ? value : rate) })} />)}
      </div>
      <div className="print-checks">
        <label><input type="checkbox" checked={state.vendors} onChange={(event) => update({ vendors: event.target.checked })} /> Recorded NPC buy prices</label>
        <label><input type="checkbox" checked={state.modernGuilds} onChange={(event) => update({ modernGuilds: event.target.checked })} /> Modern guild-rank stock</label>
        <label><input type="checkbox" checked={state.keyItems} onChange={(event) => update({ keyItems: event.target.checked })} /> Include key-item recipes (ownership unverified)</label>
        <label><input type="checkbox" checked={state.wotg} onChange={(event) => update({ wotg: event.target.checked })} /> Include WotG recipes</label>
      </div>
      <p className="print-muted">LSB tier model, not verified live-server rates. Success is rolled per required craft; the lowest effective skill surplus limits HQ. HQ upgrades: tier 0 = HQ1 only; tier 1 = 75/25/0%; tiers 2-3 = 75/18.75/6.25% of HQs. No automatic day, moon, food, or gear modifiers.</p>
      <p className="print-muted">Material loss on break defaults to 50%, matching checked LSB behavior at cap without loss-reduction bonuses. This is ingredient loss conditional on a failed synth, not the chance of failure. Crystals are always consumed. NPC sale defaults are bundled BaseSell values, not actual server quotes; NoSale items default to zero proceeds. Fame, nerfs, stock, conquest and guild restrictions can change prices. Sell multiplier applies to all sale values, including overrides. Confirm NPC acceptance in game.</p>
    </details>
    <div className="print-summary"><span>Final HQ: best gil/hour or selected tier / skill cap {PRINT_SKILL_CAP}</span><span><strong className="print-profit">{profitable.length}</strong> profitable with ingredient sourcing</span><span><strong>{missing.length}</strong> available, prices needed</span><span><strong>{gil(3600 / (settings.seconds + settings.overhead))}</strong> total synths/hour</span></div>
    <div className="print-filters"><label><span><Search size={15} /> Search recipes</span><input placeholder="Output or ingredient" value={state.query} onChange={(event) => { update({ query: event.target.value, selected: null }); setLimit(80); }} /></label><label>Craft<select value={state.craft} onChange={(event) => update({ craft: event.target.value, selected: null })}><option value="">All crafts</option>{PRINT_CRAFTS.map((craft) => <option key={craft}>{craft}</option>)}</select></label><label>View<select value={state.filter} onChange={(event) => update({ filter: event.target.value, selected: null })}><option value="eligible">Available recipes</option><option value="profitable">Profitable only</option><option value="missing">Needs prices</option><option value="all">All recipes</option></select></label><label>Rank by<select value={state.sort} onChange={(event) => update({ sort: event.target.value as State["sort"] })}><option value="hour">Whole-chain gil/hour</option><option value="profit">Profit / final attempt</option></select></label></div>
    </CollapsibleSection>
    <div className="print-workspace"><aside className="print-browser" aria-label="Ranked recipes"><div className="print-list-title">{ranked.length} recipes / {state.sort === "hour" ? "whole-chain gil/hour" : "gil per final attempt"}</div><div className="print-recipe-list">{ranked.slice(0, limit).map(({ recipe, estimate }, index) => <button type="button" key={recipe.id} aria-pressed={selected?.recipe.id === recipe.id} onClick={() => update({ selected: recipe.id })}><span className="print-recipe-title"><strong>{recipe.res.n}</strong><span className={tone(estimate.profit)}>{gil(state.sort === "hour" ? estimate.gilPerHour : estimate.profit)}</span></span><span className="print-muted">{index + 1}. {recipe.craft} {recipe.lvl}{recipe.subs?.map((sub) => ` / ${sub.c} ${sub.l}`).join("")} / #{recipe.id}</span><span className="print-muted">{!estimate.eligible || estimate.success <= 0 ? "Recipe or ingredient chain unavailable" : `Final HQ tier ${estimate.tier} / ${pct(estimate.hq)}`}{estimate.profit !== null && ` / ${gil(estimate.profit)} gil per final attempt`}{recipe.ki && " / Key item"}</span></button>)}</div>{ranked.length > limit && <button className="print-command" onClick={() => setLimit(limit + 80)}>Show more recipes</button>}{!ranked.length && <p className="print-muted">No recipes match these filters.</p>}</aside>
      {recipe && estimate ? <article className="print-detail" key={recipe.id}>
        <header className="print-detail-title">{image && <img src={`${import.meta.env.BASE_URL}${image.replace(/^\//, "")}`} alt={recipe.res.n} width="40" height="40" />}<div><h2>{recipe.res.n}</h2><span className="print-muted">{recipe.craft} {recipe.lvl} / {recipe.era || "Base"} / #{recipe.id}{recipe.ki ? " / Key item required" : ""}</span></div><button className="print-command" onClick={() => navigateToTab("crafting", recipe.res.n, "printing", recipe.id)}><Hammer size={15} /> Recipe</button></header>
        {(!estimate.eligible || estimate.success <= 0) && <p className="print-warning">Final recipe or ingredient chain unavailable under current assumptions and source choices. {estimate.issues.join(". ")} Values below are theoretical.</p>}
        <div className="print-metrics"><div><span>Expected profit / final attempt</span><strong className={tone(estimate.profit)}>{gil(estimate.profit)}{estimate.profit !== null && " gil"}</strong></div><div><span>Whole-chain gil / hour</span><strong className={tone(estimate.gilPerHour)}>{gil(estimate.gilPerHour)}</strong></div><div><span>Expected sale revenue</span><strong>{gil(estimate.revenue)}</strong></div><div><span>Expected raw-input cost</span><strong>{gil(estimate.cost)}</strong></div></div>
        <p className="print-chain-summary">Buying all final ingredients: <strong className={tone(estimate.directProfit)}>{gil(estimate.directProfit)}</strong> gil profit / final attempt. With selected sourcing: <strong className={tone(estimate.profit)}>{gil(estimate.profit)}</strong> gil.</p>
        <p className="print-muted">Final synth: {pct(estimate.success)} success / {pct(estimate.hq)} HQ on success / {estimate.tier < 0 ? "below cap" : `HQ tier ${estimate.tier}`}. Full chain: {gil(estimate.totalAttempts)} synthesis attempts / {gil(estimate.seconds)} seconds per final attempt, including ingredient production{settings.overhead ? ` and ${settings.overhead}s overhead per synth` : "; no travel, buying or selling time"}.</p>
        <div className="print-requirements">{estimate.requirements.map((requirement) => <span key={requirement.craft} className={requirement.gap < 0 ? "print-warning" : "print-muted"}>{requirement.craft}: {requirement.effective} / cap {requirement.cap} ({requirement.gap >= 0 ? "+" : ""}{requirement.gap})</span>)}</div>
        <section className="print-section"><h3>Raw-input prices &amp; whole-chain ceilings</h3><div className="print-table-wrap"><table className="print-raw-inputs"><thead><tr><th>Raw input</th><th>Expected qty / final attempt</th><th>Buy gil each</th><th>Max gil each</th></tr></thead><tbody>{estimate.rawCeilings.map((input) => <tr key={input.key}><td><ItemButton name={input.name} /></td><td>{units(input.quantity)}</td><td><PriceField name={input.name} kind="Buy" book={prices.buy} baseline={printBuyPrice(input.name, prices.effectiveBuy, state.vendors, state.modernGuilds)} onChange={(name, value) => priceChange("buy", name, value)} /><small>Applied {gil(input.price)} gil</small></td><td className={input.maximum !== null && input.maximum < 0 ? "print-loss" : ""}>{gil(input.maximum)}</td></tr>)}</tbody></table></div><p className="print-muted">Break-even prices for the selected chain, holding all other raw prices and recipe choices fixed. Shared materials and crystals are combined across every stage. Unknown prices are not zero; negative ceilings cannot break even with that input free.</p></section>
        <section className="print-section"><h3>Ingredient production chain</h3><div className="print-table-wrap"><table><thead><tr><th>Final ingredient</th><th>Recipe qty</th><th>Effective cost each</th><th>Max cost each</th></tr></thead><tbody>{estimate.ceilings.map((input) => <tr key={input.name}><td><ItemButton name={input.name} /></td><td>{input.quantity}</td><td>{gil(input.price)}</td><td>{gil(input.maximum)}</td></tr>)}</tbody></table></div>
          <p className="print-muted">Auto expands every craftable ingredient within the era / key-item filters, even with unknown prices. Alternative recipes use the lowest fully priced crafting cost when available; Buy explicitly stops a branch. HQ yields, break losses, crystals and batch quantities apply at every stage. Circular or more than {MAX_CHAIN_DEPTH}-stage branches are flagged, never silently purchased. Nonmatching outputs have no credit. Finite batches can leave surplus or fall short.</p>
          <div className="print-production">{estimate.sources.map((source, index) => <IngredientSource key={`${source.node.key}:${index}`} node={source.node} demand={source.quantity} parentQuantity={estimate.inputs[index].quantity} state={state} prices={prices} chain={chain} onSource={sourceChange} onPrice={(name, value) => priceChange("buy", name, value)} />)}</div>
        </section>
        <section className="print-section"><h3>Output sale prices</h3><div className="print-table-wrap"><table><thead><tr><th>Roll</th><th>Output</th><th>Qty</th><th>Chance / attempt</th><th>Sell gil each</th></tr></thead><tbody>{estimate.outcomes.map((outcome, index) => <tr key={index}><td>{index ? `HQ${index}` : "NQ"}</td><td><ItemButton name={outcome.n} /><small>NPC base {gil(printSellPrice(outcome.n, {}))}</small></td><td>{outcome.q}</td><td>{pct(outcome.probability)}</td><td><PriceField name={outcome.n} kind="Sell" book={prices.sell} baseline={printSellPrice(outcome.n, prices.effectiveSell)} onChange={(name, value) => priceChange("sell", name, value)} /><small>Applied {gil(outcome.price)} gil</small></td></tr>)}</tbody></table></div><p className="print-muted">Sale quotes apply across recipes and HQ rows. AH fees, unsold listings and time to sell are not included.</p></section>
        <section className="print-section print-hq-comparison"><h3><TrendingUp size={16} /> Final recipe HQ comparison</h3>
          <label className="print-tier-choice print-tier-auto"><input type="radio" name={`final-tier-${recipe.id}`} checked={manualTier === undefined} onChange={() => selectTier(undefined)} /> Auto: best gil/hour{best?.gilPerHour === null ? " (prices needed)" : best ? ` / tier ${best.tier}` : ""}</label>
          <div className="print-table-wrap"><table><thead><tr><th>Tier</th><th>Required effective skills</th><th>HQ</th><th>Profit / final attempt</th><th>Chain gil / hour</th></tr></thead><tbody>{comparisons.map((comparison) => <tr key={comparison.tier} className={`print-tier-row${estimate.tier === comparison.tier ? " print-current-tier" : ""}`} onClick={() => selectTier(comparison.tier)}><td><label className="print-tier-choice"><input type="radio" name={`final-tier-${recipe.id}`} aria-label={`Use HQ tier ${comparison.tier}`} checked={manualTier === comparison.tier} onChange={() => selectTier(comparison.tier)} />{comparison.tier} (+{HQ_GAPS[comparison.tier]})</label></td><td>{comparison.requirements.map((requirement) => `${requirement.craft} ${requirement.cap + HQ_GAPS[comparison.tier]}`).join(", ")}</td><td>{pct(comparison.hq)}</td><td className={tone(comparison.profit)}>{gil(comparison.profit)}</td><td className={tone(comparison.gilPerHour)}>{gil(comparison.gilPerHour)}</td></tr>)}</tbody></table></div><p className="print-muted">Effective skill limit: {PRINT_SKILL_CAP} in every required craft. Only the final recipe changes tier; ingredient stages stay at the at-cap, HQ tier 0 baseline. Equal or unknown returns default to the lowest required tier.</p>
        </section>
        <section className="print-section print-batch"><NumberField label="Final batch attempts" value={state.batch} min={1} max={100000} onChange={(batch) => update({ batch })} /><span>Expected profit <strong className={tone(estimate.profit)}>{gil(estimate.profit === null ? null : estimate.profit * state.batch)}</strong> gil</span><span>{gil(state.batch * estimate.seconds / 60)} minutes / {gil(state.batch * estimate.totalAttempts)} total synths</span></section>
      </article> : <div className="print-empty"><Coins size={30} /><p>No matching profit candidates.</p></div>}
    </div>
  </div>;
}