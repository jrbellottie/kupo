import { useMemo, useState } from "react";
import {
  AURA_TIERS,
  calculateFurniturePlan,
  ELEMENTS,
  FURNITURE,
  MAX_FURNITURE_STORAGE,
  MOGHANCEMENTS,
  type Furniture,
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
  const [maxPieces, setMaxPieces] = useState(10);
  const [storageTarget, setStorageTarget] = useState(MAX_FURNITURE_STORAGE);
  const [furnitureSearch, setFurnitureSearch] = useState("");
  const [furnitureElementFilter, setFurnitureElementFilter] = useState("target");
  const [craftableOnly, setCraftableOnly] = useState(false);

  const effect = MOGHANCEMENTS.find(item => item.id === effectId) ?? MOGHANCEMENTS[0];
  const targetTier = AURA_TIERS.find(tier => tier.id === tierId) ?? AURA_TIERS[0];
  const selectedElement = ELEMENTS.find(item => item.id === elementId) ?? ELEMENTS[0];
  const plan = useMemo(
    () => effect ? calculateFurniturePlan(effect, elementId, targetTier.minimum, maxPieces, storageTarget) : null,
    [effect, elementId, maxPieces, storageTarget, targetTier.minimum],
  );
  const planComplete = Boolean(plan?.targetReached && plan.storageTargetReached);

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
              The catalog also shows storage and listed synthesis recipes.
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
            <span>Furniture limit</span>
            <input
              type="number"
              min={1}
              max={30}
              value={maxPieces}
              onChange={event => setMaxPieces(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
            />
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
            <span>This Moglification requires the matching guild signboard and stall; the plan includes that pair when the furnishings are listed.</span>
          )}
        </div>
      </div>

      <section className="mogha-card">
        <div className="mogha-section-heading">
          <div>
            <h2>Suggested setup</h2>
            <p>Uses the selected element and keeps the Moghancement source at the highest individual aura for that element.</p>
          </div>
          {plan && <div className="mogha-summary">
            <span><strong>{plan.totalAura}</strong> {selectedElement.name} aura · {plan.targetReached ? `${targetTier.label} target met` : `${targetTier.minimum}+ target not met`}</span>
            <span><strong>+{plan.effectiveStorage}/{MAX_FURNITURE_STORAGE}</strong> effective storage · {plan.storageTargetReached ? `${storageTarget} target met` : `${storageTarget} target not met`}</span>
            <span>{plan.totalStorage} raw storage · {plan.pieces.length}/{maxPieces} pieces{plan.totalStorage > MAX_FURNITURE_STORAGE ? ` · ${plan.totalStorage - MAX_FURNITURE_STORAGE} above cap unused` : ""}</span>
          </div>}
        </div>
        {plan ? <>
          <div className={`mogha-status ${planComplete ? "mogha-status-good" : "mogha-status-warn"}`}>
            {plan.targetReached
              ? `${effect.label} is represented by this setup, with ${plan.totalAura} ${selectedElement.name} aura (${plan.otherElementAura} points in the strongest other element). ${plan.storageTargetReached ? `The ${storageTarget}-point storage target is reached.` : `Only ${plan.totalStorage} raw storage points fit within the current furniture limit; the target is ${storageTarget}.`}`
              : `The best listed setup reaches ${plan.totalAura} ${selectedElement.name} aura with the current furniture limit; it does not reach the ${targetTier.minimum}-point aura target${plan.storageTargetReached ? `, though it reaches the ${storageTarget}-point storage target` : ` or the ${storageTarget}-point storage target`}.`}
          </div>
          <FurnitureTable rows={plan.pieces.map(piece => piece.furniture)} purposes={plan.pieces.map(piece => piece.purpose)} />
        </> : (
          <div className="mogha-empty">
              No listed furniture source matches {effect.label} with {selectedElement.name} aura. Choose an element with a matching source furnishing; if a plan falls short of its tier, increase the furniture limit.
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
        <FurnitureTable rows={furnitureRows} />
      </section>

      <p className="mogha-footnote">
        Furniture storage is capped at 80 spaces; extra storage points do not add capacity. Aura tiers are Faint (1–50), Powerful (51–100), and Overwhelming (101+). The suggested setup uses each item type once and does not model room slots or other furniture already placed. Storage, aura, and effect names come from the pinned furnishing data; recipe availability comes from the recipe reference list. Live server layouts and effects may differ. Aura tiers do not specify an exact synthesis material-loss percentage.
      </p>
    </div>
  );
}

function FurnitureTable({ rows, purposes }: { rows: Furniture[]; purposes?: string[] }) {
  if (rows.length === 0) return <div className="mogha-empty">No matching furniture in the reference catalog.</div>;

  return (
    <div className="mogha-table-wrap">
      <table className="mogha-table">
        <thead>
          <tr>
            <th>Furniture</th>
            <th>Element / aura</th>
            <th>Moghancement</th>
            <th>Storage</th>
            <th>Listed recipe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={`${item.id}-${index}`}>
              <td>
                <strong>{item.name}</strong>
                {purposes?.[index] && <span className="mogha-purpose">{purposes[index]}</span>}
                {item.recipes[0] && <span className="mogha-ingredients">{recipeIngredients(item)}</span>}
              </td>
              <td>{item.element} +{item.aura}</td>
              <td>{item.effectLabel}</td>
              <td>+{item.storage}</td>
              <td>{recipeSummary(item)}{item.recipes.length > 2 ? ` · +${item.recipes.length - 2} more` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
