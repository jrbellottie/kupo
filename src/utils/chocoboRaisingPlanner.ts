import {
  RAISING, STAT_KEYS, STAT_LABELS, PROJECTION_FOODS, applyRaisingStatChanges,
  type RaisingStats, type StatKey,
} from "./chocoboRaising";
import { pad2, parseLocalDateTimeToMs } from "./time";
import {
  AFFECTION_TARGET, careSuccessChance, feedingOptions, validateFeedingReport,
  type FeedingEstimate, type FeedingReport,
} from "./chocoboFeeding";

export const RAISING_START_KEY = "kupo.raising.startedAt.v1";

export function raisingDayAt(startedAt: number, now: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || !Number.isFinite(new Date(startedAt).getTime()) || startedAt > now) {
    throw new Error("The egg start time must be a valid date and cannot be in the future.");
  }
  return Math.floor((now - startedAt) / (RAISING.settings.dayLength * 1000));
}

export function localRaisingStart(ms: number): string {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid egg start time.");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function parseRaisingStart(raw: string, now: number): number {
  const ms = parseLocalDateTimeToMs(raw);
  if (ms === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)
    || localRaisingStart(ms).slice(0, raw.length) !== raw) {
    throw new Error("Enter a valid local date and time for the egg hand-in.");
  }
  raisingDayAt(ms, now);
  return ms;
}

const storyReferences = [
  { name: "Gallop", story: "Impatient Chocobo", obtain: "Third meeting with Hantileon. Short walks from San d'Oria; regular walks from Bastok or Windurst.", effect: "Adds one riding-speed rank (+2.5 percentage points of rental speed), within the cap." },
  { name: "Canter", story: "Curious Chocobo", obtain: "Third meeting with Brutus on long walks (any stable).", effect: "Adds one riding-duration rank (+4 minutes), within the cap." },
  { name: "Burrow", story: "Worrisome Chocobo", obtain: "Third meeting with Zopago. Short walks from Bastok, regular from San d'Oria, long from Windurst.", effect: "Learnable digging ability; not applied by the active digging override." },
  { name: "Bore", story: "Youthful Chocobo", obtain: "Third meeting with Pulonono. Short walks from Windurst; long walks from San d'Oria or Bastok.", effect: "Learnable digging ability; not applied by the active digging override." },
  { name: "Auto-Regen", story: "Happy Chocobo", obtain: "Win Compete with Others three times (not necessarily consecutively). Meet the rivals on a regular walk first.", effect: "Learnable, but no automatic energy-regeneration effect was found in the raising model. Do not count on it as a feeding substitute." },
  { name: "Treasure Finder", story: "Diligent Chocobo", obtain: "Correctly return the lost chick found on a short walk. Ask the stable clerk and gather trainer clues before choosing an owner; some owner dialogue hooks remain incomplete.", effect: "Learnable digging ability; not applied by the active digging override." },
];

export const RAISING_ABILITIES = RAISING.abilities.map(ability => {
  const story = storyReferences.find(entry => entry.name === ability.name);
  if (!story) throw new Error(`Missing story reference for ${ability.name}.`);
  return { ...ability, ...story };
});

