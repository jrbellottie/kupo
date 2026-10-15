export type TimerNotification = {
  key: string;
  id: string;
  title: string;
  body: string;
  repeat?: boolean;
};

export type NotificationSettings = {
  volume: number;
  error: string | null;
};

export type RunningTimer = {
  id: string;
  label: string;
  targetEarthMs: number;
};

export type NotificationState = NotificationSettings & {
  alerts: TimerNotification[];
  timers: RunningTimer[];
  soundSequence: number;
};

export type NotificationBridge = {
  notify: (notification: TimerNotification) => void;
  stopTimer: (id: string) => void;
  syncTimers: (timers: RunningTimer[]) => void;
  open: () => Promise<void>;
  hide: () => void;
  preview: () => Promise<void>;
  resetPosition: () => Promise<void>;
  getSettings: () => Promise<NotificationSettings>;
  setVolume: (volume: number) => Promise<NotificationSettings>;
  onError: (listener: (message: string) => void) => () => void;
  getState: () => Promise<NotificationState>;
  onState: (listener: (state: NotificationState) => void) => () => void;
  dismiss: (key: string) => void;
  dismissAll: () => void;
  reportAudioError: (message: string) => void;
};
