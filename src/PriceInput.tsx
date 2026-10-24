import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import "./PriceInput.css";

type Props = { label: string; value: number | undefined; baseline: number | null; onChange: (value: number | null) => void; resetLabel?: string; quantity?: number; showReset?: boolean; roundDown?: boolean };

export default function PriceInput({ label, value: override, baseline, onChange, resetLabel = `Reset ${label}`, quantity = 1, showReset = true, roundDown = false }: Props) {
  const formatAmount = (amount: number) => String(roundDown ? Math.floor(amount) : Number(amount.toFixed(4)));
  const display = override === undefined ? "" : formatAmount(override * quantity);
  const source = `${override ?? ""}:${quantity}:${roundDown}`;
  const [draft, setDraft] = useState(() => ({ source, text: display, dirty: false }));
  if (draft.source !== source) setDraft({ source, text: display, dirty: false });
  const value = draft.text === "" ? null : Number(draft.text) / quantity;
  const valid = value === null || (Number.isFinite(value) && value >= 0);
  useEffect(() => {
    if (!draft.dirty || !valid || value === (override ?? null)) return;
    const timer = setTimeout(() => onChange(value), 200);
    return () => clearTimeout(timer);
  }, [value, valid, override, onChange, draft.dirty]);
  const commit = () => { if (draft.dirty && valid && value !== (override ?? null)) onChange(value); };
  return <div className="item-price-input"><input type="number" min="0" step="any" aria-label={label} aria-invalid={!valid} value={draft.text} placeholder={baseline === null ? "Unknown" : formatAmount(baseline * quantity)} onChange={(event) => setDraft({ source, text: event.target.value, dirty: true })} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); }} />{showReset && <button type="button" disabled={override === undefined && draft.text === ""} aria-label={resetLabel} title={resetLabel} onClick={() => { setDraft({ source, text: "", dirty: false }); onChange(null); }}><RotateCcw size={14} /></button>}</div>;
}