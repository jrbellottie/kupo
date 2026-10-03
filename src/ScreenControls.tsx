import { createContext, useContext, useEffect, useId, useLayoutEffect, useState, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { PanelTopClose, PanelTopOpen } from "lucide-react";
import { loadJson, saveJson } from "./utils/storage";
import { styles } from "./styles";

type SectionKind = "tabs" | "search";
type Section = { id: string; kind: SectionKind; scope: string; collapsedLabel?: string };
type Controls = {
  scope: string;
  collapsed: Record<string, boolean>;
  setCollapsed: Dispatch<SetStateAction<Record<string, boolean>>>;
  sections: Section[];
  setSections: Dispatch<SetStateAction<Section[]>>;
};
const ControlsContext = createContext<Controls | null>(null);
const COLLAPSIBLE_SCOPES = new Set(["fish", "chocobo", "weather", "drops", "crafting", "bcnm"]);

export function useTableViewportHeight(ref: RefObject<HTMLDivElement>) {
  const [height, setHeight] = useState<number>();
  const controls = useContext(ControlsContext);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const top = ref.current.getBoundingClientRect().top + window.scrollY;
    setHeight(Math.max(180, Math.floor(window.innerHeight - top - 64)));
  });
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const measure = () => {
      const top = table.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(180, Math.floor(window.innerHeight - top - 64)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (let ancestor: HTMLElement | null = table.parentElement; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor);
      for (let sibling = ancestor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        observer.observe(sibling);
      }
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, controls?.collapsed, controls?.sections]);
  return height;
}

export function ScreenControlsProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    loadJson("ffxi_screen_controls_v1", {}) ?? {}
  );
  const [sections, setSections] = useState<Section[]>([]);
  useEffect(() => saveJson("ffxi_screen_controls_v1", collapsed), [collapsed]);
  return <ControlsContext.Provider value={{ scope, collapsed, setCollapsed, sections, setSections }}>
    {children}
  </ControlsContext.Provider>;
}

export function ScreenControlToggles({ children }: { children?: ReactNode }) {
  const controls = useContext(ControlsContext);
  if (!controls) return null;
  const collapsedKinds = (["tabs", "search"] as const).filter(kind =>
    COLLAPSIBLE_SCOPES.has(controls.scope) &&
    controls.collapsed[`${controls.scope}:${kind}`] === true &&
    controls.sections.some(section => section.scope === controls.scope && section.kind === kind)
  );
  if (!children && !collapsedKinds.length) return null;
  return <div data-screen-toolbar role="group" aria-label="Collapsed sections"
    style={{ ...styles.tabBar, position: "static", background: "#0c0c0c", minWidth: 0 }}>
    {children}
    {collapsedKinds.map(kind => {
    const sections = controls.sections.filter(section => section.scope === controls.scope && section.kind === kind);
    if (!sections.length) return null;
    const key = `${controls.scope}:${kind}`;
    const collapsed = controls.collapsed[key] === true;
    if (!collapsed) return null;
    const label = sections.find(section => section.collapsedLabel)?.collapsedLabel ?? (kind === "tabs" ? "Tabs" : "Search");
    const action = `Expand ${kind}`;
    return <button key={kind} type="button" title={action} aria-label={action}
      aria-expanded={!collapsed} aria-controls={sections.map(section => section.id).join(" ")}
      onClick={() => controls.setCollapsed(previous => ({ ...previous, [key]: !collapsed }))}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 8px", border: "1px solid #444", borderRadius: 8, background: "#111", color: "#eaeaea", fontSize: 13, flexShrink: 0 }}>
      {collapsed ? <PanelTopOpen size={16} aria-hidden="true" /> : <PanelTopClose size={16} aria-hidden="true" />}
      {label}
    </button>;
  })}</div>;
}

export function CollapsibleSection({ kind, children, style, collapsedLabel }: { kind: SectionKind; children: ReactNode; style?: CSSProperties; collapsedLabel?: string }) {
  const controls = useContext(ControlsContext);
  const id = useId();
  const scope = controls?.scope;
  const enabled = scope !== undefined && COLLAPSIBLE_SCOPES.has(scope);
  const setSections = controls?.setSections;
  useLayoutEffect(() => {
    if (!enabled || !setSections || !scope) return;
    setSections(previous => [...previous, { id, kind, scope, collapsedLabel }]);
    return () => setSections(previous => previous.filter(section => section.id !== id));
  }, [enabled, id, kind, scope, setSections, collapsedLabel]);
  if (!enabled) return style ? <div style={style}>{children}</div> : <>{children}</>;
  const collapsed = controls?.collapsed[`${scope}:${kind}`] === true;
  const action = `Collapse ${kind}`;
  return <div id={id} data-screen-section={kind} hidden={collapsed}
    style={{ ...(kind === "tabs" ? { border: "1px solid #333", borderRadius: 12, padding: 8, background: "rgba(255,255,255,0.02)" } : {}), ...style, display: collapsed ? "none" : "grid", gridTemplateColumns: controls ? "32px minmax(0, 1fr)" : "minmax(0, 1fr)", gap: 8, alignItems: "start", minWidth: 0 }}>
    {controls && <button type="button" title={action} aria-label={action} aria-expanded={true} aria-controls={`${id}-content`}
      onClick={() => controls.setCollapsed(previous => ({ ...previous, [`${scope}:${kind}`]: true }))}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, border: "1px solid #444", borderRadius: 8, background: "#111", color: "#eaeaea", cursor: "pointer" }}>
      <PanelTopClose size={16} aria-hidden="true" />
    </button>}
    <div id={`${id}-content`} style={{ display: "grid", gap: 12, minWidth: 0 }}>{children}</div>
  </div>;
}