// Root-decision telemetry (issue #1893, map #1892).
//
// Measures HOW each root pick in `selectRootMove` was decided — by the
// search's own mean reward, by the material tie-break among outcome-equal
// contenders, or by one of the named tie-break rules — without changing any
// behaviour. The sink is a module-level hook, OFF by default (null): live
// play and every existing test pay nothing beyond a null check; only a
// measurement harness (`src/lib/ai/selfplay/decisionCorpus.ts`) installs it.
//
// The point of the measurement (map #1892, evidence 1): the reward slope in
// the open band is `(1 − 2·TERMINAL_BAND) / (2·MATERIAL_FULL)` = 0.0005
// reward per margin point, so the `OUTCOME_EPS = 0.05` tie window spans
// ~100 margin points. Any decision whose contenders sit inside that band is
// NOT decided by the search — this module counts how often that happens and
// which mechanism actually picked the move.

/** How the final root pick was decided. Ordered from "the search decided" to
 *  the named hand-written rules. `mean-reward` = a single contender survived
 *  the `OUTCOME_EPS` window (the search's argmax stood alone).
 *  `material-tiebreak` = several outcome-equal contenders, the saturation-
 *  proof material margin picked among them. The named values = that rule
 *  CHANGED the pick (a branch that re-selected the same edge does not count
 *  as deciding). */
export type RootDecisionMechanism =
    | "mean-reward"
    | "material-tiebreak"
    | "extra-turn-credit"
    | "wasteful-attack"
    | "block-quality"
    | "announcement-variant"
    | "self-harm-removal"
    | "free-development"
    | "hold-trick"
    | "colour-mode-evidence"
    | "wasted-mana-hold";

/** Which bound ended a search loop — the iteration budget (`SearchBudget.
 *  iterations`) was reached, the wall-clock bound (`SearchBudget.timeMs`)
 *  fired first (issue #2682: before this, `runSearchWithTrace` computed the
 *  real per-decision iteration count and threw it away — nobody could tell
 *  whether a `medium`-preset decision in the browser Worker actually
 *  completed its 400-iteration budget or got cut short by the wall clock), or
 *  the EARLY-STOP rule declared the root pick settled before either bound
 *  fired (`"settled"`, issue #2685 — the most-visited root child could no
 *  longer be overtaken and its mean-reward lead was decisive, so further
 *  iterations could not change the move).
 *  Shared by `DecisionTrace` (`search.ts`) and `RootDecisionRecord` below. */
export type SearchStopReason = "iterations" | "time" | "settled";

/** Real iteration/time stats for one completed search loop (issue #2682).
 *  `iterationsRequested` is the budget's target count (`SearchBudget.
 *  iterations`, or the completed count itself when the budget left
 *  `iterations` unset — an unbounded-iterations budget has no target to
 *  report against). `elapsedMs` is wall-clock, measured with the budget's
 *  own `now` (injectable for deterministic tests; `performance.now()` in
 *  production/the Worker). */
export type SearchStats = {
    iterationsCompleted: number;
    iterationsRequested: number;
    elapsedMs: number;
    stoppedBy: SearchStopReason;
};

/** One record per `selectRootMove` call (i.e. per real bot decision with at
 *  least one visited root edge). All reward quantities are in the [0, 1]
 *  reward band; `gapMarginPoints` converts through the open-band slope so the
 *  gap reads in `evaluate` margin points (the map's own currency).
 *
 *  The `SearchStats` fields (issue #2682) are `Partial` — only
 *  `runSearchWithTrace`'s call to `selectRootMove` can supply them (it is the
 *  only caller that actually ran a search loop); every other call site in the
 *  test suite hand-builds a `Node` with no loop to report on, so those
 *  records simply omit them. */
export type RootDecisionRecord = {
    /** Game phase at the root (e.g. "PRECOMBAT_MAIN"); "unknown" when the
     *  caller passed no root state. */
    phase: string;
    /** `kind` of the chosen move (e.g. "cast-spell", "pass"). */
    moveKind: string;
    /** True when the root decision was a pending-choice node. */
    choiceNode: boolean;
    /** Visited root edges. */
    poolSize: number;
    /** Edges inside the `VISIT_TOL` visit band. */
    exploredSize: number;
    /** Edges inside the `OUTCOME_EPS` reward window (the tie band). */
    contenderCount: number;
    /** Best mean reward among the visit-band edges. */
    bestMean: number;
    /** Mean reward of the edge actually chosen. */
    chosenMean: number;
    /** Best − second-best mean reward among visit-band edges; null when
     *  fewer than two edges survived the visit band. */
    gapReward: number | null;
    /** `gapReward` converted to `evaluate` margin points through the
     *  open-band slope; null when `gapReward` is null. */
    gapMarginPoints: number | null;
    /** How far the chosen edge's mean reward sits below `bestMean` — the
     *  reward the deciding mechanism traded away (0 when the pick IS the
     *  argmax). */
    chosenDeficitReward: number;
    mechanism: RootDecisionMechanism;
    /** True when the chosen edge is also the strict mean-reward argmax. */
    pickIsMeanArgmax: boolean;
} & Partial<SearchStats>;