export type RaisingGoalInput = {
  current: RaisingStats;
  target: RaisingStats;
  desiredAbilities: string[];
  knownAbilities: string[];
  priority: StatKey;
  currentDay: number;
  today?: { feedingDone: boolean; storyDone: boolean };
  feedingReport?: FeedingReport;
};
type RaisingPreset = Pick<RaisingGoalInput, "target" | "desiredAbilities" | "priority"> & {
  id: string;
  label: string;
  summary: string;
  reasons: Record<StatKey, string>;
  abilityReason: string;
};
export const RAISING_PRESETS: RaisingPreset[] = [
  {
    id: "digging", label: "Digging - Bore + Burrow", priority: "endurance",
    target: { strength: 32, endurance: 224, discernment: 160, receptivity: 224 },
    desiredAbilities: ["Bore", "Burrow"],
    summary: "The default END/RCP digging build uses all 640 points, favoring daily digging capacity and rare finds over riding speed.",
    reasons: {
      strength: "Improves riding speed, not a documented direct digging bonus. E keeps a small speed allowance while reserving points for digging stats.",
      endurance: "The source-derived digging guide gives one extra daily dig per two points. SS at 224 corresponds to +112 digs and also improves riding duration.",
      discernment: "A at 160 meets Bore's story-learning threshold and corresponds to a documented 20% chance to save greens. Keep it high enough until the ability is actually learned.",
      receptivity: "The source-derived guide gives a 5% rare-find increase per grade above F. SS corresponds to a 35% increase, not a flat 35% rare-item chance. It also helps trainer encounters while raising.",
    },
    abilityReason: "Bore and Burrow target additional digging item pools. They fill both ability slots; broader pools do not guarantee higher profit.",
  },
  {
    id: "racing", label: "Racing - Gallop + Canter", priority: "strength",
    target: { strength: 224, endurance: 128, discernment: 160, receptivity: 96 },
    desiredAbilities: ["Gallop", "Canter"],
    summary: "A community-recommended SS/B/A/C starter for solo races, not an optimized competitive Circuit build. These minimums total 608, leaving 32 points flexible; the planner does not automatically spend them.",
    reasons: {
      strength: "Retail racing references tie Strength to top speed. SS gives the main speed foundation, so this preset prioritizes Strength. SS begins at 224; it is not the raw 255 maximum.",
      endurance: "Determines starting race stamina in retail references. B provides a stamina base without spending the whole budget on physical stats; Canter complements it.",
      discernment: "Helps manage race stamina and item-use timing in retail references. A supports efficient stamina use, not just story learning; the pinned Canter threshold is only 96 DSC.",
      receptivity: "Helps avoid accidents and opponents' attacks in retail references. C is useful for a first racer facing NPCs, rather than sacrificing all defensive stats for speed.",
    },
    abilityReason: "Gallop and Canter are the community's standard speed/stamina pair. The pinned raising model teaches them at 64 and 96 DSC respectively; learn both before using food that lowers DSC. Their confirmed whistle effects are riding speed and duration, not a simulated race result.",
  },
  {
    id: "circuit", label: "Circuit - Elm saddle (community)", priority: "strength",
    target: { strength: 254, endurance: 34, discernment: 224, receptivity: 128 },
    desiredAbilities: ["Gallop", "Canter"],
    summary: "A community Circuit allocation aimed at NPC-heavy races with an Elm saddle: 254/34/224/128 uses all 640 points. It trades the starter's stamina reserve for near-maximum speed, stronger stamina management and item defense. It is not a universal C1 optimum; opponents, items and jockey orders matter.",
    reasons: {
      strength: "Retail community reports say speed continues improving within SS, so 254 aims near the raw maximum rather than stopping at 224. This follows the cited allocation; the pinned raising cap is 255, not 254.",
      endurance: "E at 34 is a deliberately small race-stamina reserve, not raising-action energy. The recommendation relies on an Elm saddle's reported +16 END during Circuit races. Do not assume this low-END tradeoff is suitable without that saddle.",
      discernment: "SS at 224 favors efficient race-stamina use to complement low END, rather than merely meeting the 96 DSC needed to learn Canter. This is the more END-balanced of the community's two suggested allocations, not the 254 DSC / 4 END variant.",
      receptivity: "B at 128 is an item-defense investment for NPC-heavy races. Against player fields using speed items rather than attacks, community guidance suggests less RCP may be useful; this preset is not optimized for every opponent lineup.",
    },
    abilityReason: "Gallop + Canter supply the community-recommended speed/stamina pair and occupy both slots. The training model uses the same pinned 64/96 DSC learning thresholds; neither race effects nor saddle bonuses are added to the projected raised stats.",
  },
];
export type TrainingAction = { kind: "food" | "care"; id: number };
export type TrainingDay = {
  day: number;
  careId: number;
  carePoints: 2 | 3;
  foodId: number | null;
  foodCount: number;
  story: string | null;
  attempt: number;
  assumedLearned: boolean;
  before: RaisingStats;
  after: RaisingStats;
  feeding?: FeedingEstimate;
};
const zeroStats = (): RaisingStats => ({ strength: 0, endurance: 0, discernment: 0, receptivity: 0 });
const total = (stats: RaisingStats) => STAT_KEYS.reduce((sum, key) => sum + stats[key], 0);
const meetsGoal = (stats: RaisingStats, target: RaisingStats) => STAT_KEYS.every(key => stats[key] >= target[key]);
const statsKey = (stats: RaisingStats) => stats.strength | (stats.endurance << 8) | (stats.discernment << 16) | (stats.receptivity << 24);
export const LAST_RAISING_DAY = RAISING.settings.daysToAdult4 - 1;

