import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NotificationSettings, NotificationState, RunningTimer } from "../src/notifications/types";
import {
  isRunningTimer, isTimerNotification, NotificationQueue, parseNotificationSettings, popupBounds,
  POPUP_WIDTH, POPUP_HEIGHT, POPUP_MIN_WIDTH, POPUP_MIN_HEIGHT, PREVIEW_KEY, type SavedNotificationSettings,
} from "./notificationState";

export class DesktopNotifications {
  private popup: BrowserWindow | null = null;
  private ready = false;
  private disposed = false;
  private queue = new NotificationQueue();
  private timers: RunningTimer[] = [];
  private windowOpen = false;
  private settings: SavedNotificationSettings = { volume: 0.45, position: null, size: { width: POPUP_WIDTH, height: POPUP_HEIGHT } };
  private error: string | null = null;
  private soundSequence = 0;
  private moveTimeout: NodeJS.Timeout | undefined;
  private programmaticPosition: { x: number; y: number; width: number; height: number } | null = null;
  private repeatInterval: NodeJS.Timeout;
  private readonly settingsPath: string;

  constructor(private options: {
    mainWindow: () => BrowserWindow | null;
    userData: string;
    preload: string;
    rendererDirectory: string;
    devServerUrl?: string;
  }) {
    this.settingsPath = path.join(options.userData, "notification-settings.json");
    if (existsSync(this.settingsPath)) {
      try {
        this.settings = parseNotificationSettings(JSON.parse(readFileSync(this.settingsPath, "utf8")));
      } catch (error) {
        this.reportError("Could not read notification settings; using the default position, size, and volume.", error);
      }
    }
    this.repeatInterval = setInterval(() => {
      if (this.queue.repeatDue(Date.now())) {
        this.windowOpen = true;
        this.publish(true);
      }
    }, 1000);
    screen.on("display-removed", this.reposition);
    screen.on("display-added", this.reposition);
    screen.on("display-metrics-changed", this.reposition);
    this.registerIpc();
  }

  private reportError(message: string, cause?: unknown) {
    console.error(`[Kupo notifications] ${message}`, cause ?? "");
    this.error = message;
    this.options.mainWindow()?.webContents.send("kupo:notification-error", message);
  }

