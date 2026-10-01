import { useEffect, useState } from "react";
import { ArrowDownUp, ArrowRight, Check, ChevronLeft, ChevronRight, Footprints, MapPin, Route } from "lucide-react";
import MapView, { MapDef } from "./MapView";
import mapData from "./data/maps.json";
import { buildRuinsJourney, nodeLabel, ROUTE_ENDPOINTS, RouteMap } from "./utils/alzadaalRoutes";
import { loadJson, saveJson } from "./utils/storage";
import "./AlzadaalRoute.css";
import { CollapsibleSection } from "./ScreenControls";

const MAPS = (mapData as { maps: MapDef[] }).maps;
const STORAGE_KEY = "kupo.atlas.alzadaal";
const GROUPS = ["Zone exits", "Staging points", "Remnants"] as const;
type Selection = { start: string; end: string; step: number };

function readSelection(): Selection {
  const fallback = { start: "alzahbi", end: "merit", step: 0 };
  const saved = loadJson<Partial<Selection> | null>(STORAGE_KEY, null);
  if (!saved || !ROUTE_ENDPOINTS.some(endpoint => endpoint.id === saved.start) || !ROUTE_ENDPOINTS.some(endpoint => endpoint.id === saved.end)) return fallback;
  return { start: saved.start!, end: saved.end!, step: Number.isInteger(saved.step) && saved.step! >= 0 ? saved.step! : 0 };
}

function JourneyMap({ reference, label }: { reference: RouteMap; label: string }) {
  const map = MAPS.find(candidate => candidate.zone === reference.zone && candidate.mapNo === reference.mapNo);
  if (!map) return <p role="status">Map unavailable: {reference.zone}, map {reference.mapNo}.</p>;
  return <MapView key={map.id} map={map} width={560} showHoverCell marker={reference.point ? { x: reference.point[0] / 512, y: reference.point[1] / 512, label } : undefined} />;
}

export default function AlzadaalRoute() {
  const [selection, setSelection] = useState<Selection>(readSelection);
  const journey = buildRuinsJourney(selection.start, selection.end)!;
  const stepIndex = Math.min(selection.step, journey.steps.length - 1);
  const active = journey.steps[stepIndex];
  const teleportCount = journey.steps.filter(step => step.kind === "teleport").length;
  const outsideWalk = journey.path.some(node => node.id === "dvucca") && journey.path.length > 1;

  useEffect(() => {
    try { saveJson(STORAGE_KEY, selection); } catch {}
  }, [selection]);

  function setStep(step: number) {
    setSelection(previous => ({ ...previous, step }));
  }

  return (
    <section className="alzadaal-route" aria-label="Alzadaal route helper">
      <div className="route-heading">
        <h2><Route size={21} aria-hidden="true" /> Alzadaal Undersea Ruins</h2>
        <span className="route-count">{teleportCount} lettered {teleportCount === 1 ? "teleport" : "teleports"}{outsideWalk ? " + outdoor walk" : ""}</span>
      </div>
      <CollapsibleSection kind="search">
      <div className="route-controls">
        <label>
          <span>Starting from</span>
          <select value={selection.start} onChange={event => setSelection(previous => ({ ...previous, start: event.target.value, step: 0 }))}>
            {GROUPS.map(group => <optgroup key={group} label={group}>{ROUTE_ENDPOINTS.filter(endpoint => endpoint.group === group).map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.label}</option>)}</optgroup>)}
          </select>
        </label>
        <button type="button" className="route-icon-button route-swap" title="Swap start and destination" aria-label="Swap start and destination" onClick={() => setSelection({ start: selection.end, end: selection.start, step: 0 })}>
          <ArrowDownUp size={18} aria-hidden="true" />
        </button>
        <label>
          <span>Destination</span>
          <select value={selection.end} onChange={event => setSelection(previous => ({ ...previous, end: event.target.value, step: 0 }))}>
            {GROUPS.map(group => <optgroup key={group} label={group}>{ROUTE_ENDPOINTS.filter(endpoint => endpoint.group === group).map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.label}</option>)}</optgroup>)}
          </select>
        </label>
      </div>
      </CollapsibleSection>
      <div className="route-summary" aria-label="Route overview">
        {journey.path.map((node, index) => (
          <span key={node.id}>{index > 0 && <ArrowRight size={13} aria-hidden="true" />}<span title={node.name}>{node.id === "dvucca" ? <Footprints size={14} aria-hidden="true" /> : null}{nodeLabel(node)}</span></span>
        ))}
      </div>
      <div className="route-workspace">
        <nav className="route-itinerary" aria-label="Journey steps">
          <ol>
            {journey.steps.map((step, index) => (
              <li key={`${selection.start}-${selection.end}-${index}`}>
                <button type="button" aria-current={stepIndex === index ? "step" : undefined} className={stepIndex === index ? "route-step is-current" : "route-step"} onClick={() => setStep(index)}>
                  <span className={`route-step-number${index < stepIndex ? " is-past" : ""}`}>{index < stepIndex ? <Check size={15} aria-hidden="true" /> : index + 1}</span>
                  <span><strong>{step.title}</strong><small>{step.map.zone === "Alzadaal Undersea Ruins" ? `Alzadaal - Map ${step.map.mapNo}` : `${step.map.zone} - Map ${step.map.mapNo}`}</small></span>
                  {step.kind === "walk" && <Footprints size={15} className="route-walk-icon" aria-label="Outdoor walk" />}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="route-active-step">
          <div className="route-step-heading" aria-live="polite" aria-atomic="true">
            <span className="route-step-counter">Step {stepIndex + 1} of {journey.steps.length}</span>
            <h3>{active.kind === "arrival" ? <MapPin size={19} aria-hidden="true" /> : null}{active.title}</h3>
            <p>{active.detail}</p>
          </div>
          <div className="route-progress-controls">
            <button type="button" className="route-icon-button" title="Previous step" aria-label="Previous step" disabled={stepIndex === 0} onClick={() => setStep(stepIndex - 1)}><ChevronLeft size={19} aria-hidden="true" /></button>
            <progress aria-label="Route progress" max={journey.steps.length} value={stepIndex + 1} />
            <button type="button" className="route-next" disabled={stepIndex === journey.steps.length - 1} onClick={() => setStep(stepIndex + 1)}>Next step <ChevronRight size={17} aria-hidden="true" /></button>
          </div>
          <div className="route-maps">
            <div className="route-map-current">
              <h4>{active.kind === "entry" ? "Outside entrance" : active.kind === "arrival" ? "Destination" : "Current map"}</h4>
              <JourneyMap reference={active.map} label={active.title} />
            </div>
            {active.nextMap && (
              <div className="route-map-next">
                <h4>{active.kind === "arrival" ? "Outside destination" : "Next map"}</h4>
                <JourneyMap reference={active.nextMap} label={active.kind === "arrival" ? active.title : "Arrival connection"} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}