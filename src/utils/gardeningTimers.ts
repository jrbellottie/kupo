import type { GardeningTimer } from "../types";

export type GardeningEvent = {
  id: string;
  label: string;
  atMs: number;
  earliestAtMs: number;
};

export function gardeningEvents(timer: GardeningTimer): GardeningEvent[] {
  const events: GardeningEvent[] = [];
  let earliest = timer.plantedAtMs;
  let latest = earliest;
  for (const [index, feed] of timer.feeds.entries()) {
    earliest += feed.growthMs;
    latest += feed.growthMs;
    if (feed.fedAtMs !== null) {
      earliest = latest = feed.fedAtMs;
      continue;
    }
    const name = `Feed ${index + 1}`;
    events.push({
      id: `feed-${index + 1}-open`, label: `${name} opens: ${feed.crystal}${feed.skip ? " (skip this feeding)" : ""}`,
      atMs: latest, earliestAtMs: earliest,
    }, {
      id: `feed-${index + 1}-close`, label: `${name} closes${feed.skip ? " (skipped window ends)" : `: ${feed.crystal}`}`,
      atMs: latest + feed.windowMs, earliestAtMs: earliest + feed.windowMs,
    });
    if (feed.skip) earliest += feed.windowMs;
    latest += feed.windowMs;
  }
  events.push({
    id: "harvest", label: "Harvest readiness",
    atMs: latest + timer.harvestGrowthMs, earliestAtMs: earliest + timer.harvestGrowthMs,
  });
  return events.sort((a, b) => a.atMs - b.atMs);
}

export function nextGardeningEvent(timer: GardeningTimer): GardeningEvent | undefined {
  return gardeningEvents(timer).find(event => !timer.notifiedEvents.includes(event.id));
}

export function advanceGardeningTimer(timer: GardeningTimer, nowMs: number) {
  const events = gardeningEvents(timer);
  const due = events.filter(event => event.atMs <= nowMs && !timer.notifiedEvents.includes(event.id));
  if (!timer.enabled || !due.length) return { timer, event: undefined };
  const notifiedEvents = [...timer.notifiedEvents, ...due.map(event => event.id)];
  return {
    timer: { ...timer, notifiedEvents, enabled: events.some(event => !notifiedEvents.includes(event.id)) },
    // After sleep or restart, report the latest missed milestone instead of a burst of obsolete alerts.
    event: due.at(-1),
  };
}

export function recordGardeningFeed(timer: GardeningTimer, index: number, fedAtMs: number | null, nowMs: number): GardeningTimer {
  const feed = timer.feeds[index];
  if (!Number.isInteger(index) || !feed || feed.skip) throw new Error("This recipe does not call for a crystal at that feeding.");
  if (!Number.isFinite(nowMs)) throw new Error("The current time is invalid.");
  if (fedAtMs !== null && (!Number.isFinite(fedAtMs) || fedAtMs < timer.plantedAtMs || fedAtMs > nowMs)) {
    throw new Error("Enter an actual feeding time between planting and now.");
  }
  const feeds = timer.feeds.map((entry, i) => i === index ? { ...entry, fedAtMs } : entry);
  let earliest = timer.plantedAtMs;
  for (const entry of feeds) {
    earliest += entry.growthMs;
    if (entry.fedAtMs !== null) {
      if (entry.fedAtMs < earliest) throw new Error("The feeding time is before its earliest possible window. Check planting and previous feeding times.");
      earliest = entry.fedAtMs;
    } else if (entry.skip) earliest += entry.windowMs;
  }
  const updated = { ...timer, feeds };
  const events = gardeningEvents(updated);
  updated.notifiedEvents = events.filter(event => event.atMs <= nowMs && (event.id !== "harvest" || timer.notifiedEvents.includes(event.id))).map(event => event.id);
  // A revised harvest estimate can reopen a finished timer; manually disabled timers stay disabled.
  updated.enabled = timer.enabled || (timer.notifiedEvents.includes("harvest") && events.some(event => event.atMs > nowMs));
  return updated;
}
