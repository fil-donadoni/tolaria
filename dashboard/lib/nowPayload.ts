/**
 * The Now view's payload, typed (PRD #3148 S2).
 *
 * Everything the three read-only routes the Now view is allowed to touch
 * return: `/api/loop-status` (`GatheredLoopStatus`, scripts/loop-status.ts),
 * `/api/activity` and `/api/live` (`activityView` / `liveView`,
 * scripts/telemetry-serve.ts), plus `/api/tail` for the drawer.
 *
 * MIRRORED, not imported, and for the reason this repo has already written
 * down twice (`WINDOW_HOURS` in `now-timeline.js`, `MIN_AGE_HOURS` in
 * `now-claims-table.js`): the source of those shapes is a `.ts` file that
 * imports `node:fs` and is type-checked by `tsconfig.scripts.json` with the
 * Node types. `tsconfig.dashboard.json` is a BROWSER program — no `@types/node`
 * — so an `import type` of it would drag a Node-typed module into a program
 * that cannot check it. What keeps the two honest is not a type edge but the
 * golden-payload test (`NowView.test.tsx`), which renders these components
 * against a fixture in the shape the route actually returns: a field that
 * changes name upstream shows up as a rendered figure that changed, not as a
 * type that silently widened.
 *
 * THE `*Error` SIBLINGS ARE THE POINT. `claims`, `queueDepth`, `recentMerges`,
 * `activity` and `live` are each `null`-with-a-reason on a failed read, never
 * a fabricated empty value: at 0/5000 GraphQL quota this page once rendered
 * "no claimed issues", i.e. an idle drained loop, at the exact moment GitHub
 * was unreachable (#2519 round 3, finding 5). Every renderer below branches on
 * the error FIRST.
 */

export type ClaimStage =
    | "claimed"
    | "worktree"
    | "branch pushed"
    | "PR open"
    | "merging";

export type ClaimVerdictState = "live" | "suspect" | "orphan";

export interface ClaimVerdict {
    state: ClaimVerdictState;
    reason: string;
}

export type BoardPriority = "P0" | "P1" | "P2";

export interface ClaimRow {
    issue: number;
    title: string;
    stage: ClaimStage;
    verdict: ClaimVerdict;
    priority: BoardPriority | null;
    ageHours: number;
    /** Open issues naming this one as a blocker; `null` when that read
     *  failed — distinct from a genuine `0` ("checked, blocks nothing"). */
    dependents: number | null;
}

export interface QueueDepth {
    P0: number;
    P1: number;
    P2: number;
    unprioritized: number;
    total: number;
}

export interface DriverPassLine {
    epoch: number;
    pass: number;
    claudeExit: number;
    /** A string — `n/a` is a valid value, not a parse failure. */
    pct: string;
    queueBefore: number;
    queueAfter: number;
    reason: string;
}

export interface DriverState {
    armed: boolean;
    pid: number | null;
    pidAlive: boolean;
    stopFilePresent: boolean;
    /** Newest-last, mirroring the log file's own append order. */
    recentPasses: DriverPassLine[];
}

export interface MergedPr {
    number: number;
    title: string;
    mergedAt: string;
}

export interface ReceiptCount {
    role: string;
    outcome: string;
    count: number;
}

export interface InterestingReceipt {
    role: string;
    outcome: string;
    issue?: number;
    pr?: number | null;
    session?: string;
}

export interface ReceiptsSummary {
    total: number;
    counts: ReceiptCount[];
    interesting: InterestingReceipt[];
}

export type LoopVerdictState =
    | "NEEDS ATTENTION"
    | "STALLED"
    | "STOPPED"
    | "RUNNING"
    | "IDLE";

export interface LoopFinding {
    code: string;
    detail: string;
}

/** The two reversible DRIVER operations a verdict can name. `claim.release`
 *  is deliberately not one: it acts on a row, not on the driver. */
export type RemedyAction = "driver.stop" | "driver.resume";

export interface LoopVerdict {
    state: LoopVerdictState;
    sentence: string;
    remedy: string;
    remedyAction: RemedyAction | null;
    findings: LoopFinding[];
}

export type Liveness = "active" | "live" | "idle";

export interface SessionView {
    session: string;
    title: string | null;
    lastPrompt: string | null;
    cwd: string | null;
    gitBranch: string | null;
    lastWriteMs: number;
    lastMessageMs: number | null;
    outTok: number;
    inTok: number;
    cacheRead: number;
    cost: number;
    messages: number;
    subagents: number;
    topIssues: { issue: number; mentions: number }[];
    liveness: Liveness;
}

export interface HourBucket {
    hourStart: number;
    inTok: number;
    outTok: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    messages: number;
}

export interface ActivityPayload {
    windowHours: number;
    asOf: number;
    buckets: HourBucket[];
}

export interface LivePayload {
    asOf: number;
    liveMinutes: number;
    activeMinutes: number;
    sessions: SessionView[];
    byIssue: Record<number, SessionView[]>;
}

/**
 * The whole Now payload — `/api/loop-status`'s body with the two live reads
 * folded in beside it, exactly as the transport assembles it.
 */
export interface NowPayload {
    verdict: LoopVerdict | null;
    driver: DriverState;
    claims: ClaimRow[] | null;
    claimsError: string | null;
    queueDepth: QueueDepth | null;
    queueDepthError: string | null;
    receiptsSummary: ReceiptsSummary;
    batch: string | null;
    batchStartedAt: number | null;
    priorityWarning: string | null;
    receiptErrors: unknown[];
    timelinePasses: DriverPassLine[];
    recentMerges: MergedPr[] | null;
    recentMergesError: string | null;
    recentMergesTruncated: boolean;
    dependentsError: string | null;
    /** `/api/activity`, folded in by the transport. */
    activity?: ActivityPayload;
    activityError?: string;
    /** `/api/live`, folded in by the transport. */
    live?: LivePayload;
    liveError?: string;
}

export type TailKind =
    | "user"
    | "assistant"
    | "thinking"
    | "tool_use"
    | "tool_result"
    | "system";

export interface TailEntry {
    kind: TailKind;
    ts: number | null;
    text: string;
    tool?: string;
    isError?: boolean;
}

export interface TailPage {
    session: string;
    offset: number;
    lastWriteMs: number;
    entries: TailEntry[];
    truncated: boolean;
    summary: SessionView | null;
}
