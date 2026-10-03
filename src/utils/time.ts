export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function formatCountdown(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 99) return `${hours}h ${pad2(minutes)}m ${pad2(seconds)}s`;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

// -------------------- Date parsing (LOCAL) --------------------

export function parseLocalDateTimeToMs(raw: string): number | undefined {
  const s = raw.trim();
  if (!s) return undefined;

  // datetime-local emits: YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const normalized = s.length === 16 ? `${s}:00` : s;
    const ms = new Date(normalized).getTime(); // local time
    if (Number.isFinite(ms)) return ms;
  }

  // Common paste: MM/DD/YYYY HH:MM:SS AM
  {
    const m = s.match(
        /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
    );
    if (m) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      const year = Number(m[3]);
      let hour = Number(m[4]);
      const minute = Number(m[5]);
      const second = Number(m[6] ?? 0);
      const ampm = (m[7] ?? "").toUpperCase();

      if (ampm === "AM") {
        if (hour === 12) hour = 0;
      } else if (ampm === "PM") {
        if (hour !== 12) hour += 12;
      }

      const ms = new Date(year, month - 1, day, hour, minute, second, 0).getTime();
      if (Number.isFinite(ms)) return ms;
    }
  }

  // YYYY-MM-DD HH:MM:SS (space instead of T)
  {
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const hour = Number(m[4]);
      const minute = Number(m[5]);
      const second = Number(m[6] ?? 0);

      const ms = new Date(year, month - 1, day, hour, minute, second, 0).getTime();
      if (Number.isFinite(ms)) return ms;
    }
  }

  // Last resort
  {
    const ms = new Date(s).getTime();
    if (Number.isFinite(ms)) return ms;
  }

  return undefined;
}

export function nextOccurrenceLocal(targetMs: number, nowMs: number): number {
  const dayMs = 24 * 60 * 60 * 1000;
  let t = targetMs;
  while (t <= nowMs) t += dayMs;
  return t;
}

export function advanceEarthTimer(timer: EarthTimer, nowMs: number): EarthTimer {
  return timer.repeatDaily === false
    ? { ...timer, enabled: false }
    : { ...timer, targetEarthMs: nextOccurrenceLocal(timer.targetEarthMs, nowMs) };
}

// -------------------- Duration parsing --------------------

/**
 * Parse a duration string into milliseconds.
 *
 * Supported:
 * - `H:MM:SS` (e.g. `1:45:55`)
 * - `HH:MM:SS`
 * - `MM:SS`
 * - `2h`, `2.5h`, `5m`, `10s`
 * - `1h45m55s` (any order of h/m/s)
 */
export function parseDurationToMs(raw: string): number | undefined {
  const s = raw.trim();
  if (!s) return undefined;

  // Colon formats
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => p.trim());
    if (parts.some((p) => p === "" || !/^-?\d+(?:\.\d+)?$/.test(p))) return undefined;

    if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const sec = Number(parts[2]);
      const ms = (h * 3600 + m * 60 + sec) * 1000;
      return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
    }

    if (parts.length === 2) {
      const m = Number(parts[0]);
      const sec = Number(parts[1]);
      const ms = (m * 60 + sec) * 1000;
      return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
    }

    return undefined;
  }

  // Simple unit formats: 2h / 5m / 10s
  {
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([hms])$/i);
    if (m) {
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      if (!Number.isFinite(n) || n < 0) return undefined;
      const mult = unit === "h" ? 3600_000 : unit === "m" ? 60_000 : 1000;
      return Math.round(n * mult);
    }
  }

  // Composite like 1h45m55s
  {
    // Whole string must consist only of unit tokens (optionally space-separated),
    // e.g. "1h45m55s", "1h 45m 55s". Reject any trailing/garbage characters.
    if (!/^\s*(?:-?\d+(?:\.\d+)?\s*[hms]\s*)+$/i.test(s)) return undefined;

    const re = /(-?\d+(?:\.\d+)?)\s*([hms])/gi;
    let match: RegExpExecArray | null;
    let found = false;
    let total = 0;
    while ((match = re.exec(s))) {
      found = true;
      const n = Number(match[1]);
      const unit = match[2].toLowerCase();
      if (!Number.isFinite(n) || n < 0) return undefined;
      const mult = unit === "h" ? 3600_000 : unit === "m" ? 60_000 : 1000;
      total += n * mult;
    }
    if (found) {
      const ms = Math.round(total);
      return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
    }
  }

  return undefined;
}
import type { EarthTimer } from "../types";
