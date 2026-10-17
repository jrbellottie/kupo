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
export type LostChickClues = {
  firstLetter?: string;
  raceGender?: string;
  occupation?: string;
};

export const LOST_CHICK_OWNERS = [
  { name: "Abd-al-Raziq", raceGender: "Hume Male", occupation: "Guild Worker", area: "Bastok Mines", location: "L-7" },
  { name: "Azima", raceGender: "Hume Female", occupation: "Guild Worker", area: "Bastok Mines", location: "L-6" },
  { name: "Deegis", raceGender: "Galka", occupation: "Merchant", area: "Bastok Mines", location: "H-6" },
  { name: "Drangord", raceGender: "Galka", occupation: "Miner", area: "Bastok Mines", location: "D-7" },
  { name: "Galdeo", raceGender: "Galka", occupation: "Merchant", area: "Bastok Mines", location: "E-6" },
  { name: "Gray Wolf", raceGender: "Galka", occupation: "Watchman", area: "Bastok Mines", location: "H-7" },
  { name: "Gerbaum", raceGender: "Galka", occupation: "Miner", area: "Bastok Mines", location: "F-8" },
  { name: "Griselda", raceGender: "Hume Female", occupation: "Merchant", area: "Bastok Mines", location: "H-5" },
  { name: "Carautia", raceGender: "Elvaan Female", occupation: "Merchant", area: "Southern San d'Oria", location: "K-8" },
  { name: "Cletae", raceGender: "Elvaan Female", occupation: "Merchant", area: "Southern San d'Oria", location: "D-8" },
  { name: "Coderiant", raceGender: "Elvaan Male", occupation: "Information Guide", area: "Southern San d'Oria", location: "F-8" },
  { name: "Cahaurme", raceGender: "Elvaan Male", occupation: "Watchman", area: "Southern San d'Oria", location: "J-9" },
  { name: "Corua", raceGender: "Old Elvaan Woman", occupation: "Merchant", area: "Southern San d'Oria", location: "G-9" },
  { name: "Luthiaque", raceGender: "Elvaan Male", occupation: "Town Information Guide", area: "Southern San d'Oria", location: "G-9" },
  { name: "Lanqueron", raceGender: "Elvaan Male", occupation: "Package Deliverer", area: "Southern San d'Oria", location: "I-9" },
  { name: "Violitte", raceGender: "Elvaan Female", occupation: "Merchant", area: "Southern San d'Oria", location: "G-10" },
  { name: "Valderotaux", raceGender: "Old Elvaan Male", occupation: "Merchant", area: "Southern San d'Oria", location: "K-6" },
  { name: "Gioh Ajihri", raceGender: "Mithra", occupation: "Hunter", area: "Windurst Woods", location: "K-5" },
  { name: "Gottah Maporushanoh", raceGender: "Mithra", occupation: "Adventurer", area: "Windurst Woods", location: "H-10" },
  { name: "Kyaa Taali", raceGender: "Mithra", occupation: "Guild Worker", area: "Windurst Woods", location: "H-13 (Bone Craft Guild)" },
  { name: "Kapeh Myohrye", raceGender: "Mithra", occupation: "Hunter", area: "Windurst Woods", location: "K-7 (Vashai's Residence)" },
  { name: "Kopuro-Popuro", raceGender: "Tarutaru Male", occupation: "Ministry Worker", area: "Windurst Woods", location: "H-10 (Manustery South)" },
  { name: "Kororo", raceGender: "Tarutaru Female", occupation: "Ministry Worker", area: "Windurst Woods", location: "H-9 (Manustery North)" },
  { name: "Ponono", raceGender: "Tarutaru Female", occupation: "Guild Worker", area: "Windurst Woods", location: "G-12 (Clothcraft Guild)" },
  { name: "Peshi Yohnts", raceGender: "Mithra", occupation: "Guild Worker", area: "Windurst Woods", location: "H-13 (Bone Craft Guild)" },
] as const;

export function validLostChickClues(value: unknown): value is LostChickClues | undefined {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const clues = value as Record<string, unknown>;
  return Object.keys(clues).every(key => ["firstLetter", "raceGender", "occupation"].includes(key))
    && (clues.firstLetter === undefined || typeof clues.firstLetter === "string" && clues.firstLetter.length <= 1)
    && (clues.raceGender === undefined || typeof clues.raceGender === "string" && clues.raceGender.length <= 80)
    && (clues.occupation === undefined || typeof clues.occupation === "string" && clues.occupation.length <= 80);
}

export function filterLostChickOwners(clues: LostChickClues = {}) {
  const firstLetter = clues.firstLetter?.trim().toLocaleLowerCase() ?? "";
  const raceGender = clues.raceGender?.trim().toLocaleLowerCase() ?? "";
  const occupation = clues.occupation?.trim().toLocaleLowerCase() ?? "";
  return LOST_CHICK_OWNERS.filter(owner =>
    (!firstLetter || owner.name.toLocaleLowerCase().startsWith(firstLetter))
    && (!raceGender || owner.raceGender.toLocaleLowerCase().includes(raceGender))
    && (!occupation || owner.occupation.toLocaleLowerCase().includes(occupation)));
}

export function validRaisingEvents(value: unknown): value is RaisingEvent[] | undefined {
  return value === undefined || Array.isArray(value)
    && value.every(id => RAISING_EVENTS.some(event => event.id === id))
    && new Set(value).size === value.length;
}

