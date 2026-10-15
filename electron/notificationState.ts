import type { RunningTimer, TimerNotification } from "../src/notifications/types";

export const POPUP_WIDTH = 420;
export const POPUP_HEIGHT = 320;
export const POPUP_MIN_WIDTH = 320;
export const POPUP_MIN_HEIGHT = 220;
export const REPEAT_INTERVAL_MS = 20_000;
export const MAX_SOUND_REPEATS = 10;
export const PREVIEW_KEY = "kupo-notification-preview";

type WorkArea = { x: number; y: number; width: number; height: number };
export type PopupDisplay = { id: number; workArea: WorkArea };
export type PopupPosition = { displayId: number; x: number; y: number };
export type PopupSize = { width: number; height: number };
export type SavedNotificationSettings = { volume: number; position: PopupPosition | null; size: PopupSize };

export function parseNotificationSettings(value: unknown): SavedNotificationSettings {
  if (!value || typeof value !== "object" || !("volume" in value) ||
    typeof value.volume !== "number" || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1 ||
    !("position" in value)) {
    throw new Error("Invalid notification settings.");
  }
  let size: PopupSize = { width: POPUP_WIDTH, height: POPUP_HEIGHT };
  if ("size" in value) {
    if (!value.size || typeof value.size !== "object" ||
      !("width" in value.size) || typeof value.size.width !== "number" || !Number.isSafeInteger(value.size.width) || value.size.width < POPUP_MIN_WIDTH ||
      !("height" in value.size) || typeof value.size.height !== "number" || !Number.isSafeInteger(value.size.height) || value.size.height < POPUP_MIN_HEIGHT) {
      throw new Error("Invalid notification popup size.");
    }
    size = { width: value.size.width, height: value.size.height };
  }
  const position = value.position;
  if (position === null) return { volume: value.volume, position: null, size };
  if (
    typeof position !== "object" ||
    !("displayId" in position) || typeof position.displayId !== "number" || !Number.isSafeInteger(position.displayId) ||
    !("x" in position) || typeof position.x !== "number" || !Number.isSafeInteger(position.x) ||
    !("y" in position) || typeof position.y !== "number" || !Number.isSafeInteger(position.y)
  ) {
    throw new Error("Invalid notification popup position.");
  }
  return { volume: value.volume, position: { displayId: position.displayId, x: position.x, y: position.y }, size };
}

export function popupBounds(position: PopupPosition | null, displays: PopupDisplay[], primary: PopupDisplay,
  size: PopupSize = { width: POPUP_WIDTH, height: POPUP_HEIGHT }): WorkArea {
  const savedDisplay = position && displays.find(display => display.id === position.displayId);
  const area = (savedDisplay || primary).workArea;
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const x = savedDisplay && position ? position.x : area.width - width - 16;
  const y = savedDisplay && position ? position.y : area.height - height - 16;
  return {
    x: area.x + Math.max(0, Math.min(x, area.width - width)),
    y: area.y + Math.max(0, Math.min(y, area.height - height)),
    width,
    height,
  };
}

export function isRunningTimer(value: unknown): value is RunningTimer {
  return !!value && typeof value === "object" &&
    "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "label" in value && typeof value.label === "string" &&
    "targetEarthMs" in value && typeof value.targetEarthMs === "number" && Number.isFinite(value.targetEarthMs);
}

export function isTimerNotification(value: unknown): value is TimerNotification {
  if (!value || typeof value !== "object") return false;
  return "key" in value && typeof value.key === "string" && value.key.length > 0 &&
    "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "title" in value && typeof value.title === "string" &&
    "body" in value && typeof value.body === "string" &&
    (!("repeat" in value) || value.repeat === undefined || typeof value.repeat === "boolean");
}

export class NotificationQueue {
  private entries = new Map<string, { alert: TimerNotification; nextSoundAt: number; repeats: number }>();
  private lastKeyByTimer = new Map<string, string>();

  get alerts(): TimerNotification[] {
    return [...this.entries.values()].map(entry => entry.alert);
  }

  add(alert: TimerNotification, now: number): boolean {
    if (this.lastKeyByTimer.get(alert.id) === alert.key) return false;
    this.lastKeyByTimer.set(alert.id, alert.key);
    this.entries.set(alert.key, { alert, nextSoundAt: now + REPEAT_INTERVAL_MS, repeats: 0 });
    return true;
  }

  dismiss(key: string) {
    this.entries.delete(key);
  }

  dismissAll() {
    this.entries.clear();
  }

  stopTimer(id: string) {
    for (const [key, entry] of this.entries) {
      if (entry.alert.id === id) this.entries.delete(key);
    }
    this.lastKeyByTimer.delete(id);
  }

  repeatDue(now: number): boolean {
    let play = false;
    for (const entry of this.entries.values()) {
      if (entry.alert.repeat !== false && entry.repeats < MAX_SOUND_REPEATS && now >= entry.nextSoundAt) {
        entry.repeats++;
        entry.nextSoundAt = now + REPEAT_INTERVAL_MS;
        play = true;
      }
    }
    return play;
  }
}
