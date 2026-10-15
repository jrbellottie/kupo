import { contextBridge, ipcRenderer } from "electron";
import type { NotificationBridge, NotificationState } from "../src/notifications/types";

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    send: (channel: string, data?: unknown) => {
      if (channel === "ffxi:keepAwake") ipcRenderer.send(channel, data);
    },
  },
});

const notifications: NotificationBridge = {
  notify: notification => ipcRenderer.send("kupo:notify", notification),
  stopTimer: id => ipcRenderer.send("kupo:notification-stop", id),
  syncTimers: timers => ipcRenderer.send("kupo:notification-timers", timers),
  open: () => ipcRenderer.invoke("kupo:notification-open"),
  hide: () => ipcRenderer.send("kupo:notification-hide"),
  preview: () => ipcRenderer.invoke("kupo:notification-preview"),
  resetPosition: () => ipcRenderer.invoke("kupo:notification-reset"),
  getSettings: () => ipcRenderer.invoke("kupo:notification-settings"),
  setVolume: volume => ipcRenderer.invoke("kupo:notification-volume", volume),
  onError: listener => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message);
    ipcRenderer.on("kupo:notification-error", handler);
    return () => ipcRenderer.removeListener("kupo:notification-error", handler);
  },
  getState: () => ipcRenderer.invoke("kupo:notification-state"),
  onState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: NotificationState) => listener(state);
    ipcRenderer.on("kupo:notification-state-changed", handler);
    return () => ipcRenderer.removeListener("kupo:notification-state-changed", handler);
  },
  dismiss: key => ipcRenderer.send("kupo:notification-dismiss", key),
  dismissAll: () => ipcRenderer.send("kupo:notification-dismiss-all"),
  reportAudioError: message => ipcRenderer.send("kupo:notification-audio-error", message),
};
contextBridge.exposeInMainWorld("kupoNotifications", notifications);
