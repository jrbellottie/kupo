import { useEffect, useState } from "react";
import { loadJson, saveJson } from "./utils/storage";
import { styles } from "./styles";

const CRAFTS = [
  "Alchemy",
  "Bonecraft",
  "Clothcraft",
  "Cooking",
  "Fishing",
  "Goldsmithing",
  "Leathercraft",
  "Smithing",
  "Woodworking",
] as const;

const OUTCOME_KEYS = ["hq", "nq", "breaks"] as const;
const MAX_SKILL_LEVEL = 120;
const MAX_OUTCOME_COUNT = Number.MAX_SAFE_INTEGER;
const STORAGE_KEY = "ffxi_synthesis_skill_tracker_v1";

type Craft = (typeof CRAFTS)[number];
type OutcomeKey = (typeof OUTCOME_KEYS)[number];
type SynthesisCounts = Record<OutcomeKey, number>;
const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  hq: "HQ",
  nq: "NQ",
  breaks: "Break",
};

type CraftProgress = {
  currentLevel: number;
  levels: Record<string, SynthesisCounts[]>;
};
type TrackerState = {
  increment: 1 | 10;
  selectedCraft: Craft;
  crafts: Partial<Record<Craft, CraftProgress>>;
};

const EMPTY_COUNTS: SynthesisCounts = {
  hq: 0,
  nq: 0,
  breaks: 0,
};

const DEFAULT_TRACKER: TrackerState = {
  increment: 1,
  selectedCraft: "Woodworking",
  crafts: {},
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isCraft(value: unknown): value is Craft {
  return typeof value === "string" && CRAFTS.some(craft => craft === value);
}

function normalizeCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count)
    ? Math.max(0, Math.min(MAX_OUTCOME_COUNT, Math.floor(count)))
    : 0;
}

function normalizeSkillLevel(value: unknown): number {
  const level = Number(value);
  return Number.isFinite(level)
    ? Math.max(0, Math.min(MAX_SKILL_LEVEL, Math.floor(level)))
    : 0;
}

function normalizeCounts(value: unknown): SynthesisCounts {
  const counts = asRecord(value);
  const legacyHq = Math.min(
    MAX_OUTCOME_COUNT,
    normalizeCount(counts.hq1) + normalizeCount(counts.hq2) + normalizeCount(counts.hq3)
  );
  return {
    hq: counts.hq === undefined ? legacyHq : normalizeCount(counts.hq),
    nq: normalizeCount(counts.nq),
    breaks: normalizeCount(counts.breaks),
  };
}

function normalizeSteps(value: unknown): SynthesisCounts[] {
  const steps = Array.isArray(value) ? value : [];
  const total = steps.reduce<SynthesisCounts>((result, step) => {
    const counts = normalizeCounts(step);
    return {
      hq: normalizeCount(result.hq + counts.hq),
      nq: normalizeCount(result.nq + counts.nq),
      breaks: normalizeCount(result.breaks + counts.breaks),
    };
  }, { ...EMPTY_COUNTS });
  return [total];
}

function normalizeTracker(value: unknown): TrackerState {
  const tracker = asRecord(value);
  const rawCrafts = asRecord(tracker.crafts);
  const crafts: Partial<Record<Craft, CraftProgress>> = {};

  for (const craft of CRAFTS) {
    const rawProgress = asRecord(rawCrafts[craft]);
    const rawLevels = asRecord(rawProgress.levels);
    const levels: Record<string, SynthesisCounts[]> = {};

    for (const [levelKey, steps] of Object.entries(rawLevels)) {
      const level = Number(levelKey);
      if (Number.isInteger(level) && level >= 0 && level <= MAX_SKILL_LEVEL) {
        levels[String(level)] = normalizeSteps(steps);
      }
    }

    if (rawCrafts[craft]) {
      crafts[craft] = {
        currentLevel: normalizeSkillLevel(rawProgress.currentLevel),
        levels,
      };
    }
  }

  return {
    increment: tracker.increment === 10 ? 10 : 1,
    selectedCraft: isCraft(tracker.selectedCraft) ? tracker.selectedCraft : DEFAULT_TRACKER.selectedCraft,
    crafts,
  };
}

function totalCounts(steps: SynthesisCounts[]) {
  const totals = steps.reduce<SynthesisCounts>((result, step) => ({
    hq: result.hq + step.hq,
    nq: result.nq + step.nq,
    breaks: result.breaks + step.breaks,
  }), { ...EMPTY_COUNTS });
  return {
    ...totals,
    successes: totals.nq + totals.hq,
    syntheses: totals.nq + totals.hq + totals.breaks,
  };
}

