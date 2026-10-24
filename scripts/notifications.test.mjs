import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: 'export * from "./electron/notificationState"; export * from "./src/utils/timerSchedule"; export { presetTimerDetails } from "./src/utils/presetTimerDetails";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm",
});
const {
  NotificationQueue, popupBounds, parseNotificationSettings, isTimerNotification, isRunningTimer,
  runningTimerPreviews, nextTimerAt,
  presetTimerDetails,
  REPEAT_INTERVAL_MS, MAX_SOUND_REPEATS,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const secondary = { id: 2, workArea: { x: -2560, y: -200, width: 2560, height: 1400 } };
const alert = (key, id = "timer-1", repeat = true) => ({ key, id, title: "Kupo", body: "Timer due", repeat });

test("popup defaults to the primary work area, above taskbars", () => {
  assert.deepEqual(popupBounds(null, [primary, secondary], primary), { x: 1484, y: 704, width: 420, height: 320 });
});

test("saved secondary monitor and relative position survive serialization and monitor rearrangement", () => {
  const settings = parseNotificationSettings(JSON.parse(JSON.stringify({
    volume: 0.45, position: { displayId: 2, x: 150, y: 200 },
  })));
  assert.deepEqual(popupBounds(settings.position, [primary, secondary], primary),
    { x: -2410, y: 0, width: 420, height: 320 });
  const moved = { ...secondary, workArea: { ...secondary.workArea, x: 1920, y: 0 } };
  assert.deepEqual(popupBounds(settings.position, [primary, moved], primary),
    { x: 2070, y: 200, width: 420, height: 320 });
});

test("missing monitors fall back to primary and changed DPI/work areas clamp the popup on screen", () => {
  const position = { displayId: 2, x: 2300, y: 1300 };
  assert.deepEqual(popupBounds(position, [primary], primary), popupBounds(null, [primary], primary));
  assert.deepEqual(popupBounds(position, [primary, secondary], primary),
    { x: -420, y: 880, width: 420, height: 320 });
  const tiny = { id: 3, workArea: { x: 50, y: 40, width: 300, height: 240 } };
  assert.deepEqual(popupBounds({ displayId: 3, x: -400, y: -100 }, [tiny], tiny), tiny.workArea);
});

test("popup size survives saving, legacy settings keep the default, and oversized windows stay reachable", () => {
  const settings = parseNotificationSettings(JSON.parse(JSON.stringify({
    volume: 0.3, position: { displayId: 2, x: 100, y: 200 }, size: { width: 640, height: 700 },
  })));
  assert.deepEqual(popupBounds(settings.position, [primary, secondary], primary, settings.size),
    { x: -2460, y: 0, width: 640, height: 700 });
  assert.deepEqual(parseNotificationSettings({ volume: 0.3, position: null }).size, { width: 420, height: 320 });
  assert.deepEqual(popupBounds(settings.position, [primary], primary, { width: 4000, height: 3000 }), primary.workArea);
  for (const size of [null, {}, { width: 100, height: 700 }, { width: 640, height: Infinity }]) {
    assert.throws(() => parseNotificationSettings({ volume: 0.3, position: null, size }), /Invalid/);
  }
});

test("running timers sort by remaining time, not creation order or original duration", () => {
  const base = { kind: "EARTH_TIME", enabled: true, createdAtMs: 0, rawInput: "" };
  const timers = [
    { ...base, id: "later", label: "Later", targetEarthMs: 50000 },
    { ...base, id: "soon", label: "Soon", targetEarthMs: 20000 },
    { ...base, id: "disabled", label: "Disabled", enabled: false, targetEarthMs: 1000 },
    { ...base, id: "paused", label: "Paused", pausedRemainingMs: 1000, targetEarthMs: 5000 },
  ];
  const rows = runningTimerPreviews(timers, 10000, { timeOffsetMs: 0, newMoonStartEarthMs: 0 });
  assert.deepEqual(rows, [
    { id: "soon", label: "Soon", targetEarthMs: 20000 },
    { id: "later", label: "Later", targetEarthMs: 50000 },
  ]);
  assert.equal(timers[0].id, "later", "sorting must not reorder saved main-window timers");
  assert.ok(rows.every(isRunningTimer));
  assert.equal(isRunningTimer({ ...rows[0], targetEarthMs: NaN }), false);
});

test("running previews use shared transport, weekday, moon, NM and gardening schedules", () => {
  const base = { enabled: true, createdAtMs: 0, label: "Schedule" };
  const cal = { timeOffsetMs: 0, newMoonStartEarthMs: 0 };
  const now = 10000;
  const transport = { ...base, id: "transport", kind: "TRANSPORT", departureMinutes: [480], offsetHours: 125 / 60 };
  assert.equal(nextTimerAt(transport, now, cal), 480 * 2400 - 300000);
  const nm = { ...base, id: "nm", kind: "NM_TIMED_WINDOW", baseEarthMs: 0,
    windowStartOffsetMs: 60000, windowEndOffsetMs: 120000, intervalMs: 30000, warnLeadMs: 10000 };
  assert.equal(nextTimerAt(nm, now, cal), 50000);
  assert.equal(nextTimerAt({ ...base, id: "garden", kind: "GARDENING", plantedAtMs: 0, feeds: [],
    harvestGrowthMs: 80000, notifiedEvents: [] }, now, cal), 80000);
  for (const timer of [
    { ...base, id: "weekday", kind: "VANA_WEEKDAY_TIME", targetWeekday: "Firesday", targetHour: 6, targetMinute: 0 },
    { ...base, id: "moon", kind: "MOON_STEP", targetMoonStep: 50 },
    { ...base, id: "percent", kind: "MOON_PERCENT", targetPercent: 50 },
    { ...base, id: "lottery", kind: "NM_LOTTERY", baseEarthMs: 0, warnLeadMs: 1000, phRespawnMs: 300000, phNextAtMs: 300000 },
  ]) {
    const rows = runningTimerPreviews([timer], now, cal);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].targetEarthMs, nextTimerAt(timer, now, cal));
    assert.ok(rows[0].targetEarthMs > now);
  }
});

