// src/AppShell.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { UsersRound, Coins, Pickaxe, PanelTopClose, PanelTopOpen } from "lucide-react";
import {
  Calibration,
  DEFAULT_CALIBRATION,
  VanaWeekday,
  getVanaNow,
  moonDirectionFromStep,
  moonPercentFromStep,
  moonPhaseNameFromStep,
  nextEarthMsForMoonPercent,
  nextEarthMsForMoonStep,
  nextEarthMsForVanaWeekdayTime,
  nextEarthMsForVanaDailySchedule,
  calibrationFromSnapshot,
} from "./vanadiel";
import { styles } from "./styles";
import { ScreenControlsProvider, ScreenControlToggles } from "./ScreenControls";
import { loadJson, saveJson } from "./utils/storage";
import { advanceEarthTimer, formatCountdown, nextOccurrenceLocal, pad2, parseDurationToMs, parseLocalDateTimeToMs, uid } from "./utils/time";
import { createWeatherWindowTimer, type WeatherRow } from "./utils/weather";
import { AnyTimer, MoonDirection } from "./types";
import { WEEKDAYS, WEEKDAY_COLORS, weekdayStyle } from "./utils/weekday";
import { moonDirGlyph, moonGlyphStyle, moonPhaseStyle } from "./utils/moon";
import { buildTenshodoPresets, GUILD_PRESETS, nextGuildAlertTarget } from "./utils/guilds";
import { TRANSPORT_GROUPS, createTransportTimer, formatTransportDepartures, getTransportArrivalMinutes, type TransportPreset } from "./utils/transport";
import { registerTabSwitcher, switchTabWithScroll, setCurrentTab } from "./utils/tabNav";
import { getNextNmLotteryEvent, getNextNmTimedWindowEvent } from "./utils/nm";
import FishTab from "./FishTab";
import ClamTab from "./ClamTab";
import ChocoboTab from "./ChocoboTab";
import WeatherTab from "./WeatherTab";
import StopwatchTab from "./StopwatchTab";
import BcnmTab from "./BcnmTab";
import SkillchainTab from "./SkillchainTab";

const BestiaryTab = React.lazy(() => import("./BestiaryTab"));
const CraftingTab = React.lazy(() => import("./CraftingTab"));
const PrintingTab = React.lazy(() => import("./PrintingTab"));
const QuestsTab = React.lazy(() => import("./QuestsTab"));
const AtlasTab = React.lazy(() => import("./AtlasTab"));
const DropsTab = React.lazy(() => import("./DropsTab"));
const NpcTab = React.lazy(() => import("./NpcTab"));
const HelmTab = React.lazy(() => import("./HelmTab"));

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function stepFromDirectionAndPercent(dir: MoonDirection, pct: number): number {
  const p = clampInt(pct, 0, 100);
  if (p === 100) return 100;
  if (dir === "WAXING") return p;
  if (p === 0) return 0;
  return 200 - p;
}

const optionBaseStyle: React.CSSProperties = {
  backgroundColor: "#0c0c0c",
  color: "#eaeaea",
};

type TenshodoTarget = {
  label: string;
  targetWeekday: VanaWeekday;
  targetHour: number;
  targetMinute: number;
};

type GuildPreview = {
  id: string;
  label: string;
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
  closedOn: VanaWeekday | null;
  targetWeekday: VanaWeekday;
  targetHour: number;
  targetMinute: number;
  nextAt: number;
};

function mergeTenshodoTargets(targets: TenshodoTarget[]): TenshodoTarget[] {
  const map = new Map<string, TenshodoTarget>();

  for (const t of targets) {
    const key = `${t.targetWeekday}|${t.targetHour}|${t.targetMinute}`;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...t });
      continue;
    }

    const parts = existing.label.split(" / ").map((s) => s.trim());
    if (!parts.includes(t.label)) parts.push(t.label);

    map.set(key, {
      ...existing,
      label: parts.join(" / "),
    });
  }

  return Array.from(map.values());
}

const PRESET_OFFSET_MIN = 0;
const PRESET_OFFSET_MAX = 23;

function formatVanaTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** Valid if it parses to a finite, positive duration (e.g. "5m", "2.5h", "1:45:55"). */
function isValidDuration(raw: string): boolean {
  const ms = parseDurationToMs(raw);
  return Number.isFinite(ms as number) && (ms as number) > 0;
}

/**
 * Strict validation for the two ToD formats we advertise:
 *  1. ISO 24-hour:  YYYY-MM-DDTHH:MM:SS  (seconds optional)
 *  2. US 12-hour:   MM/DD/YYYY HH:MM:SS AM/PM  (seconds optional)
 * Range-checks each component and verifies it's a real calendar date
 * (JS Date silently rolls over out-of-range values, so we compare back).
 */
function isValidTod(raw: string): boolean {
  const s = raw.trim();

  let year: number;
  let month: number; // 1..12
  let day: number;
  let hour: number; // 0..23 after AM/PM applied
  let minute: number;
  let second: number;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
    hour = Number(iso[4]);
    minute = Number(iso[5]);
    second = Number(iso[6] ?? 0);
    if (hour > 23) return false;
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
    let h = Number(us[4]);
    minute = Number(us[5]);
    second = Number(us[6] ?? 0);
    const ampm = us[7].toUpperCase();
    if (h < 1 || h > 12) return false;
    if (ampm === "AM") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
    hour = h;
  } else {
    return false;
  }

  // Range checks (hour already validated per-format above).
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (minute > 59) return false;
  if (second > 59) return false;

  // Reject rolled-over dates like Feb 30 by comparing components back.
  const d = new Date(year, month - 1, day, hour, minute, second, 0);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day &&
    d.getHours() === hour &&
    d.getMinutes() === minute &&
    d.getSeconds() === second
  );
}

type TabId = "home" | "timers" | "nm" | "presets" | "counters" | "luShang" | "fish" | "clam" | "chocobo" | "helm" | "weather" | "bcnm" | "drops" | "npc" | "bestiary" | "skillchains" | "crafting" | "printing" | "quests" | "atlas" | "calibration";

type TabDef = {
  id: TabId;
  label: string;
  icon: React.ReactNode;
};

const ENABLE_CALIBRATION_DEV_TAB = false;

const TABS: TabDef[] = [
  { id: "home", label: "Clock & Timers", icon: "🕐" },
  { id: "timers", label: "Time Tools", icon: "⏱️" },
  { id: "nm", label: "NM Timers", icon: "👹" },
  { id: "presets", label: "Presets", icon: "⭐" },
  { id: "counters", label: "Counters", icon: "🔢" },
  { id: "luShang", label: "Lu Shang", icon: "🪝" },
  { id: "fish", label: "Fish", icon: "🐟" },
  { id: "clam", label: "Clam", icon: "🪣" },
  { id: "chocobo", label: "Digging", icon: "🐤" },
  { id: "helm", label: "HELM", icon: <Pickaxe size={18} /> },
  { id: "weather", label: "Weather", icon: "🌦️" },
  { id: "bcnm", label: "BCNM", icon: "⚔️" },
  { id: "skillchains", label: "Skillchains", icon: "🔗" },
  { id: "bestiary", label: "Bestiary", icon: "📖" },
  { id: "drops", label: "Items", icon: "💰" },
  { id: "npc", label: "NPC", icon: <UsersRound size={18} /> },
  { id: "crafting", label: "Crafting", icon: "🔨" },
  { id: "printing", label: "Profits", icon: <Coins size={18} /> },
  { id: "quests", label: "Quests", icon: "📜" },
  { id: "atlas", label: "Atlas", icon: "🗺️" },
  ...(import.meta.env.DEV && ENABLE_CALIBRATION_DEV_TAB
    ? [{ id: "calibration", label: "Calibration", icon: "🛠️" } as TabDef]
    : []),
];

const TAB_IDS: TabId[] = TABS.map((t) => t.id);

type CounterWidgetState = {
  increment: number;
  success: number;
  failure: number;
  hq1: number;
  hq2: number;
  hq3: number;
  nq: number;
  break: number;
};

const COUNTER_INCREMENT_MIN = 1;
const COUNTER_INCREMENT_MAX = 9999;

const COUNTER_COUNT_MIN = 0;
const COUNTER_COUNT_MAX = Number.MAX_SAFE_INTEGER;

const DEFAULT_COUNTERS: CounterWidgetState = {
  increment: 1,
  success: 0,
  failure: 0,
  hq1: 0,
  hq2: 0,
  hq3: 0,
  nq: 0,
  break: 0,
};

type LuShangState = {
  moatCarp: number;
};

const LU_SHANG_GOAL = 10000;
const LU_SHANG_STACK_SIZE = 12;
const LU_SHANG_MIN = 0;
const LU_SHANG_MAX = Number.MAX_SAFE_INTEGER;

const DEFAULT_LU_SHANG: LuShangState = {
  moatCarp: 0,
};

function normalizeLuShangState(raw: unknown): LuShangState {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    moatCarp: clampInt(Number(obj.moatCarp) || 0, LU_SHANG_MIN, LU_SHANG_MAX),
  };
}

function normalizeCounterWidgetState(raw: unknown): CounterWidgetState {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const increment = clampInt(Number(obj.increment) || 1, COUNTER_INCREMENT_MIN, COUNTER_INCREMENT_MAX);
  const success = clampInt(Number(obj.success) || 0, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX);
  const failure = clampInt(Number(obj.failure) || 0, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX);

  // Migration from older installs that stored { hq, nq }.
  const hasNewSynth =
    "hq1" in obj || "hq2" in obj || "hq3" in obj || "nq" in obj || "break" in obj;

  const nq = clampInt(Number(obj.nq) || 0, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX);
  const synthBreak = clampInt(Number(obj.break) || 0, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX);

  let hq1 = clampInt(Number(obj.hq1) || 0, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX);
  let hq2 = clampInt(Number(obj.hq2) || 0, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX);
  let hq3 = clampInt(Number(obj.hq3) || 0, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX);

  if (!hasNewSynth) {
    const oldHq = clampInt(Number((obj as Record<string, unknown>).hq) || 0, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX);
    // Best-effort: treat old aggregate HQ as HQ1 to preserve the main success-rate math.
    hq1 = oldHq;
    hq2 = 0;
    hq3 = 0;
  }

  return {
    ...DEFAULT_COUNTERS,
    increment,
    success,
    failure,
    hq1,
    hq2,
    hq3,
    nq,
    break: synthBreak,
  };
}

