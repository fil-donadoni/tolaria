// Loop scorecard — the numbers this loop's design decisions rest on
// (issue #2187, PRD #2180).
//
// The repo holds ~190k tool-telemetry events and, since #2182, a durable receipt
// per subagent. Every optimisation recorded in the loop's skill file is
// nonetheless an anecdote with a date attached: "a strong reviewer over a cheap
// implementer is the asymmetry to exploit", "one gate per landing tree",
// "omitting the model parameter silently routes at the session tier". Each of
// those is a claim about a RATE, and none of them has ever been measured.
//
// This module is that measurement. Two properties are load-bearing:
//
//   * PURE — events and receipts in, scorecard out. No filesystem, no clock, no
//     git. The window arrives as an argument, so the same inputs always produce
//     the same numbers and a fixture can pin them.
//   * DEFINITIONS ARE THE DELIVERABLE — every metric here is a rate, and a rate
//     silently redefined is worse than no rate: the series stays plausible while
//     meaning something else. So each definition is stated in the code, pinned by
//     a test against a frozen sample, and reports its own denominator. Changing
//     one is a deliberate edit to an expectation.
//
// What the data cannot say, it says loudly. `unclassified` roles, `missing`
// receipts and an empty window are reported as themselves rather than folded
// into a confident-looking average.

export interface TelemetryEvent {
    ts: number;
    phase: "pre" | "post";
    session: string;
    tool: string | null;
    id: string | null;
    skill?: string | null;
    agent_desc?: string | null;
    agent_type?: string | null;
    /** The `model` parameter the caller passed. `null` = inherited the session tier. */
    model?: string | null;
    cmd?: string | null;
    tokens?: number | null;
    [key: string]: unknown;
}

/** The receipt shape this module reads. Structurally compatible with `Receipt`. */
export interface ScorecardReceipt {
    role: "implement" | "fixup" | "review" | "missing";
    issue?: number;
    outcome: string;
    session?: string;
    /** Which batch directory it came from — the orchestrator's session id. */
    batch: string;
    /** Which re-attempt of this (issue, role) pair — absent means round 1.
     * See `receipt.ts`'s `RoundedReceipt`. A second review or fixup round
     * carries an explicit `round`, and picking the latest one is what keeps
     * `shippedIssues` from reporting a superseded round's outcome. */
    round?: number;
    /** Unix seconds. Optional only because ~0.5% of the receipts on disk
     * predate the field; an undated receipt falls outside every window. */
    ts?: number;
}

export interface Window {
    /** Unix seconds, inclusive. */
    from: number;
    /** Unix seconds, inclusive. */
    to: number;
}

/**
 * The loop's three working roles, plus the orchestrator, plus `support` — the
 * read-only spawns (`investigate`, `research`, `verify`, `migrate`, `audit`)
 * that `spawn-guard.sh` also admits. Support is a REAL bucket, not a synonym
 * for unclassified: it is work whose role IS known and simply is not one of the
 * three the per-issue cost figures are about.
 */
export type Role =
    | "implement"
    | "review"
    | "fixup"
    | "support"
    | "orchestrator";

export interface Scorecard {
    window: Window;
    /** False when the window contains no events AND no receipts. */
    hasData: boolean;
    /** Human-readable statements about what the numbers do NOT cover. */
    notes: string[];

    passes: number;
    issuesShipped: number;
    /** Seconds of orchestrator wall-clock per shipped issue. `null` with none. */
    wallClockPerIssueSec: number | null;

    tokensByRole: Record<Role | "unclassified", number>;
    /** Tokens per shipped issue, by role. `null` when nothing shipped. */
    tokensPerIssueByRole: Record<Role | "unclassified", number> | null;
    /** Share of agent tokens the role heuristic could not attribute. */
    unclassifiedTokenShare: number | null;

    /** Blocked reviews ÷ reviews. `null` when no review was recorded. */
    reviewBlockingRate: number | null;
    reviewsRecorded: number;

    /** rounds → how many issues had exactly that many fixups. The tail matters. */
    fixupRounds: Record<number, number>;

    /** Full-gate invocations ÷ shipped issues. `null` when nothing shipped. */
    gateRunsPerShippedIssue: number | null;
    gateRuns: number;

    collisionAborts: number;
    missingReceipts: number;

