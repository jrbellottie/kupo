import { RAISING } from "./chocoboRaising";
import type { FeedingReport } from "./chocoboFeeding";

export const RAISING_EVENTS = [
  { id: "white-handkerchief", label: "Crying at night / holding White Handkerchief" },
  { id: "high-spirits", label: "High spirits" },
  { id: "full-of-energy", label: "Full of energy" },
  { id: "bright-and-focused", label: "Bright and focused" },
  { id: "returned", label: "Returned after running away" },
  { id: "recovered", label: "Trainer reported recovery from an ailment" },
  { id: "whistle-search", label: "Whistle quest / searching for a handkerchief" },
  { id: "whistle-found", label: "Found Handkerchief or Dirty Handkerchief for the whistle" },
  { id: "held-item", label: "Holding an item brought back from a walk" },
  { id: "lost-chick", label: "Found a lost chick on a walk" },
] as const;
export type RaisingEvent = typeof RAISING_EVENTS[number]["id"];

export function validRaisingEvents(value: unknown): value is RaisingEvent[] | undefined {
  return value === undefined || Array.isArray(value)
    && value.every(id => RAISING_EVENTS.some(event => event.id === id))
    && new Set(value).size === value.length;
}

export function raisingMilestoneGuidance(day: number): string[] {
  const s = RAISING.settings;
  if (day === s.daysToChick) return ["Hatching: name the chick at the trainer. Newly hatched chicks start completely full; do not feed yet."];
  if (day === 7) return ["White Handkerchief window: if the trainer offers it for nighttime crying, accept the key item. Hold it through a raising-report day, then zone out and back and talk to the trainer. Return it before day 15; it is not food. Whistle holders may not receive this event."];
  if (day === 14) return ["White Handkerchief deadline: if still holding it and a report day has passed, zone out and back and speak to the trainer today. The unfinished event expires on day 15."];
  if (day === 15) return ["White Handkerchief window closes: an unfinished event is cancelled. Do not feed medicine for the missed event; the adult whistle quest remains available."];
  if (day === s.daysToAdolescent) return ["Adolescence: check visible color and new reports. Stories and regular walks unlock; color is now locked. Newly selected care still starts two days later."];
  if (day === s.daysToAdult1) return ["Adulthood: long walks and documentation unlock. If you do not have a Chocobo Whistle, ask about the quest; raisers outside San d'Oria first visit Hantileon in Southern San d'Oria. The White Handkerchief outcome does not block it."];
  if (day === s.daysToAdult2) return ["Adult growth report: update the trainer's stats and condition. This milestone does not add a training multiplier in the pinned model."];
  if (day === s.daysToAdult3) return ["Growth stabilizes: care-plan stat losses stop, but food penalties remain. An unnamed bird may be named automatically; check the trainer's report."];
  if (day === s.daysToAdult4 - 1) return ["Last training day: prepare to collect the retirement registration card and re-register the final riding stats. Do not give up the bird instead of retiring it."];
  if (day >= s.daysToAdult4) return ["Retirement: collect the registration card from the home trainer and register the final bird. Raising has ended; no more feeding or training is planned."];
  return [];
}

export function raisingEventGuidance(report: FeedingReport, day: number): string[] {
  if (!validRaisingEvents(report.events)) throw new Error("Select valid raising report events.");
  const selected = new Set(report.events ?? []);
  const messages: string[] = [];
  const ready = report.condition === "healthy" && !report.ailments?.length;
  const activityGate = ready ? "Check the required energy before acting." : "Wait until healthy, awake, present and energetic enough before doing activities.";
  if (selected.has("white-handkerchief")) {
    messages.push(day >= 15
      ? "White Handkerchief: the unfinished event expires on day 15 in the pinned rules. Check the trainer's dialogue; do not use medicine or restart the egg clock. The whistle quest is not blocked."
      : "White Handkerchief / nighttime crying: hold the key item through one raising-report day. Receive the next report, then zone out and back and speak to the home trainer to return it before day 15. This is a dialogue event, not a food trade; the following report closes the event.");
  }
  if (selected.has("high-spirits")) messages.push("High spirits: a positive report, not an ailment. No medicine is needed for it; continue only the planned actions allowed by current health, hunger and energy.");
  if (selected.has("full-of-energy")) messages.push("Full of energy: no remedy needed. Check actual energy before activities; this report does not grant extra meals or extra story attempts in the forecast.");
  if (selected.has("bright-and-focused")) messages.push("Bright and focused: no remedy needed. Continue eligible training and stories; do not assume an ability was learned or add an unverified stat bonus.");
  if (selected.has("returned")) messages.push("Returned after running away: confirm the bird is back, then enter fresh health, hunger and affection reports. Restore low affection with safe meals after any treatment. Do not make up missed feeding or care.");
  if (selected.has("recovered")) messages.push("Recovery report: clear only the ailments the trainer says have ended and enter fresh hunger, affection and readiness reports. Do not repeat medicine for a cured condition or assume every other ailment ended too.");
  if (selected.has("whistle-found")) {
    messages.push("Handkerchief / Dirty Handkerchief found: speak to Hantileon in Southern San d'Oria and receive the Chocobo Whistle. Then register the adult bird with its trainer. These are not the chick's White Handkerchief.");
  } else if (selected.has("whistle-search")) {
    messages.push(day < RAISING.settings.daysToAdult1
      ? `Whistle quest: it begins at adulthood, day ${RAISING.settings.daysToAdult1}; the chick's White Handkerchief is a separate event.`
      : `Whistle search: speak to Hantileon first if directed there. Use hands-on short, regular or long walks from the home stable and choose to search; try another distance if empty. The hiding distance stays fixed for this quest. ${activityGate}`);
  }
  if (selected.has("held-item")) messages.push(`Item from a walk: free an inventory slot, then choose Watch Over to collect it (requires ${RAISING.actionEnergy[48]["2"]}+ energy after hatching). ${activityGate}`);
  if (selected.has("lost-chick")) messages.push("Lost chick: ask the stable clerk and gather the trainers' clues before choosing its owner. A correct return earns the Diligent Chocobo story; some owner dialogue hooks are incomplete in the pinned source. Do not guess an owner or feed a remedy.");
  return [...messages, ...(selected.has("white-handkerchief") && [7, 14, 15].includes(day) ? [] : raisingMilestoneGuidance(day))];
}
