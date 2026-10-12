import { app, BrowserWindow, ipcMain, Notification, powerSaveBlocker, screen, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;

let win: BrowserWindow | null = null;

// IMPORTANT: these must be set BEFORE app.whenReady()
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

// Keep the OS from suspending the app ONLY while timers are enabled (renderer-controlled)
let keepAwakeId: number | null = null;

function ensureKeepAwakeOn() {
  if (keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId)) return;
  keepAwakeId = powerSaveBlocker.start("prevent-app-suspension");
}

function ensureKeepAwakeOff() {
  if (keepAwakeId === null) return;
  if (powerSaveBlocker.isStarted(keepAwakeId)) powerSaveBlocker.stop(keepAwakeId);
  keepAwakeId = null;
}

// Track repeating alarms by id
const repeaters = new Map<string, NodeJS.Timeout>();

function stopRepeater(id: string) {
  const t = repeaters.get(id);
  if (t) clearInterval(t);
  repeaters.delete(id);
}

function createWindow() {
  // Near-fullscreen on a 1080p display, clamped to smaller screens
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: Math.min(1600, workArea.width),
    height: Math.min(960, workArea.height),
    // Dev-only: packaged builds get the icon from the exe (build/icon.ico via electron-builder)
    ...(VITE_DEV_SERVER_URL ? { icon: path.join(process.env.APP_ROOT, "build", "icon.ico") } : {}),
    webPreferences: {
      // Renderer timers won't be throttled when minimized/hidden
      backgroundThrottling: false,

      // IMPORTANT: this must point to the BUILT preload (vite-electron builds to preload.mjs)
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  // External links (e.g. wiki pages) open in the user's default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    ensureKeepAwakeOff();
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(() => {
  app.setAppUserModelId("kupo");

  createWindow();
});

// Renderer -> Main: control keep-awake while timers are enabled
ipcMain.on("ffxi:keepAwake", (_event, payload: { enabled: boolean }) => {
  if (payload.enabled) ensureKeepAwakeOn();
  else ensureKeepAwakeOff();
});

// Renderer -> Main: show a notification.
// - Default behavior repeats every 20s until clicked, capped at 10 repeats.
// - For one-shot notifications (e.g. NM intervals), pass repeat: false.
ipcMain.on(
  "ffxi:notify",
  (
    _event,
    payload: { id: string; title: string; body: string; repeat?: boolean; repeatEveryMs?: number }
  ) => {
    const { id, title, body } = payload;
    const repeat = payload.repeat ?? true;
    const repeatEveryMs = Math.max(1_000, Math.floor(payload.repeatEveryMs ?? 20_000));

    const showToast = (wireDismiss: boolean) => {
      try {
        const n = new Notification({ title, body });

        if (wireDismiss) {
          // Clicking the toast stops the spam
          n.on("click", () => {
            stopRepeater(id);
            BrowserWindow.getAllWindows()[0]?.webContents.send("ffxi:timerDismissed", { id });
          });
        }

        n.show();
      } catch {
        // ignore
      }
    };

    // One-shot: show once and do not register a repeater.
    if (!repeat) {
      showToast(false);
      return;
    }

    // already repeating? ignore
    if (repeaters.has(id)) return;

    // Show once immediately
    showToast(true);

    // Repeat until dismissed, capped so it never repeats forever
    const MAX_REPEATS = 10;
    let repeatCount = 0;
    const interval = setInterval(() => {
      showToast(true);
      if (++repeatCount >= MAX_REPEATS) stopRepeater(id);
    }, repeatEveryMs);
    repeaters.set(id, interval);
  }
);

// optional manual stop
ipcMain.on("ffxi:notifyStop", (_event, payload: { id: string }) => {
  stopRepeater(payload.id);
});
