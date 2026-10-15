import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopNotifications } from "./notifications";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;

let win: BrowserWindow | null = null;
let notifications: DesktopNotifications | null = null;

// IMPORTANT: these must be set BEFORE app.whenReady()
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
// Native Wayland does not allow restoring arbitrary top-level window positions.
if (process.platform === "linux") app.commandLine.appendSwitch("ozone-platform", "x11");

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

      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External links (e.g. wiki pages) open in the user's default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => {
    notifications?.dispose();
    notifications = null;
    win = null;
    ensureKeepAwakeOff();
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
  if (!win) {
    createWindow();
    createNotifications();
  }
});

function createNotifications() {
  notifications = new DesktopNotifications({
    mainWindow: () => win,
    userData: app.getPath("userData"),
    preload: path.join(__dirname, "preload.cjs"),
    rendererDirectory: RENDERER_DIST,
    devServerUrl: VITE_DEV_SERVER_URL,
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId("kupo");

  createWindow();
  createNotifications();
});

app.on("before-quit", () => notifications?.dispose());

// Renderer -> Main: control keep-awake while timers are enabled
ipcMain.on("ffxi:keepAwake", (event, payload: { enabled: boolean }) => {
  if (event.sender !== win?.webContents) return;
  if (payload.enabled) ensureKeepAwakeOn();
  else ensureKeepAwakeOff();
});