function formatSkillUpRate(syntheses: number, levels = 1): string {
  if (syntheses <= 0) return "—";
  const rate = (levels * 10 / syntheses) * 100;
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
}

export default function SynthesisLevelTracker() {
  const [tracker, setTracker] = useState<TrackerState>(() =>
    normalizeTracker(loadJson<unknown>(STORAGE_KEY, DEFAULT_TRACKER))
  );
  const [viewingLevel, setViewingLevel] = useState<number | null>(null);

  useEffect(() => saveJson(STORAGE_KEY, tracker), [tracker]);

  const selectedCraft = tracker.selectedCraft;
  const progress = tracker.crafts[selectedCraft] ?? { currentLevel: 0, levels: {} };
  const displayedLevel = viewingLevel ?? progress.currentLevel;
  const editingSavedLevel = displayedLevel !== progress.currentLevel;
  const levelKey = String(displayedLevel);
  const steps = progress.levels[levelKey] ?? normalizeSteps([]);
  const totals = totalCounts(steps);
  const recordedLevels = Object.entries(progress.levels)
    .filter(([level, levelSteps]) => Number(level) !== progress.currentLevel && totalCounts(levelSteps).syntheses > 0)
    .sort(([levelA], [levelB]) => Number(levelB) - Number(levelA));
  const previousLevels = recordedLevels.filter(([level]) => level !== levelKey);
  const recordedAttempts = recordedLevels.reduce(
    (total, [, levelSteps]) => total + totalCounts(levelSteps).syntheses,
    0
  );
  const averageSkillUpRate = formatSkillUpRate(recordedAttempts, recordedLevels.length);

  function updateProgress(update: (current: CraftProgress) => CraftProgress) {
    setTracker(previous => {
      const current = previous.crafts[selectedCraft] ?? { currentLevel: 0, levels: {} };
      return {
        ...previous,
        crafts: {
          ...previous.crafts,
          [selectedCraft]: update(current),
        },
      };
    });
  }

  function setCurrentLevel(level: number) {
    setViewingLevel(null);
    updateProgress(current => ({
      ...current,
      currentLevel: normalizeSkillLevel(level),
    }));
  }

  function adjustOutcome(stepIndex: number, outcome: OutcomeKey, amount: -1 | 1) {
    updateProgress(current => {
      const key = String(displayedLevel);
      const currentSteps = normalizeSteps(current.levels[key]);
      const nextSteps = currentSteps.map((step, index) =>
        index === stepIndex
          ? {
            ...step,
            [outcome]: Math.max(0, Math.min(MAX_OUTCOME_COUNT, step[outcome] + amount * tracker.increment)),
          }
          : step
      );
      return {
        ...current,
        levels: {
          ...current.levels,
          [key]: nextSteps,
        },
      };
    });
  }

  function completeLevel() {
    setViewingLevel(null);
    updateProgress(current => ({
      ...current,
      currentLevel: Math.min(MAX_SKILL_LEVEL, current.currentLevel + 1),
    }));
  }

  const summaryItems = [
    { label: "Syntheses", value: totals.syntheses },
    { label: "Skill-up rate", value: formatSkillUpRate(totals.syntheses) },
    { label: "Successful", value: totals.successes },
    { label: "NQ", value: totals.nq },
    { label: "HQ total", value: totals.hq },
    { label: "Breaks", value: totals.breaks },
  ];

  return (
    <section style={styles.card}>
      <div style={styles.titleRow}>
        <h3 style={styles.h3}>Synthesis Skill-Up Tracker</h3>
        <div style={styles.sub}>Saved by craft on this device</div>
      </div>

      <div style={styles.cardBody}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 12 }}>
          <label style={styles.field}>
            <span style={styles.label}>Craft</span>
            <select
              style={styles.selectCompact}
              value={selectedCraft}
              onChange={event => {
                const craft = event.target.value;
                if (isCraft(craft)) {
                  setViewingLevel(null);
                  setTracker(previous => ({
                    ...previous,
                    selectedCraft: craft,
                  }));
                }
              }}
            >
              {CRAFTS.map(craft => <option key={craft} value={craft}>{craft}</option>)}
            </select>
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Current whole skill level</span>
            <input
              style={styles.inputCompact}
              type="number"
              min={0}
              max={MAX_SKILL_LEVEL}
              step={1}
              value={progress.currentLevel}
              onChange={event => setCurrentLevel(Number(event.target.value) || 0)}
            />
          </label>
        </div>

        <div style={styles.subCard}>
          <div style={{ ...styles.titleRow, marginBottom: 10 }}>
            <strong>
              {editingSavedLevel ? "Editing saved level " : "Level "}
              {displayedLevel} to {displayedLevel + 1}
            </strong>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={styles.sub}>Increment by:</span>
              <button
                type="button"
                style={styles.buttonPrimaryCompact}
                aria-label={`Counter increment +${tracker.increment}; click to toggle`}
                aria-pressed={tracker.increment === 10}
                onClick={() => setTracker(previous => ({
                  ...previous,
                  increment: previous.increment === 1 ? 10 : 1,
                }))}
              >
                +{tracker.increment}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(95px, 1fr))", gap: 8 }}>
            {summaryItems.map(item => (
              <div key={item.label}>
                <div style={styles.sub}>{item.label}</div>
                <strong>{item.value.toLocaleString()}</strong>
              </div>
            ))}
          </div>

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ borderCollapse: "collapse", minWidth: 760, width: "100%", textAlign: "left" }}>
              <thead>
                <tr>
                  {["Skill level", "Syntheses", ...OUTCOME_KEYS.map(outcome => OUTCOME_LABELS[outcome])].map(label => (
                    <th key={label} scope="col" style={{ padding: "6px 4px", borderBottom: "1px solid #444", fontSize: 12 }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {steps.map((step, index) => {
                  const stepTotal = totalCounts([step]);
                  return (
                    <tr key={index}>
                      <th scope="row" style={{ padding: "5px 4px", borderBottom: "1px solid #292929", fontSize: 12, whiteSpace: "nowrap" }}>
                        {displayedLevel} → {displayedLevel + 1}
                      </th>
                      <td style={{ padding: "5px 4px", borderBottom: "1px solid #292929" }}>{stepTotal.syntheses.toLocaleString()}</td>
                      {OUTCOME_KEYS.map(outcome => (
                        <td key={outcome} style={{ padding: "5px 4px", borderBottom: "1px solid #292929" }}>
                          <button
                            style={{ ...styles.buttonCompact, width: 76, padding: "0 6px", fontVariantNumeric: "tabular-nums" }}
                            title="Left-click to add one; right-click to subtract one"
                            aria-label={`${displayedLevel} to ${displayedLevel + 1} ${OUTCOME_LABELS[outcome]} count: ${step[outcome]}. Left-click to add one; right-click to subtract one.`}
                            onClick={() => adjustOutcome(index, outcome, 1)}
                            onContextMenu={event => {
                              event.preventDefault();
                              adjustOutcome(index, outcome, -1);
                            }}
                          >
                            {step[outcome].toLocaleString()}
                          </button>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={styles.buttonRow}>
            {editingSavedLevel ? (
              <button style={styles.buttonPrimaryCompact} onClick={() => setViewingLevel(null)}>
                Return to current level ({progress.currentLevel})
              </button>
            ) : (
              <button
                style={{
                  ...styles.buttonPrimaryCompact,
                  ...(progress.currentLevel >= MAX_SKILL_LEVEL ? styles.buttonDisabled : {}),
                }}
                disabled={progress.currentLevel >= MAX_SKILL_LEVEL}
                onClick={completeLevel}
              >
                Mark level complete and start {progress.currentLevel + 1}
              </button>
            )}
          </div>
        </div>

        {recordedLevels.length > 0 && (
          <div style={styles.subCard}>
            <div style={styles.titleRow}>
              <strong>Recorded levels</strong>
              <span style={styles.sub}>Average skill-up rate: {averageSkillUpRate}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginTop: 10 }}>
              {previousLevels.map(([level, levelSteps]) => {
                const recordedLevel = Number(level);
                const summary = totalCounts(levelSteps);
                return (
                  <div key={level} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ fontWeight: 700 }}>{recordedLevel} to {recordedLevel + 1}</div>
                      <button
                        style={styles.buttonCompact}
                        aria-label={`Edit level ${recordedLevel} to ${recordedLevel + 1}`}
                        onClick={() => setViewingLevel(recordedLevel)}
                      >
                        Edit
                      </button>
                    </div>
                    <div style={styles.sub}>
                      {summary.syntheses.toLocaleString()} syntheses · {summary.successes.toLocaleString()} successful ·{" "}
                      {summary.hq.toLocaleString()} HQ · {summary.breaks.toLocaleString()} breaks
                    </div>
                    <div style={styles.sub}>Skill-up rate: {formatSkillUpRate(summary.syntheses)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