  private saveSettings() {
    try {
      const temporary = `${this.settingsPath}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.settings), "utf8");
      renameSync(temporary, this.settingsPath);
    } catch (error) {
      this.reportError("Could not save the notification position, size, or volume. Check access to Kupo's data folder.", error);
      this.publish();
      throw error;
    }
  }

  private getSettings(): NotificationSettings {
    return { volume: this.settings.volume, error: this.error };
  }

  private getState(): NotificationState {
    return { ...this.getSettings(), alerts: this.queue.alerts, timers: this.timers,
      soundSequence: this.soundSequence, windowOpen: this.windowOpen };
  }

  private fromMain(event: IpcMainEvent | IpcMainInvokeEvent) {
    return event.sender === this.options.mainWindow()?.webContents;
  }

  private fromPopup(event: IpcMainEvent | IpcMainInvokeEvent) {
    return event.sender === this.popup?.webContents;
  }

  private registerIpc() {
    ipcMain.on("kupo:notify", (event, payload: unknown) => {
      if (!this.fromMain(event)) return;
      if (!isTimerNotification(payload)) {
        this.reportError("Rejected an invalid timer notification.");
        return;
      }
      if (this.queue.add(payload, Date.now())) {
        this.windowOpen = true;
        this.publish(true);
      }
    });
    ipcMain.on("kupo:notification-timers", (event, payload: unknown) => {
      if (!this.fromMain(event)) return;
      if (!Array.isArray(payload) || !payload.every(isRunningTimer)) {
        this.reportError("Rejected an invalid running timer list.");
        return;
      }
      const timers = payload.sort((first, second) => first.targetEarthMs - second.targetEarthMs);
      if (timers.length === this.timers.length && timers.every((timer, index) =>
        timer.id === this.timers[index].id && timer.label === this.timers[index].label &&
        timer.targetEarthMs === this.timers[index].targetEarthMs)) return;
      this.timers = timers;
      this.publish();
    });
    ipcMain.handle("kupo:notification-open", event => {
      if (!this.fromMain(event)) throw new Error("The timer window can only be opened from Kupo.");
      this.windowOpen = true;
      this.publish();
    });
    ipcMain.on("kupo:notification-hide", event => {
      if (!this.fromPopup(event)) return;
      this.hide();
    });
    ipcMain.on("kupo:notification-stop", (event, id: unknown) => {
      if (!this.fromMain(event) || typeof id !== "string") return;
      this.queue.stopTimer(id);
      this.publish();
    });
    ipcMain.handle("kupo:notification-settings", event => {
      if (!this.fromMain(event)) throw new Error("Notification settings are only available to the main window.");
      return this.getSettings();
    });
    ipcMain.handle("kupo:notification-volume", (event, volume: unknown) => {
      if (!this.fromMain(event) || typeof volume !== "number" || !Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw new Error("Invalid notification volume request.");
      }
      this.settings.volume = volume;
      this.saveSettings();
      this.publish();
      return this.getSettings();
    });
    ipcMain.handle("kupo:notification-preview", event => {
      if (!this.fromMain(event)) throw new Error("Notification preview is only available to the main window.");
      this.preview();
    });
    ipcMain.handle("kupo:notification-reset", event => {
      if (!this.fromMain(event)) throw new Error("Notification positioning is only available to the main window.");
      clearTimeout(this.moveTimeout);
      this.settings.position = null;
      this.saveSettings();
      this.reposition();
      this.preview();
    });
    ipcMain.handle("kupo:notification-state", event => {
      if (this.fromPopup(event)) {
        this.ready = true;
        this.publish();
      } else if (!this.fromMain(event)) {
        throw new Error("Notification state is only available to Kupo windows.");
      }
      return this.getState();
    });
    ipcMain.on("kupo:notification-dismiss", (event, key: unknown) => {
      if (!this.fromPopup(event) || typeof key !== "string") return;
      this.queue.dismiss(key);
      this.windowOpen = this.queue.alerts.length > 0;
      this.publish();
    });
    ipcMain.on("kupo:notification-dismiss-all", event => {
      if (!this.fromPopup(event)) return;
      this.hide();
    });
    ipcMain.on("kupo:notification-audio-error", (event, message: unknown) => {
      if (!this.fromPopup(event) || typeof message !== "string") return;
      this.reportError(`Alert sound could not play: ${message}`);
      this.publish();
    });
  }

  private preview() {
    this.windowOpen = true;
    this.queue.stopTimer(PREVIEW_KEY);
    this.queue.add({
      key: PREVIEW_KEY, id: PREVIEW_KEY, title: "Test notification",
      body: "Drag the header to move this window, or its edges to resize. Kupo remembers both. Click here to dismiss this test.",
      repeat: false,
    }, Date.now());
    this.publish(true);
  }

  private ensurePopup() {
    if (this.popup || this.disposed) return;
    const bounds = popupBounds(this.settings.position, screen.getAllDisplays(), screen.getPrimaryDisplay(), this.settings.size);
    const popup = new BrowserWindow({
      ...bounds,
      title: "Kupo timer alerts",
      show: false,
      frame: false,
      resizable: true,
      minWidth: Math.min(POPUP_MIN_WIDTH, bounds.width),
      minHeight: Math.min(POPUP_MIN_HEIGHT, bounds.height),
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#10141e",
      webPreferences: {
        preload: this.options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    this.popup = popup;
    popup.setAlwaysOnTop(true, "screen-saver");
    popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    popup.webContents.on("will-navigate", event => event.preventDefault());
    popup.webContents.on("render-process-gone", (_event, details) => {
      this.reportError(`The notification popup stopped (${details.reason}). Use Test / position popup to reopen it.`);
      popup.destroy();
    });
    const boundsChanged = () => {
      const bounds = popup.getBounds();
      if (this.programmaticPosition?.x === bounds.x && this.programmaticPosition.y === bounds.y &&
        this.programmaticPosition.width === bounds.width && this.programmaticPosition.height === bounds.height) return;
      this.programmaticPosition = null;
      clearTimeout(this.moveTimeout);
      this.moveTimeout = setTimeout(() => this.rememberPosition(), 200);
    };
    popup.on("move", boundsChanged);
    popup.on("resize", boundsChanged);
    popup.on("close", event => {
      if (this.disposed) return;
      event.preventDefault();
      this.hide();
    });
    popup.on("closed", () => {
      clearTimeout(this.moveTimeout);
      this.popup = null;
      this.ready = false;
    });
    const load = this.options.devServerUrl
      ? popup.loadURL(new URL("src/notifications/index.html", this.options.devServerUrl).href)
      : popup.loadFile(path.join(this.options.rendererDirectory, "src", "notifications", "index.html"));
    void load.catch(error => {
      this.reportError("Could not load the notification popup. Use Test / position popup to retry.", error);
      popup.destroy();
    });
  }

  private rememberPosition() {
    clearTimeout(this.moveTimeout);
    this.moveTimeout = undefined;
    if (!this.popup || this.popup.isDestroyed()) return;
    const bounds = this.popup.getBounds();
    const display = screen.getDisplayMatching(bounds);
    this.settings.position = {
      displayId: display.id,
      x: bounds.x - display.workArea.x,
      y: bounds.y - display.workArea.y,
    };
    this.settings.size = { width: Math.max(POPUP_MIN_WIDTH, bounds.width), height: Math.max(POPUP_MIN_HEIGHT, bounds.height) };
    try {
      this.saveSettings();
    } catch {
      // saveSettings reports the persistence error to both windows.
    }
  }

  private reposition = () => {
    const bounds = popupBounds(this.settings.position, screen.getAllDisplays(), screen.getPrimaryDisplay(), this.settings.size);
    this.programmaticPosition = bounds;
    this.popup?.setMinimumSize(Math.min(POPUP_MIN_WIDTH, bounds.width), Math.min(POPUP_MIN_HEIGHT, bounds.height));
    this.popup?.setBounds(bounds);
  };

  private hide() {
    this.windowOpen = false;
    this.queue.dismissAll();
    this.publish();
  }

  private publish(sound = false) {
    if (this.disposed) return;
    if (sound) this.soundSequence++;
    this.options.mainWindow()?.webContents.send("kupo:notification-state-changed", this.getState());
    if (this.windowOpen) this.ensurePopup();
    if (!this.popup || !this.ready) return;
    this.popup.webContents.send("kupo:notification-state-changed", this.getState());
    if (this.windowOpen) {
      if (!this.popup.isVisible()) {
        this.reposition();
        this.popup.showInactive();
        if (process.platform === "linux") this.popup.moveTop();
      } else if (sound && process.platform === "linux") {
        this.popup.moveTop();
      }
    } else {
      if (this.moveTimeout) this.rememberPosition();
      this.popup.hide();
    }
  }

  dispose() {
    if (this.disposed) return;
    if (this.moveTimeout) this.rememberPosition();
    this.disposed = true;
    clearInterval(this.repeatInterval);
    clearTimeout(this.moveTimeout);
    screen.removeListener("display-removed", this.reposition);
    screen.removeListener("display-added", this.reposition);
    screen.removeListener("display-metrics-changed", this.reposition);
    for (const channel of [
      "kupo:notify", "kupo:notification-stop", "kupo:notification-dismiss",
      "kupo:notification-dismiss-all", "kupo:notification-audio-error", "kupo:notification-timers", "kupo:notification-hide",
    ]) ipcMain.removeAllListeners(channel);
    for (const channel of [
      "kupo:notification-settings", "kupo:notification-volume", "kupo:notification-preview",
      "kupo:notification-reset", "kupo:notification-state", "kupo:notification-open",
    ]) ipcMain.removeHandler(channel);
    this.popup?.destroy();
  }
}
