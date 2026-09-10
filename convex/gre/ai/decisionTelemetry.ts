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
 *  proof material margin picked among them. A named value = that rule was the
 *  LAST one to touch the pick; whether it actually CHANGED it is the record's
 *  own `flipped` field (issue #3399), not something the name asserts.
 *
 *  FROZEN — the root-rule moratorium (issue #3399, PRD #3397, ADR 0124 §5).
 *  The union is DERIVED from the runtime list below, and every member owes a
 *  `ROOT_RULE_ALLOWLIST` row naming the issue whose body carries its
 *  justification. For a NEW rule that justification has one shape: the proof
 *  that the two candidates the rule separates share ONE feature vector under
 *  every evaluation term — a distinction a term could express is a TERM, to
 *  be fitted from verdicts (ADR 0124), not a fourteenth hand-written rule at
 *  the root. Enforced twice: `Record<RootDecisionMechanism, …>` reds in `tsc`
 *  on a missing row, and `rootRuleAllowlist.bot.test.ts` reds at runtime in
 *  both directions (vitest transpiles, it does not typecheck). */
export const ROOT_DECISION_MECHANISMS = [
    "mean-reward",
    "material-tiebreak",
    "extra-turn-credit",
    "wasteful-attack",
    "block-quality",
    "announcement-variant",
    "self-harm-removal",
    "free-development",
    "hold-trick",
    "colour-mode-evidence",
    "wasted-mana-hold",
    "last-window-fire",
    "standing-spend-hold",
    "resolved-payoff",
] as const;

export type RootDecisionMechanism = (typeof ROOT_DECISION_MECHANISMS)[number];

/** One allowlist row. `structural` marks the two outcomes of the search's own
 *  selection — the mean-reward argmax and the material tie-break among
 *  outcome-equal contenders. They are not rules and cannot be disabled: with
 *  no argmax there is no pick at all. Everything else is `rule` — a named
 *  hand-written root tie-break, subject to the moratorium and to
 *  `SearchVariant.disabledRootRules`. */
export type RootRuleProvenance = {
    kind: "structural" | "rule";
    /** The issue whose body records the justification. */
    issue: number;
    /** One line: what the rule buys, in the vocabulary of the position it was
     *  written for. */
    why: string;
};

/** The moratorium allowlist (issue #3399). A new `ROOT_DECISION_MECHANISMS`
 *  member without a row here does not compile and does not pass the guard
 *  test — which is the whole point: the queue's answer to "the bot blundered"
 *  became a fourteenth root rule thirteen times, and ADR 0124 §5 replaced that
 *  reflex with Verdicts → fit → report. */
export const ROOT_RULE_ALLOWLIST: Record<
    RootDecisionMechanism,
    RootRuleProvenance
> = {
    "mean-reward": {
        kind: "structural",
        issue: 1893,
        why: "one contender survived the OUTCOME_EPS window — the search's own argmax",
    },
    "material-tiebreak": {
        kind: "structural",
        issue: 1893,
        why: "several outcome-equal contenders, ranked by saturation-proof material margin",
    },
    "extra-turn-credit": {
        kind: "rule",
        issue: 244,
        why: "an extra turn is washed out of the rollout (ADR 0015 horizon), so a grant is both low-reward and under-visited",
    },
    "wasteful-attack": {
        kind: "rule",
        issue: 1893,
        why: "a fully-absorbed attack that kills nothing leaves board material unchanged, so it ties with staying back; provenance predates the issue-tracked workflow, named and measured in the telemetry corpus",
    },
    "block-quality": {
        kind: "rule",
        issue: 1893,
        why: "a double chump and a single chump leave the same board in most rollouts; provenance predates the issue-tracked workflow, refined by #2876 (determinized lens) and #3106 (the empty declaration is always a contender)",
    },
    "announcement-variant": {
        kind: "rule",
        issue: 1888,
        why: "sibling variants of one announcement (other targets, other X, other modes) are outcome-equal to the search and separated only by the resolved payoff",
    },
    "self-harm-removal": {
        kind: "rule",
        issue: 365,
        why: "a self-confined cast whose settled resolution strictly LOWERS the mover's margin, held over an outcome-equal pass",
    },
    "free-development": {
        kind: "rule",
        issue: 206,
        why: "a land drop / free mana source / mana dork has no option cost, and its development washes out of the rollout (ADR 0020 §1)",
    },
    "hold-trick": {
        kind: "rule",
        issue: 229,
        why: "an instant-speed answer dumped at sorcery speed destroys option value the reward cannot price (ADR 0021)",
    },
    "colour-mode-evidence": {
        kind: "rule",
        issue: 2306,
        why: "a protection-from-the-colour-of-your-choice pick has no material signature at all until something of that colour appears",
    },
    "wasted-mana-hold": {
        kind: "rule",
        issue: 2955,
        why: "a ritual whose mana nothing in the position can spend burns a card for a resource that empties unused (CR 106.4 / 500.4)",
    },
    "last-window-fire": {
        kind: "rule",
        issue: 2939,
        why: "past the opponent's end step (CR 513.1) deferring buys no information, and both subtrees contain the same future activation",
    },
    "standing-spend-hold": {
        kind: "rule",
        issue: 3319,
        why: "the missing half of the fire rule outside the mover's own sorcery window: a spend that leaves the position no better is dominated by keeping the permanent",
    },
    "resolved-payoff": {
        kind: "rule",
        issue: 3388,
        why: "the POSITIVE half of self-harm-removal: a self-confined cast whose settled resolution strictly IMPROVES the mover's margin, taken over an outcome-equal pass",
    },
};

/** Whether a mechanism can be turned off by `SearchVariant.disabledRootRules`
 *  — every `rule` row, never a `structural` one. */
export function isDisableableRootRule(m: RootDecisionMechanism): boolean {
    return ROOT_RULE_ALLOWLIST[m].kind === "rule";
}

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
    /** Whether `mechanism` actually CHANGED the pick relative to the chain
     *  stage before it (issue #3399, the root-rule moratorium). A rule that
     *  re-selects the edge the stage before it already held CONFIRMED the
     *  pick; it did not decide it, and it is the count of records where it
     *  did that says whether the rule earns its place.
     *
     *  Per mechanism kind:
     *  - `mean-reward` — always false. There is no stage before the argmax.
     *  - `material-tiebreak` — true when the chosen edge sits strictly BELOW
     *    `bestMean`, i.e. the margin ranking traded reward away. Equal-mean
     *    edges are not a change: the reward stage had no opinion between
     *    them, so calling the pick a flip would count the order `pool`
     *    happened to be built in.
     *  - a named rule — true when the edge it selected is not the one the
     *    chain held when it ran. */
    flipped: boolean;
    /** True when the chosen edge is also the strict mean-reward argmax. */
    pickIsMeanArgmax: boolean;
    /** Issue #3393 — the 1-ply greedy policy's pick on the SAME root (the
     *  rollout policy `selectRolloutMove` applied to the root's move list,
     *  no search), as a move key, beside the key of the move the search
     *  chose. `greedyAgrees` is their equality. Present only on records
     *  `runSearchWithTrace` emitted — it is the sole caller that holds the
     *  root state, the pruned move list and the seed the greedy pick needs;
     *  a hand-built `selectRootMove` call in a test omits all three. */
    greedyMoveKey?: string;
    chosenMoveKey?: string;
    greedyAgrees?: boolean;
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

/** The named hand-written rules — every allowlisted mechanism that is not
 *  structural. DERIVED from `ROOT_RULE_ALLOWLIST`, never a second
 *  hand-maintained list: the literal this replaced shipped WITHOUT
 *  `resolved-payoff` (issue #3388 added the mechanism and forgot the row), so
 *  `namedRuleShare` silently under-counted from the day that rule landed —
 *  precisely the drift the moratorium's single registry exists to make
 *  impossible. */
const NAMED_RULES: RootDecisionMechanism[] = ROOT_DECISION_MECHANISMS.filter(
    (m) => ROOT_RULE_ALLOWLIST[m].kind === "rule"
);

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
    /** Share of decisions decided by one of the named tie-break rules. */
    namedRuleShare: number;
    /** Share of decisions whose final pick is the strict mean-reward argmax. */
    meanArgmaxShare: number;
    /** Issue #3399 — per mechanism, how many of the decisions it was
     *  attributed actually CHANGED the pick, out of how many it was
     *  attributed at all. A named rule sitting at `flipped: 0` over a real
     *  corpus decided NOTHING on it: it only ever confirmed what the stage
     *  before it already held. That is half the moratorium's removal test
     *  (the other half is the `must` tier staying green with the rule
     *  disabled — `SearchVariant.disabledRootRules`). */
    flipsByMechanism: Partial<
        Record<RootDecisionMechanism, { flipped: number; total: number }>
    >;
    /** Share of decisions whose attributed mechanism changed the pick. */
    flippedShare: number;
    /** Issue #3393 — share of records whose search pick equals the 1-ply
     *  greedy pick, over the records that carry `greedyAgrees` (null when
     *  none does), and the same agreement split by deciding mechanism and
     *  by chosen move kind as `{ agree, total }` counts. */
    greedyAgreeShare: number | null;
    greedyAgreeByMechanism: Partial<
        Record<RootDecisionMechanism, { agree: number; total: number }>
    >;
    greedyAgreeByMoveKind: Record<string, { agree: number; total: number }>;
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
    const flipsByMechanism: RootDecisionSummary["flipsByMechanism"] = {};
    let multiContender = 0;
    let named = 0;
    let meanArgmax = 0;
    let flipped = 0;
    let greedyTotal = 0;
    let greedyAgree = 0;
    const greedyAgreeByMechanism: RootDecisionSummary["greedyAgreeByMechanism"] =
        {};
    const greedyAgreeByMoveKind: RootDecisionSummary["greedyAgreeByMoveKind"] =
        {};
    const bumpAgree = (
        row: { agree: number; total: number },
        agrees: boolean
    ): void => {
        row.total++;
        if (agrees) row.agree++;
    };

    for (const r of records) {
        if (r.greedyAgrees !== undefined) {
            greedyTotal++;
            if (r.greedyAgrees) greedyAgree++;
            bumpAgree(
                (greedyAgreeByMechanism[r.mechanism] ??= {
                    agree: 0,
                    total: 0,
                }),
                r.greedyAgrees
            );
            bumpAgree(
                (greedyAgreeByMoveKind[r.moveKind] ??= { agree: 0, total: 0 }),
                r.greedyAgrees
            );
        }
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
        const flips = (flipsByMechanism[r.mechanism] ??= {
            flipped: 0,
            total: 0,
        });
        flips.total++;
        if (r.flipped) {
            flips.flipped++;
            flipped++;
        }
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
        flipsByMechanism,
        flippedShare: total === 0 ? 0 : flipped / total,
        greedyAgreeShare: greedyTotal === 0 ? null : greedyAgree / greedyTotal,
        greedyAgreeByMechanism,
        greedyAgreeByMoveKind,
    };
}
