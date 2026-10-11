// src/utils/guilds.ts
import { VanaWeekday } from "../vanadiel";
import { WEEKDAYS } from "./weekday";

function mod(n: number, m: number): number {
  const r = n % m;
  return r < 0 ? r + m : r;
}

export type VanaNowLite = {
  weekday: VanaWeekday;
  hour: number;
  minute: number;
};

export type PrepTarget = {
  targetWeekday: VanaWeekday;
  targetHour: number;
  targetMinute: number;
};

export type GuildSchedule = {
  openHour: number; // 0..23
  openMinute?: number; // default 0
  closedOn?: VanaWeekday | null; // holiday weekday closure, optional
};

export type GuildPreset = {
  id:
    | "WOODWORKING"
    | "CLOTHCRAFT"
    | "SMITHING"
    | "GOLDSMITHING"
    | "BONECRAFT"
    | "ALCHEMY"
    | "ALCHEMY_WHITEGATE"
    | "COOKING"
    | "FISHING"
    | "FISHING_WHITEGATE"
    | "LEATHERCRAFT";
  label: string;
  schedule: GuildSchedule;
  closeHour: number;
  closeMinute?: number;
};

export const GUILD_COLORS: Record<GuildPreset["id"] | "TENSHODO", string> = {
  WOODWORKING: "#8ed08b",
  CLOTHCRAFT: "#efa6d2",
  SMITHING: "#aebdce",
  GOLDSMITHING: "#e6c35c",
  BONECRAFT: "#e8dcc0",
  ALCHEMY: "#66d9bd",
  ALCHEMY_WHITEGATE: "#66d9bd",
  COOKING: "#ffab70",
  FISHING: "#79bfff",
  FISHING_WHITEGATE: "#79bfff",
  LEATHERCRAFT: "#c99c72",
  TENSHODO: "#bda0ed",
};

export const GUILD_PRESETS: GuildPreset[] = [
  {
    id: "WOODWORKING",
    label: "Woodworking Guild",
    schedule: { openHour: 6, openMinute: 0, closedOn: "Firesday" },
    closeHour: 21,
    closeMinute: 0,
  },
  {
    id: "CLOTHCRAFT",
    label: "Clothcraft Guild",
    schedule: { openHour: 6, openMinute: 0, closedOn: "Firesday" },
    closeHour: 21,
    closeMinute: 0,
  },
  {
    id: "SMITHING",
    label: "Smithing Guild",
    schedule: { openHour: 8, openMinute: 0, closedOn: "Watersday" },
    closeHour: 23,
    closeMinute: 0,
  },
  {
    id: "GOLDSMITHING",
    label: "Goldsmithing Guild",
    schedule: { openHour: 8, openMinute: 0, closedOn: "Iceday" },
    closeHour: 23,
    closeMinute: 0,
  },
  {
    id: "BONECRAFT",
    label: "Bonecraft Guild",
    schedule: { openHour: 8, openMinute: 0, closedOn: "Windsday" },
    closeHour: 23,
    closeMinute: 0,
  },
  {
    id: "ALCHEMY",
    label: "Alchemy Guild",
    schedule: { openHour: 8, openMinute: 0, closedOn: "Lightsday" },
    closeHour: 23,
    closeMinute: 0,
  },
  {
    id: "ALCHEMY_WHITEGATE",
    label: "Alchemy Guild — Whitegate",
    schedule: { openHour: 8, openMinute: 0, closedOn: "Lightningday" },
    closeHour: 23,
    closeMinute: 0,
  },
  {
    id: "COOKING",
    label: "Cooking Guild",
    schedule: { openHour: 5, openMinute: 0, closedOn: "Darksday" },
    closeHour: 20,
    closeMinute: 0,
  },
  {
    id: "FISHING",
    label: "Fishing Guild",
    schedule: { openHour: 3, openMinute: 0, closedOn: "Lightningday" },
    closeHour: 18,
    closeMinute: 0,
  },
  {
    id: "FISHING_WHITEGATE",
    label: "Fishing Guild — Whitegate",
    schedule: { openHour: 1, openMinute: 0, closedOn: "Lightsday" },
    closeHour: 18,
    closeMinute: 0,
  },
  {
    id: "LEATHERCRAFT",
    label: "Leathercraft Guild",
    schedule: { openHour: 3, openMinute: 0, closedOn: "Iceday" },
    closeHour: 18,
    closeMinute: 0,
  },
];