test("preset button details identify the selected lead time and local fire time", () => {
  const nowMs = new Date(2026, 9, 15, 12, 0, 0).getTime();
  const fireAtMs = nowMs + 5 * 60_000;
  assert.deepEqual(presetTimerDetails("5 real-time minutes", 5, "departure", fireAtMs, nowMs), {
    offset: "5 real-time minutes before departure",
    localFireTime: new Date(fireAtMs).toLocaleString(),
    timeUntil: "00:05:00",
  });
  assert.deepEqual(presetTimerDetails("0 Vana'diel hours", 0, "the next Vana'diel day boundary", fireAtMs, nowMs), {
    offset: "No lead time (at the next Vana'diel day boundary)",
    localFireTime: new Date(fireAtMs).toLocaleString(),
    timeUntil: "00:05:00",
  });
});

test("invalid saved settings and malformed timer messages fail validation", () => {
  for (const value of [null, {}, { volume: NaN, position: null }, { volume: 2, position: null },
    { volume: 0.5 }, { volume: 0.5, position: { displayId: 2, x: "1", y: 0 } }]) {
    assert.throws(() => parseNotificationSettings(value), /Invalid/);
  }
  assert.equal(isTimerNotification(alert("one")), true);
  for (const value of [null, {}, { ...alert("one"), key: "" }, { ...alert("one"), repeat: "yes" }]) {
    assert.equal(isTimerNotification(value), false);
  }
});

test("simultaneous notifications are retained and clicking dismisses only that occurrence", () => {
  const queue = new NotificationQueue();
  assert.equal(queue.add(alert("first"), 0), true);
  assert.equal(queue.add(alert("second", "timer-2"), 0), true);
  assert.equal(queue.add(alert("first"), 1), false);
  queue.dismiss("first");
  assert.deepEqual(queue.alerts.map(entry => entry.key), ["second"]);
  assert.equal(queue.add(alert("first"), 2), false, "dismissed occurrences must not reappear");
  assert.equal(queue.add(alert("next-day"), 3), true, "recurring timers may fire on their next occurrence");
  assert.deepEqual(queue.alerts.map(entry => entry.key), ["second", "next-day"]);
});

test("sound repeats are coalesced, capped, and stop immediately on dismissal", () => {
  const queue = new NotificationQueue();
  queue.add(alert("one"), 0);
  queue.add(alert("two", "timer-2"), 0);
  assert.equal(queue.repeatDue(REPEAT_INTERVAL_MS - 1), false);
  for (let repeat = 1; repeat <= MAX_SOUND_REPEATS; repeat++) {
    assert.equal(queue.repeatDue(repeat * REPEAT_INTERVAL_MS), true);
    assert.equal(queue.repeatDue(repeat * REPEAT_INTERVAL_MS), false);
  }
  assert.equal(queue.repeatDue((MAX_SOUND_REPEATS + 1) * REPEAT_INTERVAL_MS), false);
  assert.equal(queue.alerts.length, 2, "sound cap must not discard unread alerts");
  queue.dismissAll();
  assert.equal(queue.alerts.length, 0);
  assert.equal(queue.repeatDue(1_000_000), false);
});