export function raisingMilestoneGuidance(day: number): string[] {
  const s = RAISING.settings;
  if (day === s.daysToChick) return ["Hatching: name the chick at the trainer. Newly hatched chicks start completely full; do not feed yet."];
  if (day === s.daysToAdolescent) return ["Adolescence: check visible color and new reports. Stories and regular walks unlock; color is now locked. Newly selected care still starts two days later."];
  if (day === s.daysToAdult1) return ["Adulthood: long walks and documentation unlock. If you do not have a Chocobo Whistle, ask about the quest; raisers outside San d'Oria first visit Hantileon in Southern San d'Oria. The White Handkerchief outcome does not block it."];
  if (day === s.daysToAdult2) return ["Adult growth report: update the trainer's stats and condition. This milestone does not add a training multiplier."];
  if (day === s.daysToAdult3) return ["Growth stabilizes: care-plan stat losses stop, but food penalties remain. An unnamed bird may be named automatically; check the trainer's report."];
  if (day === s.daysToAdult4 - 1) return ["Last training day: prepare to collect the retirement registration card and re-register the final riding stats. Do not give up the bird instead of retiring it."];
  if (day >= s.daysToAdult4) return ["Retirement: collect the registration card from the home trainer and register the final bird. Raising has ended; no more feeding or training is planned."];
  return [];
}

export function raisingEventGuidance(report: FeedingReport, day: number, lostChickClues?: LostChickClues): string[] {
  if (!validRaisingEvents(report.events)) throw new Error("Select valid raising report events.");
  if (!validLostChickClues(lostChickClues)) throw new Error("Enter valid Lost Chick clues.");
  const selected = new Set(report.events ?? []);
  const messages: string[] = [];
  const ready = report.condition === "healthy" && !report.ailments?.length;
  const activityGate = ready ? "Check the required energy before acting." : "Wait until healthy, awake, present and energetic enough before doing activities.";
  if (selected.has("white-handkerchief")) {
    messages.push(day >= 15
      ? "White Handkerchief: the event expires on day 15 and the key item is taken back. This has no stat effect and does not block the adult Whistle quest; no medicine is needed."
      : "White Handkerchief / nighttime crying: hold the key item through one raising-report day. Receive the next report, then zone out and back and speak to the home trainer to return it before day 15. This is a dialogue event, not a food trade; it has no stat effect, and the following report closes the event.");
  }
  if (selected.has("high-spirits")) messages.push("High spirits (Happiness): care plans are more effective while this positive condition is active, and from adolescence it increases the chance of later Full of energy (Vitality) and Bright and focused (Intelligence) reports. It does not directly add affection or stat points. No remedy is needed.");
  if (selected.has("full-of-energy")) messages.push("Full of energy (Vitality): physical care plans give better Strength and Endurance training results. Tell a Story also has a higher chance to teach an unlearned ability. This is not extra stored energy or extra story attempts; check the actual energy meter before activities. No remedy is needed.");
  if (selected.has("bright-and-focused")) messages.push("Bright and focused (Intelligence): mental care plans give better Discernment and Receptivity training results. Tell a Story also has a higher chance to teach an unlearned ability. This is not a direct Discernment gain or a guarantee of learning. No remedy is needed.");
  if (selected.has("returned")) messages.push("Returned after running away: the bird is back, but away days passed without care or training, so there is no catch-up bonus. Enter fresh health, hunger and affection reports; restore low affection with safe meals after any treatment. Do not make up missed feeding or care.");
  if (selected.has("recovered")) messages.push("Recovery report: the reported ailment has ended, but this gives no stat bonus and does not clear other ailments. Clear only the conditions the trainer says have ended, enter fresh hunger, affection and readiness reports, and do not repeat medicine for a cured condition.");
  if (selected.has("whistle-found")) {
    messages.push("Handkerchief / Dirty Handkerchief found: this is Whistle quest progress, not a stat reward. Speak to Hantileon in Southern San d'Oria to receive the Chocobo Whistle, then register the adult bird with its trainer. These are not the chick's White Handkerchief.");
  } else if (selected.has("whistle-search")) {
    messages.push(day < RAISING.settings.daysToAdult1
      ? `Whistle quest: it begins at adulthood, day ${RAISING.settings.daysToAdult1}; the chick's White Handkerchief is a separate event. There is no raising bonus or detriment yet.`
      : `Whistle search: speak to Hantileon first if directed there. Use hands-on short, regular or long walks from the home stable and choose to search; try another distance if empty. The hiding distance stays fixed for this quest. This advances the riding quest, not training stats. ${activityGate}`);
  }
  if (selected.has("held-item")) messages.push(`Item from a walk: carrying it gives no stat bonus. Free an inventory slot, then choose Watch Over to collect it (requires ${RAISING.actionEnergy[48]["2"]}+ energy after hatching). ${activityGate}`);
  if (selected.has("lost-chick")) messages.push("Lost chick: choose “Take it home” when it appears on a short walk. On later walks of any length, trainer encounters reveal the owner's first initial, race/gender and occupation. Ask the VCS Chocoguy, Kiria-Romaria, for the Lost Chick option to review clues; this is a separate NPC from Pulonono, your raising trainer. Enter the clues above to filter the owner list, and gather all three before choosing. Ask the matching NPC if they own the chick; the correct answer earns the Diligent Chocobo story, while a wrong guess restarts the search. A later short walk can give another chance. This is not an ailment; do not feed a remedy.");
  return messages;
}