export function validateRaisingGoal(input: RaisingGoalInput): string | null {
  if (input.today && (typeof input.today.feedingDone !== "boolean" || typeof input.today.storyDone !== "boolean")) {
    return "Today's feeding and story completion must be checked or unchecked.";
  }
  for (const [label, stats] of [["Current", input.current], ["Target", input.target]] as const) {
    if (STAT_KEYS.some(key => !Number.isInteger(stats[key]) || stats[key] < 0 || stats[key] > 255)) {
      return `${label} stats must be whole points from 0 to 255.`;
    }
    if (total(stats) > RAISING.settings.statGrowthCap) {
      return `${label} stats total ${total(stats)}; the combined cap is ${RAISING.settings.statGrowthCap}. Lower the targets or correct the current stats.`;
    }
  }
  if (!STAT_KEYS.includes(input.priority)) return "Choose a valid priority stat.";
  if (!Number.isInteger(input.currentDay) || input.currentDay < 0 || input.currentDay > LAST_RAISING_DAY) {
    return `Current raising day must be a whole number from 0 to ${LAST_RAISING_DAY}. Retirement starts on day ${RAISING.settings.daysToAdult4}.`;
  }
  if (input.feedingReport) {
    const error = validateFeedingReport(input.feedingReport, input.currentDay);
    if (error) return error;
  }
  for (const names of [input.desiredAbilities, input.knownAbilities]) {
    if (new Set(names).size !== names.length || names.some(name => !RAISING_ABILITIES.some(ability => ability.name === name))) {
      return "Select distinct abilities from the listed story abilities.";
    }
    if (names.length > 2) return "A chocobo has only two ability slots. Select at most two desired and two already-learned abilities.";
  }
  if (new Set([...input.desiredAbilities, ...input.knownAbilities]).size > 2) {
    return "The desired abilities will not fit alongside the already-learned abilities. Only two slots exist; this planner will not recommend randomly forgetting an ability.";
  }
  return null;
}

export function storyLearningProbability(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 0) throw new Error("Story attempts must be a non-negative whole number.");
  return 1 - (1 - RAISING.learnChance / 100) ** attempts;
}

export const STORY_ATTEMPTS_95 = Math.ceil(Math.log(0.05) / Math.log(1 - RAISING.learnChance / 100));

export function trainingActionName(action: TrainingAction): string {
  const entry = action.kind === "food"
    ? PROJECTION_FOODS.find(food => food.id === action.id)
    : RAISING.plans.find(plan => plan.id === action.id && plan.id !== 1);
  if (!entry) throw new Error(`Unknown ${action.kind} training action: ${action.id}.`);
  return entry.name;
}

export function applyTrainingAction(stats: RaisingStats, action: TrainingAction, day: number, carePoints: 2 | 3 = 2): RaisingStats {
  if (!Number.isInteger(day) || day < 0 || day > LAST_RAISING_DAY) throw new Error("Training day is outside the raising period.");
  if (action.kind === "food") {
    const food = PROJECTION_FOODS.find(entry => entry.id === action.id && !entry.forgetsAbility);
    if (!food) throw new Error(`Unsupported training food: ${action.id}.`);
    return applyRaisingStatChanges(stats, food.stats);
  }
  const plan = RAISING.plans.find(entry => entry.id === action.id && entry.id !== 1);
  if (!plan) throw new Error(`Unsupported care plan: ${action.id}.`);
  if (plan.id === 0) return { ...stats };
  const changes = zeroStats();
  for (const key of STAT_KEYS) {
    changes[key] = day >= RAISING.settings.daysToAdult3 && plan.arrows[key] < 0 ? 0 : plan.arrows[key] * carePoints;
  }
  return applyRaisingStatChanges(stats, changes);
}