test("dismissing one alert retains other alerts for their next scheduled repeat", () => {
  const queue = new NotificationQueue();
  queue.add(alert("dismissed", "first-timer"), 0);
  queue.add(alert("pending", "second-timer"), 1000);
  queue.dismiss("dismissed");
  assert.deepEqual(queue.alerts.map(entry => entry.key), ["pending"]);
  assert.equal(queue.repeatDue(REPEAT_INTERVAL_MS), false);
  assert.equal(queue.repeatDue(REPEAT_INTERVAL_MS + 1000), true);
  assert.deepEqual(queue.alerts.map(entry => entry.key), ["pending"]);
  queue.dismissAll();
  assert.equal(queue.repeatDue(2 * REPEAT_INTERVAL_MS + 1000), false);
});

test("one-shot NM/gardening alerts do not repeat; deleting/disabling clears all occurrences of that timer", () => {
  const queue = new NotificationQueue();
  queue.add(alert("nm-one", "nm", false), 0);
  queue.add(alert("nm-two", "nm", false), 1000);
  assert.equal(queue.repeatDue(1_000_000), false);
  queue.add(alert("daily", "daily"), 0);
  queue.stopTimer("nm");
  assert.deepEqual(queue.alerts.map(entry => entry.key), ["daily"]);
  queue.stopTimer("daily");
  assert.equal(queue.repeatDue(1_000_000), false);
});

test("a timer remains alerting until its last pending occurrence is dismissed, even after sound stops", () => {
  const queue = new NotificationQueue();
  queue.add(alert("first"), 0);
  queue.add(alert("second"), 1);
  const activeIds = () => [...new Set(queue.alerts.map(entry => entry.id))];
  for (let repeat = 1; repeat <= MAX_SOUND_REPEATS; repeat++) {
    queue.repeatDue(repeat * REPEAT_INTERVAL_MS + 1);
  }
  assert.equal(queue.repeatDue(1_000_000), false);
  assert.deepEqual(activeIds(), ["timer-1"]);
  queue.dismiss("first");
  assert.deepEqual(activeIds(), ["timer-1"]);
  queue.dismiss("second");
  assert.deepEqual(activeIds(), []);
});

test("bundled original chime is a short, non-clipping mono PCM sound with silent edges", () => {
  const wav = readFileSync(new URL("../src/assets/timer-chime.wav", import.meta.url));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  const duration = wav.readUInt32LE(40) / wav.readUInt32LE(28);
  assert.ok(duration >= 1 && duration <= 1.5);
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  assert.ok(peak > 1000 && peak < 16384, `Expected a gentle but audible chime, got peak ${peak}`);
  assert.equal(wav.readInt16LE(44), 0);
  assert.equal(wav.readInt16LE(wav.length - 2), 0);
});

const desktopBundle = buildSync({
  stdin: {
    contents: 'import "./electron/main"; export { DesktopNotifications } from "./electron/notifications";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    loader: "ts",
  },
  define: { "import.meta.url": JSON.stringify(new URL("../electron/main.ts", import.meta.url).href) },
  bundle: true, write: false, platform: "node", format: "cjs", external: ["electron"],
}).outputFiles[0].text;
const require = createRequire(import.meta.url);

