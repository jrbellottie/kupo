import { formatCountdown } from "./time";

export function presetTimerDetails(
  offsetText: string,
  offsetValue: number,
  reference: string,
  fireAtMs: number,
  nowMs: number,
) {
  const offset = offsetValue === 0
    ? `No lead time (at ${reference})`
    : `${offsetText} before ${reference}`;
  return {
    offset,
    localFireTime: new Date(fireAtMs).toLocaleString(),
    timeUntil: formatCountdown(Math.max(0, fireAtMs - nowMs)),
  };
}
