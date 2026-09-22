// Queue planner — the `/process-gh-issues` scheduling decision, as code
// (issue #2181, PRD #2180).
//
// The loop used to derive its batch by having a language model read ~150 lines
// of prose and hand-roll a `jq` query on every pass: priority order, lineage
// sort, file-overlap disjointness, dependency resolution, model routing, skip
// classification. That layer's failures are silent and PLAUSIBLE — a wrong
// batch is indistinguishable from a right one — and it has already cost a real
// incident: `index("bug")` returns a POSITION, position 0 is falsy in jq, so
// "bug is the first label" classified identically to "no bug label", inverting
// the key across half the queue and skipping five older bugs with nothing red
// anywhere.
//
// This module is that decision, made once, with tests. Three properties are
// load-bearing:
//
//   * PURE — no clock, no network, no filesystem, no git. "Now" arrives through
//     config and every round-trip goes through the injected `QueuePort`, so the
//     planner is deterministic and its I/O cost is assertable.
//   * TWO-STAGE — the light list (`number,title,labels,parent,assignees`) is
//     enough to order and filter the whole queue; bodies are pulled one
//     candidate at a time and only while the batch still has room. Selection
//     cost scales with the batch, not the queue.
//   * TOTAL — every issue in the snapshot lands in exactly one of `batch`,
//     `deferred`, `skipped` or `staleClaims`. An issue the planner silently
//     drops is an issue nobody knows is stuck.
//
// The orchestrator EXECUTES this plan; it does not re-derive it.

import { lintIssue, targetFilesSection, type Finding } from "./queue-lint";
import { classifyPath, laneFor, type Lane } from "../check-lane";
import {
    parentIsAbandoned,
    type IssueState,
    type StateReason,
} from "./orphans";
// Type-only: the liveness verdict is the CLASSIFIER's, never re-spelled here
// (issue #4384). The gathering of it is I/O and stays in `loop-doctor.ts`.
import type { ClaimVerdictState } from "../loop-doctor";

// ─────────────────────────────────────────────────────────────────────────────
// Input — the shape `gh issue list --json number,title,labels,parent,assignees,updatedAt`
// actually returns. Index signatures are deliberate: the CLI carries more
// fields than the planner reads (label ids and colours, the parent's title and
// url), and narrowing them out here would make the captured golden fixtures
// fail to type-check for no benefit.
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueLabel {
    name: string;
    [key: string]: unknown;
}

export interface QueueParent {
    number: number;
    /**
     * The parent's lifecycle, which `gh issue list --json parent` already
     * returns alongside its number and title — so both the band degradation
     * and the orphan refusal below cost zero extra round-trips (issue #4105).
     *
     * REQUIRED, not optional: `effectivePriority` must treat a CLOSED parent
     * as no parent at all, and a field that may be missing degrades that rule
     * to "unless the caller forgot", silently. Making it required puts the
     * enforcement in `tsc` — a new call site that builds a parent without its
     * state goes red instead of inheriting a dead umbrella's band.
     */
    state: IssueState;
    [key: string]: unknown;
}

export interface QueueAssignee {
    login: string;
    [key: string]: unknown;
}

export interface QueueIssue {
    number: number;
    title: string;
    labels: QueueLabel[];
    /** The native GitHub sub-issue edge. `null` for a standalone issue. */
    parent: QueueParent | null;
    assignees: QueueAssignee[];
    updatedAt: string;
}

/** Stage-2 detail for one issue. */
export interface IssueDetail {
    state: IssueState;
    /** Why it closed, when it is closed — `NOT_PLANNED` is what makes an open
     *  child of this issue an ORPHAN (issue #4105). `null` for an open issue,
     *  and for a closed one GitHub attributed to nothing. */
    stateReason: StateReason;
    labels: string[];
    body: string;
}

/**
 * The planner's only door to the outside world.
 *
 * `issueDetail` is a network round-trip in production, so the number of calls
 * the planner makes is part of its contract, not an implementation detail —
 * a planner that pulled the whole queue's bodies would erase two-stage
 * selection while still producing a correct plan.
 */
export interface QueuePort {
    issueDetail(number: number): IssueDetail;
    /** Issues that currently have an open PR — the liveness signal that keeps a
     *  long-running claim from being swept as orphaned. */
    issuesWithOpenPr: number[];
    /**
     * The `Priority` field on the GitHub Project board, per issue number.
     *
     * A DATA field, not a method, on purpose: the board is ONE read for the
     * whole queue, so making it a per-issue lookup would invent a round-trip
     * the two-stage design exists to avoid.
     *
     * Absent from the map = the issue is not on the board, or is on it with no
     * Priority set. Both mean the same thing here — no explicit priority — and
     * the planner must not distinguish them: a board where only the urgent few
     * carry a value is the intended steady state, not a partially-filled one.
     */
    priority: Record<number, BoardPriority>;
}

/** The board's `Priority` single-select, strongest first.
 *
 *  `P3` is "deliberately later" — a maintainer looked at this and ruled it
 *  below `P2`. It is NOT the same statement as no value at all, which is
 *  "nobody has looked yet", and the two must never share a rank (issue
 *  #4051): the sort below is the only thing that separates a ruled-on
 *  backlog from the unexamined residue. */
export type BoardPriority = "P0" | "P1" | "P2" | "P3";

const PRIORITY_RANK: Record<BoardPriority, number> = {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3,
};

/** Where an issue sits on the board's priority axis. Unprioritized sorts LAST
 *  — below every explicit value, including `P3`.
 *
 *  ONE PAST THE LAST NAMED RANK, and it moves whenever a band is added. Left
 *  at `3` when `P3: 3` joined the table, `priorityRank` would return the same
 *  number for "deliberately last" and "never ruled on", the comparator would
 *  stop distinguishing them, and nothing would go red (issue #4051). */
export const UNPRIORITIZED = 4;

/** Rank of a priority that may be absent — the one place `undefined`/`null`
 *  becomes `UNPRIORITIZED`, so no caller can spell that fallback differently. */
export function priorityRank(p: BoardPriority | null | undefined): number {
    return p == null ? UNPRIORITIZED : PRIORITY_RANK[p];
}

/** The minimum a band computation needs: the issue's own number and its
 *  native sub-issue parent, both already on every `QueueIssue` and on the
 *  ready-queue rows `loop-status` gathers. */
export interface BandedIssue {
    number: number;
    parent?: { number: number; state: IssueState } | null;
}

/**
 * Whether the parent edge is one that GOVERNS the child's band.
 *
 * A CLOSED parent governs nothing (issue #4105). `gh issue list --json parent`
 * returns the parent whether it is open or closed, and the board map can still
 * carry a closed umbrella's `Priority` — so before this, an orphan under a
 * dead P0 epic kept competing in the P0 band, and because the parent GOVERNS
 * (issue #4371) the child's own value could no longer outrank it. The band a
 * maintainer maintains is the one on an OPEN umbrella; a closed one is a
 * ruling nobody is re-reading.
 *
 * The degradation is to the child's own value, not to unprioritized: the
 * child's `Priority` is a real statement, it was merely outranked by a
 * statement that has since stopped being made.
 */
