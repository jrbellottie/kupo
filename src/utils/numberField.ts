export function normalizeNumberDraft(current: string, next: string) {
  return current === "0" && /^0\d/.test(next) ? next.slice(1) : next;
}

export function committedNumberValue(draft: string, min: number, max: number) {
  const next = draft === "" ? min : Number(draft);
  return Number.isFinite(next) ? Math.min(max, Math.max(min, next)) : min;
}