function desktopHarness(platform) {
  const calls = [];
  const windows = [];
  const handlers = new Map();
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
  ipcMain.removeHandler = channel => handlers.delete(channel);
  const app = new EventEmitter();
  app.commandLine = { appendSwitch: (...args) => calls.push(["switch", ...args]) };
  app.disableHardwareAcceleration = () => calls.push(["software-rendering"]);
  app.whenReady = () => {
    calls.push(["whenReady"]);
    return { then() {} };
  };
  const screen = new EventEmitter();
  screen.getAllDisplays = () => [primary];
  screen.getPrimaryDisplay = () => primary;
  screen.getDisplayMatching = () => primary;
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.webContents = new EventEmitter();
      this.webContents.send = () => {};
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    setAlwaysOnTop(...args) { calls.push(["alwaysOnTop", ...args]); }
    setVisibleOnAllWorkspaces(...args) { calls.push(["workspaces", ...args]); }
    setMinimumSize() {}
    setBounds(bounds) { this.bounds = bounds; }
    getBounds() { return this.bounds; }
    isVisible() { return this.visible; }
    isDestroyed() { return false; }
    showInactive() { this.visible = true; calls.push(["showInactive"]); }
    moveTop() { calls.push(["moveTop"]); }
    hide() { this.visible = false; calls.push(["hide"]); }
    destroy() { this.emit("closed"); }
    loadFile() { return Promise.resolve(); }
  }
  const mainWindow = { webContents: { send() {} } };
  const electron = { app, BrowserWindow: Window, ipcMain, screen };
  const module = { exports: {} };
  runInNewContext(desktopBundle, {
    module, exports: module.exports,
    require: name => {
      if (name === "electron") return electron;
      if (name === "node:fs") return { ...require(name), existsSync: () => false };
      return require(name);
    },
    process: { platform, env: {} },
    console,
    setInterval: () => 1, clearInterval() {},
    setTimeout, clearTimeout,
  });
  return {
    calls, windows, handlers, ipcMain, mainWindow,
    createNotifications: () => new module.exports.DesktopNotifications({
      mainWindow: () => mainWindow,
      userData: "unused", preload: "preload.cjs", rendererDirectory: "dist",
    }),
  };
}

for (const platform of ["linux", "win32", "darwin"]) {
  test(`${platform}: startup selects Linux rendering defaults before app readiness only on Linux`, () => {
    const { calls } = desktopHarness(platform);
    const software = calls.findIndex(([name]) => name === "software-rendering");
    const ozone = calls.findIndex(([name, flag]) => name === "switch" && flag === "ozone-platform");
    const ready = calls.findIndex(([name]) => name === "whenReady");
    if (platform === "linux") {
      assert.ok(software >= 0 && software < ready);
      assert.ok(ozone >= 0 && ozone < ready);
      assert.deepEqual(calls[ozone], ["switch", "ozone-platform", "x11"]);
    } else {
      assert.equal(software, -1);
      assert.equal(ozone, -1);
    }
  });

  test(`${platform}: popup uses platform stacking without focus, preserves updates and reopens`, () => {
    const { calls, windows, handlers, ipcMain, mainWindow, createNotifications } = desktopHarness(platform);
    const notifications = createNotifications();
    try {
      handlers.get("kupo:notification-open")({ sender: mainWindow.webContents });
      const popup = windows[0];
      assert.equal(popup.options.type, undefined, "keep a normal managed window; KDE disallows resizing notification windows");
      assert.equal(popup.options.alwaysOnTop, true);
      assert.equal(popup.options.resizable, true);
      assert.notEqual(popup.options.focusable, false, "retain keyboard interaction and window-manager resizing");
      assert.equal(popup.options.webPreferences.sandbox, true);
      assert.equal(popup.isVisible(), false, "wait for the popup renderer before showing");
      const popupEvent = { sender: popup.webContents };
      handlers.get("kupo:notification-state")(popupEvent);
      assert.equal(popup.isVisible(), true);
      assert.deepEqual(calls.filter(([name]) => ["showInactive", "moveTop"].includes(name)),
        platform === "linux" ? [["showInactive"], ["moveTop"]] : [["showInactive"]]);
      const raises = () => calls.filter(([name]) => name === "moveTop").length;
      const before = raises();
      ipcMain.emit("kupo:notification-timers", { sender: mainWindow.webContents },
        [{ id: "timer", label: "Timer", targetEarthMs: 1000 }]);
      assert.equal(raises(), before, "ordinary countdown updates must not repeatedly raise the popup");
      ipcMain.emit("kupo:notify", { sender: mainWindow.webContents }, alert("new-alert"));
      assert.equal(raises(), before + (platform === "linux" ? 1 : 0));
      ipcMain.emit("kupo:notification-dismiss-all", popupEvent);
      assert.equal(popup.isVisible(), false);
      handlers.get("kupo:notification-preview")({ sender: mainWindow.webContents });
      assert.equal(popup.isVisible(), true);
      assert.equal(windows.length, 1, "reuse the popup after dismissal");
      assert.equal(raises(), before + (platform === "linux" ? 2 : 0));
    } finally {
      notifications.dispose();
    }
  });
}