export function nextGuildAlertTarget(now: VanaNowLite, schedule: GuildSchedule, offsetHours: number): PrepTarget {
  const openMinute = schedule.openMinute ?? 0;
  const closedOn = schedule.closedOn ?? null;

  const offset = Math.max(0, Math.min(23, Math.floor(Number.isFinite(offsetHours) ? offsetHours : 0)));
  const offsetMinutes = offset * 60;

  const weekMinutes = WEEKDAYS.length * 24 * 60; // 8 * 1440
  const nowDayIndex = WEEKDAYS.indexOf(now.weekday);
  const nowAbsMinutes = nowDayIndex * 24 * 60 + now.hour * 60 + now.minute;

  let bestFireAbsMinutes = Number.POSITIVE_INFINITY;

  // Consider the next occurrence of "open" for each weekday (within the next week).
  // Pick the earliest *fire* time in the future.
  for (const d of WEEKDAYS) {
    if (closedOn && d === closedOn) continue;

    const dayIndex = WEEKDAYS.indexOf(d);
    let openAbsMinutes = dayIndex * 24 * 60 + schedule.openHour * 60 + openMinute;

    // Ensure this open is in the future (else it refers to next week's same weekday).
    if (openAbsMinutes <= nowAbsMinutes) openAbsMinutes += weekMinutes;

    let fireAbsMinutes = openAbsMinutes - offsetMinutes;

    // If we're already past the ideal alert time, but not past open, fire at open.
    if (fireAbsMinutes <= nowAbsMinutes) fireAbsMinutes = openAbsMinutes;

    if (fireAbsMinutes < bestFireAbsMinutes) bestFireAbsMinutes = fireAbsMinutes;
  }

  // Fallback: if offset is extremely large or the loop found nothing (should be rare),
  // schedule the earliest possible fire by taking the next open and subtracting.
  if (!Number.isFinite(bestFireAbsMinutes)) {
    for (const d of WEEKDAYS) {
      if (closedOn && d === closedOn) continue;
      const dayIndex = WEEKDAYS.indexOf(d);
      let openAbsMinutes = dayIndex * 24 * 60 + schedule.openHour * 60 + openMinute;
      if (openAbsMinutes <= nowAbsMinutes) openAbsMinutes += weekMinutes;
      let fireAbsMinutes = openAbsMinutes - offsetMinutes;
      if (fireAbsMinutes <= nowAbsMinutes) fireAbsMinutes = openAbsMinutes;
      if (fireAbsMinutes < bestFireAbsMinutes) bestFireAbsMinutes = fireAbsMinutes;
    }
  }

  const normalized = mod(bestFireAbsMinutes, weekMinutes);
  const targetDayIndex = Math.floor(normalized / (24 * 60));
  const dayMinutes = normalized % (24 * 60);
  const targetHour = Math.floor(dayMinutes / 60);
  const targetMinute = dayMinutes % 60;

  return {
    targetWeekday: WEEKDAYS[targetDayIndex],
    targetHour,
    targetMinute,
  };
}

/**
 * Cooking Guild:
 * - opens 05:00
 * - closed on Darksday
 */
export function nextCookingGuildPrepTarget(now: VanaNowLite): PrepTarget {
  const cookingGuild = GUILD_PRESETS.find((guild) => guild.id === "COOKING");
  if (!cookingGuild) {
    throw new Error("Cooking guild preset is missing.");
  }

  return nextGuildAlertTarget(
    now,
    cookingGuild.schedule,
    1
  );
}

/**
 * Leathercraft Guild:
 * - opens 03:00
 * - closed on Iceday
 */
export function nextLeathercraftGuildPrepTarget(now: VanaNowLite): PrepTarget {
  const leathercraftGuild = GUILD_PRESETS.find((guild) => guild.id === "LEATHERCRAFT");
  if (!leathercraftGuild) {
    throw new Error("Leathercraft guild preset is missing.");
  }

  return nextGuildAlertTarget(
    now,
    leathercraftGuild.schedule,
    2
  );
}

/**
 * Clothcraft Guild:
 * - opens 06:00
 * - closed on Firesday
 */
export function nextClothcraftGuildPrepTarget(now: VanaNowLite): PrepTarget {
  const clothcraftGuild = GUILD_PRESETS.find((guild) => guild.id === "CLOTHCRAFT");
  if (!clothcraftGuild) {
    throw new Error("Clothcraft guild preset is missing.");
  }

  // Back-compat default: 1 hour before open
  return nextGuildAlertTarget(
    now,
    clothcraftGuild.schedule,
    1
  );
}

// ---------- Tenshodo ----------

export type TenshodoPreset = {
  id: "TENSHODO";
  label: string; // merged label for UI/timers
  schedule: GuildSchedule;
  locations: string[];
};

type TenshodoLocation = {
  name: string;
  schedule: GuildSchedule;
};

const TENSHODO_LOCATIONS: TenshodoLocation[] = [
  {
    name: "Lower Jeuno",
    schedule: { openHour: 1, openMinute: 0, closedOn: "Earthsday" },
  },
  {
    name: "Port Bastok",
    schedule: { openHour: 1, openMinute: 0, closedOn: "Iceday" },
  },
  {
    name: "Norg",
    schedule: { openHour: 9, openMinute: 0, closedOn: "Darksday" },
  },
];

/**
 * Merge locations iff they share the *same* open time + holiday (closedOn) + prepLead.
 */
export function buildTenshodoPresets(): TenshodoPreset[] {
  const groups = new Map<
    string,
    {
      schedule: GuildSchedule;
      locations: string[];
    }
  >();

  for (const loc of TENSHODO_LOCATIONS) {
    const s = loc.schedule;
    const key = [
      `open:${s.openHour}:${s.openMinute ?? 0}`,
      `closed:${s.closedOn ?? "none"}`,
    ].join("|");

    const existing = groups.get(key);
    if (existing) {
      existing.locations.push(loc.name);
    } else {
      groups.set(key, { schedule: s, locations: [loc.name] });
    }
  }

  const presets: TenshodoPreset[] = [];
  for (const [, g] of groups) {
    const locLabel = g.locations.join(" + ");
    const closed = g.schedule.closedOn ? ` (closed ${g.schedule.closedOn})` : "";
    presets.push({
      id: "TENSHODO",
      label: `Tenshodo — ${locLabel}${closed}`,
      schedule: g.schedule,
      locations: g.locations,
    });
  }

  // Keep a stable order: Jeuno/Bastok first (open 1), then Norg (open 9)
  presets.sort((a, b) => (a.schedule.openHour ?? 0) - (b.schedule.openHour ?? 0));
  return presets;
}

export function nextTenshodoPrepTargets(now: VanaNowLite): Array<{ label: string } & PrepTarget> {
  const presets = buildTenshodoPresets();
  return presets.map((p) => ({
    label: p.label,
    ...nextGuildAlertTarget(now, p.schedule, 1),
  }));
}