    /** Agent spawns that passed no `model`, so inherited the session tier. */
    inheritedModelSpawns: number;
    agentSpawns: number;
    /** `inheritedModelSpawns ÷ agentSpawns`. `null` when nothing was spawned. */
    inheritedModelShare: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Definitions — each one pinned by `scorecard.test.ts` against a frozen sample.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SHIPPED: an issue whose LATEST work receipt is `pr-open`, and which is not
 * still sitting on an unanswered `blocking` verdict.
 *
 * Not "merged" — a receipt cannot know that; the merge is a GitHub fact and this
 * function is pure. This is the closest disk-local proxy.
 *
 * Two clauses, each doing real work:
 *
 *   * **Latest** work receipt, so a `fixup` supersedes the `implement` receipt it
 *     replaces, and — once a second round exists — the highest `round` within
 *     that role supersedes the round before it. Selection is by round, never
 *     by the order the receipts happen to iterate in (directory read order is
 *     not filename-sorted, and even sorted order puts `12-fixup-2.json` before
 *     `12-fixup.json`): an issue reworked across several fixup rounds must
 *     report its LAST round's outcome, not whichever one this loop saw last.
 *     An issue that went to `[WIP]` after three attempts has a `wip` fixup
 *     receipt as its latest round and is correctly excluded.
 *   * A `blocking` verdict with **no fixup after it** excludes the issue. A
 *     blocking verdict that a fixup answered does NOT: the block was resolved and
 *     the PR did ship. Counting it as unshipped would inflate every per-issue
 *     cost figure by exactly the work the loop is designed to do.
 */
function shippedIssues(receipts: ScorecardReceipt[]): Set<string> {
    const latest = new Map<string, ScorecardReceipt>();
    const hasFixup = new Set<string>();
    const blocked = new Set<string>();
    for (const r of receipts) {
        const k = key(r);
        if (r.role === "review") {
            if (r.outcome === "blocking") blocked.add(k);
            continue;
        }
        if (r.role !== "implement" && r.role !== "fixup") continue;
        if (r.role === "fixup") hasFixup.add(k);
        const held = latest.get(k);
        if (!held || supersedesWork(r, held)) latest.set(k, r);
    }

    const shipped = new Set<string>();
    for (const [k, r] of latest) {
        if (r.outcome !== "pr-open") continue;
        if (blocked.has(k) && !hasFixup.has(k)) continue;
        shipped.add(k);
    }
    return shipped;
}

/** `candidate` supersedes `held` iff it is a later role (`fixup` over
 * `implement`), or the same role at a higher round (absent round = 1). */
function supersedesWork(
    candidate: ScorecardReceipt,
    held: ScorecardReceipt
): boolean {
    const rank = (r: ScorecardReceipt) => (r.role === "fixup" ? 1 : 0);
    if (rank(candidate) !== rank(held)) return rank(candidate) > rank(held);
    return (candidate.round ?? 1) > (held.round ?? 1);
}

/** An issue is identified by batch + number: the same issue in two passes is two data points. */
function key(r: ScorecardReceipt): string {
    return `${r.batch}#${r.issue ?? 0}`;
}

const FULL_GATE =
    /\b(bun run test|bun run check:all|TOLARIA_ALLOW_FULL_SUITE)\b/;

/**
 * ROLE: derived from the Agent spawn's own fields, in this order.
 *
 * The heuristic is deliberately shallow AND its miss rate is reported: a role
 * split that quietly buckets everything it cannot read into "implement" would
 * look identical to a real one. `unclassifiedTokenShare` is how you know
 * whether to believe the split at all.
 */
export function classifyRole(event: TelemetryEvent): Role | "unclassified" {
    if (event.tool !== "Agent") return "orchestrator";
    const type = (event.agent_type ?? "").toLowerCase();
    const desc = (event.agent_desc ?? "").toLowerCase().trimStart();

    // `.claude/hooks/spawn-guard.sh` DENIES a spawn whose description does not
    // start with one of these, so from its landing onward this is a total
    // classification rather than a heuristic. The looser fallbacks below stay
    // for the telemetry recorded BEFORE the hook existed — deleting them would
    // silently reclassify ~190k historical events.
    if (desc.startsWith("review")) return "review";
    if (desc.startsWith("fixup")) return "fixup";
    if (desc.startsWith("implement")) return "implement";
    for (const verb of [
        "investigate",
        "research",
        "verify",
        "migrate",
        "audit",
    ]) {
        if (desc.startsWith(verb)) return "support";
    }

    if (type.includes("review") || /\breview/.test(desc)) return "review";
    if (/\bfix ?up\b/.test(desc)) return "fixup";
    if (/\bimplement\b/.test(desc) || /#\d+/.test(desc)) return "implement";
    return "unclassified";
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ScorecardInput {
    events: TelemetryEvent[];
    receipts: ScorecardReceipt[];
    window: Window;
}

export function summarizeLoop({
    events,
    receipts: allReceipts,
    window,
}: ScorecardInput): Scorecard {
    const inWindow = events.filter(
        (e) => e.ts >= window.from && e.ts <= window.to
    );
    const notes: string[] = [];

    // The window has to filter BOTH inputs or every per-issue figure is a
    // windowed numerator over an all-time denominator. It was not: `passes`,
    // `issuesShipped`, the review rate and the fixup histogram came from every
    // receipt on disk, while tokens, gates and wall-clock came from the window.
    // Measured 2026-08-17, same repo, four windows:
    //
    //     days        7      14      30      60
    //     passes     80      80      80      80     ← never moved
    //     shipped    63      63      63      63     ← never moved
    //     gate runs  98     235    1485    3653     ← windowed
    //
    // So "1.56 gate runs per shipped issue" at 7 days and "23.57" at 30 was one
    // series divided by a constant. Every ratio this module reports was
    // affected, and nothing said so.
    //
    // An UNDATED receipt is excluded rather than admitted everywhere: the
    // alternative is a row that silently counts in every window, which is the
    // failure this fixes. The count is reported instead of swallowed.
    const undatedReceipts = allReceipts.filter(
        (r) => typeof r.ts !== "number"
    ).length;
    const receipts = allReceipts.filter(
        (r) =>
            typeof r.ts === "number" && r.ts >= window.from && r.ts <= window.to
    );
    // The receipt directory is younger than the telemetry log — receipts only
    // exist since #2182, and batches are pruned. Asking for 60 days therefore
    // widens the event side while the receipt side stops at its own beginning,
    // and every per-issue ratio inflates with the window for no reason a reader
    // could see. Same class of defect as the one above, so it is stated rather
    // than left to be rediscovered.
    const earliest = Math.min(
        ...allReceipts
            .map((r) => r.ts)
            .filter((t): t is number => typeof t === "number")
    );
    if (Number.isFinite(earliest) && earliest > window.from) {
        const covered = Math.round((window.to - earliest) / 86_400);
        const asked = Math.round((window.to - window.from) / 86_400);
        notes.push(
            `Receipts only go back ${covered} day(s) of the ${asked} asked for: per-issue figures over the longer window divide a full-window numerator by a ${covered}-day denominator.`
        );
    }

    if (undatedReceipts > 0) {
        notes.push(
            `${undatedReceipts} receipt(s) carry no \`ts\` and are outside every window — they predate the field and are excluded from all counts.`
        );
    }

    if (inWindow.length === 0 && receipts.length === 0) {
        notes.push(
            "No telemetry events and no receipts in this window — every figure below is zero because there is nothing to measure, not because the loop performed perfectly."
        );
        return emptyScorecard(window, notes);
    }
    if (inWindow.length === 0) {
        notes.push(
            "No telemetry events in this window: token, wall-clock, gate and model-tier figures are unavailable. Receipt-derived figures below are still real."
        );
    }
    if (receipts.length === 0) {
        notes.push(
            "No receipts supplied: ship counts, review rate, fixup rounds and collisions are unavailable. Telemetry-derived figures below are still real."
        );
    }

    const shipped = shippedIssues(receipts);
    const batches = new Set(receipts.map((r) => r.batch));

    // ── wall-clock: first to last telemetry event of the batches' sessions ──
    const batchEvents = inWindow.filter((e) => batches.has(e.session));
    const wallClockSec =
        batchEvents.length > 1
            ? Math.max(...batchEvents.map((e) => e.ts)) -
              Math.min(...batchEvents.map((e) => e.ts))
            : 0;

    // ── tokens by role (post events only: `pre` carries no usage) ──
    const tokensByRole: Record<Role | "unclassified", number> = {
        implement: 0,
        review: 0,
        fixup: 0,
        support: 0,
        orchestrator: 0,
        unclassified: 0,
    };
    for (const e of inWindow) {
        if (e.phase !== "post") continue;
        const tokens = typeof e.tokens === "number" ? e.tokens : 0;
        if (tokens <= 0) continue;
        tokensByRole[classifyRole(e)] += tokens;
    }
    const agentTokens =
        tokensByRole.implement +
        tokensByRole.review +
        tokensByRole.fixup +
        tokensByRole.support +
        tokensByRole.unclassified;

    // ── reviews ──
    const reviews = receipts.filter((r) => r.role === "review");
    const blocked = reviews.filter((r) => r.outcome === "blocking").length;

    // ── fixup rounds, as a DISTRIBUTION: the tail is the interesting part ──
    const fixupsPerIssue = new Map<string, number>();
    for (const k of shipped) fixupsPerIssue.set(k, 0);
    for (const r of receipts) {
        if (r.role !== "fixup") continue;
        const k = key(r);
        fixupsPerIssue.set(k, (fixupsPerIssue.get(k) ?? 0) + 1);
    }
    const fixupRounds: Record<number, number> = {};
    for (const rounds of fixupsPerIssue.values()) {
        fixupRounds[rounds] = (fixupRounds[rounds] ?? 0) + 1;
    }

    // ── gate runs ──
    const gateRuns = inWindow.filter(
        (e) =>
            e.phase === "pre" &&
            e.tool === "Bash" &&
            typeof e.cmd === "string" &&
            FULL_GATE.test(e.cmd)
    ).length;

    // ── model tier ──
    const spawns = inWindow.filter(
        (e) => e.phase === "pre" && e.tool === "Agent"
    );
    const inherited = spawns.filter(
        (e) => e.model === null || e.model === undefined
    ).length;

    const shippedCount = shipped.size;
    const ratio = (n: number) => (shippedCount === 0 ? null : n / shippedCount);

    if (shippedCount === 0 && receipts.length > 0) {
        notes.push(
            "No issue shipped in this window, so every per-issue figure is null rather than an infinity or a zero."
        );
    }
    if (agentTokens > 0 && tokensByRole.unclassified / agentTokens > 0.2) {
        notes.push(
            `${Math.round((tokensByRole.unclassified / agentTokens) * 100)}% of agent tokens could not be attributed to a role — treat the role split as indicative only.`
        );
    }

    return {
        window,
        hasData: true,
        notes,
        passes: batches.size,
        issuesShipped: shippedCount,
        wallClockPerIssueSec: ratio(wallClockSec),
        tokensByRole,
        tokensPerIssueByRole:
            shippedCount === 0
                ? null
                : {
                      implement: tokensByRole.implement / shippedCount,
                      review: tokensByRole.review / shippedCount,
                      fixup: tokensByRole.fixup / shippedCount,
                      support: tokensByRole.support / shippedCount,
                      orchestrator: tokensByRole.orchestrator / shippedCount,
                      unclassified: tokensByRole.unclassified / shippedCount,
                  },
        unclassifiedTokenShare:
            agentTokens === 0 ? null : tokensByRole.unclassified / agentTokens,
        reviewBlockingRate:
            reviews.length === 0 ? null : blocked / reviews.length,
        reviewsRecorded: reviews.length,
        fixupRounds,
        gateRunsPerShippedIssue: ratio(gateRuns),
        gateRuns,
        collisionAborts: receipts.filter((r) => r.outcome === "collision")
            .length,
        missingReceipts: receipts.filter((r) => r.role === "missing").length,
        inheritedModelSpawns: inherited,
        agentSpawns: spawns.length,
        inheritedModelShare:
            spawns.length === 0 ? null : inherited / spawns.length,
    };
}

function emptyScorecard(window: Window, notes: string[]): Scorecard {
    return {
        window,
        hasData: false,
        notes,
        passes: 0,
        issuesShipped: 0,
        wallClockPerIssueSec: null,
        tokensByRole: {
            implement: 0,
            review: 0,
            fixup: 0,
            support: 0,
            orchestrator: 0,
            unclassified: 0,
        },
        tokensPerIssueByRole: null,
        unclassifiedTokenShare: null,
        reviewBlockingRate: null,
        reviewsRecorded: 0,
        fixupRounds: {},
        gateRunsPerShippedIssue: null,
        gateRuns: 0,
        collisionAborts: 0,
        missingReceipts: 0,
        inheritedModelSpawns: 0,
        agentSpawns: 0,
        inheritedModelShare: null,
    };
}
