import { useMemo, useState } from "react";
import {
  AURA_TIERS,
  calculateFurniturePlan,
  evaluateFurnitureSetup,
  furnitureQuantityOptionsMaximum,
  ELEMENTS,
  FURNITURE,
  MAX_FURNITURE_STORAGE,
  MOGHANCEMENTS,
  type Furniture,
  type PlannedFurniture,
} from "./utils/moghancements";
import "./MoghancementTab.css";

const ELEMENT_FILTER_ALL = "all";

function recipeSummary(furniture: Furniture): string {
  if (furniture.recipes.length === 0) return "No recipe in the reference list";
  return furniture.recipes
    .slice(0, 2)
    .map(recipe => `${recipe.craft} ${recipe.level} (${recipe.quality})`)
    .join(" · ");
}

function recipeIngredients(furniture: Furniture): string {
  const recipe = furniture.recipes[0];
  if (!recipe) return "";
  return recipe.ingredients.map(item => `${item.name} ×${item.quantity}`).join(", ");
}

export default function MoghancementTab() {
  const [effectId, setEffectId] = useState(512);
  const [elementId, setElementId] = useState(1);
  const [tierId, setTierId] = useState<(typeof AURA_TIERS)[number]["id"]>("faint");
  const [storageTarget, setStorageTarget] = useState(MAX_FURNITURE_STORAGE);
  const [furnitureSearch, setFurnitureSearch] = useState("");
  const [furnitureElementFilter, setFurnitureElementFilter] = useState("target");
  const [craftableOnly, setCraftableOnly] = useState(false);
  const [customPieces, setCustomPieces] = useState<PlannedFurniture[] | null>(null);

  const effect = MOGHANCEMENTS.find(item => item.id === effectId) ?? MOGHANCEMENTS[0];
  const targetTier = AURA_TIERS.find(tier => tier.id === tierId) ?? AURA_TIERS[0];
  const selectedElement = ELEMENTS.find(item => item.id === elementId) ?? ELEMENTS[0];
  const suggestedPlan = useMemo(
    () => effect ? calculateFurniturePlan(effect, elementId, targetTier.minimum, storageTarget) : null,
    [effect, elementId, storageTarget, targetTier.minimum],
  );
  const plan = useMemo(
    () => customPieces !== null && effect
      ? evaluateFurnitureSetup(customPieces, effect, elementId, targetTier.minimum, storageTarget)
      : suggestedPlan,
    [customPieces, effect, elementId, targetTier.minimum, storageTarget, suggestedPlan],
  );
  const planComplete = Boolean(plan?.targetReached && plan.storageTargetReached);
  const quantities = new Map(plan?.pieces.map(piece => [piece.furniture.id, piece.quantity]));
  const setQuantity = (furniture: Furniture, quantity: number) => {
    setCustomPieces(current => {
      const pieces = current ?? suggestedPlan?.pieces ?? [];
      if (quantity === 0) return pieces.filter(piece => piece.furniture.id !== furniture.id);
      if (pieces.some(piece => piece.furniture.id === furniture.id)) {
        return pieces.map(piece => piece.furniture.id === furniture.id ? { ...piece, quantity } : piece);
      }
      return [...pieces, { furniture, quantity }];
    });
  };

  const furnitureRows = useMemo(() => {
    const query = furnitureSearch.trim().toLowerCase();
    const targetEffectIds = effect?.pairedBaseId !== undefined
      ? [effect.pairedBaseId, effect.pairedMegaId]
      : [effect?.id];
    return FURNITURE
      .filter(item => furnitureElementFilter === ELEMENT_FILTER_ALL
        || item.elementId === (furnitureElementFilter === "target" ? elementId : Number(furnitureElementFilter)))
      .filter(item => !craftableOnly || item.recipes.length > 0)
      .filter(item => !query || [
        item.name,
        item.element,
        item.effectLabel,
        ...item.recipes.flatMap(recipe => [recipe.craft, ...recipe.ingredients.map(ingredient => ingredient.name)]),
      ].some(value => value.toLowerCase().includes(query)))
      .sort((a, b) => {
        const aTarget = targetEffectIds.includes(a.moghancementId) ? 1 : 0;
        const bTarget = targetEffectIds.includes(b.moghancementId) ? 1 : 0;
        return bTarget - aTarget || b.aura - a.aura || b.storage - a.storage || a.name.localeCompare(b.name);
      });
  }, [craftableOnly, effect, elementId, furnitureElementFilter, furnitureSearch]);

  if (!effect) return <div className="mogha-card">No furnishing effects are available in the current reference data.</div>;

  return (
    <div className="mogha-tab">
      <div className="mogha-card">
        <div className="mogha-heading">
          <div>
            <h1 className="mogha-title">Moghancement &amp; Furniture</h1>
            <p className="mogha-intro">
              Choose an effect, dominant aura element, aura tier, and storage target up to 80.
              Start with a suggestion or choose furniture quantities from the catalog.
            </p>
          </div>
        </div>

        <div className="mogha-controls">
          <label className="mogha-field">
            <span>Moghancement</span>
            <select value={effectId} onChange={event => setEffectId(Number(event.target.value))}>
              {MOGHANCEMENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="mogha-field">
            <span>Dominant aura element</span>
            <select value={elementId} onChange={event => setElementId(Number(event.target.value))}>
              {ELEMENTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="mogha-field">
            <span>Target aura tier</span>
            <select value={tierId} onChange={event => setTierId(event.target.value as typeof tierId)}>
              {AURA_TIERS.map(tier => <option key={tier.id} value={tier.id}>{tier.label} · {tier.minimum}+ points</option>)}
            </select>
          </label>
          <label className="mogha-field mogha-count-field">
            <span>Storage target (max 80)</span>
            <input
              type="number"
              min={1}
              max={MAX_FURNITURE_STORAGE}
              value={storageTarget}
              onChange={event => setStorageTarget(Math.max(1, Math.min(MAX_FURNITURE_STORAGE, Number(event.target.value) || 1)))}
            />
          </label>
        </div>

        <div className="mogha-effect-description">
          <strong>{effect.label}</strong>
          {effect.description && <span>{effect.description}</span>}
          {effect.pairedBaseId !== undefined && (
            <span>This Moglification requires the matching guild signboard and stall; the suggested setup includes that pair when the furnishings are listed.</span>
          )}
        </div>
      </div>

      <section className="mogha-card">
        <div className="mogha-section-heading">
          <div>
            <h2>{customPieces === null ? "Suggested setup" : "Your setup"}</h2>
            <p>Repeat furniture for aura, add storage, and keep your Moghancement source. Quantity 0 removes an item; totals update as you edit.</p>
            <div className="mogha-setup-actions">
              <button type="button" onClick={() => setCustomPieces(null)} disabled={customPieces === null || !suggestedPlan}>Use suggested setup</button>
              <button type="button" onClick={() => setCustomPieces([])}>Clear setup</button>
            </div>
          </div>
          {plan && <div className="mogha-summary">
            <span><strong>{plan.totalAura}</strong> {selectedElement.name} aura · {plan.totalAura >= targetTier.minimum ? `${targetTier.label} aura target met` : `${targetTier.minimum}+ aura target not met`}</span>
            <span><strong>+{plan.effectiveStorage}/{MAX_FURNITURE_STORAGE}</strong> effective storage · {plan.storageTargetReached ? `${storageTarget} target met` : `${storageTarget} target not met`}</span>
            <span>{plan.totalStorage} raw storage · {plan.totalPieces} pieces{plan.totalStorage > MAX_FURNITURE_STORAGE ? ` · ${plan.totalStorage - MAX_FURNITURE_STORAGE} above cap unused` : ""}</span>
          </div>}
        </div>
        {plan ? <>
          <div role="status" className={`mogha-status ${planComplete ? "mogha-status-good" : "mogha-status-warn"}`}>
            {plan.targetReached
              ? `${effect.label} is represented by this setup, with ${plan.totalAura} ${selectedElement.name} aura. `
              : "This setup does not meet the selected Moghancement and aura target. "}
            {!plan.effectPresent && <span>Add the matching Moghancement source{effect.pairedBaseId !== undefined ? " (both guild signboard and stall)" : " for the selected element"}. </span>}
            {plan.effectPresent && !plan.effectDominant && <span>Another furnishing has higher or tied individual aura for the selected element and a competing effect. Repeating a source adds elemental aura, not individual effect priority. </span>}
            {!plan.elementDominant && <span>{selectedElement.name} must exceed the strongest other element ({plan.otherElementAura} aura). </span>}
            {plan.totalAura < targetTier.minimum && <span>Add {targetTier.minimum - plan.totalAura} more {selectedElement.name} aura to reach {targetTier.label}. </span>}
            {plan.storageTargetReached ? `The ${storageTarget}-point storage target is reached. ` : `Storage is ${plan.effectiveStorage}; the target is ${storageTarget}. `}
          </div>
          {plan.pieces.length > 0
            ? <FurnitureTable rows={plan.pieces.map(piece => piece.furniture)} purposes={plan.pieces.map(piece => piece.purpose)} quantities={quantities} onQuantityChange={setQuantity} showTotals />
            : <div className="mogha-empty">Choose quantities from the catalog below to build your setup.</div>}
        </> : (
          <div className="mogha-empty">
              No listed furniture source matches {effect.label} with {selectedElement.name} aura. Choose an element with a matching source furnishing.
          </div>
        )}
      </section>

      <section className="mogha-card">
        <div className="mogha-section-heading">
          <div>
            <h2>Furniture catalog</h2>
            <p>{furnitureRows.length} of {FURNITURE.length} furnishings · filter by aura element, effect, recipe, or ingredient.</p>
          </div>
          <div className="mogha-catalog-controls">
            <label className="mogha-field">
              <span>Element</span>
              <select value={furnitureElementFilter} onChange={event => setFurnitureElementFilter(event.target.value)}>
                <option value="target">Selected aura element ({selectedElement.name})</option>
                <option value={ELEMENT_FILTER_ALL}>All elements</option>
                {ELEMENTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="mogha-field mogha-search-field">
              <span>Search</span>
              <input value={furnitureSearch} onChange={event => setFurnitureSearch(event.target.value)} placeholder="Furniture, craft, ingredient..." />
            </label>
            <label className="mogha-check">
              <input type="checkbox" checked={craftableOnly} onChange={event => setCraftableOnly(event.target.checked)} />
              Listed recipe only
            </label>
          </div>
        </div>
        <FurnitureTable rows={furnitureRows} quantities={quantities} onQuantityChange={setQuantity} />
      </section>

      <p className="mogha-footnote">
        Furniture storage is capped at 80 spaces; extra storage points do not add capacity. Aura tiers are Faint (1–50), Powerful (51–100), and Overwhelming (101+). Furniture copies add aura and storage; Rare furnishings are limited to one. Quantity dropdowns expand as needed. Custom choices stay in place when targets change; use the suggested setup to replace them. Room slots and unselected furniture are not modeled. Storage, aura, item flags, and effect names come from the pinned furnishing data; recipe availability comes from the recipe reference list. Live server layouts and effects may differ. Aura tiers do not specify an exact synthesis material-loss percentage.
      </p>
    </div>
  );
}

function FurnitureTable({ rows, purposes, quantities, onQuantityChange, showTotals = false }: {
  rows: Furniture[];
  purposes?: (string | undefined)[];
  quantities: Map<number, number>;
  onQuantityChange: (furniture: Furniture, quantity: number) => void;
  showTotals?: boolean;
}) {
  if (rows.length === 0) return <div className="mogha-empty">No matching furniture in the reference catalog.</div>;

  return (
    <div className="mogha-table-wrap">
      <table className="mogha-table">
        <thead>
          <tr>
            <th>Furniture</th>
            <th>Quantity</th>
            <th>Element / aura {showTotals ? "total" : "each"}</th>
            <th>Moghancement</th>
            <th>Storage {showTotals ? "total" : "each"}</th>
            <th>Listed recipe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={`${item.id}-${index}`}>
              <td>
                <strong>{item.name}</strong>
                {item.rare && <span className="mogha-purpose">Rare: max 1</span>}
                {purposes?.[index] && <span className="mogha-purpose">{purposes[index]}</span>}
                {item.recipes[0] && <span className="mogha-ingredients">{recipeIngredients(item)}</span>}
              </td>
              <td>
                <label className="mogha-field mogha-quantity-field">
                  <select aria-label={`Quantity of ${item.name}`} value={quantities.get(item.id) ?? 0} onChange={event => onQuantityChange(item, Number(event.target.value))}>
                    {Array.from({ length: furnitureQuantityOptionsMaximum(item, quantities.get(item.id) ?? 0) + 1 }, (_, quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}
                  </select>
                </label>
              </td>
              <td>{item.element} +{item.aura * (showTotals ? quantities.get(item.id) ?? 0 : 1)}
                {showTotals && <span className="mogha-purpose">+{item.aura} each</span>}
              </td>
              <td>{item.effectLabel}</td>
              <td>+{item.storage * (showTotals ? quantities.get(item.id) ?? 0 : 1)}
                {showTotals && <span className="mogha-purpose">+{item.storage} each</span>}
              </td>
              <td>{recipeSummary(item)}{item.recipes.length > 2 ? ` · +${item.recipes.length - 2} more` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