export type RootDecisionSink = (record: RootDecisionRecord) => void;

let sink: RootDecisionSink | null = null;

/** Install (or, with null, remove) the telemetry sink. Off by default —
 *  callers MUST restore null when done (try/finally), or every later search
 *  in the process keeps paying the record-building cost. */
export function setRootDecisionSink(next: RootDecisionSink | null): void {
    sink = next;
}

/** The currently installed sink (null = telemetry off). Read once per
 *  `selectRootMove` call. */
export function getRootDecisionSink(): RootDecisionSink | null {
    return sink;
}

// ---------------------------------------------------------------------------
// Aggregation (pure — the corpus runner and the findings doc both read this)
// ---------------------------------------------------------------------------

/** Histogram bucket upper bounds for `gapMarginPoints`, chosen so the map's
 *  ~100-point indifference band falls on a bucket edge. */
export const GAP_BUCKET_EDGES = [
    5, 10, 25, 50, 100, 150, 250, 500, 1000,
] as const;

const NAMED_RULES: RootDecisionMechanism[] = [
    "extra-turn-credit",
    "wasteful-attack",
    "block-quality",
    "announcement-variant",
    "self-harm-removal",
    "free-development",
    "hold-trick",
    "colour-mode-evidence",
    "wasted-mana-hold",
];

export type RootDecisionSummary = {
    total: number;
    /** Decisions per mechanism (absent = zero). */
    byMechanism: Partial<Record<RootDecisionMechanism, number>>;
    /** phase → mechanism → count. */
    byPhase: Record<string, Partial<Record<RootDecisionMechanism, number>>>;
    /** chosen move kind → mechanism → count. */
    byMoveKind: Record<string, Partial<Record<RootDecisionMechanism, number>>>;
    /** Histogram of best-vs-second gaps in margin points. Label "≤N" per
     *  `GAP_BUCKET_EDGES` edge, then ">1000", plus "single-edge" for
     *  decisions with no second visit-band edge. */
    gapHistogram: Record<string, number>;
    /** Share of decisions with more than one `OUTCOME_EPS` contender — the
     *  decisions the search itself did NOT resolve. */
    multiContenderShare: number;
    /** Share of decisions decided by one of the six named tie-break rules. */
    namedRuleShare: number;
    /** Share of decisions whose final pick is the strict mean-reward argmax. */
    meanArgmaxShare: number;
};

function bucketLabel(gapMarginPoints: number): string {
    for (const edge of GAP_BUCKET_EDGES) {
        if (gapMarginPoints <= edge) return `≤${edge}`;
    }
    return `>${GAP_BUCKET_EDGES[GAP_BUCKET_EDGES.length - 1]}`;
}

function bump(
    table: Record<string, Partial<Record<RootDecisionMechanism, number>>>,
    key: string,
    mech: RootDecisionMechanism
): void {
    const row = (table[key] ??= {});
    row[mech] = (row[mech] ?? 0) + 1;
}

/** Fold a record list into the summary the findings doc reports. Pure. */
export function summarizeRootDecisions(
    records: RootDecisionRecord[]
): RootDecisionSummary {
    const byMechanism: Partial<Record<RootDecisionMechanism, number>> = {};
    const byPhase: RootDecisionSummary["byPhase"] = {};
    const byMoveKind: RootDecisionSummary["byMoveKind"] = {};
    const gapHistogram: Record<string, number> = {};
    let multiContender = 0;
    let named = 0;
    let meanArgmax = 0;

    for (const r of records) {
        byMechanism[r.mechanism] = (byMechanism[r.mechanism] ?? 0) + 1;
        bump(byPhase, r.phase, r.mechanism);
        bump(byMoveKind, r.moveKind, r.mechanism);
        const label =
            r.gapMarginPoints === null
                ? "single-edge"
                : bucketLabel(r.gapMarginPoints);
        gapHistogram[label] = (gapHistogram[label] ?? 0) + 1;
        if (r.contenderCount > 1) multiContender++;
        if (NAMED_RULES.includes(r.mechanism)) named++;
        if (r.pickIsMeanArgmax) meanArgmax++;
    }

    const total = records.length;
    return {
        total,
        byMechanism,
        byPhase,
        byMoveKind,
        gapHistogram,
        multiContenderShare: total === 0 ? 0 : multiContender / total,
        namedRuleShare: total === 0 ? 0 : named / total,
        meanArgmaxShare: total === 0 ? 0 : meanArgmax / total,
    };
}
