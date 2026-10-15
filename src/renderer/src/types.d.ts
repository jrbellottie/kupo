export {};
import type { NotificationBridge } from "../../notifications/types";

declare global {
  interface Window {
    electron?: {
      ipcRenderer: {
        send: (channel: string, data?: unknown) => void;
      };
    };
    kupoNotifications?: NotificationBridge;
  }
}