export default function AppShell() {
  const [nowMs, setNowMs] = useState(Date.now());

  // Ship a sensible default so most users can skip manual setup.
  // If older installs saved `null`, treat it as "no value" and fall back to defaults.
  const [cal, setCal] = useState<Calibration>(() => {
    const stored = loadJson<Calibration | null>("ffxi_cal_v1", DEFAULT_CALIBRATION);
    return stored ?? DEFAULT_CALIBRATION;
  });
  const [timers, setTimers] = useState<AnyTimer[]>(() => loadJson<AnyTimer[]>("ffxi_timers_v2", []));
  const activeTimerIds = useMemo(() => new Set(timers.filter(timer => timer.enabled).map(timer => timer.id)), [timers]);

  const [showCalibration, setShowCalibration] = useState<boolean>(() => loadJson<boolean>("ffxi_show_cal_v1", false));

  const [presetOffsetHours, setPresetOffsetHours] = useState<number>(() =>
    clampInt(loadJson<number>("ffxi_preset_offset_hours_v1", 2), PRESET_OFFSET_MIN, PRESET_OFFSET_MAX)
  );

  const [counters, setCounters] = useState<CounterWidgetState>(() =>
    normalizeCounterWidgetState(loadJson<unknown>("ffxi_counters_v1", DEFAULT_COUNTERS))
  );

  const [luShang, setLuShang] = useState<LuShangState>(() =>
    normalizeLuShangState(loadJson<unknown>("ffxi_lu_shang_v1", DEFAULT_LU_SHANG))
  );

  const [luSinglesInput, setLuSinglesInput] = useState("100");
  const [luStacksInput, setLuStacksInput] = useState("10");
  const [luSetTotalInput, setLuSetTotalInput] = useState("");

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const stored = loadJson<string>("ffxi_active_tab_v1", "home");
    if (stored === "stopwatch") return "timers";
    if (stored === "bait" || stored === "rods") return "fish";
    return TAB_IDS.includes(stored as TabId) ? stored as TabId : "home";
  });
  useEffect(() => setCurrentTab(activeTab), [activeTab]);

  const [headerCollapsed, setHeaderCollapsed] = useState(() =>
    loadJson<boolean>("ffxi_header_collapsed_v1", false) === true
  );
  useEffect(() => saveJson("ffxi_header_collapsed_v1", headerCollapsed), [headerCollapsed]);

  const [cWeekday, setCWeekday] = useState<VanaWeekday>("Firesday");
  const [cHour, setCHour] = useState("0");
  const [cMin, setCMin] = useState("0");

  const [newMoonInput, setNewMoonInput] = useState("");

  const [tLabel, setTLabel] = useState("Timer");
  const [tWeekday, setTWeekday] = useState<VanaWeekday>("Earthsday");
  const [tHour, setTHour] = useState("1");
  const [tMin, setTMin] = useState("0");

  const [rLabel, setRLabel] = useState("Real Life Timer");
  const [rMode, setRMode] = useState<"IN" | "AT">("IN");
  const [rDuration, setRDuration] = useState("5m");
  const [rWhen, setRWhen] = useState(() => {
    const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  });

  const [mLabel, setMLabel] = useState("Moon Timer");
  const [mDir, setMDir] = useState<MoonDirection>("WAXING");
  const [mPercent, setMPercent] = useState("19");

  const [nmMode, setNmMode] = useState<"TIMED_WINDOW" | "LOTTERY">("TIMED_WINDOW");
  const [nmLabel, setNmLabel] = useState("NM Timer");
  const [nmWarnLead, setNmWarnLead] = useState("10s");
  const [nmTodInput, setNmTodInput] = useState("");

  // Timed spawn window
  const [nmWindowStart, setNmWindowStart] = useState("2h");
  const [nmWindowEnd, setNmWindowEnd] = useState("2.5h");
  const [nmWindowInterval, setNmWindowInterval] = useState("5m");

  // Lottery NM (window open + PH respawn)
  const [nmPhRespawn, setNmPhRespawn] = useState("5m");

  function formatLocalDateTimeLikeInput(ms: number): string {
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  }

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => saveJson("ffxi_cal_v1", cal), [cal]);
  useEffect(() => saveJson("ffxi_timers_v2", timers), [timers]);
  useEffect(() => saveJson("ffxi_show_cal_v1", showCalibration), [showCalibration]);
  useEffect(() => saveJson("ffxi_preset_offset_hours_v1", presetOffsetHours), [presetOffsetHours]);
  useEffect(() => saveJson("ffxi_counters_v1", counters), [counters]);
  useEffect(() => saveJson("ffxi_lu_shang_v1", luShang), [luShang]);
  useEffect(() => saveJson("ffxi_active_tab_v1", activeTab), [activeTab]);

  useEffect(() => {
    registerTabSwitcher((tab) => {
      if (TAB_IDS.includes(tab as TabId)) setActiveTab(tab as TabId);
    });
  }, []);

  // Flash the "Clock & Timers" tab when a new timer is added, so the user can
  // see where the timer landed (especially when adding from another tab).
  const [homeTabFlash, setHomeTabFlash] = useState(false);
  const prevTimerCountRef = useRef(timers.length);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (timers.length > prevTimerCountRef.current) {
      // Restart the animation even if it's already running: remove the class,
      // then re-add it on the next frame so the CSS animation replays.
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      if (flashRafRef.current) cancelAnimationFrame(flashRafRef.current);

      setHomeTabFlash(false);
      flashRafRef.current = requestAnimationFrame(() => {
        flashRafRef.current = requestAnimationFrame(() => {
          setHomeTabFlash(true);
          flashTimeoutRef.current = setTimeout(() => setHomeTabFlash(false), 1500);
        });
      });
    }
    prevTimerCountRef.current = timers.length;
  }, [timers.length]);
  useEffect(() => () => {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    if (flashRafRef.current) cancelAnimationFrame(flashRafRef.current);
  }, []);

  const hasEnabledTimers = useMemo(() => timers.some((t) => t.enabled), [timers]);
  useEffect(() => {
    window.electron?.ipcRenderer?.send?.("ffxi:keepAwake", { enabled: hasEnabledTimers });
  }, [hasEnabledTimers]);

  const now = useMemo(() => getVanaNow(nowMs, cal), [nowMs, cal]);
  const nowMoonDir = moonDirectionFromStep(now.moonStep);

  const nextMoonAt = now.nextMoonStepAtEarthMs;
  const msUntilNextMoonStep = nextMoonAt - nowMs;

  const nextMoonLabel = useMemo(() => {
    const after = getVanaNow(nextMoonAt + 25, cal);
    return {
      phase: after.moonPhaseName,
      pct: after.moonPercent,
      dir: moonDirectionFromStep(after.moonStep),
    };
  }, [nextMoonAt, cal]);

  const guildPreviews = useMemo(() => {
    return GUILD_PRESETS.map((guild): GuildPreview => {
      const target = nextGuildAlertTarget(now, guild.schedule, presetOffsetHours);
      const nextAt = nextEarthMsForVanaWeekdayTime({
        nowEarthMs: nowMs,
        cal,
        targetWeekday: target.targetWeekday,
        targetHour: target.targetHour,
        targetMinute: target.targetMinute,
      });

      return {
        id: guild.id,
        label: guild.label,
        openHour: guild.schedule.openHour,
        openMinute: guild.schedule.openMinute ?? 0,
        closeHour: guild.closeHour,
        closeMinute: guild.closeMinute ?? 0,
        closedOn: guild.schedule.closedOn ?? null,
        ...target,
        nextAt,
      };
    });
  }, [now, nowMs, cal, presetOffsetHours]);

  const tenshodoPreviews = useMemo(() => {
    const presets = buildTenshodoPresets();
    const rawTargets = presets.map((p) => ({
      label: p.label,
      ...nextGuildAlertTarget(now, p.schedule, presetOffsetHours),
    })) as TenshodoTarget[];

    const mergedTargets = mergeTenshodoTargets(rawTargets);

    return mergedTargets.map((t) => {
      const nextAt = nextEarthMsForVanaWeekdayTime({
        nowEarthMs: nowMs,
        cal,
        targetWeekday: t.targetWeekday,
        targetHour: t.targetHour,
        targetMinute: t.targetMinute,
      });
      return { ...t, nextAt };
    });
  }, [now, nowMs, cal, presetOffsetHours]);

  const nextDayPreview = useMemo(() => {
    const target = nextGuildAlertTarget(now, { openHour: 0, openMinute: 0, closedOn: null }, presetOffsetHours);
    const nextAt = nextEarthMsForVanaWeekdayTime({
      nowEarthMs: nowMs,
      cal,
      targetWeekday: target.targetWeekday,
      targetHour: target.targetHour,
      targetMinute: target.targetMinute,
    });
    return { ...target, nextAt };
  }, [now, nowMs, cal, presetOffsetHours]);

  const transportPreviews = useMemo(() => TRANSPORT_GROUPS.map((group) => ({
    ...group,
    routes: group.routes.map((route) => {
      const nextAt = nextEarthMsForVanaDailySchedule({
        nowEarthMs: nowMs,
        cal,
        departureMinutes: route.departureMinutes,
        offsetHours: presetOffsetHours,
      });
      const departureAt = nextAt + presetOffsetHours * 144_000;
      const nextDepartureAt = nextEarthMsForVanaDailySchedule({
        nowEarthMs: nowMs,
        cal,
        departureMinutes: route.departureMinutes,
        offsetHours: 0,
      });
      const nextArrivalAt = nextEarthMsForVanaDailySchedule({
        nowEarthMs: nowMs,
        cal,
        departureMinutes: route.arrivalMinutes,
        offsetHours: 0,
      });
      return {
        ...route, nextAt, departureAt, nextDepartureAt, nextArrivalAt,
        alertVana: getVanaNow(nextAt, cal),
        departureVana: getVanaNow(departureAt, cal),
        nextDepartureVana: getVanaNow(nextDepartureAt, cal),
        nextArrivalVana: getVanaNow(nextArrivalAt, cal),
      };
    }),
  })), [nowMs, cal, presetOffsetHours]);

  useEffect(() => {
    if (!window.electron?.ipcRenderer?.on) return;

    const handler = (payload: { id: string }) => {
      setTimers((prev) => prev.map((t) => (t.id === payload.id ? { ...t, enabled: false } : t)));
    };

    window.electron.ipcRenderer.on("ffxi:timerDismissed", handler);
    return () => window.electron?.ipcRenderer?.off?.("ffxi:timerDismissed", handler);
  }, []);

  const lastFireRef = useRef<Record<string, number>>({});
  const lastTickRef = useRef<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const nowMs2 = Date.now();
      const prevMs = lastTickRef.current;
      lastTickRef.current = nowMs2;

      const maxCatchupMs = 5 * 60 * 1000;
      const effectivePrevMs = nowMs2 - prevMs > maxCatchupMs ? nowMs2 - maxCatchupMs : prevMs;

      const timedWindowExpiredIds: string[] = [];
      const lotteryClearPhIds: string[] = [];

      for (const t of timers) {
        if (!t.enabled) continue;

        // Paused countdowns don't fire.
        if (t.kind === "EARTH_TIME" && t.pausedRemainingMs != null) continue;

        // NM timers have multiple internal events (warn + pop), so they use a different scheduler.
        let event:
          | {
              atMs: number;
              title: string;
              body: string;
              fireKey: string;
              repeat?: boolean;
              action?: { type: "NM_LOTTERY_CLEAR_PH" };
            }
          | null = null;

        if (t.kind === "NM_TIMED_WINDOW") {
          const endAt = t.baseEarthMs + t.windowEndOffsetMs;
          if (nowMs2 > endAt + 60_000) {
            timedWindowExpiredIds.push(t.id);
            continue;
          }

          event = getNextNmTimedWindowEvent(t, effectivePrevMs);
          if (event) event = { ...event, repeat: false };
        } else if (t.kind === "NM_LOTTERY") {
          if (t.phNextAtMs !== null && nowMs2 > t.phNextAtMs + 60_000) {
            lotteryClearPhIds.push(t.id);
          }

          event = getNextNmLotteryEvent(t, effectivePrevMs);
          if (event) event = { ...event, repeat: false };
        }

        if (!event && (t.kind === "NM_TIMED_WINDOW" || t.kind === "NM_LOTTERY")) {
          continue;
        }

        // All other timer kinds behave like "one next due time".
        if (!event) {
          let dueAt: number;

          if (t.kind === "VANA_WEEKDAY_TIME") {
            dueAt = nextEarthMsForVanaWeekdayTime({
              nowEarthMs: effectivePrevMs,
              cal,
              targetWeekday: t.targetWeekday,
              targetHour: t.targetHour,
              targetMinute: t.targetMinute,
            });
          } else if (t.kind === "TRANSPORT") {
            dueAt = nextEarthMsForVanaDailySchedule({
              nowEarthMs: effectivePrevMs,
              cal,
              departureMinutes: t.departureMinutes,
              offsetHours: t.offsetHours,
            });
          } else if (t.kind === "MOON_STEP") {
            dueAt = nextEarthMsForMoonStep({
              nowEarthMs: effectivePrevMs,
              cal,
              targetMoonStep: t.targetMoonStep,
            });
          } else if (t.kind === "MOON_PERCENT") {
            dueAt = nextEarthMsForMoonPercent({
              nowEarthMs: effectivePrevMs,
              cal,
              targetPercent: t.targetPercent,
            });
          } else if (t.kind === "EARTH_TIME") {
            dueAt = t.targetEarthMs;
          } else {
            continue;
          }

          event = {
            atMs: dueAt,
            title: "Kupo",
            body: t.kind === "TRANSPORT"
              ? `${t.label} ${t.offsetHours === 0 ? "departs now" : `departs in ${t.offsetHours} Vana hours`}! (click to stop)`
              : `${t.label} is due now! (click to stop)`,
            fireKey: "due",
            repeat: true,
          };
        }

        if (event.atMs <= nowMs2) {
          const fireKey = `${t.id}|${event.fireKey}`;
          const last = lastFireRef.current[fireKey] ?? 0;
          if (nowMs2 - last > 10_000) {
            lastFireRef.current[fireKey] = nowMs2;

            window.electron?.ipcRenderer?.send("ffxi:notify", {
              id: t.id,
              title: event.title,
              body: event.body,
              repeat: event.repeat,
            });
          }

          if (t.kind === "EARTH_TIME") {
            setTimers((prev) =>
              prev.map((x) => {
                if (x.id !== t.id || x.kind !== "EARTH_TIME") return x;
                return advanceEarthTimer(x, nowMs2);
              })
            );
          }

          if (t.kind === "NM_LOTTERY" && event.action?.type === "NM_LOTTERY_CLEAR_PH") {
            lotteryClearPhIds.push(t.id);
          }
        }
      }

      if (timedWindowExpiredIds.length > 0 || lotteryClearPhIds.length > 0) {
        setTimers((prev) =>
          prev.map((x) => {
            if (timedWindowExpiredIds.includes(x.id)) return { ...x, enabled: false };
            if (lotteryClearPhIds.includes(x.id) && x.kind === "NM_LOTTERY") return { ...x, phNextAtMs: null };
            return x;
          })
        );
      }
    }, 250);

    return () => clearInterval(id);
  }, [timers, cal]);

  function saveDayCalibration() {
    const snapshotEarthMs = Date.now();
    const existingMoon = cal.newMoonStartEarthMs;

    const calObj = calibrationFromSnapshot({
      snapshotEarthMs,
      weekday: cWeekday,
      hour: Number(cHour) || 0,
      minute: Number(cMin) || 0,
      newMoonStartEarthMs: existingMoon,
    });

    setCal(calObj);
    setShowCalibration(false);
  }

  function saveMoonCalibration() {
    if (!newMoonInput.trim()) {
      alert("Enter New Moon Start first.");
      return;
    }

    const newMoonStartEarthMs = parseLocalDateTimeToMs(newMoonInput);
    if (!Number.isFinite(newMoonStartEarthMs as number)) {
      alert("Invalid New Moon time.");
      return;
    }

    setCal({
      timeOffsetMs: cal.timeOffsetMs,
      newMoonStartEarthMs: newMoonStartEarthMs as number,
    });

    setShowCalibration(false);
  }

  function clearCalibration() {
    // Revert to baked-in defaults (users can still manually recalibrate if desired).
    setCal(DEFAULT_CALIBRATION);
    setShowCalibration(true);
  }

  function addWeekdayTimer() {
    const hh = clampInt(Number(tHour) || 0, 0, 23);
    const mm = clampInt(Number(tMin) || 0, 0, 59);

    setTimers((prev) => [
      {
        id: uid(),
        kind: "VANA_WEEKDAY_TIME",
        label: tLabel.trim() || "Timer",
        enabled: true,
        createdAtMs: Date.now(),
        targetWeekday: tWeekday,
        targetHour: hh,
        targetMinute: mm,
      },
      ...prev,
    ]);
  }

  function addWeatherTimer(row: WeatherRow, digMode: boolean) {
    const nowT = Date.now();
    if (!Number.isFinite(row.startEarthMs) || row.startEarthMs <= nowT) {
      alert("This weather window has already started. Choose an upcoming window.");
      return;
    }
    const timer = createWeatherWindowTimer(row, digMode, nowT);
    setTimers(prev => [timer, ...prev.filter(existing => existing.id !== timer.id)]);
  }

  function addRealLifeTimer() {
    const ms = parseLocalDateTimeToMs(rWhen);
    if (!Number.isFinite(ms as number)) {
      alert("Invalid real life time.");
      return;
    }
    const nextMs = nextOccurrenceLocal(ms as number, Date.now());

    setTimers((prev) => [
      {
        id: uid(),
        kind: "EARTH_TIME",
        label: rLabel.trim() || "Real Life Timer",
        enabled: true,
        createdAtMs: Date.now(),
        targetEarthMs: nextMs,
        rawInput: rWhen,
      },
      ...prev,
    ]);
  }

  function addCountdownTimer() {
    const durMs = parseDurationToMs(rDuration);
    if (!Number.isFinite(durMs as number) || (durMs as number) <= 0) {
      alert("Invalid countdown duration.");
      return;
    }
    const nowT = Date.now();

    setTimers((prev) => [
      {
        id: uid(),
        kind: "EARTH_TIME",
        label: rLabel.trim() || `Countdown (${rDuration.trim()})`,
        enabled: true,
        createdAtMs: nowT,
        targetEarthMs: nowT + (durMs as number),
        rawInput: rDuration,
      },
      ...prev,
    ]);
  }

  /** Restart a countdown timer (EARTH_TIME whose rawInput is a duration) from now. */
  function resetCountdownTimer(id: string) {
    const nowT = Date.now();
    setTimers((prev) =>
      prev.map((x) => {
        if (x.id !== id || x.kind !== "EARTH_TIME") return x;
        const durMs = parseDurationToMs(x.rawInput);
        if (!Number.isFinite(durMs as number) || (durMs as number) <= 0) return x;
        return { ...x, targetEarthMs: nowT + (durMs as number), enabled: true, pausedRemainingMs: null };
      })
    );
  }

  function pauseCountdownTimer(id: string) {
    const nowT = Date.now();
    setTimers((prev) =>
      prev.map((x) => {
        if (x.id !== id || x.kind !== "EARTH_TIME" || x.pausedRemainingMs != null) return x;
        return { ...x, pausedRemainingMs: Math.max(0, x.targetEarthMs - nowT) };
      })
    );
  }

  function resumeCountdownTimer(id: string) {
    const nowT = Date.now();
    setTimers((prev) =>
      prev.map((x) => {
        if (x.id !== id || x.kind !== "EARTH_TIME" || x.pausedRemainingMs == null) return x;
        return { ...x, targetEarthMs: nowT + x.pausedRemainingMs, pausedRemainingMs: null };
      })
    );
  }

  function addGuildTimer(guild: GuildPreview) {
    setTimers((prev) => [
      {
        id: uid(),
        kind: "VANA_WEEKDAY_TIME",
        label: `${guild.label} (offset ${presetOffsetHours}h) — ${guild.targetWeekday} ${pad2(guild.targetHour)}:${pad2(
          guild.targetMinute
        )}`,
        enabled: true,
        createdAtMs: Date.now(),
        targetWeekday: guild.targetWeekday,
        targetHour: guild.targetHour,
        targetMinute: guild.targetMinute,
      },
      ...prev,
    ]);
  }

  function addTransportTimer(route: TransportPreset) {
    const timer = createTransportTimer(route, presetOffsetHours, Date.now());
    setTimers((prev) => [timer, ...prev]);
  }

  function addTenshodoTimers() {
    const presets = buildTenshodoPresets();
    const rawTargets = presets.map((p) => ({
      label: p.label,
      ...nextGuildAlertTarget(now, p.schedule, presetOffsetHours),
    })) as TenshodoTarget[];

    const mergedTargets = mergeTenshodoTargets(rawTargets);

    setTimers((prev) => [
      ...mergedTargets.map((t) => ({
        id: uid(),
        kind: "VANA_WEEKDAY_TIME" as const,
        label: `${t.label} (offset ${presetOffsetHours}h) — ${t.targetWeekday} ${pad2(t.targetHour)}:${pad2(
          t.targetMinute
        )}`,
        enabled: true,
        createdAtMs: Date.now(),
        targetWeekday: t.targetWeekday,
        targetHour: t.targetHour,
        targetMinute: t.targetMinute,
      })),
      ...prev,
    ]);
  }

  function addNextDayTimer() {
    const target = nextGuildAlertTarget(now, { openHour: 0, openMinute: 0, closedOn: null }, presetOffsetHours);
    setTimers((prev) => [
      {
        id: uid(),
        kind: "VANA_WEEKDAY_TIME",
        label: `Next Day (offset ${presetOffsetHours}h) - ${target.targetWeekday} ${pad2(target.targetHour)}:${pad2(target.targetMinute)}`,
        enabled: true,
        createdAtMs: Date.now(),
        targetWeekday: target.targetWeekday,
        targetHour: target.targetHour,
        targetMinute: target.targetMinute,
      },
      ...prev,
    ]);
  }

  function addMoonTimer() {
    const pct = clampInt(Number(mPercent) || 0, 0, 100);
    const step = stepFromDirectionAndPercent(mDir, pct);

    const displayPct = moonPercentFromStep(step);
    const dir = moonDirectionFromStep(step);
    const phase = moonPhaseNameFromStep(step);

    setTimers((prev) => [
      {
        id: uid(),
        kind: "MOON_STEP",
        label: (mLabel.trim() || "Moon Timer") + ` (${moonDirGlyph(dir)} ${dir} ${displayPct}%, ${phase}, step ${step})`,
        enabled: true,
        createdAtMs: Date.now(),
        targetMoonStep: step,
      },
      ...prev,
    ]);
  }

  function addNmTimedWindowTimer() {
    const warnLeadMs = parseDurationToMs(nmWarnLead) ?? 10_000;
    const startMs = parseDurationToMs(nmWindowStart);
    const endMs = parseDurationToMs(nmWindowEnd);
    const hasInterval = nmWindowInterval.trim() !== "";
    const intervalMs = hasInterval ? parseDurationToMs(nmWindowInterval) : null;

    if (
      !Number.isFinite(startMs as number) ||
      !Number.isFinite(endMs as number) ||
      (hasInterval && !Number.isFinite(intervalMs as number))
    ) {
      alert("Invalid NM window values. Try: 2h, 2.5h, 5m, or 1:45:55. Leave interval blank if NM has no interval.");
      return;
    }

    if ((endMs as number) < (startMs as number)) {
      alert("Window end must be >= window start.");
      return;
    }

    const createdAtMs = Date.now();
    const baseEarthMsRaw = nmTodInput.trim() ? parseLocalDateTimeToMs(nmTodInput) : undefined;
    if (nmTodInput.trim() && !Number.isFinite(baseEarthMsRaw as number)) {
      alert("Invalid ToD time. Leave blank for now, or use formats like YYYY-MM-DDTHH:MM:SS or MM/DD/YYYY HH:MM:SS AM.");
      return;
    }
    const baseEarthMs = Number.isFinite(baseEarthMsRaw as number) ? (baseEarthMsRaw as number) : createdAtMs;

    setTimers((prev) => [
      {
        id: uid(),
        kind: "NM_TIMED_WINDOW",
        label: nmLabel.trim() || "NM Timer",
        enabled: true,
        createdAtMs,
        baseEarthMs,
        windowStartOffsetMs: Math.floor(startMs as number),
        windowEndOffsetMs: Math.floor(endMs as number),
        intervalMs: intervalMs == null ? null : Math.max(1_000, Math.floor(intervalMs as number)),
        warnLeadMs: Math.max(0, Math.floor(warnLeadMs)),
      },
      ...prev,
    ]);
  }

  function addNmLotteryTimer() {
    const warnLeadMs = parseDurationToMs(nmWarnLead) ?? 10_000;
    const phRespawnMs = parseDurationToMs(nmPhRespawn);

    if (!Number.isFinite(phRespawnMs as number)) {
      alert("Invalid Lottery NM values. Try: 5m for PH respawn.");
      return;
    }

    const createdAtMs = Date.now();
    const baseEarthMsRaw = nmTodInput.trim() ? parseLocalDateTimeToMs(nmTodInput) : undefined;
    if (nmTodInput.trim() && !Number.isFinite(baseEarthMsRaw as number)) {
      alert("Invalid ToD time. Leave blank for now, or use formats like YYYY-MM-DDTHH:MM:SS or MM/DD/YYYY HH:MM:SS AM.");
      return;
    }
    const baseEarthMs = Number.isFinite(baseEarthMsRaw as number) ? (baseEarthMsRaw as number) : createdAtMs;

    setTimers((prev) => [
      {
        id: uid(),
        kind: "NM_LOTTERY",
        label: nmLabel.trim() || "Lottery NM",
        enabled: true,
        createdAtMs,
        baseEarthMs,
        warnLeadMs: Math.max(0, Math.floor(warnLeadMs)),
        phRespawnMs: Math.max(1_000, Math.floor(phRespawnMs as number)),
        // Start the PH respawn timer immediately; user can keep hitting "PH killed" to reset.
        phNextAtMs: createdAtMs + Math.max(1_000, Math.floor(phRespawnMs as number)),
      },
      ...prev,
    ]);
  }

  function setNmTodNow() {
    // Use a format parseLocalDateTimeToMs reliably accepts (local time).
    setNmTodInput(formatLocalDateTimeLikeInput(Date.now()));
  }

  function resetNmBaseNow(id: string) {
    const now = Date.now();
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.kind === "NM_TIMED_WINDOW") return { ...t, baseEarthMs: now, enabled: true };
        if (t.kind === "NM_LOTTERY") return { ...t, baseEarthMs: now, phNextAtMs: now + t.phRespawnMs, enabled: true };
        return t;
      })
    );
  }

  function lotteryPhKilledNow(id: string) {
    const now = Date.now();
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id || t.kind !== "NM_LOTTERY") return t;
        return { ...t, phNextAtMs: now + t.phRespawnMs, enabled: true };
      })
    );
  }

  function lotteryClearPh(id: string) {
    setTimers((prev) => prev.map((t) => (t.id === id && t.kind === "NM_LOTTERY" ? { ...t, phNextAtMs: null } : t)));
  }

  function toggleTimer(id: string) {
    setTimers((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));
  }

  function deleteTimer(id: string) {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }

  const previewPct = clampInt(Number(mPercent) || 0, 0, 100);
  const previewStep = stepFromDirectionAndPercent(mDir, previewPct);
  const previewPhase = moonPhaseNameFromStep(previewStep);

  // ---- Inline input validation ----
  // Real life "When" is required and must be a valid date/time.
  const rWhenValid = isValidTod(rWhen);
  const rDurationValid = isValidDuration(rDuration);

  // NM: ToD is optional (blank = now), but if provided must be valid.
  const nmTodValid = nmTodInput.trim() === "" || isValidTod(nmTodInput);
  const nmWarnLeadValid = isValidDuration(nmWarnLead);
  const nmWindowStartValid = isValidDuration(nmWindowStart);
  const nmWindowEndValid = isValidDuration(nmWindowEnd);
  const nmWindowIntervalValid = nmWindowInterval.trim() === "" || isValidDuration(nmWindowInterval);
  const nmWindowOrderValid =
    !nmWindowStartValid || !nmWindowEndValid
      ? true
      : (parseDurationToMs(nmWindowEnd) as number) >= (parseDurationToMs(nmWindowStart) as number);
  const nmPhRespawnValid = isValidDuration(nmPhRespawn);

  const nmTimedWindowFormValid =
    nmTodValid &&
    nmWarnLeadValid &&
    nmWindowStartValid &&
    nmWindowEndValid &&
    nmWindowIntervalValid &&
    nmWindowOrderValid;

  const nmLotteryFormValid = nmTodValid && nmWarnLeadValid && nmPhRespawnValid;


  const counterIncrement = clampInt(counters.increment || 1, COUNTER_INCREMENT_MIN, COUNTER_INCREMENT_MAX);
  const sfTotal = counters.success + counters.failure;
  const successPct = sfTotal > 0 ? (counters.success / sfTotal) * 100 : 0;
  const failurePct = sfTotal > 0 ? (counters.failure / sfTotal) * 100 : 0;

  const synthHqTotal = counters.hq1 + counters.hq2 + counters.hq3;
  const synthTotal = synthHqTotal + counters.nq + counters.break;

  const hqTotalPct = synthTotal > 0 ? (synthHqTotal / synthTotal) * 100 : 0;
  const hq1Pct = synthTotal > 0 ? (counters.hq1 / synthTotal) * 100 : 0;
  const hq2Pct = synthTotal > 0 ? (counters.hq2 / synthTotal) * 100 : 0;
  const hq3Pct = synthTotal > 0 ? (counters.hq3 / synthTotal) * 100 : 0;
  const nqPct = synthTotal > 0 ? (counters.nq / synthTotal) * 100 : 0;
  const breakPct = synthTotal > 0 ? (counters.break / synthTotal) * 100 : 0;

  function adjustCounter(kind: "success" | "failure" | "hq1" | "hq2" | "hq3" | "nq" | "break", delta: number) {
    setCounters((prev) => ({
      ...prev,
      [kind]: clampInt((prev[kind] ?? 0) + delta, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX),
    }));
  }

  function onCounterButtonClick(kind: "success" | "failure" | "hq1" | "hq2" | "hq3" | "nq" | "break") {
    adjustCounter(kind, counterIncrement);
  }

  function onCounterButtonRightClick(
    e: React.MouseEvent,
    kind: "success" | "failure" | "hq1" | "hq2" | "hq3" | "nq" | "break"
  ) {
    e.preventDefault();
    adjustCounter(kind, -counterIncrement);
  }

  function adjustIncrement(delta: number) {
    setCounters((prev) => ({
      ...prev,
      increment: clampInt(
        (Number(prev.increment) || 1) + delta,
        COUNTER_INCREMENT_MIN,
        COUNTER_INCREMENT_MAX
      ),
    }));
  }

  function resetCounters() {
    setCounters((prev) => ({
      ...prev,
      success: 0,
      failure: 0,
      nq: 0,
      break: 0,
      hq1: 0,
      hq2: 0,
      hq3: 0,
    }));
  }

  function adjustLuShangCarp(delta: number) {
    setLuShang((prev) => ({
      moatCarp: clampInt(prev.moatCarp + Math.floor(delta), LU_SHANG_MIN, LU_SHANG_MAX),
    }));
  }

  function parsePositiveWholeInput(raw: string): number | null {
    if (!raw.trim()) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    if (!Number.isInteger(parsed)) return null;
    if (parsed <= 0) return null;
    return parsed;
  }

  function applyLuSingles(sign: 1 | -1) {
    const amount = parsePositiveWholeInput(luSinglesInput);
    if (amount === null) {
      alert("Enter a positive whole number for singles.");
      return;
    }
    adjustLuShangCarp(sign * amount);
  }

  function applyLuStacks(sign: 1 | -1) {
    const stacks = parsePositiveWholeInput(luStacksInput);
    if (stacks === null) {
      alert("Enter a positive whole number for stacks.");
      return;
    }
    adjustLuShangCarp(sign * stacks * LU_SHANG_STACK_SIZE);
  }

  function setLuShangTotal() {
    const total = parsePositiveWholeInput(luSetTotalInput);
    if (total === null) {
      alert("Enter a positive whole number for total moat carp.");
      return;
    }
    setLuShang({ moatCarp: clampInt(total, LU_SHANG_MIN, LU_SHANG_MAX) });
  }

  function resetLuShang() {
    setLuShang(DEFAULT_LU_SHANG);
  }

  const clockCard = (
        <section style={styles.card}>
          <div style={styles.titleRow}>
            <h2 style={styles.h2}>Vana&apos;diel Clock</h2>
          </div>

          <div style={styles.cardBody}>
            <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800 }}>
              <span style={weekdayStyle(now.weekday)}>{now.weekday}</span> {pad2(now.hour)}:{pad2(now.minute)}
            </div>

            <div style={{ marginTop: 6, opacity: 0.9 }}>
              Moon:{" "}
              <span style={moonPhaseStyle(now.moonPhaseName)}>
                <span style={moonGlyphStyle()}>{moonDirGlyph(nowMoonDir)}</span>
                {now.moonPhaseName}
              </span>{" "}
              ({now.moonPercent}%)
            </div>

            <div style={{ marginTop: 8, ...styles.sub }}>
              Next:{" "}
              <span style={moonPhaseStyle(nextMoonLabel.phase)}>
                <span style={moonGlyphStyle()}>{moonDirGlyph(nextMoonLabel.dir)}</span>
                {nextMoonLabel.phase}
              </span>{" "}
              ({nextMoonLabel.pct}%)
              <br />
              In: {formatCountdown(msUntilNextMoonStep)} (at {new Date(nextMoonAt).toLocaleTimeString()})
            </div>
          </div>
        </section>
  );

  const vanaTimerCard = (
        <section style={styles.cardStretch}>
          <div style={styles.titleRow}>
            <h3 style={styles.h3}>Vana&apos;diel Timer</h3>
          </div>

          <div style={styles.cardBody}>
            <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
              <div style={styles.field}>
                <div style={styles.label}>Label</div>
                <input style={styles.inputCompact} value={tLabel} onChange={(e) => setTLabel(e.target.value)} />
              </div>

              <div style={styles.field}>
                <div style={styles.label}>Weekday</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <select
                    style={{ ...styles.selectCompact, flex: 1 }}
                    value={tWeekday}
                    onChange={(e) => setTWeekday(e.target.value as VanaWeekday)}
                  >
                    {WEEKDAYS.map((d) => (
                      <option
                        key={d}
                        value={d}
                        style={{
                          ...optionBaseStyle,
                          color: WEEKDAY_COLORS[d],
                          fontWeight: 800,
                        }}
                      >
                        {d}
                      </option>
                    ))}
                  </select>

                  <div style={{ ...styles.sub, whiteSpace: "nowrap" }}>
                    <span style={{ opacity: 0.8 }}>Selected:</span> <span style={weekdayStyle(tWeekday)}>{tWeekday}</span>
                  </div>
                </div>
              </div>

              <div style={styles.compactRow}>
                <div style={styles.field}>
                  <div style={styles.label}>Hour</div>
                  <input style={styles.inputCompact} value={tHour} onChange={(e) => setTHour(e.target.value)} />
                </div>
                <div style={styles.field}>
                  <div style={styles.label}>Min</div>
                  <input style={styles.inputCompact} value={tMin} onChange={(e) => setTMin(e.target.value)} />
                </div>
              </div>
            </div>

            <div style={styles.topCardFooter}>
              <div style={{ ...styles.buttonRowCompact, marginTop: 0 }}>
                <button style={styles.buttonPrimaryCompact} onClick={addWeekdayTimer}>
                  Add Vana&apos;diel timer
                </button>
              </div>
            </div>
          </div>
        </section>
  );

  const realLifeCard = (
        <section style={styles.cardStretch}>
          <div style={styles.titleRow}>
            <h3 style={styles.h3}>Real life timer</h3>
          </div>

          <div style={styles.cardBody}>
            <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
              <div style={styles.field}>
                <div style={styles.label}>Label</div>
                <input style={styles.inputCompact} value={rLabel} onChange={(e) => setRLabel(e.target.value)} />
              </div>

              <div style={styles.field}>
                <div style={styles.label}>Mode</div>
                <select
                  style={styles.selectCompact}
                  value={rMode}
                  onChange={(e) => setRMode(e.target.value as "IN" | "AT")}
                >
                  <option style={optionBaseStyle} value="IN">
                    Countdown (in…)
                  </option>
                  <option style={optionBaseStyle} value="AT">
                    At a specific time
                  </option>
                </select>
              </div>

              {rMode === "IN" ? (
                <div style={styles.field}>
                  <div style={styles.label}>Duration</div>
                  <input
                    style={{ ...styles.inputCompact, ...(rDurationValid ? {} : styles.inputError) }}
                    value={rDuration}
                    onChange={(e) => setRDuration(e.target.value)}
                    placeholder="5m"
                  />
                  <div style={{ ...styles.buttonRowCompact, marginTop: 6 }}>
                    {["1m", "5m", "10m", "30m", "1h"].map((d) => (
                      <button key={d} style={styles.buttonCompact} onClick={() => setRDuration(d)}>
                        {d}
                      </button>
                    ))}
                  </div>
                  <div style={styles.sub}>
                    e.g. <code>90s</code>, <code>5m</code>, <code>2.5h</code>, <code>1:45:55</code>
                  </div>
                  {!rDurationValid && (
                    <div style={styles.errorText}>Invalid duration.</div>
                  )}
                </div>
              ) : (
                <div style={styles.field}>
                  <div style={styles.label}>When (local)</div>
                  <input
                    style={{ ...styles.inputCompact, ...(rWhenValid ? {} : styles.inputError) }}
                    value={rWhen}
                    onChange={(e) => setRWhen(e.target.value)}
                    placeholder="2026-07-14T14:06:40"
                  />
                  <div style={styles.sub}>
                    Accepted formats:
                    <br />
                    • ISO 24-hour: <code>YYYY-MM-DDTHH:MM:SS</code> (e.g. 2026-07-14T14:06:40)
                    <br />
                    • US 12-hour: <code>MM/DD/YYYY HH:MM:SS AM/PM</code> (e.g. 07/14/2026 02:06:40 PM)
                  </div>
                  {!rWhenValid && (
                    <div style={styles.errorText}>
                      Invalid date/time. Match one of the formats above.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={styles.topCardFooter}>
              <div style={{ ...styles.buttonRowCompact, marginTop: 0 }}>
                {rMode === "IN" ? (
                  <button
                    style={{ ...styles.buttonPrimaryCompact, ...(rDurationValid ? {} : styles.buttonDisabled) }}
                    onClick={addCountdownTimer}
                    disabled={!rDurationValid}
                  >
                    Start countdown
                  </button>
                ) : (
                  <button
                    style={{ ...styles.buttonPrimaryCompact, ...(rWhenValid ? {} : styles.buttonDisabled) }}
                    onClick={addRealLifeTimer}
                    disabled={!rWhenValid}
                  >
                    Add real life timer
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
  );

  const moonCard = (
        <section style={styles.cardStretch}>
          <div style={styles.titleRow}>
            <h3 style={styles.h3}>Moon timer</h3>
            <div style={styles.sub}>Set by waxing/waning + %</div>
          </div>

          <div style={styles.cardBody}>
            <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
              <div style={styles.field}>
                <div style={styles.label}>Label</div>
                <input style={styles.inputCompact} value={mLabel} onChange={(e) => setMLabel(e.target.value)} />
              </div>

              <div style={styles.field}>
                <div style={styles.label}>Direction</div>
                <select
                  style={styles.selectCompact}
                  value={mDir}
                  onChange={(e) => setMDir(e.target.value as MoonDirection)}
                >
                  <option
                    value="WAXING"
                    style={{
                      ...optionBaseStyle,
                      color: "#D8B04B",
                      fontWeight: 800,
                    }}
                  >
                    Waxing
                  </option>
                  <option
                    value="WANING"
                    style={{
                      ...optionBaseStyle,
                      color: "#B9C2D6",
                      fontWeight: 800,
                    }}
                  >
                    Waning
                  </option>
                </select>
              </div>

              <div style={styles.field}>
                <div style={styles.label}>Target % (0..100)</div>
                <input style={styles.inputCompact} value={mPercent} onChange={(e) => setMPercent(e.target.value)} />
              </div>

              <div style={styles.sub}>
                Will target: <span style={moonGlyphStyle()}>{moonDirGlyph(mDir)}</span>
                {mDir} {previewPct}% — <span style={moonPhaseStyle(previewPhase)}>{previewPhase}</span> (step{" "}
                {previewStep})
              </div>
            </div>

            <div style={styles.topCardFooter}>
              <div style={{ ...styles.buttonRowCompact, marginTop: 0 }}>
                <button style={styles.buttonPrimaryCompact} onClick={addMoonTimer}>
                  Add moon timer
                </button>
              </div>
            </div>
          </div>
        </section>
  );

  const countersCard = (
        <section style={styles.card}>
          <div style={styles.titleRow}>
            <h3 style={styles.h3}>Counters</h3>
            <div style={styles.sub}>Manual increment + reset</div>
          </div>

          <div style={styles.cardBody}>
            <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
              <div style={styles.field}>
                <div style={styles.label}>Increment</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    style={{ ...styles.buttonCompact, width: 40, padding: 0 }}
                    onClick={() => adjustIncrement(-1)}
                    title="Decrement increment"
                  >
                    -
                  </button>
                  <input
                    style={{ ...styles.inputCompact, width: 140 }}
                    type="number"
                    inputMode="numeric"
                    min={COUNTER_INCREMENT_MIN}
                    max={COUNTER_INCREMENT_MAX}
                    step={1}
                    value={counters.increment}
                    onChange={(e) =>
                      setCounters((prev) => ({
                        ...prev,
                        increment: clampInt(
                          Number(e.target.value) || 1,
                          COUNTER_INCREMENT_MIN,
                          COUNTER_INCREMENT_MAX
                        ),
                      }))
                    }
                  />
                  <button
                    style={{ ...styles.buttonCompact, width: 40, padding: 0 }}
                    onClick={() => adjustIncrement(1)}
                    title="Increment increment"
                  >
                    +
                  </button>
                </div>
                <div style={styles.sub}>Left click adds +{counterIncrement}. Right click subtracts -{counterIncrement}.</div>
              </div>

              <div style={styles.subCard}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>Success / Failure</div>
                  <div style={styles.sub}>
                    Total: {sfTotal} • Success: {successPct.toFixed(1)}% • Failure: {failurePct.toFixed(1)}%
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={styles.sub}>Success</div>
                    <div style={{ fontSize: 26, fontWeight: 900 }}>{counters.success}</div>
                  </div>
                  <div>
                    <div style={styles.sub}>Failure</div>
                    <div style={{ fontSize: 26, fontWeight: 900 }}>{counters.failure}</div>
                  </div>
                </div>

                <div style={styles.buttonRow}>
                  <button
                    style={styles.buttonPrimaryCompact}
                    onClick={() => onCounterButtonClick("success")}
                    onContextMenu={(e) => onCounterButtonRightClick(e, "success")}
                    title="Left click: +  |  Right click: -"
                  >
                    Success +{counterIncrement}
                  </button>
                  <button
                    style={styles.buttonCompact}
                    onClick={() => onCounterButtonClick("failure")}
                    onContextMenu={(e) => onCounterButtonRightClick(e, "failure")}
                    title="Left click: +  |  Right click: -"
                  >
                    Failure +{counterIncrement}
                  </button>
                </div>
              </div>

              <div style={styles.subCard}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>Synthesis</div>
                  <div style={styles.sub}>
                    Total: {synthTotal} • HQ Total: {hqTotalPct.toFixed(1)}% • NQ: {nqPct.toFixed(1)}% • Break: {breakPct.toFixed(1)}%
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                  <div>
                    <div style={styles.sub}>HQ1 ({hq1Pct.toFixed(1)}%)</div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>{counters.hq1}</div>
                  </div>
                  <div>
                    <div style={styles.sub}>HQ2 ({hq2Pct.toFixed(1)}%)</div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>{counters.hq2}</div>
                  </div>
                  <div>
                    <div style={styles.sub}>HQ3 ({hq3Pct.toFixed(1)}%)</div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>{counters.hq3}</div>
                  </div>
                  <div>
                    <div style={styles.sub}>NQ ({nqPct.toFixed(1)}%)</div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>{counters.nq}</div>
                  </div>
                  <div>
                    <div style={styles.sub}>Break ({breakPct.toFixed(1)}%)</div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>{counters.break}</div>
                  </div>
                  <div>
                    <div style={styles.sub}>HQ Total</div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>{synthHqTotal}</div>
                  </div>
                </div>

                <div style={styles.buttonRow}>
                  <button
                    style={styles.buttonPrimaryCompact}
                    onClick={() => onCounterButtonClick("hq1")}
                    onContextMenu={(e) => onCounterButtonRightClick(e, "hq1")}
                    title="Left click: +  |  Right click: -"
                  >
                    HQ1 +{counterIncrement}
                  </button>
                  <button
                    style={styles.buttonCompact}
                    onClick={() => onCounterButtonClick("hq2")}
                    onContextMenu={(e) => onCounterButtonRightClick(e, "hq2")}
                    title="Left click: +  |  Right click: -"
                  >
                    HQ2 +{counterIncrement}
                  </button>
                  <button
                    style={styles.buttonCompact}
                    onClick={() => onCounterButtonClick("hq3")}
                    onContextMenu={(e) => onCounterButtonRightClick(e, "hq3")}
                    title="Left click: +  |  Right click: -"
                  >
                    HQ3 +{counterIncrement}
                  </button>
                  <button
                    style={styles.buttonCompact}
                    onClick={() => onCounterButtonClick("nq")}
                    onContextMenu={(e) => onCounterButtonRightClick(e, "nq")}
                    title="Left click: +  |  Right click: -"
                  >
                    NQ +{counterIncrement}
                  </button>
                  <button
                    style={styles.buttonCompact}
                    onClick={() => onCounterButtonClick("break")}
                    onContextMenu={(e) => onCounterButtonRightClick(e, "break")}
                    title="Left click: +  |  Right click: -"
                  >
                    Break +{counterIncrement}
                  </button>
                </div>
              </div>
            </div>

            <div style={styles.topCardFooter}>
              <div style={{ ...styles.buttonRowCompact, marginTop: 0 }}>
                <button style={styles.buttonCompact} onClick={resetCounters}>
                  Reset counters
                </button>
              </div>
            </div>
          </div>
        </section>
  );

  const luShangRemaining = Math.max(0, LU_SHANG_GOAL - luShang.moatCarp);
  const luShangProgress = Math.min(100, (luShang.moatCarp / LU_SHANG_GOAL) * 100);
  const luShangRemainingStacks = Math.ceil(luShangRemaining / LU_SHANG_STACK_SIZE);
  const luShangSinglesValid = parsePositiveWholeInput(luSinglesInput) !== null;
  const luShangStacksValid = parsePositiveWholeInput(luStacksInput) !== null;

  const luShangCard = (
        <section style={styles.card}>
          <div style={styles.titleRow}>
            <h3 style={styles.h3}>Lu Shang Moat Carp Tracker</h3>
            <div style={styles.sub}>Goal: {LU_SHANG_GOAL.toLocaleString()} moat carp</div>
          </div>

          <div style={styles.cardBody}>
            <div style={{ marginTop: 8, display: "grid", gap: 12 }}>
              <div style={styles.subCard}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 30, fontWeight: 900 }}>{luShang.moatCarp.toLocaleString()}</div>
                  <div style={styles.sub}>
                    Remaining: {luShangRemaining.toLocaleString()} carp ({luShangRemainingStacks.toLocaleString()} stacks)
                  </div>
                  <div style={styles.sub}>Progress: {luShangProgress.toFixed(2)}%</div>
                  <div
                    style={{
                      height: 12,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.08)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${luShangProgress}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, #4ca4ff 0%, #8af6b0 100%)",
                        transition: "width 200ms ease",
                      }}
                    />
                  </div>
                </div>
              </div>

              <div style={styles.subCard}>
                <div style={{ fontWeight: 900 }}>Quick add/subtract</div>
                <div style={styles.buttonRow}>
                  <button style={styles.buttonPrimaryCompact} onClick={() => adjustLuShangCarp(1)}>
                    +1
                  </button>
                  <button style={styles.buttonCompact} onClick={() => adjustLuShangCarp(-1)}>
                    -1
                  </button>
                  <button style={styles.buttonPrimaryCompact} onClick={() => adjustLuShangCarp(LU_SHANG_STACK_SIZE)}>
                    +12 (stack)
                  </button>
                  <button style={styles.buttonCompact} onClick={() => adjustLuShangCarp(-LU_SHANG_STACK_SIZE)}>
                    -12 (stack)
                  </button>
                </div>
              </div>

              <div style={styles.subCard}>
                <div style={{ fontWeight: 900 }}>Text adjust by singles</div>
                <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    style={{ ...styles.inputCompact, width: 180, ...(luShangSinglesValid ? {} : styles.inputError) }}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={luSinglesInput}
                    onChange={(e) => setLuSinglesInput(e.target.value)}
                    placeholder="e.g. 240"
                  />
                  <button
                    style={{ ...styles.buttonPrimaryCompact, ...(luShangSinglesValid ? {} : styles.buttonDisabled) }}
                    onClick={() => applyLuSingles(1)}
                    disabled={!luShangSinglesValid}
                  >
                    Add singles
                  </button>
                  <button
                    style={{ ...styles.buttonCompact, ...(luShangSinglesValid ? {} : styles.buttonDisabled) }}
                    onClick={() => applyLuSingles(-1)}
                    disabled={!luShangSinglesValid}
                  >
                    Subtract singles
                  </button>
                </div>
              </div>

              <div style={styles.subCard}>
                <div style={{ fontWeight: 900 }}>Text adjust by stacks (x{LU_SHANG_STACK_SIZE})</div>
                <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    style={{ ...styles.inputCompact, width: 180, ...(luShangStacksValid ? {} : styles.inputError) }}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={luStacksInput}
                    onChange={(e) => setLuStacksInput(e.target.value)}
                    placeholder="e.g. 20 stacks"
                  />
                  <button
                    style={{ ...styles.buttonPrimaryCompact, ...(luShangStacksValid ? {} : styles.buttonDisabled) }}
                    onClick={() => applyLuStacks(1)}
                    disabled={!luShangStacksValid}
                  >
                    Add stacks
                  </button>
                  <button
                    style={{ ...styles.buttonCompact, ...(luShangStacksValid ? {} : styles.buttonDisabled) }}
                    onClick={() => applyLuStacks(-1)}
                    disabled={!luShangStacksValid}
                  >
                    Subtract stacks
                  </button>
                </div>
              </div>

              <div style={styles.subCard}>
                <div style={{ fontWeight: 900 }}>Set total directly</div>
                <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    style={{ ...styles.inputCompact, width: 180 }}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={luSetTotalInput}
                    onChange={(e) => setLuSetTotalInput(e.target.value)}
                    placeholder="e.g. 3520"
                  />
                  <button
                    style={styles.buttonPrimaryCompact}
                    onClick={setLuShangTotal}
                  >
                    Set total
                  </button>
                  <button style={styles.buttonCompact} onClick={resetLuShang}>
                    Reset to 0
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
  );

  const nmContent = (
        <section style={styles.card}>
          <div style={styles.titleRow}>
            <h3 style={styles.h3}>Notorious Monster timers</h3>
            <div style={styles.sub}>Timed windows (optional interval), or lottery PH respawn loop</div>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 12, maxWidth: 640 }}>
            <div style={styles.field}>
              <div style={styles.label}>Mode</div>
              <select
                style={styles.select}
                value={nmMode}
                onChange={(e) => setNmMode(e.target.value as "TIMED_WINDOW" | "LOTTERY")}
              >
                <option value="TIMED_WINDOW" style={optionBaseStyle}>
                  Timed spawn (window + optional interval)
                </option>
                <option value="LOTTERY" style={optionBaseStyle}>
                  Lottery (PH respawn loop)
                </option>
              </select>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ ...styles.field, width: 320 }}>
                <div style={styles.label}>Label</div>
                <input style={styles.input} value={nmLabel} onChange={(e) => setNmLabel(e.target.value)} />
              </div>

              <div style={{ ...styles.field, width: 160 }}>
                <div style={styles.label}>Warn lead</div>
                <input
                  style={{ ...styles.input, ...(nmWarnLeadValid ? {} : styles.inputError) }}
                  value={nmWarnLead}
                  onChange={(e) => setNmWarnLead(e.target.value)}
                  placeholder="10s"
                  title="Examples: 10s, 1m, 1m30s, 1:30"
                />
                {nmWarnLeadValid ? (
                  <div style={styles.sub}>Examples: 10s, 1m, 1m30s, 1:30</div>
                ) : (
                  <div style={styles.errorText}>Invalid duration. Try 10s, 1m, 1m30s, or 1:30.</div>
                )}
              </div>
            </div>

            <div style={styles.field}>
              <div style={styles.label}>ToD (local)</div>
              <input
                style={{ ...styles.input, ...(nmTodValid ? {} : styles.inputError) }}
                type="text"
                value={nmTodInput}
                onChange={(e) => setNmTodInput(e.target.value)}
                placeholder="(blank = now)  e.g. 2026-02-04T13:22:10 or 02/04/2026 01:22:10 PM"
              />
              <div style={{ marginTop: 6, ...styles.buttonRow }}>
                <button style={styles.button} onClick={setNmTodNow}>
                  Use now
                </button>
                <button style={styles.button} onClick={() => setNmTodInput("")}
                  title="Clear ToD input (will use now)">
                  Clear
                </button>
              </div>
              <div style={styles.sub}>
                Leave blank to use now. Accepted formats:
                <br />
                • ISO 24-hour: <code>YYYY-MM-DDTHH:MM:SS</code> (e.g. 2026-02-04T13:22:10)
                <br />
                • US 12-hour: <code>MM/DD/YYYY HH:MM:SS AM/PM</code> (e.g. 02/04/2026 01:22:10 PM)
              </div>
              {!nmTodValid && (
                <div style={styles.errorText}>
                  Invalid date/time. Match one of the formats above, or leave blank for now.
                </div>
              )}
            </div>

            {nmMode === "TIMED_WINDOW" ? (
              <>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div style={{ ...styles.field, width: 200 }}>
                    <div style={styles.label}>Window start</div>
                    <input
                      style={{ ...styles.input, ...(nmWindowStartValid ? {} : styles.inputError) }}
                      value={nmWindowStart}
                      onChange={(e) => setNmWindowStart(e.target.value)}
                      placeholder="2h"
                      title="Examples: 2h, 2.5h, 1h45m, 1h45m55s, 1:45:55"
                    />
                    {nmWindowStartValid ? (
                      <div style={styles.sub}>Examples: 2h, 2.5h, 1h45m55s, 1:45:55</div>
                    ) : (
                      <div style={styles.errorText}>Invalid duration. Try 2h, 2.5h, 1h45m55s, or 1:45:55.</div>
                    )}
                  </div>

                  <div style={{ ...styles.field, width: 160 }}>
                    <div style={styles.label}>Window end</div>
                    <input
                      style={{ ...styles.input, ...(nmWindowEndValid && nmWindowOrderValid ? {} : styles.inputError) }}
                      value={nmWindowEnd}
                      onChange={(e) => setNmWindowEnd(e.target.value)}
                      placeholder="2.5h"
                    />
                    {!nmWindowEndValid ? (
                      <div style={styles.errorText}>Invalid duration. Try 2.5h or 2h30m.</div>
                    ) : !nmWindowOrderValid ? (
                      <div style={styles.errorText}>End must be ≥ start.</div>
                    ) : null}
                  </div>

                  <div style={{ ...styles.field, width: 160 }}>
                    <div style={styles.label}>Interval (optional)</div>
                    <input
                      style={{ ...styles.input, ...(nmWindowIntervalValid ? {} : styles.inputError) }}
                      value={nmWindowInterval}
                      onChange={(e) => setNmWindowInterval(e.target.value)}
                      placeholder="5m (blank = single check at window start)"
                      title="Examples: 5m, 90s, 1m30s"
                    />
                    {nmWindowInterval.trim() === "" ? (
                      <div style={styles.sub}>Blank = one check at window start.</div>
                    ) : nmWindowIntervalValid ? (
                      <div style={styles.sub}>Examples: 5m, 90s, 1m30s</div>
                    ) : (
                      <div style={styles.errorText}>Invalid duration. Try 5m, 90s, or 1m30s.</div>
                    )}
                  </div>
                </div>

                <div style={styles.buttonRow}>
                  <button
                    style={{ ...styles.buttonPrimary, ...(nmTimedWindowFormValid ? {} : styles.buttonDisabled) }}
                    onClick={addNmTimedWindowTimer}
                    disabled={!nmTimedWindowFormValid}
                  >
                    Start timed NM
                  </button>
                </div>

                <div style={styles.sub}>
                  Example: start 2h, end 2.5h, interval 5m → warns at 1:59:50 then pops at 2:00:00, 2:05:00, … 2:30:00. Leave interval blank for one check at window start. Timed spawns also alert when the window closes (unless an interval pop already lands exactly at close).
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div style={{ ...styles.field, width: 200 }}>
                    <div style={styles.label}>PH respawn</div>
                    <input
                      style={{ ...styles.input, ...(nmPhRespawnValid ? {} : styles.inputError) }}
                      value={nmPhRespawn}
                      onChange={(e) => setNmPhRespawn(e.target.value)}
                      placeholder="5m"
                      title="Examples: 5m, 90s, 1m30s"
                    />
                    {nmPhRespawnValid ? (
                      <div style={styles.sub}>Press “PH killed” each time you kill it to reset the PH timer each time.</div>
                    ) : (
                      <div style={styles.errorText}>Invalid duration. Try 5m, 90s, or 1m30s.</div>
                    )}
                  </div>
                </div>

                <div style={styles.buttonRow}>
                  <button
                    style={{ ...styles.buttonPrimary, ...(nmLotteryFormValid ? {} : styles.buttonDisabled) }}
                    onClick={addNmLotteryTimer}
                    disabled={!nmLotteryFormValid}
                  >
                    Start lottery NM
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
  );

  const presetControls = (
        <section aria-label="Preset timer settings" style={{ ...styles.card, background: "#0c0c0c", padding: "8px 14px" }}>
          <div style={styles.titleRow}>
            <h3 style={styles.h3}>Preset timers</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <label htmlFor="preset-offset-hours" style={styles.sub}>Offset (Vana hours):</label>
              <input
                id="preset-offset-hours"
                style={{ ...styles.input, width: 72 }}
                type="number"
                min={PRESET_OFFSET_MIN}
                max={PRESET_OFFSET_MAX}
                step={1}
                value={presetOffsetHours}
                onChange={(e) => setPresetOffsetHours(clampInt(Number(e.target.value) || 0, PRESET_OFFSET_MIN, PRESET_OFFSET_MAX))}
                title="Hours before the target/open time (Vana hours)"
              />
              <div style={styles.sub}>hours before target/open</div>
            </div>
          </div>
        </section>
  );

  const presetContent = (
        <section style={styles.card}>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                alignItems: "start",
              }}
            >
              {/* Next Day */}
              <div style={styles.subCard}>
                <div style={styles.titleRow}>
                  <div style={{ fontWeight: 800 }}>Next Day</div>
                  <div style={styles.sub}>
                    Targets 00:00 → fires {pad2(nextDayPreview.targetHour)}:{pad2(nextDayPreview.targetMinute)} (offset {presetOffsetHours}h)
                  </div>
                </div>

                <div style={{ marginTop: 8, ...styles.sub }}>
                  Will set:{" "}
                  <span style={weekdayStyle(nextDayPreview.targetWeekday)}>{nextDayPreview.targetWeekday}</span>{" "}
                  {pad2(nextDayPreview.targetHour)}:{pad2(nextDayPreview.targetMinute)}
                  <br />
                  Next: {new Date(nextDayPreview.nextAt).toLocaleString()} — In:{" "}
                  {formatCountdown(nextDayPreview.nextAt - nowMs)}
                </div>

                <div style={{ marginTop: 10, ...styles.buttonRow }}>
                  <button style={styles.buttonPrimary} onClick={addNextDayTimer}>
                    Add Next Day timer
                  </button>
                </div>
              </div>

              {guildPreviews.map((guild) => (
                <div key={guild.id} style={styles.subCard}>
                  <div style={styles.titleRow}>
                    <div style={{ fontWeight: 800 }}>{guild.label}</div>
                    <div style={styles.sub}>
                      Opens {formatVanaTime(guild.openHour, guild.openMinute)}–{formatVanaTime(guild.closeHour, guild.closeMinute)} → fires {pad2(guild.targetHour)}:{pad2(guild.targetMinute)} (offset {presetOffsetHours}h), closed {guild.closedOn ?? "Never"}
                    </div>
                  </div>

                  <div style={{ marginTop: 8, ...styles.sub }}>
                    Will set:{" "}
                    <span style={weekdayStyle(guild.targetWeekday)}>{guild.targetWeekday}</span>{" "}
                    {pad2(guild.targetHour)}:{pad2(guild.targetMinute)}
                    <br />
                    Next: {new Date(guild.nextAt).toLocaleString()} — In: {formatCountdown(guild.nextAt - nowMs)}
                  </div>

                  <div style={{ marginTop: 10, ...styles.buttonRow }}>
                    <button style={styles.buttonPrimary} onClick={() => addGuildTimer(guild)}>
                      Add {guild.label} timer
                    </button>
                  </div>
                </div>
              ))}

              {/* Tenshodo */}
              <div style={styles.subCard}>
                <div style={styles.titleRow}>
                  <div style={{ fontWeight: 800 }}>Tenshodo</div>
                  <div style={styles.sub}>Adds 2–3 timers (merged when fire time matches)</div>
                </div>

                <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
                  {tenshodoPreviews.map((t) => (
                    <div key={t.label} style={{ ...styles.sub, opacity: 0.95 }}>
                      <div style={{ fontWeight: 800 }}>{t.label}</div>
                      Will set:{" "}
                      <span style={weekdayStyle(t.targetWeekday)}>{t.targetWeekday}</span> {pad2(t.targetHour)}:
                      {pad2(t.targetMinute)}
                      <br />
                      Next: {new Date(t.nextAt).toLocaleString()} — In: {formatCountdown(t.nextAt - nowMs)}
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 10, ...styles.buttonRow }}>
                  <button style={styles.buttonPrimary} onClick={addTenshodoTimers}>
                    Add Tenshodo timers
                  </button>
                </div>

                <div style={{ marginTop: 8, ...styles.sub }}>
                  Notes: Lower Jeuno closed Earthsday; Port Bastok closed Iceday; Norg closed Darksday. Offset is {presetOffsetHours}h
                  before open.
                </div>
              </div>

              <div style={{ gridColumn: "1 / -1", ...styles.sub }}>
                <h3 style={styles.h3}>Boats &amp; airships</h3>
                Daily Vana&apos;diel departure schedules. Each route alerts before every departure until disabled.
                The offset is saved when you add the timer; if an alert time has passed, the next future alert is used.
                Arrival countdowns track the next arrival at the destination, including a trip already underway.
                Board before departure. Server timings may vary; confirm with the dock NPC.
              </div>
              {transportPreviews.map((group) => (
                <React.Fragment key={group.label}>
                  <div style={{ gridColumn: "1 / -1", ...styles.titleRow }}>
                    <div style={{ fontWeight: 800 }}>{group.label}</div>
                    <a href={group.sourceUrl} target="_blank" rel="noreferrer" style={styles.sub}>Schedule source</a>
                  </div>
                  {group.routes.map((route) => (
                    <div key={route.id} style={styles.subCard}>
                      <div style={{ fontWeight: 800 }}>{route.label}</div>
                      <div style={{ marginTop: 8 }}>
                        <strong>Next departure in: {formatCountdown(route.nextDepartureAt - nowMs)}</strong>
                        <br />
                        <span style={weekdayStyle(route.nextDepartureVana.weekday)}>{route.nextDepartureVana.weekday}</span>{" "}
                        {formatVanaTime(route.nextDepartureVana.hour, route.nextDepartureVana.minute)} (Vana)
                        <br />
                        {new Date(route.nextDepartureAt).toLocaleString()} (Earth)
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <strong>Next arrival in: {formatCountdown(route.nextArrivalAt - nowMs)}</strong>
                        <br />
                        <span style={weekdayStyle(route.nextArrivalVana.weekday)}>{route.nextArrivalVana.weekday}</span>{" "}
                        {formatVanaTime(route.nextArrivalVana.hour, route.nextArrivalVana.minute)} (Vana)
                        <br />
                        {new Date(route.nextArrivalAt).toLocaleString()} (Earth)
                      </div>
                      <div style={{ marginTop: 8, ...styles.sub }}>
                        Departs daily (Vana): {formatTransportDepartures(route.departureMinutes)}
                        <br />
                        Next alert: <span style={weekdayStyle(route.alertVana.weekday)}>{route.alertVana.weekday}</span>{" "}
                        {formatVanaTime(route.alertVana.hour, route.alertVana.minute)} (offset {presetOffsetHours}h)
                        <br />
                        {new Date(route.nextAt).toLocaleString()} — In: {formatCountdown(route.nextAt - nowMs)}
                        <br />
                        For departure: <span style={weekdayStyle(route.departureVana.weekday)}>{route.departureVana.weekday}</span>{" "}
                        {formatVanaTime(route.departureVana.hour, route.departureVana.minute)}
                        {" "}({new Date(route.departureAt).toLocaleString()})
                      </div>
                      <div style={{ marginTop: 10, ...styles.buttonRow }}>
                        <button style={styles.buttonPrimary} onClick={() => addTransportTimer(route)}>
                          Set timer
                        </button>
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
        </section>
  );

  const timersListContent = (
        <section style={styles.card}>
          <div style={styles.titleRow}>
            <h3 style={styles.h3}>Timers</h3>
            <div style={styles.sub}>{timers.length} total</div>
          </div>

          {timers.length === 0 ? (
            <div style={{ marginTop: 10, ...styles.muted }}>No timers yet.</div>
          ) : (
            <div style={styles.timerGrid}>
              {timers.map((t) => {
                let nextAt: number | null = null;

                if (t.kind === "NM_TIMED_WINDOW") {
                  const ev = getNextNmTimedWindowEvent(t, nowMs);
                  nextAt = ev?.atMs ?? null;
                } else if (t.kind === "NM_LOTTERY") {
                  const ev = getNextNmLotteryEvent(t, nowMs);
                  nextAt = ev?.atMs ?? null;
                } else {
                  nextAt =
                    t.kind === "VANA_WEEKDAY_TIME"
                      ? nextEarthMsForVanaWeekdayTime({
                          nowEarthMs: nowMs,
                          cal: cal ?? undefined,
                          targetWeekday: t.targetWeekday,
                          targetHour: t.targetHour,
                          targetMinute: t.targetMinute,
                        })
                      : t.kind === "TRANSPORT"
                        ? nextEarthMsForVanaDailySchedule({
                            nowEarthMs: nowMs,
                            cal,
                            departureMinutes: t.departureMinutes,
                            offsetHours: t.offsetHours,
                          })
                      : t.kind === "MOON_STEP"
                        ? nextEarthMsForMoonStep({
                            nowEarthMs: nowMs,
                            cal: cal ?? undefined,
                            targetMoonStep: t.targetMoonStep,
                          })
                        : t.kind === "MOON_PERCENT"
                          ? nextEarthMsForMoonPercent({
                              nowEarthMs: nowMs,
                              cal: cal ?? undefined,
                              targetPercent: t.targetPercent,
                            })
                          : t.targetEarthMs;
                }

                const pausedMs =
                  t.kind === "EARTH_TIME" && t.pausedRemainingMs != null ? t.pausedRemainingMs : null;
                if (pausedMs !== null) nextAt = nowMs + pausedMs;

                const inMs = nextAt === null ? Number.POSITIVE_INFINITY : nextAt - nowMs;

                const vanaAt = nextAt === null ? now : getVanaNow(nextAt, cal ?? undefined);
                const departureAt = t.kind === "TRANSPORT" && nextAt !== null
                  ? nextAt + t.offsetHours * 144_000
                  : null;
                const departureVana = departureAt === null ? null : getVanaNow(departureAt, cal);
                const nextDepartureAt = t.kind === "TRANSPORT"
                  ? nextEarthMsForVanaDailySchedule({
                      nowEarthMs: nowMs,
                      cal,
                      departureMinutes: t.departureMinutes,
                      offsetHours: 0,
                    })
                  : null;
                const nextDepartureVana = nextDepartureAt === null ? null : getVanaNow(nextDepartureAt, cal);
                const arrivalMinutes = t.kind === "TRANSPORT" ? getTransportArrivalMinutes(t) : undefined;
                const nextArrivalAt = arrivalMinutes === undefined
                  ? null
                  : nextEarthMsForVanaDailySchedule({
                      nowEarthMs: nowMs,
                      cal,
                      departureMinutes: arrivalMinutes,
                      offsetHours: 0,
                    });
                const nextArrivalVana = nextArrivalAt === null ? null : getVanaNow(nextArrivalAt, cal);

                let detailLine: React.ReactNode = null;

                if (t.kind === "VANA_WEEKDAY_TIME") {
                  detailLine = (
                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                      Vana: {t.targetWeekday} {pad2(t.targetHour)}:{pad2(t.targetMinute)}
                    </div>
                  );
                } else if (t.kind === "TRANSPORT") {
                  detailLine = (
                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                      Transport: departs daily (Vana) {formatTransportDepartures(t.departureMinutes)}
                      <br />
                      Alerts {t.offsetHours} Vana hours before every departure.
                    </div>
                  );
                } else if (t.kind === "MOON_STEP") {
                  const step = t.targetMoonStep;
                  const dir = moonDirectionFromStep(step);
                  const pct = moonPercentFromStep(step);
                  const phase = moonPhaseNameFromStep(step);

                  detailLine = (
                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                      Moon: <span style={moonGlyphStyle()}>{moonDirGlyph(dir)}</span>
                      {dir} {pct}% (<span style={moonPhaseStyle(phase)}>{phase}</span>) step {step}
                    </div>
                  );
                } else if (t.kind === "MOON_PERCENT") {
                  detailLine = (
                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                      Moon: {t.targetPercent}%
                    </div>
                  );
                } else if (t.kind === "NM_TIMED_WINDOW") {
                  detailLine = (
                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                      NM (timed): window {formatCountdown(t.windowStartOffsetMs)} → {formatCountdown(t.windowEndOffsetMs)}{" "}
                      {t.intervalMs == null ? "(single check at window start)" : `every ${formatCountdown(t.intervalMs)}`}
                      <br />
                      ToD: {new Date(t.baseEarthMs).toLocaleString()}
                    </div>
                  );
                } else if (t.kind === "NM_LOTTERY") {
                  detailLine = (
                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                      NM (lottery): PH respawn {formatCountdown(t.phRespawnMs)}
                      <br />
                      ToD: {new Date(t.baseEarthMs).toLocaleString()}
                      {t.phNextAtMs ? (
                        <>
                          <br />
                          PH next: {new Date(t.phNextAtMs).toLocaleString()} — In: {formatCountdown(t.phNextAtMs - nowMs)}
                        </>
                      ) : null}
                    </div>
                  );
                } else {
                  detailLine = (
                    <div style={{ marginTop: 6, opacity: 0.9 }}>Real: {new Date(t.targetEarthMs).toLocaleString()}</div>
                  );
                }

                return (
                  <div key={t.id} style={styles.timerItem}>
                    <div style={styles.timerTop}>
                      <div style={styles.timerLabel}>{t.label}</div>
                      <div style={styles.muted}>
                        {pausedMs !== null ? "Paused" : t.enabled ? "Enabled" : "Disabled"}
                      </div>
                    </div>

                    {detailLine}

                    {nextDepartureAt !== null && nextDepartureVana !== null && (
                      <div style={{ marginTop: 8 }}>
                        <strong>Next departure in: {formatCountdown(nextDepartureAt - nowMs)}</strong>
                        <br />
                        Leaves (Vana):{" "}
                        <span style={weekdayStyle(nextDepartureVana.weekday)}>{nextDepartureVana.weekday}</span>{" "}
                        {formatVanaTime(nextDepartureVana.hour, nextDepartureVana.minute)}
                        <br />
                        Leaves (Earth): {new Date(nextDepartureAt).toLocaleString()}
                      </div>
                    )}

                    {nextArrivalAt !== null && nextArrivalVana !== null ? (
                      <div style={{ marginTop: 8 }}>
                        <strong>Next arrival in: {formatCountdown(nextArrivalAt - nowMs)}</strong>
                        <br />
                        Arrives (Vana):{" "}
                        <span style={weekdayStyle(nextArrivalVana.weekday)}>{nextArrivalVana.weekday}</span>{" "}
                        {formatVanaTime(nextArrivalVana.hour, nextArrivalVana.minute)}
                        <br />
                        Arrives (Earth): {new Date(nextArrivalAt).toLocaleString()}
                      </div>
                    ) : t.kind === "TRANSPORT" ? (
                      <div style={{ marginTop: 8, ...styles.muted }}>
                        Arrival schedule unavailable. Recreate this timer from a transport preset.
                      </div>
                    ) : null}

                    <div style={{ marginTop: 6, ...styles.muted }}>
                      {nextAt === null ? (
                        <>Next: No upcoming events.</>
                      ) : (
                        <>
                          {t.kind === "TRANSPORT" ? "Next alert" : "Next"} (Earth): {new Date(nextAt).toLocaleString()} — In: {formatCountdown(inMs)}
                          <br />
                          {t.kind === "TRANSPORT" ? "Next alert" : "Next"} (Vana):{" "}
                          <span style={weekdayStyle(vanaAt.weekday)}>{vanaAt.weekday}</span> {pad2(vanaAt.hour)}:
                          {pad2(vanaAt.minute)}
                        </>
                      )}
                    </div>

                    {departureAt !== null && departureVana !== null && departureAt !== nextDepartureAt && (
                      <div style={{ marginTop: 8 }}>
                        <strong>Departure for this alert</strong>
                        <br />
                        Leaves (Vana):{" "}
                        <span style={weekdayStyle(departureVana.weekday)}>{departureVana.weekday}</span>{" "}
                        {formatVanaTime(departureVana.hour, departureVana.minute)}
                        <br />
                        Leaves (Earth): {new Date(departureAt).toLocaleString()} — In: {formatCountdown(departureAt - nowMs)}
                      </div>
                    )}

                    <div style={styles.buttonRow}>
                      {t.kind === "EARTH_TIME" && isValidDuration(t.rawInput) && (
                        <>
                          <button
                            style={styles.button}
                            onClick={() =>
                              pausedMs !== null ? resumeCountdownTimer(t.id) : pauseCountdownTimer(t.id)
                            }
                            title={pausedMs !== null ? "Resume the countdown" : "Pause the countdown"}
                          >
                            {pausedMs !== null ? "Resume" : "Pause"}
                          </button>
                          <button
                            style={styles.button}
                            onClick={() => resetCountdownTimer(t.id)}
                            title={`Restart the ${t.rawInput.trim()} countdown from now`}
                          >
                            Reset
                          </button>
                        </>
                      )}

                      {(t.kind === "NM_TIMED_WINDOW" || t.kind === "NM_LOTTERY") && (
                        <button style={styles.button} onClick={() => resetNmBaseNow(t.id)}>
                          Set ToD now
                        </button>
                      )}

                      {t.kind === "NM_LOTTERY" && (
                        <>
                          <button
                            style={styles.button}
                            onClick={() => lotteryPhKilledNow(t.id)}
                            title="Resets the PH respawn countdown"
                          >
                            PH killed
                          </button>
                          {t.phNextAtMs ? (
                            <button style={styles.button} onClick={() => lotteryClearPh(t.id)}>
                              Clear PH
                            </button>
                          ) : null}
                        </>
                      )}

                      <button style={styles.button} onClick={() => toggleTimer(t.id)}>
                        {t.enabled ? "Disable" : "Enable"}
                      </button>
                      <button style={styles.button} onClick={() => deleteTimer(t.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
  );

  const calibrationContent = (
        <section style={styles.card}>
          <div style={styles.titleRow}>
            <h3 style={styles.h3}>Manual calibration</h3>
            <button style={styles.button} onClick={() => setShowCalibration((v) => !v)}>
              {showCalibration ? "Hide" : "Show"}
            </button>
          </div>

          {!showCalibration ? (
            <div style={{ marginTop: 10, ...styles.sub }}>
              Calibration is applied automatically. Use “Show” only if you want to recalibrate.
            </div>
          ) : (
            <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
              <div style={{ ...styles.sub, opacity: 0.9 }}>
                Day and Moon are calibrated separately. Saving either one overrides the default.
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <div style={styles.subCard}>
                  <div style={styles.titleRow}>
                    <div style={{ fontWeight: 800 }}>Day calibration</div>
                    <div style={styles.sub}>Match /clock</div>
                  </div>

                  <div style={{ marginTop: 10, ...styles.compactRow }}>
                    <div style={styles.field}>
                      <div style={styles.label}>Weekday</div>
                      <select
                        style={styles.select}
                        value={cWeekday}
                        onChange={(e) => setCWeekday(e.target.value as VanaWeekday)}
                      >
                        {WEEKDAYS.map((d) => (
                          <option
                            key={d}
                            value={d}
                            style={{
                              ...optionBaseStyle,
                              color: WEEKDAY_COLORS[d],
                              fontWeight: 800,
                            }}
                          >
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={styles.compactRow}>
                      <div style={styles.field}>
                        <div style={styles.label}>Hour</div>
                        <input style={styles.input} value={cHour} onChange={(e) => setCHour(e.target.value)} />
                      </div>
                      <div style={styles.field}>
                        <div style={styles.label}>Min</div>
                        <input style={styles.input} value={cMin} onChange={(e) => setCMin(e.target.value)} />
                      </div>
                    </div>
                  </div>

                  <div style={styles.buttonRow}>
                    <button style={styles.buttonPrimary} onClick={saveDayCalibration}>
                      Save day calibration
                    </button>
                  </div>

                  <div style={{ marginTop: 8, ...styles.sub }}>Stored offset (ms): {String(cal.timeOffsetMs)}</div>
                </div>

                <div style={styles.subCard}>
                  <div style={styles.titleRow}>
                    <div style={{ fontWeight: 800 }}>Moon calibration</div>
                    <div style={styles.sub}>Local time</div>
                  </div>

                  <div style={{ marginTop: 10, ...styles.field }}>
                    <div style={styles.label}>New Moon Start</div>
                    <input
                      style={styles.input}
                      type="text"
                      value={newMoonInput}
                      onChange={(e) => setNewMoonInput(e.target.value)}
                      placeholder="01/24/2026 03:14:24 AM  (or 2026-01-24T03:14:24)"
                    />
                    <div style={styles.sub}>Supports: MM/DD/YYYY HH:MM:SS AM, or YYYY-MM-DDTHH:MM(:SS)</div>
                  </div>

                  <div style={styles.buttonRow}>
                    <button style={styles.buttonPrimary} onClick={saveMoonCalibration}>
                      Save moon calibration
                    </button>
                    <button style={styles.button} onClick={clearCalibration}>
                      Reset to defaults
                    </button>
                  </div>

                  <div style={{ marginTop: 8, ...styles.sub }}>
                    Stored New Moon Start: {new Date(cal.newMoonStartEarthMs).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
  );

  const currentTab = TABS.find(tab => tab.id === activeTab)!;
  const headerToggle = (
    <button
      type="button"
      aria-label={headerCollapsed ? "Expand header" : "Collapse header"}
      title={headerCollapsed ? "Expand header" : "Collapse header"}
      aria-expanded={!headerCollapsed}
      aria-controls="main-navigation"
      style={{ ...styles.tabButton, width: headerCollapsed ? "auto" : 32, height: 32, padding: headerCollapsed ? "0 8px" : 0, justifyContent: "center", borderRadius: 8, flexShrink: 0 }}
      onClick={() => setHeaderCollapsed(collapsed => !collapsed)}
    >
      {headerCollapsed ? <PanelTopOpen size={18} aria-hidden="true" /> : <PanelTopClose size={18} aria-hidden="true" />}
      {headerCollapsed && <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center" }}>{currentTab.icon}</span>}
      {headerCollapsed && <span style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }} title={currentTab.label}>{currentTab.label}</span>}
    </button>
  );
  const tabBar = (
    <header hidden={headerCollapsed} style={{
      ...styles.tabBar,
      display: headerCollapsed ? "none" : "flex",
      flexWrap: "wrap",
      alignItems: "center",
      position: "static",
      background: "#0c0c0c",
    }}>
      <nav id="main-navigation" aria-label="Main navigation" hidden={headerCollapsed}
        style={{ display: headerCollapsed ? "none" : "flex", flexWrap: "wrap", gap: 8, minWidth: 0, flexBasis: "100%" }}>
      {!headerCollapsed && headerToggle}
      {TABS.map((tab) => {
        const active = tab.id === activeTab;
        const flashing = tab.id === "home" && homeTabFlash;
        return (
          <button
            key={tab.id}
            className={flashing ? "tab-flash" : undefined}
            style={active ? styles.tabButtonActive : styles.tabButton}
            onClick={() => switchTabWithScroll(activeTab, tab.id)}
          >
            <span aria-hidden>{tab.icon}</span>
            {tab.label}
            {tab.id === "home" && timers.length > 0 ? (
              <span style={styles.tabBadge}>{timers.length}</span>
            ) : null}
          </button>
        );
      })}
      </nav>
    </header>
  );

  return (
    <ScreenControlsProvider scope={activeTab}>
    <div style={{ ...styles.page, paddingTop: headerCollapsed ? 8 : 16, gap: headerCollapsed ? 8 : 12 }}>
      <div data-main-toolbar style={{ position: "sticky", top: 8, zIndex: 10, display: "flex", flexDirection: "column", gap: headerCollapsed ? 8 : 12 }}>
        {tabBar}
        <ScreenControlToggles>{headerCollapsed ? headerToggle : null}</ScreenControlToggles>
        {activeTab === "presets" && presetControls}
      </div>

      <div data-scroll-root style={{ display: "contents" }}>
      {activeTab === "home" && (
        <div style={{ ...styles.tabContent, gap: 16 }}>
          <div style={{ ...styles.tabGrid, alignItems: "start", gridAutoRows: "max-content" }}>{clockCard}</div>
          {timersListContent}
        </div>
      )}

      {activeTab === "timers" && (
        <div style={styles.tabContent}>
          <div style={{ ...styles.tabGrid, alignItems: "stretch" }}>
            {vanaTimerCard}
            {realLifeCard}
            {moonCard}
          </div>
          <StopwatchTab />
        </div>
      )}

      {activeTab === "nm" && (
        <div style={styles.tabContent}>
          {nmContent}
        </div>
      )}

      {activeTab === "presets" && (
        <div style={styles.tabContent}>
          {presetContent}
        </div>
      )}

      {activeTab === "counters" && (
        <div style={styles.tabContent}>
          <div>
            <div style={{ ...styles.tabGrid, alignItems: "start", gridAutoRows: "max-content" }}>{countersCard}</div>
          </div>
        </div>
      )}

      {activeTab === "luShang" && (
        <div style={styles.tabContent}>
          <div>
            <div style={{ ...styles.tabGrid, alignItems: "start", gridAutoRows: "max-content" }}>{luShangCard}</div>
          </div>
        </div>
      )}

      {activeTab === "fish" && (
        <div style={styles.tabContent}>
          <FishTab />
        </div>
      )}

      {activeTab === "clam" && (
        <div style={styles.tabContent}>
          <ClamTab />
        </div>
      )}

      {activeTab === "chocobo" && (
        <div style={styles.tabContent}>
          <ChocoboTab cal={cal} />
        </div>
      )}

      {activeTab === "weather" && (
        <div style={styles.tabContent}>
          <WeatherTab cal={cal} countdownNowMs={nowMs} activeTimerIds={activeTimerIds} onSetTimer={addWeatherTimer} />
        </div>
      )}

      {activeTab === "helm" && (
        <div style={styles.tabContent}>
          <React.Suspense fallback={<div style={styles.card}>Loading HELM...</div>}>
            <HelmTab />
          </React.Suspense>
        </div>
      )}

      {activeTab === "bcnm" && (
        <div style={styles.tabContent}>
          <BcnmTab />
        </div>
      )}

      {activeTab === "quests" && (
        <div style={styles.tabContent}>
          <React.Suspense fallback={<div style={styles.card}>Loading quests...</div>}>
            <QuestsTab />
          </React.Suspense>
        </div>
      )}

      {activeTab === "atlas" && (
        <div style={styles.tabContent}>
          <React.Suspense fallback={<div style={styles.card}>Loading atlas...</div>}>
            <AtlasTab />
          </React.Suspense>
        </div>
      )}

      {activeTab === "drops" && (
        <div style={styles.tabContent}>
          <React.Suspense fallback={<div style={styles.card}>Loading items...</div>}>
            <DropsTab />
          </React.Suspense>
        </div>
      )}

      {activeTab === "npc" && (
        <div style={styles.tabContent}>
          <React.Suspense fallback={<div style={styles.card}>Loading NPCs...</div>}>
            <NpcTab />
          </React.Suspense>
        </div>
      )}

      {activeTab === "bestiary" && (
        <div style={styles.tabContent}>
          <React.Suspense fallback={<div style={styles.card}>Loading bestiary...</div>}>
            <BestiaryTab />
          </React.Suspense>
        </div>
      )}

      {activeTab === "skillchains" && (
        <div style={styles.tabContent}>
          <SkillchainTab />
        </div>
      )}

      {activeTab === "crafting" && (
        <div style={styles.tabContent}>
          <React.Suspense fallback={<div style={styles.card}>Loading recipes...</div>}>
            <CraftingTab />
          </React.Suspense>
        </div>
      )}

      {activeTab === "printing" && (
        <div style={styles.tabContent}>
          <React.Suspense fallback={<div style={styles.card}>Loading profits...</div>}>
            <PrintingTab />
          </React.Suspense>
        </div>
      )}

      {activeTab === "calibration" && (
        <div style={styles.tabContent}>
          {calibrationContent}
        </div>
      )}
      </div>
    </div>
    </ScreenControlsProvider>
  );
}