function parentGoverns(
    parent: { number: number; state: IssueState } | null | undefined
): parent is { number: number; state: IssueState } {
    return parent != null && parent.state !== "CLOSED";
}

/**
 * The priority BAND an issue competes in: its parent PRD's board `Priority`
 * when the parent carries one, else its own (issue #3212, issue #4371).
 *
 * A P0 PRD is P0 because it must CLOSE soon, and an umbrella closes only when
 * its last child does — so its children carry that urgency whatever their own
 * value says. Without this, a P0 epic drains in dribs while every standalone
 * P1 interleaves, and the board's strongest statement buys nothing.
 *
 * The parent GOVERNS, and that includes demoting (issue #4371 — it reverses
 * the "never demotes" clause this function shipped with). The umbrella is the
 * ruling a maintainer actually maintains: it is one row, re-read whenever the
 * plan changes. A child's own `Priority` is set per-slice, often at filing
 * time and often wrong — issue #4371 was filed on a queue where children
 * mis-marked `P0` under a correctly-`P1` PRD were outranking unprioritized
 * children of a `P0` umbrella. Taking the stronger of the two makes every such
 * slip a board-wide override that nobody rules on again. The child's own value
 * is not discarded: it is the comparator key right below the band, ordering
 * the slices INSIDE their umbrella's turn.
 *
 * A parent with no board value makes no statement, so the band degrades to the
 * child's own — an unprioritized umbrella must not bury its children. A CLOSED
 * parent makes no statement either (issue #4105, `parentGoverns`): it is a
 * ruling nobody re-reads, and an orphan under a dead P0 epic must not hold the
 * P0 band against the live queue.
 *
 * ONE level. `gh issue list --json parent` carries the parent's number and
 * title and nothing else — no grandparent, no priority of its own — and the
 * band is a lookup into the board map already in hand, so it costs no extra
 * API call.
 */
export function effectivePriority(
    issue: BandedIssue,
    priority: Record<number, BoardPriority>
): BoardPriority | null {
    const own = priority[issue.number] ?? null;
    const parent = parentGoverns(issue.parent)
        ? (priority[issue.parent.number] ?? null)
        : null;
    return parent ?? own;
}

/** True when the BAND came from the parent PRD rather than the issue itself —
 *  the comparator key right under the band (issue #4371).
 *
 *  Inside one band, a standalone issue leads the children of a PRD that landed
 *  in the same band: `P0` set on an issue with no umbrella is the maintainer
 *  pointing at that issue and nothing else, while a `P0` slice is one of many
 *  ways into the same epic. Without this key the two tie on own priority and
 *  the order falls to the lineage tie-break, which is a creation date.
 *
 *  A parent that carries no board value governs nothing, so its children are
 *  `false` here and compete as standalones — the same degradation
 *  `effectivePriority` makes. */
export function bandIsInherited(
    issue: BandedIssue,
    priority: Record<number, BoardPriority>
): boolean {
    return parentGoverns(issue.parent) && priority[issue.parent.number] != null;
}

