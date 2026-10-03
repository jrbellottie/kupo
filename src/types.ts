import type { VanaWeekday } from "./vanadiel";

export type TimerKind =
  | "VANA_WEEKDAY_TIME"
  | "TRANSPORT"
  | "MOON_STEP"
  | "MOON_PERCENT"
  | "EARTH_TIME"
  | "NM_TIMED_WINDOW"
  | "NM_LOTTERY";

export type BaseTimer = {
  id: string;
  label: string;
  kind: TimerKind;
  enabled: boolean;
  createdAtMs: number;
};

export type WeekdayTimer = BaseTimer & {
  kind: "VANA_WEEKDAY_TIME";
  targetWeekday: VanaWeekday;
  targetHour: number;
  targetMinute: number;
};

export type TransportTimer = BaseTimer & {
  kind: "TRANSPORT";
  departureMinutes: number[];
  arrivalMinutes?: number[];
  offsetHours: number;
};

export type MoonStepTimer = BaseTimer & {
  kind: "MOON_STEP";
  targetMoonStep: number; // 0..199 (display step)
};

export type MoonPercentTimer = BaseTimer & {
  kind: "MOON_PERCENT";
  targetPercent: number; // legacy only
};

export type EarthTimer = BaseTimer & {
  kind: "EARTH_TIME";
  targetEarthMs: number;
  rawInput: string;
  /** Existing Earth timers repeat daily; exact forecast windows opt out. */
  repeatDaily?: boolean;
  /** When set, the countdown is paused with this much time remaining (ms). */
  pausedRemainingMs?: number | null;
};

export type NmTimedWindowTimer = BaseTimer & {
  kind: "NM_TIMED_WINDOW";
  baseEarthMs: number;
  windowStartOffsetMs: number;
  windowEndOffsetMs: number;
  intervalMs: number | null;
  warnLeadMs: number;
};

export type NmLotteryTimer = BaseTimer & {
  kind: "NM_LOTTERY";
  baseEarthMs: number;
  warnLeadMs: number;
  phRespawnMs: number;
  phNextAtMs: number | null;
};

export type AnyTimer = WeekdayTimer | TransportTimer | MoonStepTimer | MoonPercentTimer | EarthTimer | NmTimedWindowTimer | NmLotteryTimer;

export type MoonDirection = "WAXING" | "WANING";