type SearchNode = {
  stats: RaisingStats;
  parent: SearchNode | null;
  entry: TrainingDay | null;
  attempts: number;
  cost: number;
  affection: number;
  fullness: number;
  energySpent: number;
  affectionDebt: number;
};

export function careAvailableDay(id: number): number {
  const plan = RAISING.plans.find(entry => entry.id === id && entry.id !== 1);
  if (!plan) throw new Error(`Unsupported care plan: ${id}.`);
  return plan.stage === "Egg" ? 0 : plan.stage === "Chick" ? RAISING.settings.daysToChick
    : plan.stage === "Adolescent" ? RAISING.settings.daysToAdolescent : RAISING.settings.daysToAdult1;
}

export function trainingFoodLimit(id: number): number {
  const food = PROJECTION_FOODS.find(entry => entry.id === id && !entry.forgetsAbility);
  if (!food || food.fullness <= 0) throw new Error(`Unsupported training food: ${id}.`);
  return Math.min(4, Math.ceil(224 / food.fullness));
}

export function groupTrainingDays(days: TrainingDay[]) {
  const groups: (TrainingDay & { endDay: number; days: number; firstAttempt: number })[] = [];
  for (const entry of days) {
    const previous = groups.at(-1);
    const samePhase = previous && [RAISING.settings.daysToChick, RAISING.settings.daysToAdolescent, RAISING.settings.daysToAdult3]
      .every(boundary => (previous.day < boundary) === (entry.day < boundary));
    if (previous && samePhase && previous.endDay + 1 === entry.day && previous.careId === entry.careId && previous.carePoints === entry.carePoints
      && previous.foodId === entry.foodId && previous.foodCount === entry.foodCount && previous.story === entry.story
      && previous.feeding?.items.join(",") === entry.feeding?.items.join(",")) {
      previous.endDay = entry.day;
      previous.days++;
      previous.after = entry.after;
      previous.attempt = entry.attempt;
      previous.assumedLearned = entry.assumedLearned;
      if (previous.feeding && entry.feeding) previous.feeding = {
        ...previous.feeding, affectionAfter: entry.feeding.affectionAfter, fullnessAfter: entry.feeding.fullnessAfter,
        careSuccess: Math.min(previous.feeding.careSuccess, entry.feeding.careSuccess),
      };
    } else {
      groups.push({ ...entry, feeding: entry.feeding ? { ...entry.feeding } : undefined, endDay: entry.day, days: 1, firstAttempt: entry.attempt });
    }
  }
  return groups;
}