export interface PlanConfig {
    batchCap: number;
    staleClaimHours: number;
    defaultImplModel: string;
    /** Injected, never read from the clock — the planner must be reproducible. */
    now: string;
    /** Shared files where every issue merely ADDS an entry. Excluded from the
     *  overlap check: the merge-train absorbs their trivial rebase conflicts by
     *  design, and treating them as edges would serialize every batch that
     *  ships a card. */
    appendOnlyPaths?: string[];
    /**
     * File sets the ORCHESTRATOR inferred for issues that declare none.
     *
     * The planner will not guess a file set from prose — inference is a
     * judgment call and a wrong guess parallelizes two issues that collide. But
     * refusing outright is not free either: most of the existing queue predates
     * the `Target files:` convention, so a planner with no fallback degenerates
     * to a solo batch on almost every pass and the fan-out stops paying for
     * itself.
     *
     * So the judgment stays with the model and the arithmetic stays here. The
     * loop runs the planner once, reads which candidates came back with an
     * unknown blast radius, infers file sets for the ones it can (grep the
     * issue's key symbols for shared consumers — prose names the module an
     * issue is ABOUT, not every file it will touch), and re-runs with those
     * overrides. Given the same overrides the plan is still reproducible.
     *
     * An inferred set is admitted like a declared one but tagged `inferred`, so
     * the merge-train knows to re-check disjointness against the receipts'
     * actual touched paths.
     */
    inferredTargetFiles?: Record<number, string[]>;
    /**
     * Leave HITL candidates out of the batch entirely (#3088).
     *
     * `HITL` in a body means "an agent may implement this, but a human must
     * look before it merges". That is a precondition on the CALLER, not a
     * property of the issue, which is why this is a config flag and not a
     * blanket rule: an interactive session IS the human the flag asks for, so
     * it still admits them and the default stays `false`. An unattended run
     * cannot supply one — and since ADR 0110 retired the merge-train, the pass
     * it is handed to ends in `land`, which merges. So for the AFK driver the
     * flag is not "handle carefully", it is "never consider": the work is not
     * eligible for a process with no person in it.
     *
     * Excluded issues are DEFERRED, not skipped. Nothing is wrong with them and
     * no human action is owed — a `SkipAction` would be a lie, and would put
     * perfectly good issues in front of whoever triages malformed ones.
     */
    excludeHitl?: boolean;
    /**
     * Restrict the candidate set to the open sub-issues of ONE umbrella
     * (issue #2327).
     *
     * A maintainer request like "finish PRD #N" was not expressible, so the
     * batch got assembled BY HAND — which discards, in one move, the resolved
     * model tier, the dependency scan, the disjointness walk and the lineage
     * sort, and leaves a set of model-derived decisions no later run can
     * reconstruct. Expressing the scope as a config field keeps every one of
     * those rules: the restriction is applied to the ELIGIBLE set, and
     * everything downstream — sort, dependency resolution, disjointness,
     * lane homogeneity, model resolution — runs unchanged over it.
     *
     * The edge read is the NATIVE sub-issue one (`QueueIssue.parent`), never a
     * prose `Split out of #N` line: the list call already carries it, so the
     * restriction costs no round-trip and cannot disagree with the sort key
     * `effectivePriority` uses.
     *
     * Applied AFTER Stage 1, deliberately: `activeClaims` and `staleClaims`
     * are whole-queue facts the session cap is computed from, and filtering
     * before they are collected would let a lineage-scoped plan admit past the
     * cap because it could not see the claims in other lineages.
     *
     * Out-of-lineage candidates are absent from the plan, not `deferred`: a
     * deferral means "considered this pass, not admitted", and a restricted
     * plan did not consider them at all. What was restricted is recorded on
     * the durable artefact (`PlanRecord.lineage`), which is where
     * reproducibility lives.
     */
    lineage?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────

/** What the orchestrator must DO about a skipped issue. A skip with no action
 *  is a skip that repeats itself on every pass forever. */
export type SkipAction =
    /** Relabel `ready-for-agent` → `ready-for-human`: no agent can land it. */
    | "relabel-human"
    /** Strip the stray `ready-for-agent` from an umbrella. */
    | "strip-ready"
    /** The issue is malformed; send it back for information. */
    | "needs-info"
    /** Its native parent was closed as `not planned`: the work was abandoned.
     *  Close it (`bun run issues:orphans --close`) or re-parent it to a live
     *  umbrella — issue #4105. */
    | "close-orphan";

/** How much of the tree an issue may touch — the input to disjointness. */
export type BlastRadius =
    /** A `Target files:` section the planner could read. */
    | "declared"
    /** Supplied by the orchestrator via `inferredTargetFiles` — batched like a
     *  declared set, but the train re-checks it against the receipts. */
    | "inferred"
    /** No section at all: the planner will not guess, so the issue runs solo. */
    | "unknown"
    /** A declared `- *`: the issue itself says it touches everything. */
    | "everything";

export interface PlannedIssue {
    number: number;
    title: string;
    /** Branch/commit prefix — `bug` label ⇒ `fix`, everything else ⇒ `feat`. */
    type: "fix" | "feat";
    /** Always present, so the orchestrator cannot omit the `model` parameter and
     *  silently inherit the session's tier. */
    model: string;
    /** Several `model:*` labels — the most capable won; the loop should say so. */
    modelAmbiguity?: string[];
    hitl: boolean;
    /** The board's `Priority`, when the maintainer set one. Echoed so the plan
     *  says WHY an issue jumped the queue — an unexplained reordering reads as
     *  a planner bug and gets "fixed". */
    priority?: BoardPriority;
    /** The band the issue actually competed in, echoed ONLY when it DIFFERS
     *  from `priority` — i.e. when the parent PRD moved it, in either
     *  direction (issue #3212, issue #4371). Present means "this did not
     *  compete on its own priority, and here is the value it competed on";
     *  absent means the two agree and there is nothing to explain. The
     *  demotion case is the one that now most needs saying: a `P0` slice
     *  planned under a `P1` band looks like a planner bug until the band is on
     *  the row beside it. */
    priorityBand?: BoardPriority;
    targetFiles: string[];
    blastRadius: BlastRadius;
    /**
     * The lane THIS issue's own `targetFiles` classify to, computed with the
     * EXACT predicate `check:lane` runs against a real diff
     * (`classifyPath`/`laneFor`, `scripts/check-lane.ts`) — never a second,
     * hand-maintained mapping from an `area:*` label. The label is a
     * hypothesis a human wrote before the code existed; this is the
     * authority, and the two are allowed to disagree (issue #2743, closing
     * PRD #2738 § "the issue's area:* label is the hypothesis … the
     * authority stays what check:lane derives from the real diff").
     *
     * Determines which OTHER issues may share this batch — see the
     * homogeneity check in `planBatch` — never who reads the batch.
     */
    lane: Lane;
    reason: string;
}

export interface DeferredIssue {
    number: number;
    reason: string;
    /** The issue this one overlaps or is blocked by, when there is one. */
    conflictsWith: number | null;
}

export interface SkippedIssue {
    number: number;
    reason: string;
    action: SkipAction;
}

export interface BatchPlan {
    version: 1;
    /**
     * The lane every admitted issue shares — set once, from the first
     * admission (`batch[0].lane`), and `undefined` for an empty batch. A
     * batch is all-`skin`, all-`engine` or all-`full`, never mixed (issue
     * #2743): the orchestrator's payoff for homogeneity — one batch-level
     * `check:ui` for a `skin` batch, none at all for an `engine` one — holds
     * only when EVERY admitted issue's real target files land in the same
     * lane. A `full` batch pays neither of those rules; an issue inside one
     * that itself reaches `src/**` still owes its own per-PR check under
     * `.claude/rules/chrome-debug.md`, unchanged by this field.
     */
    lane?: Lane;
    batch: PlannedIssue[];
    deferred: DeferredIssue[];
    skipped: SkippedIssue[];
    staleClaims: number[];
    /**
     * Issues held by a claim the planner judged LIVE — `in-progress`, not
     * stale, and not a PRD umbrella (which is skipped before the claim branch
     * is ever reached).
     *
     * The complement of `staleClaims` within the claimed set, and the input to
     * the session cap (`liveClaims`). It is reported rather than re-derived
     * because the wrapper's first cut recomputed it from the raw labels, which
     * is the same decision spelled a second way — and spelled slightly wrong:
     * it had no way to know the planner had already classified a claimed
     * umbrella as `skipped`.
     */
    activeClaims: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan artefact — the durable record `queue:plan` writes to
// `.claude/telemetry/plans/` (issue #2518).
//
// Nothing checked that the batch a pass CLAIMED was the batch the planner
// PRODUCED, and nothing recorded which plan a claim came from — a
// hand-picked batch was indistinguishable from a planned one, after the
// fact. This record is what `claim-ledger.sh` joins a claim row against: it
// names the session, so the join key is exactly the session id the hook
// already reads off its own payload, and it carries the admitted batch (with
// the priority read for each issue, already on `PlannedIssue.priority`) so a
// later reader can tell whether a claimed issue was actually in it.
//
// `buildPlanRecord` is pure — same discipline as `planBatch` itself. The
// actual filesystem write, the session id and the wall clock are the
// wrapper's job (`scripts/queue-plan.ts`).
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanRecord {
    version: 1;
    /** The orchestrator's Claude Code session id. Empty string when the
     *  environment carries none — never guessed or invented, so an absent
     *  session reads as exactly that on a later audit, not as a fabricated
     *  join key that happens to never match. */
    session: string;
    /** Injected, never read from the clock — same discipline as
     *  `PlanConfig.now`, and in fact the SAME value: the record describes
     *  the plan built at that instant. */
    ts: string;
    /** True when this plan was built with `--no-priority`: the batch order
     *  is the queue's default order, not the board's, and a later reader
     *  must not mistake it for a prioritised plan. */
    noPriority: boolean;
    /** The umbrella `--lineage <N>` scoped this plan to, or `null` for an
     *  unrestricted pass (issue #2327). On the RECORD and not on `BatchPlan`
     *  deliberately: stdout's schema is what `/next-issue` and `loop-drain`
     *  parse and it stays byte-identical, while the durable artefact is where
     *  "which candidate set produced this batch" has to be legible — without
     *  it a scoped plan is indistinguishable, after the fact, from a whole-queue
     *  one that happened to return the same issues. */
    lineage: number | null;
    plan: BatchPlan;
}

/**
 * Build the durable plan artefact for one `queue:plan` run.
 *
 * Pure: given the plan already produced, the session id and clock reading the
 * wrapper resolved, and whether `--no-priority` was passed, this only shapes
 * the record — it performs no I/O and makes no decision `planBatch` did not
 * already make.
 */
export function buildPlanRecord(
    plan: BatchPlan,
    session: string,
    now: string,
    noPriority: boolean,
    lineage: number | null = null
): PlanRecord {
    return { version: 1, session, ts: now, noPriority, lineage, plan };
}

/**
 * Filename for the plan artefact: `<session>-<epoch-ms>.json`.
 *
 * Sortable and joinable by session in one shot — `claim-ledger.sh` globs
 * `<session>-*.json` and a lexicographic sort of same-width epoch
 * milliseconds is a chronological sort too, so "the latest plan for this
 * session" is `sort | tail -1` with no JSON parsing required to find it.
 *
 * `session` empty (no session in the environment) falls back to `"unknown"`
 * rather than producing a bare `-<ts>.json`, which would glob-match every
 * session's lookup equally and defeat the join.
 */
export function planFilename(session: string, nowIso: string): string {
    const safeSession = session.trim() === "" ? "unknown" : session.trim();
    return `${safeSession}-${Date.parse(nowIso)}.json`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

/** Registration points every ticket appends to. Kept short and explicit: an
 *  over-broad list would hide a genuine semantic collision. */
export const DEFAULT_APPEND_ONLY_PATHS = [
    "convex/cards/index.ts",
    "convex/gre/serialize.ts",
    "data/card-index.json",
];

/** Implement tiers, weakest to strongest. An issue carrying several `model:*`
 *  labels resolves to the most capable — under-powering a ticket is the more
 *  expensive mistake, since a wrong abstraction survives review. */
const MODEL_RANK = ["haiku", "sonnet", "opus", "fable"];

const DEPENDENCY_KEYWORDS =
    /(blocked by|depends on|depend on|requires|after)\s*:?\s*#(\d+)/gi;

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

const labelNames = (issue: QueueIssue): string[] =>
    issue.labels.map((l) => l.name);

/** Membership, never a position lookup — see the header comment. */
const hasLabel = (issue: QueueIssue, name: string): boolean =>
    labelNames(issue).includes(name);

/** A child inherits its parent's queue position, not its own creation date, so
 *  an old umbrella's slices drain before a newer standalone issue. The key is
 *  the parent's NUMBER: issue numbers are monotonic in creation time, and the
 *  list payload's `parent` object carries no date at all. */
const lineage = (issue: QueueIssue): number =>
    issue.parent?.number ?? issue.number;

/** The band, but only when the parent MOVED it off the issue's own value —
 *  lifting it or, since issue #4371, demoting it. Either way it is the one
 *  case the plan owes the reader an explanation for; equal values explain
 *  themselves. */
const inheritedBand = (
    issue: QueueIssue,
    priority: Record<number, BoardPriority>
): BoardPriority | null => {
    const band = effectivePriority(issue, priority);
    if (band === null) return null;
    return band === (priority[issue.number] ?? null) ? null : band;
};

function hoursBetween(fromIso: string, toIso: string): number {
    return (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
}

/**
 * A claim nobody is working: no open PR for the issue and no activity on it
 * for longer than `staleClaimHours`. ONE definition, read by the planner
 * (which defers such an issue and excludes it from `activeClaims`) and by
 * `queue:claim` (which excludes it from the set the cap counts, issue #4375)
 * — two spellings of "stale" would let the planner admit a pick the claim
 * then refuses.
 */
export function isStaleClaim(
    issue: { number: number; updatedAt: string },
    issuesWithOpenPr: number[],
    nowIso: string,
    staleClaimHours: number
): boolean {
    return (
        !issuesWithOpenPr.includes(issue.number) &&
        hoursBetween(issue.updatedAt, nowIso) > staleClaimHours
    );
}

/**
 * The repo root, as a normalized path. A `Target files` list of `- *` — the
 * "this touches everything" the intake skills document — normalizes to this and
 * collides with every path there is.
 */
export const EVERYTHING = "";

/** Strip decoration so a glob and a path underneath it compare equal. */
export function normalizePath(raw: string): string {
    const path = raw
        .trim()
        .replace(/^[-*]\s+/, "")
        .replace(/`/g, "")
        .trim()
        .replace(/\/\*\*$/, "")
        .replace(/\/\*$/, "")
        .replace(/\/+$/, "");
    // A bare `*` survived every strip above and then collided with NOTHING,
    // so an issue declaring the whole repo batched happily beside all of them.
    return path === "*" || path === "**" ? EVERYTHING : path;
}

/** Two paths collide when either contains the other. */
export function pathsOverlap(a: string, b: string): boolean {
    if (a === EVERYTHING || b === EVERYTHING) return true;
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Is `path` the append-only registration point `point`, or something inside it?
 *
 * **Directional on purpose, unlike `pathsOverlap`.** The append-only exclusion
 * asks "may I ignore this path when checking disjointness", and a DIRECTORY that
 * merely happens to contain a registration point is not itself append-only.
 * Using symmetric containment here means a broad declaration silently excludes
 * itself from every conflict check: `convex/gre/**` contains
 * `convex/gre/serialize.ts`, so the whole engine directory was dropped from
 * `comparable` and the issue looked conflict-free with everything. Observed on
 * the live queue — two issues that both edit `convex/gre/state.ts` were batched
 * together, which is the one wrong answer the fan-out cannot survive.
 */
export function isAppendOnlyPath(path: string, point: string): boolean {
    return path === point || path.startsWith(`${point}/`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Body parsing
// ─────────────────────────────────────────────────────────────────────────────

const HEADING = /^#{1,6}\s+/;

/**
 * Read the `Target files` section, in either form the queue contains — the
 * `## Target files` heading and the Agent Brief template's `**Target files:**`
 * label (issue #3535). `targetFilesSection` is the single authority on which
 * forms are accepted; this reader only turns the section's lines into paths.
 *
 * Returns `null` when the section is absent — which is NOT the same as an empty
 * list. The planner does not infer a file set from prose: inference is a
 * judgment call, and a wrong guess parallelizes two issues that collide. An
 * absent section means "unknown", and unknown runs solo.
 *
 * **A label with no list items under it is absent too.** The section is there,
 * but it declares nothing, and an empty DECLARED set is the one answer that is
 * actively wrong: it reads as "this issue touches no file", which overlaps
 * nothing and batches happily beside everything.
 */
export function parseTargetFiles(body: string): string[] | null {
    const section = targetFilesSection(body);
    if (section === null) return null;

    const items: string[] = [];
    for (const line of section) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        if (/^[-*]\s+/.test(trimmed)) {
            items.push(normalizePath(trimmed));
            continue;
        }
        // Prose. Before the list it is the section's preamble; after the list it
        // is the template's explanatory paragraph, and the list is over.
        if (items.length > 0) break;
    }
    return items.length > 0 ? items : null;
}

/**
 * Read every issue this one declares a dependency on.
 *
 * Two shapes, because tickets use both: the prose keyword form ("depends on
 * #999") and the template's `## Blocked by` section, whose refs sit on their
 * own list lines with no keyword anywhere near them. Reading only the keyword
 * form would miss every ticket this project's own intake skill emits.
 *
 * A `## Parent` reference is deliberately NOT a dependency — an umbrella is
 * context for its slice, not a blocker.
 */
export function parseDependencies(body: string, self: number): number[] {
    const found = new Set<number>();

    for (const match of body.matchAll(DEPENDENCY_KEYWORDS)) {
        found.add(Number(match[2]));
    }

    const lines = body.split("\n");
    const start = lines.findIndex((l) => /^#{1,6}\s+blocked by/i.test(l));
    if (start !== -1) {
        for (const line of lines.slice(start + 1)) {
            if (HEADING.test(line)) break;
            const trimmed = line.trim();
            if (trimmed === "") continue;
            if (!/^[-*]\s+/.test(trimmed)) break;
            for (const m of trimmed.matchAll(/#(\d+)/g))
                found.add(Number(m[1]));
        }
    }

    found.delete(self);
    return [...found].sort((a, b) => a - b);
}

const isHitl = (body: string): boolean => /⚠️\s*HITL|\bHITL\b/.test(body);

// ─────────────────────────────────────────────────────────────────────────────
// Well-formedness
//
// The rules themselves live in `queue-lint.ts` — one authority, called both at
// intake (before an issue is published) and here (before it is admitted). The
// planner used to carry a second copy of the unmergeable-work checks; two
// copies of a rule is how they drift, and the drift is invisible because each
// copy looks correct in its own file.
//
// This maps a blocking finding to the action the orchestrator must take. The
// mapping is here rather than in the lint because "what to do about it" is the
// LOOP's concern — the lint's job is to say what is wrong, and intake acts on
// the same findings differently (it sends them back to the author).
// ─────────────────────────────────────────────────────────────────────────────

function lintAction(blocking: Finding[]): SkipAction {
    if (blocking.some((f) => f.rule.startsWith("unmergeable"))) {
        return "relabel-human";
    }
    if (blocking.some((f) => f.rule === "prd-with-ready-for-agent")) {
        return "strip-ready";
    }
    return "needs-info";
}

// ─────────────────────────────────────────────────────────────────────────────
// Model routing
// ─────────────────────────────────────────────────────────────────────────────

function resolveModel(
    issue: QueueIssue,
    config: PlanConfig
): { model: string; ambiguity?: string[] } {
    const declared = labelNames(issue)
        .filter((n) => n.startsWith("model:"))
        .map((n) => n.slice("model:".length));

    if (declared.length === 0) return { model: config.defaultImplModel };
    if (declared.length === 1) return { model: declared[0] };

    const best = [...declared].sort(
        (a, b) => MODEL_RANK.indexOf(a) - MODEL_RANK.indexOf(b)
    )[declared.length - 1];
    return { model: best, ambiguity: declared };
}

// ─────────────────────────────────────────────────────────────────────────────
// The plan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Plan one fan-out batch.
 *
 * Stage 1 (no bodies): classify and order the whole snapshot. Stage 2 (one body
 * per candidate, top-down, only while the batch has room): unmergeability,
 * dependencies, disjointness.
 */
export function planBatch(
    issues: QueueIssue[],
    config: PlanConfig,
    port: QueuePort
): BatchPlan {
    const appendOnly = (
        config.appendOnlyPaths ?? DEFAULT_APPEND_ONLY_PATHS
    ).map(normalizePath);

    const batch: PlannedIssue[] = [];
    const deferred: DeferredIssue[] = [];
    const skipped: SkippedIssue[] = [];
    const staleClaims: number[] = [];
    const activeClaims: number[] = [];

    // ── Stage 1: eligibility ────────────────────────────────────────────────
    const eligible: QueueIssue[] = [];

    for (const issue of issues) {
        if (hasLabel(issue, "prd")) {
            // An umbrella is a spec, not a work item. Left alone it is skipped
            // on every pass forever AND permanently falsifies the loop's stop
            // condition — it is never `in-progress`, so "no unclaimed
            // ready-for-agent issues" never becomes true.
            skipped.push({
                number: issue.number,
                reason: "PRD — a spec umbrella, not a work item; the `ready-for-agent` label on it is a data defect",
                action: "strip-ready",
            });
            continue;
        }

        if (hasLabel(issue, "in-progress")) {
            const stale = isStaleClaim(
                issue,
                port.issuesWithOpenPr,
                config.now,
                config.staleClaimHours
            );
            if (stale) {
                staleClaims.push(issue.number);
                deferred.push({
                    number: issue.number,
                    reason: "stale claim — release it, then it is reselectable on a later pass",
                    conflictsWith: null,
                });
            } else {
                activeClaims.push(issue.number);
                deferred.push({
                    number: issue.number,
                    reason: "claimed by another session",
                    conflictsWith: null,
                });
            }
            continue;
        }

        if (issue.assignees.length > 0) {
            deferred.push({
                number: issue.number,
                reason: "assigned — someone is working it",
                conflictsWith: null,
            });
            continue;
        }

        eligible.push(issue);
    }

    // ── Stage 1: lineage restriction (issue #2327) ──────────────────────────
    // Scope the candidate set to one umbrella's own children, and change
    // NOTHING else: the sort below, the dependency scan, the disjointness rule
    // and the model resolution all run over this set exactly as they run over
    // the whole queue. See `PlanConfig.lineage` for why it lands here and not
    // before the claim classification above.
    const candidates =
        config.lineage == null
            ? eligible
            : eligible.filter(
                  (issue) => issue.parent?.number === config.lineage
              );

    // ── Stage 1: order ──────────────────────────────────────────────────────
    // Priority BAND first, then standalone-before-slice, then own priority,
    // then bugs, then oldest LINEAGE, then the issue's own number so the order
    // is total (a comparator with ties is not reproducible).
    //
    // Priority is the ZEROTH key, above `bug`, and that is the whole point: it
    // is the maintainer's live override, the one input whose criteria change
    // week to week. A P2 outranking an unprioritized `bug` is correct — the
    // human looked at the board and said so. Every key below it is a default
    // for the issues nobody has ruled on, which is the vast majority.
    //
    // The band is the parent PRD's (`effectivePriority`, issue #3212, issue
    // #4371): a P0 umbrella closes only when its last child does, so its
    // children clear before the P1 band opens — and a child's own value never
    // moves the band, because the umbrella is the ruling that gets maintained
    // and a per-slice `Priority` is the one that rots.
    //
    // The three keys, in the order the maintainer enumerated them (issue
    // #4371): no PRD + `P0` · PRD `P0` + `P0` · PRD `P0` + anything weaker ·
    // `P1` with no PRD · PRD `P1` + … `bandIsInherited` is what separates the
    // first two, and own priority is what orders the slices inside one
    // umbrella's turn. `bug` sits below all three — it is the default for what
    // nobody ruled on, and a ruling outranks a default.
    const band = (issue: QueueIssue): number =>
        priorityRank(effectivePriority(issue, port.priority));
    const inherited = (issue: QueueIssue): number =>
        bandIsInherited(issue, port.priority) ? 1 : 0;
    const own = (issue: QueueIssue): number =>
        priorityRank(port.priority[issue.number]);
    candidates.sort((a, b) => {
        const bandDelta = band(a) - band(b);
        if (bandDelta !== 0) return bandDelta;
        const inheritedDelta = inherited(a) - inherited(b);
        if (inheritedDelta !== 0) return inheritedDelta;
        const ownDelta = own(a) - own(b);
        if (ownDelta !== 0) return ownDelta;
        const bugA = hasLabel(a, "bug") ? 0 : 1;
        const bugB = hasLabel(b, "bug") ? 0 : 1;
        if (bugA !== bugB) return bugA - bugB;
        const lineageDelta = lineage(a) - lineage(b);
        if (lineageDelta !== 0) return lineageDelta;
        return a.number - b.number;
    });

    // ── Stage 2: admission ──────────────────────────────────────────────────
    /** Set once a solo issue is admitted: nothing else may join it. */
    let closed = false;

    for (const issue of candidates) {
        if (batch.length >= config.batchCap) {
            deferred.push({
                number: issue.number,
                reason: "batch is full",
                conflictsWith: null,
            });
            continue;
        }
        if (closed) {
            deferred.push({
                number: issue.number,
                reason: `batch closed — #${batch[0].number} runs solo`,
                conflictsWith: batch[0].number,
            });
            continue;
        }

        // Orphan refusal (issue #4105). An open child of a parent closed as
        // `not planned` is ABANDONED work — after the `/audit-tracker` fix a
        // tracker with live slices stays OPEN as a retired umbrella, so this
        // shape no longer overlaps with "survivor slice". Issue #3016 is the
        // case that paid for it: `ready-for-agent`, on the board, picked by a
        // session, and obsolete.
        //
        // SKIPPED, not deferred, and it names its exit: a deferral repeats
        // itself on every pass forever, which is precisely the state #3016 sat
        // in. The parent's `stateReason` is the one field the cheap Stage-1
        // list does not carry, so it costs ONE detail fetch — and only for a
        // candidate whose parent is already known CLOSED from that list.
        // The refusal is decided on lineage alone, so it never pays for the
        // orphan's own body — and the WRAPPER's `issueDetail` cache collapses
        // a whole abandoned epic's children into one parent read.
        if (issue.parent != null && issue.parent.state === "CLOSED") {
            const parentDetail = port.issueDetail(issue.parent.number);
            if (
                parentIsAbandoned({
                    state: parentDetail.state,
                    stateReason: parentDetail.stateReason,
                })
            ) {
                skipped.push({
                    number: issue.number,
                    reason: `orphan — its native parent #${issue.parent.number} is closed as \`not planned\`, so this work was abandoned, not moved (issue #4105). Close it (\`bun run issues:orphans --close\`) or re-parent it to a live umbrella`,
                    action: "close-orphan",
                });
                continue;
            }
        }

        const detail = port.issueDetail(issue.number);
        const declaredFiles = parseTargetFiles(detail.body);
        const inferredFiles = config.inferredTargetFiles?.[issue.number];

        // A declaration always wins over an override: the issue's own
        // `Target files:` section is the authoritative statement, and letting a
        // guess quietly overrule it would make the plan depend on which of two
        // sources the reader happened to trust.
        let blastRadius: BlastRadius;
        let targetFiles: string[];
        if (declaredFiles !== null) {
            // `normalizePath` maps a bare `*` to `EVERYTHING` (the empty repo
            // root), so this reads the NORMALIZED marker. Matching the raw `"*"`
            // here is what broke when normalization learned about it — and the
            // failure was silent: the issue kept a `declared` radius and stopped
            // announcing that it touches the whole repo.
            blastRadius = declaredFiles.includes(EVERYTHING)
                ? "everything"
                : "declared";
            targetFiles = declaredFiles;
        } else if (inferredFiles && inferredFiles.length > 0) {
            blastRadius = "inferred";
            targetFiles = inferredFiles.map(normalizePath);
        } else {
            blastRadius = "unknown";
            targetFiles = [];
        }
        const batchable =
            blastRadius === "declared" || blastRadius === "inferred";

        // Lane (issue #2743). Computed from the real `targetFiles` with the
        // SAME predicate `check:lane` runs against an actual diff — never
        // from the issue's `area:*` label, which this function never reads.
        // `unknown` (targetFiles === []) and `everything` (targetFiles ===
        // [EVERYTHING], and `classifyPath("")` is unrecognised) both feed
        // `laneFor` an input that resolves to `full` on its own fail-closed
        // terms, which is also the right answer: both are already solo
        // (`!batchable` below), so their lane never has to coexist with
        // anything else's.
        const lane: Lane = laneFor(targetFiles.map(classifyPath));

        // Well-formedness (issue #2188). The lint runs at both ends of the
        // queue's life: intake calls it before publishing, and the planner
        // calls it here so a pre-existing defect cannot poison a batch.
        //
        // It is the SINGLE authority on what makes an issue unworkable — the
        // planner used to carry its own copy of the unmergeable-work rules, and
        // two copies of a rule is how they drift. Only BLOCKING findings keep
        // an issue out: measured against the live queue, the advisory ones (no
        // declared target files, no acceptance criteria) describe 66 and 44 of
        // 100 issues respectively, and a planner that refused those would be an
        // outage, not a gate.
        const lintFindings = lintIssue({
            number: issue.number,
            title: issue.title,
            labels: labelNames(issue),
            parentNumber: issue.parent?.number ?? null,
            body: detail.body,
        });
        const lintBlockers = lintFindings.filter(
            (f) => f.severity === "blocking"
        );
        if (lintBlockers.length > 0) {
            skipped.push({
                number: issue.number,
                reason: lintBlockers
                    .map((f) => `${f.rule}: ${f.message}`)
                    .join("; "),
                action: lintAction(lintBlockers),
            });
            continue;
        }

        if (config.excludeHitl && isHitl(detail.body)) {
            deferred.push({
                number: issue.number,
                reason: "HITL — needs a human before it merges, so an unattended run never considers it",
                conflictsWith: null,
            });
            continue;
        }

        const blockers = parseDependencies(detail.body, issue.number);
        const openBlocker = blockers.find(
            (n) => port.issueDetail(n).state === "OPEN"
        );
        if (openBlocker !== undefined) {
            deferred.push({
                number: issue.number,
                reason: `blocked by #${openBlocker}`,
                conflictsWith: openBlocker,
            });
            continue;
        }

        const comparable = targetFiles.filter(
            (p) => !appendOnly.some((a) => isAppendOnlyPath(p, a))
        );

        if (batch.length > 0) {
            if (!batchable) {
                deferred.push({
                    number: issue.number,
                    reason:
                        blastRadius === "unknown"
                            ? "no declared target files and none inferred — an unknown blast radius overlaps everything, so it runs solo"
                            : "declares `*` — it runs solo",
                    conflictsWith: batch[0].number,
                });
                continue;
            }

            // Lane homogeneity (issue #2743). A batch is all-skin, all-engine,
            // all-docs or all-full — the reason lives on `BatchPlan.lane`
            // above. Nothing here enumerates the lanes: it is a plain equality
            // against the batch's first admitted lane, so a lane added to
            // `check-lane.ts` becomes another homogeneity class for free. This
            // is what makes a `area:ui-ux`-labelled issue whose declared
            // files actually reach `convex/**` harmless rather than
            // corrupting: it computes `full` on its own real target files (see
            // `lane` above, which never reads the label) and simply cannot
            // join a `skin` batch — it is deferred here like any other
            // cross-lane candidate, and every OTHER issue in the batch is
            // admitted or deferred exactly as if the mislabelled one had
            // never been in the queue (acceptance criterion 2).
            if (batch[0].lane !== lane) {
                deferred.push({
                    number: issue.number,
                    reason: `lane mismatch — batch is ${batch[0].lane} (from #${batch[0].number}), this issue's target files land in ${lane}`,
                    conflictsWith: batch[0].number,
                });
                continue;
            }

            const clash = batch.find((admitted) =>
                admitted.targetFiles.some((a) =>
                    comparable.some((c) => pathsOverlap(a, c))
                )
            );
            if (clash) {
                deferred.push({
                    number: issue.number,
                    reason: `target files overlap #${clash.number}`,
                    conflictsWith: clash.number,
                });
                continue;
            }
        }

        const { model, ambiguity } = resolveModel(issue, config);
        const movedBand = inheritedBand(issue, port.priority);
        batch.push({
            number: issue.number,
            title: issue.title,
            type: hasLabel(issue, "bug") ? "fix" : "feat",
            model,
            ...(ambiguity ? { modelAmbiguity: ambiguity } : {}),
            hitl: isHitl(detail.body),
            ...(port.priority[issue.number]
                ? { priority: port.priority[issue.number] }
                : {}),
            ...(movedBand !== null ? { priorityBand: movedBand } : {}),
            targetFiles: comparable,
            blastRadius,
            lane,
            reason: batchable
                ? `admitted — ${blastRadius} target files, disjoint from the rest of the batch`
                : "admitted solo — blast radius is neither declared nor inferred",
        });

        if (!batchable) closed = true;
    }

    return {
        version: 1,
        lane: batch[0]?.lane,
        batch,
        deferred,
        skipped,
        staleClaims,
        activeClaims,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admission — the two things that refuse a PICK before the plan is worth
// having (ADR 0136 §6–7, issue #3775).
//
// The planner above answers "which issue is next". These answer the question
// in front of it: should this session take one AT ALL. Both are pure
// decisions over data the wrapper reads — a claims map and a marker record —
// for the same reason `planBatch` is: a refusal that cannot be tested is a
// refusal nobody can change with confidence, and both of these refuse work a
// human is waiting for.
//
// Each refusal NAMES ITS EXIT. A stop with no way out is how an unattended
// driver turns a two-minute fix into an idle night: the cap refusal prints
// the claimed issues and `--no-cap`, the RED refusal prints the broken sha,
// the step that failed and `bun run health:fix`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The durable release-health verdict, as `health-main.ts` leaves it in
 * `.claude/telemetry/health/` — the `RED` marker file plus the fields of
 * `last.json` a reader needs to say WHAT is broken.
 *
 * `sha` and `failedStep` are optional because the record is written by
 * another process and may be mid-write, truncated, or (for `failedStep`) from
 * a run that died before it named a step. A missing field degrades the
 * MESSAGE, never the decision: the marker's presence is the verdict.
 */
export interface HealthMarker {
    sha?: string;
    failedStep?: string;
    log?: string;
}

/**
 * Live claims: the open `in-progress` issues the planner did not already
 * classify as stale, reconciled against the claims record.
 *
 * The LABEL is the count and the ledger only subtracts from it. That
 * direction is the whole design, and it is the one a first cut got backwards:
 * counting the INTERSECTION made the cap fail open to zero the moment the
 * journal could not be found, and a live queue with four claims on it planned
 * a fifth pick without a word. A throughput knob that silently never fires is
 * indistinguishable from one that was never built.
 *
 * So:
 *
 *   * an `in-progress` label with no ledger row at all COUNTS — the ledger is
 *     per-machine and best-effort (a shell hook under `2>/dev/null`), while
 *     the cap is a property of the repository's throughput, measured in PR/h
 *     by ACTIVE SESSIONS wherever they run;
 *   * an issue whose last ledger row is `released` does NOT count — the label
 *     outliving the release is exactly the orphan window `claim-sweep.sh` and
 *     `loop:doctor` close, and holding a slot for it would wedge the queue on
 *     work nobody is doing;
 *   * a claim the planner reports as STALE is excluded by the caller before it
 *     gets here (`BatchPlan.staleClaims` — no open PR and untouched past
 *     `staleClaimHours`), for the same reason.
 *
 * Sorted ascending so a refusal message is reproducible.
 */
export function liveClaims(inProgress: number[], released: number[]): number[] {
    const gone = new Set(released);
    return [...new Set(inProgress)]
        .filter((n) => !gone.has(n))
        .sort((a, b) => a - b);
}

/**
 * Fold the claim journal (`.claude/telemetry/claims.jsonl`) into the issues
 * whose LAST row gave the claim back. Last row per issue wins: a `claim` row
 * takes it, any other event (`released`) returns it.
 *
 * Pure over the file's text, and deliberately NOT `loop-doctor.ts`'s
 * `parseClaimOwners`: that fold answers "WHO owns this claim" and therefore
 * drops every row written before owners were recorded (#2627). Here a row with
 * no owner is a perfectly good claim, and an issue the journal never mentions
 * is not released — it is simply unknown, which `liveClaims` counts.
 *
 * Malformed lines are skipped rather than thrown on — a shell hook appends to
 * this journal under `2>/dev/null`, so a torn last line is a normal thing to
 * find and refusing to read the rest because of one is worse than ignoring it.
 */
export function releasedClaims(ledgerText: string): number[] {
    const released = new Set<number>();
    for (const line of ledgerText.split("\n")) {
        if (line.trim() === "") continue;
        let row: { issue?: unknown; event?: unknown };
        try {
            row = JSON.parse(line) as { issue?: unknown; event?: unknown };
        } catch {
            continue;
        }
        if (typeof row.issue !== "number") continue;
        if (row.event === "claim") released.delete(row.issue);
        else released.add(row.issue);
    }
    return [...released].sort((a, b) => a - b);
}

/**
 * The cap's census: split the reconciled claims into the ones that COUNT and
 * the ones the liveness classifier proved recoverable (issue #4384).
 *
 * A `recoverable` claim is one `loop:doctor` has positively identified as
 * owned by NO running process, whose local branch still holds committed work.
 * It burns no CPU, and CPU contention is the entire thing the cap measures —
 * so it holds its LABEL (releasing it would orphan the WIP, and that call
 * stays `loop:doctor --release`'s alone) without holding a SLOT. Before this
 * split, three such corpses refused every claim for 24 hours with zero
 * sessions running.
 *
 * EVERY OTHER READING COUNTS, including no reading at all. `live`, `suspect`
 * and `orphan` count; an issue the classifier has no verdict for — the probe
 * failed, `git ls-remote` could not reach the network, the journal is missing
 * — counts too. That asymmetry is the same one `ClaimFacts.ownerAlive`
 * documents at the other end: uncertainty never authorises more concurrency.
 * `orphan` counts deliberately as well — it is `loop:doctor --release`'s to
 * drop, and the 24-hour stale rule already removes the abandoned ones before
 * they reach here.
 *
 * Both lists sorted, so a refusal message is reproducible.
 */
export function capCensus(
    claims: number[],
    verdicts: Map<number, ClaimVerdictState>
): CapCensus {
    const live: number[] = [];
    const recoverable: number[] = [];
    for (const n of [...new Set(claims)].sort((a, b) => a - b)) {
        if (verdicts.get(n) === "recoverable") recoverable.push(n);
        else live.push(n);
    }
    return { live, recoverable };
}

export interface CapCensus {
    /** Claims counting against `sessions.cap`. */
    live: number[];
    /** Claims proved recoverable — the label stands, the slot does not. */
    recoverable: number[];
}

export interface AdmissionInput {
    /** Live claims, already reconciled — see `liveClaims`. */
    claims: number[];
    /** `sessions.cap` from `tolaria.config.json`, never a literal. */
    cap: number;
    /** `--no-cap`: the announced escape from the cap refusal ONLY. */
    noCap: boolean;
    /** The release-health verdict, or `null` when no `RED` marker exists. */
    red: HealthMarker | null;
    /** Claims `capCensus` kept out of `claims` (issue #4384) — the refusal
     *  names them so it points at the branches to resume. Threaded through
     *  here too, so the combined decision and `capRefusal` cannot disagree
     *  about what a refusal SAYS if a caller ever reaches for this one. */
    recoverable?: number[];
}

export type Admission =
    | { admitted: true }
    | {
          admitted: false;
          refusal:
              | "cap"
              | "red"
              /** `--lineage <N>` named an issue that is not an umbrella. */
              | "lineage-not-umbrella"
              /** `--lineage <N>` named an umbrella with no open children in
               *  the queue. */
              | "lineage-empty";
          message: string;
      };

/**
 * The RED refusal, on its own: it needs no queue and no network, so the
 * wrapper asks it BEFORE the first `gh` round-trip. A session on a broken base
 * should not spend the queue read and a detail fetch per candidate to be told
 * it may not pick.
 */
export function redRefusal(red: HealthMarker | null): Admission {
    if (!red) return { admitted: true };
    const sha = red.sha ? red.sha.slice(0, 8) : "unknown sha";
    const step = red.failedStep ?? "unknown step";
    return {
        admitted: false,
        refusal: "red",
        message:
            `release health is RED @ ${sha} (failed at ${step}) — refusing to pick onto a broken base.\n` +
            `  Fix forward FIRST: \`bun run health:fix\`. \`bun run health:status\` prints the verdict${
                red.log ? ` and the log (${red.log})` : ""
            }.\n` +
            `  \`land\` still warns and proceeds, so a session already mid-issue finishes.`,
    };
}

/**
 * The cap refusal, on its own: it needs the planner's own classification of
 * which claims are live, so the wrapper asks it after `planBatch`.
 */
export function capRefusal(
    claims: number[],
    cap: number,
    noCap: boolean,
    /** Claims excluded from the count by `capCensus` — named in the message so
     *  the refusal points at the branches to resume, not only at `--no-cap`
     *  (issue #4384). */
    recoverable: number[] = []
): Admission {
    if (noCap || claims.length < cap) return { admitted: true };
    const breakdown =
        recoverable.length === 0
            ? ""
            : `  ${claims.length + recoverable.length} claimed, ${claims.length} live, ${recoverable.length} recoverable (not counted): ` +
              `${recoverable.map((n) => `#${n}`).join(", ")} — a dead pass left committed work on branch *issue-N.\n` +
              `  \`bun run loop:doctor\` names them; resume or salvage those branches (the label is not released by hand).\n`;
    return {
        admitted: false,
        refusal: "cap",
        message:
            `session cap reached — ${claims.length}/${cap} live claims: ${claims
                .map((n) => `#${n}`)
                .join(", ")}.\n` +
            breakdown +
            `  Per-session yield halves past the knee (PR/h by active sessions: 0.59 at 1, 1.44 at 3, 1.19 at 4).\n` +
            `  Wait for one to land, or re-run with --no-cap to plan past it deliberately.`,
    };
}

/**
 * The `--lineage <N>` refusal (issue #2327): may a plan be scoped to this
 * umbrella at all?
 *
 * Two failures, and each NAMES which one it was — a scoped request that
 * quietly widened back to the whole queue is the failure mode the flag exists
 * to remove, so neither case returns a plan. `detail` is the target's own
 * Stage-2 record (one extra round-trip, paid once per run); `children` is the
 * set of queue rows whose native parent edge points at it.
 *
 *   * NOT AN UMBRELLA — no `prd` label. The flag means "finish PRD #N", and
 *     an issue that is not a PRD has no children to finish; reading its edges
 *     would silently plan an empty batch instead of saying the target was
 *     wrong.
 *   * NO OPEN CHILDREN — it is an umbrella, but nothing in the `ready-for-agent`
 *     queue is parented to it. Note the scope: a child that exists but is
 *     claimed, assigned or unlabelled is NOT this case — it is in `children`,
 *     and the plan that comes back is a legitimately empty one, exactly as an
 *     unrestricted pass over a fully-claimed queue would be.
 */
export function lineageRefusal(
    target: number,
    detail: IssueDetail,
    children: number[]
): Admission {
    if (!detail.labels.includes("prd")) {
        return {
            admitted: false,
            refusal: "lineage-not-umbrella",
            message:
                `--lineage #${target} is not an umbrella — it carries no \`prd\` label.\n` +
                `  The flag scopes a batch to ONE umbrella's open children; a work item has none.\n` +
                `  Pass the PRD's number, or drop --lineage to plan the whole queue.`,
        };
    }
    if (children.length === 0) {
        return {
            admitted: false,
            refusal: "lineage-empty",
            message:
                `--lineage #${target} is an umbrella with no open \`ready-for-agent\` children.\n` +
                `  Nothing is parented to it in the queue this run read, so there is nothing to plan.\n` +
                `  Check the sub-issue edges (\`gh issue edit <child> --parent ${target}\`) — a prose\n` +
                `  "Split out of #${target}" line is not one — or close the umbrella if its work is done.`,
        };
    }
    return { admitted: true };
}

/**
 * Should this session pick an issue? The ORDER of the two refusals, as one
 * decision — the wrapper asks them separately (RED before the queue read, the
 * cap after the plan), and this is what pins which one wins when both apply.
 *
 * RED is tested FIRST, and `--no-cap` does not touch it. The two answer
 * different questions — "is there room for one more pass?" versus "is the tree
 * every pass would branch from broken?" — and only the first is a tuning knob.
 * A `--no-cap` that also waved through a red base would let the one flag
 * anybody reaches for when they are in a hurry silently opt out of the thing
 * ADR 0136 §6 added to stop new worktrees branching from a tip known red.
 */
export function admitPick(input: AdmissionInput): Admission {
    const red = redRefusal(input.red);
    if (!red.admitted) return red;
    return capRefusal(
        input.claims,
        input.cap,
        input.noCap,
        input.recoverable ?? []
    );
}
