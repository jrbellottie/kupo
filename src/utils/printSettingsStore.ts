import { useCallback, useEffect, useRef, useState } from "react";
import { loadJson, saveJson } from "./storage";
import { restorePrintSettings, type PrintSettings, type PrintSettingsUpdate } from "./printing";

const STORAGE_KEY = "kupo.profits.settings.v1";
const CHANGE_EVENT = "kupo:profits-settings-changed";

export function usePrintSettings(fallback: Partial<PrintSettings> = {}) {
  const [settings, setSettings] = useState(() =>
    restorePrintSettings(loadJson<Partial<PrintSettings>>(STORAGE_KEY, fallback))
  );
  const settingsRef = useRef(settings);

  useEffect(() => {
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<PrintSettings>).detail;
      if (!next) return;
      settingsRef.current = next;
      setSettings(next);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const next = restorePrintSettings(loadJson<Partial<PrintSettings>>(STORAGE_KEY, {}));
      settingsRef.current = next;
      setSettings(next);
    };

    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const updateSettings = useCallback((patch: PrintSettingsUpdate) => {
    const previous = settingsRef.current;
    const changes = typeof patch === "function" ? patch(previous) : patch;
    const next = { ...previous, ...changes };
    saveJson(STORAGE_KEY, next);
    settingsRef.current = next;
    setSettings(next);
    window.dispatchEvent(new CustomEvent<PrintSettings>(CHANGE_EVENT, { detail: next }));
  }, []);

  return [settings, updateSettings] as const;
}
