import type { AnyTimer } from "../types";
import type { RunningTimer } from "../notifications/types";
import {
  type Calibration, nextEarthMsForVanaWeekdayTime, nextEarthMsForVanaDailySchedule,
  nextEarthMsForMoonStep, nextEarthMsForMoonPercent,
} from "../vanadiel";
import { nextGardeningEvent } from "./gardeningTimers";
import { getNextNmLotteryEvent, getNextNmTimedWindowEvent } from "./nm";

export function nextTimerAt(timer: AnyTimer, nowMs: number, cal: Calibration): number | null {
  switch (timer.kind) {
    case "GARDENING":
      return nextGardeningEvent(timer)?.atMs ?? null;
    case "NM_TIMED_WINDOW":
      return getNextNmTimedWindowEvent(timer, nowMs)?.atMs ?? null;
    case "NM_LOTTERY":
      return getNextNmLotteryEvent(timer, nowMs)?.atMs ?? null;
    case "VANA_WEEKDAY_TIME":
      return nextEarthMsForVanaWeekdayTime({
        nowEarthMs: nowMs, cal, targetWeekday: timer.targetWeekday,
        targetHour: timer.targetHour, targetMinute: timer.targetMinute,
      });
    case "TRANSPORT":
      return nextEarthMsForVanaDailySchedule({
        nowEarthMs: nowMs, cal, departureMinutes: timer.departureMinutes, offsetHours: timer.offsetHours,
      });
    case "MOON_STEP":
      return nextEarthMsForMoonStep({ nowEarthMs: nowMs, cal, targetMoonStep: timer.targetMoonStep });
    case "MOON_PERCENT":
      return nextEarthMsForMoonPercent({ nowEarthMs: nowMs, cal, targetPercent: timer.targetPercent });
    case "EARTH_TIME":
      return timer.targetEarthMs;
  }
}

export function runningTimerPreviews(timers: AnyTimer[], nowMs: number, cal: Calibration): RunningTimer[] {
  return timers.flatMap(timer => {
    if (!timer.enabled || (timer.kind === "EARTH_TIME" && timer.pausedRemainingMs != null)) return [];
    const targetEarthMs = nextTimerAt(timer, nowMs, cal);
    return targetEarthMs === null ? [] : [{ id: timer.id, label: timer.label, targetEarthMs }];
  }).sort((first, second) => first.targetEarthMs - second.targetEarthMs);
}
