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

import { lintIssue, type Finding } from "./queue-lint";

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
    state: "OPEN" | "CLOSED";
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
     * A DATA field, not a method, on purpose: the board is one `gh project
     * item-list` call for the whole queue, so making it a per-issue lookup
     * would invent a round-trip the two-stage design exists to avoid.
     *
     * Absent from the map = the issue is not on the board, or is on it with no
     * Priority set. Both mean the same thing here — no explicit priority — and
     * the planner must not distinguish them: a board where only the urgent few
     * carry a value is the intended steady state, not a partially-filled one.
     */
    priority: Record<number, BoardPriority>;
}

/** The board's `Priority` single-select, strongest first. */
export type BoardPriority = "P0" | "P1" | "P2";

const PRIORITY_RANK: Record<BoardPriority, number> = { P0: 0, P1: 1, P2: 2 };

/** Where an issue sits on the board's priority axis. Unprioritized sorts LAST
 *  — below every explicit value, including `P2`. */
const UNPRIORITIZED = 3;

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
    | "needs-info";

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
    targetFiles: string[];
    blastRadius: BlastRadius;
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
    batch: PlannedIssue[];
    deferred: DeferredIssue[];
    skipped: SkippedIssue[];
    staleClaims: number[];
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

function hoursBetween(fromIso: string, toIso: string): number {
    return (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
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
 * Read the `Target files` section.
 *
 * Returns `null` when the section is absent — which is NOT the same as an empty
 * list. The planner does not infer a file set from prose: inference is a
 * judgment call, and a wrong guess parallelizes two issues that collide. An
 * absent section means "unknown", and unknown runs solo.
 */
export function parseTargetFiles(body: string): string[] | null {
    const lines = body.split("\n");
    const start = lines.findIndex((l) => /^#{1,6}\s+target files/i.test(l));
    if (start === -1) return null;

    const items: string[] = [];
    for (const line of lines.slice(start + 1)) {
        if (HEADING.test(line)) break;
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
    return items;
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
            const stale =
                !port.issuesWithOpenPr.includes(issue.number) &&
                hoursBetween(issue.updatedAt, config.now) >
                    config.staleClaimHours;
            if (stale) {
                staleClaims.push(issue.number);
                deferred.push({
                    number: issue.number,
                    reason: "stale claim — release it, then it is reselectable on a later pass",
                    conflictsWith: null,
                });
            } else {
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

    // ── Stage 1: order ──────────────────────────────────────────────────────
    // Board priority first, then bugs, then oldest LINEAGE, then the issue's
    // own number so the order is total (a comparator with ties is not
    // reproducible).
    //
    // Priority is the ZEROTH key, above `bug`, and that is the whole point: it
    // is the maintainer's live override, the one input whose criteria change
    // week to week. A P2 outranking an unprioritized `bug` is correct — the
    // human looked at the board and said so. Every key below it is a default
    // for the issues nobody has ruled on, which is the vast majority.
    const rank = (issue: QueueIssue): number => {
        const p = port.priority[issue.number];
        return p === undefined ? UNPRIORITIZED : PRIORITY_RANK[p];
    };
    eligible.sort((a, b) => {
        const priorityDelta = rank(a) - rank(b);
        if (priorityDelta !== 0) return priorityDelta;
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

    for (const issue of eligible) {
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
            targetFiles: comparable,
            blastRadius,
            reason: batchable
                ? `admitted — ${blastRadius} target files, disjoint from the rest of the batch`
                : "admitted solo — blast radius is neither declared nor inferred",
        });

        if (!batchable) closed = true;
    }

    return { version: 1, batch, deferred, skipped, staleClaims };
}