export function planRaisingGoal(input: RaisingGoalInput) {
  const error = validateRaisingGoal(input);
  if (error) throw new Error(error);
  const pending = RAISING_ABILITIES
    .filter(ability => input.desiredAbilities.includes(ability.name) && !input.knownAbilities.includes(ability.name))
    .sort((a, b) => b.discernment - a.discernment);
  const threshold = Math.max(0, ...pending.map(ability => ability.discernment));
  const attemptBudget = pending.length * STORY_ATTEMPTS_95;
  // Allow adult walks before the assumed story window; actual story acquisition is not predictable.
  const firstStoryDay = RAISING.settings.daysToAdult1 + 2;
  const start: SearchNode = {
    stats: { ...input.current }, parent: null, entry: null, attempts: 0, cost: 0,
    affection: input.feedingReport?.affection ?? RAISING.feeding.initialAffection,
    fullness: input.feedingReport?.fullness ?? 255, energySpent: 0, affectionDebt: 0,
  };
  const score = (node: SearchNode) => {
    const learning = node.attempts < attemptBudget;
    const deficit = STAT_KEYS.reduce((sum, key) =>
      sum + Math.max(0, input.target[key] - node.stats[key]) * (key === input.priority ? 2 : 1), 0);
    const excess = STAT_KEYS.reduce((sum, key) => sum + Math.max(0, node.stats[key] - input.target[key]), 0);
    const urgency = input.feedingReport && LAST_RAISING_DAY - (node.entry?.day ?? input.currentDay) < 8 ? 8 : 1;
    return (deficit + excess * 0.7) * urgency + node.cost * 0.015 + node.affectionDebt
      + (input.feedingReport ? Math.max(0, AFFECTION_TARGET - node.affection) * 2 : 0)
      + (learning ? Math.max(0, threshold - node.stats.discernment) * 5 + (attemptBudget - node.attempts) * 8 : 0);
  };
  let frontier = [start];
  const foods = PROJECTION_FOODS.filter(food => !food.forgetsAbility);
  for (let day = input.today ? input.currentDay : input.currentDay + 1; day <= LAST_RAISING_DAY; day++) {
    const candidates = new Map<string, SearchNode>();
    const plans = RAISING.plans.filter(plan => plan.id === 0
      || (plan.id >= 2 && day >= input.currentDay + 2 && day >= careAvailableDay(plan.id) + 2))
      .flatMap(plan => plan.id === 0 ? [{ ...plan, points: 2 as const }]
        : [{ ...plan, points: 2 as const }, { ...plan, points: 3 as const }]);
    for (const parent of frontier) {
      const learning = parent.attempts < attemptBudget;
      const reached = !learning && meetsGoal(parent.stats, input.target);
      for (const care of reached ? plans.filter(plan => plan.id === 0) : plans) {
        const afterCare = applyTrainingAction(parent.stats, { kind: "care", id: care.id }, day, care.points);
        let meals: { foodId: number | null; foodCount: number; stats: RaisingStats; feeding?: FeedingEstimate }[] = [
          { foodId: null, foodCount: 0, stats: afterCare },
        ];
        const isToday = day === input.currentDay && !!input.today;
        if (input.feedingReport) {
          const affection = isToday ? parent.affection : Math.max(0, Math.min(255, parent.affection + care.affection));
          const fullness = isToday ? parent.fullness : day <= RAISING.settings.daysToChick ? 255
            : day < RAISING.settings.daysToAdolescent
              ? Math.max(0, parent.fullness - Math.floor(RAISING.feeding.chickHungerPerEnergy * parent.energySpent)) : 0;
          const allowed = !isToday || (!input.today?.feedingDone && ["healthy", "tired"].includes(input.feedingReport.condition));
          const success = careSuccessChance(parent.stats, parent.affection, care.id);
          const options = feedingOptions(afterCare, affection, fullness, day, allowed)
            .filter(meal => (!learning || meal.stats.discernment >= Math.min(parent.stats.discernment, threshold))
              && (!reached || meetsGoal(meal.stats, input.target)));
          const canMaintain = options.some(meal => meal.affection >= AFFECTION_TARGET);
          meals = options.filter(meal => !canMaintain || meal.affection >= AFFECTION_TARGET).map(meal => ({
            foodId: null, foodCount: 0, stats: meal.stats,
            feeding: {
              items: meal.items, affectionBefore: affection, affectionAfter: meal.affection,
              fullnessBefore: fullness, fullnessAfter: meal.fullness, careSuccess: success,
            },
          }));
        } else if (!reached && day >= RAISING.settings.daysToAdolescent && !(day === input.currentDay && input.today?.feedingDone)) {
          for (const food of foods) {
            let stats = afterCare;
            for (let count = 1; count <= trainingFoodLimit(food.id); count++) {
              const next = applyRaisingStatChanges(stats, food.stats);
              if (statsKey(next) === statsKey(stats)) break;
              stats = next;
              meals.push({ foodId: food.id, foodCount: count, stats });
            }
          }
        }
        for (const meal of meals) {
          if (learning && meal.stats.discernment < Math.min(parent.stats.discernment, threshold)) continue;
          let stats = meal.stats;
          let attempts = parent.attempts;
          let story: string | null = null;
          let attempt = 0;
          if (learning && day >= firstStoryDay && stats.discernment >= threshold && !(day === input.currentDay && input.today?.storyDone)
            && (!isToday || !input.feedingReport || input.feedingReport.condition === "healthy")) {
            const ability = pending[Math.floor(attempts / STORY_ATTEMPTS_95)];
            story = ability.name;
            attempt = attempts % STORY_ATTEMPTS_95 + 1;
            stats = applyRaisingStatChanges(stats, { ...zeroStats(), discernment: 1 });
            attempts++;
          }
          const entry: TrainingDay = {
            day, careId: care.id, carePoints: care.points, foodId: meal.foodId, foodCount: meal.foodCount, story, attempt,
            assumedLearned: attempt === STORY_ATTEMPTS_95, before: parent.stats, after: stats,
            feeding: meal.feeding,
          };
          const cost = parent.cost + (meal.feeding?.items.length ?? meal.foodCount) + Number(care.id !== 0) * 0.5
            + Number(parent.entry !== null && parent.entry.careId !== care.id) * 2;
          const affection = meal.feeding?.affectionAfter ?? parent.affection;
          const node: SearchNode = {
            stats, parent, entry, attempts, cost, affection, fullness: meal.feeding?.fullnessAfter ?? parent.fullness,
            // Today's remaining energy is not measured. Story success can also refill energy.
            energySpent: isToday || story !== null ? 0 : care.energy,
            affectionDebt: parent.affectionDebt + (meal.feeding ? Math.max(0, AFFECTION_TARGET - affection) * 0.05 : 0),
          };
          const nextDayResetsHunger = day + 1 >= RAISING.settings.daysToAdolescent;
          // Older birds eat every modeled day; any top-band value survives the next care-and-meal cycle.
          const feedingKey = nextDayResetsHunger ? `${Math.min(AFFECTION_TARGET, affection)}`
            : `${affection}:${node.fullness}:${node.energySpent}`;
          const key = `${statsKey(stats)}:${attempts}${input.feedingReport ? `:${feedingKey}` : ""}`;
          const existing = candidates.get(key);
          if (!existing || score(node) < score(existing)) candidates.set(key, node);
        }
      }
    }
    // Bounded search across the calendar; an incomplete result is not proof of impossibility.
    frontier = [...candidates.values()].sort((a, b) => score(a) - score(b)).slice(0, 48);
    if (!frontier.length) throw new Error(`No valid training candidates on day ${day}.`);
  }
  const route = frontier.find(node => meetsGoal(node.stats, input.target) && node.attempts === attemptBudget) ?? frontier[0];
  const days: TrainingDay[] = [];
  for (let node: SearchNode | null = route; node?.entry; node = node.parent) days.push(node.entry);
  days.reverse();
  const assumedAbilities = pending.slice(0, Math.floor(route.attempts / STORY_ATTEMPTS_95)).map(ability => ability.name);
  const remaining = STAT_KEYS.filter(key => route.stats[key] < input.target[key])
    .map(key => `${STAT_LABELS[key]}: ${input.target[key] - route.stats[key]} more points`);
  for (const ability of pending) {
    if (!assumedAbilities.includes(ability.name)) remaining.push(`${ability.name}: story-attempt allowance not completed`);
  }
  return {
    threshold, pending, days, groups: groupTrainingDays(days), firstStoryDay,
    result: route.stats,
    complete: remaining.length === 0,
    remaining,
    foodItems: days.reduce((sum, day) => sum + (day.feeding?.items.length ?? day.foodCount), 0),
    careDays: days.filter(day => day.careId !== 0).length,
    earlyCareDays: days.filter(day => day.careId !== 0 && day.day < RAISING.settings.daysToAdult3).length,
    lateCareDays: days.filter(day => day.careId !== 0 && day.day >= RAISING.settings.daysToAdult3).length,
    finalAbilities: [...new Set([...input.knownAbilities, ...assumedAbilities])],
  };
}
