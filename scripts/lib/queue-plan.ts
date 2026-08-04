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

/** Strip decoration so a glob and a path underneath it compare equal. */
export function normalizePath(raw: string): string {
    return raw
        .trim()
        .replace(/^[-*]\s+/, "")
        .replace(/`/g, "")
        .trim()
        .replace(/\/\*\*$/, "")
        .replace(/\/\*$/, "")
        .replace(/\/+$/, "");
}

/** Two paths collide when either contains the other. */
function pathsOverlap(a: string, b: string): boolean {
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
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
// Unmergeable work
//
// Some work cannot be landed by an automated session no matter how well it is
// implemented, and claiming it burns a full implement + review cycle before
// failing at `git push`. Both cases below are detectable from the declared
// target files alone, which is why they are checked here rather than discovered
// at the end.
// ─────────────────────────────────────────────────────────────────────────────

function unmergeableReason(paths: string[]): string | null {
    for (const p of paths) {
        if (p.startsWith(".github/workflows")) {
            return "CI config — pushing `.github/workflows/**` needs the `workflow` OAuth scope, which only an interactive `gh auth refresh` grants";
        }
        if (p.startsWith("~") || p.startsWith("/") || p.startsWith("..")) {
            return `\`${p}\` lives outside the repository — no PR can carry the change`;
        }
    }
    return null;
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
    // Bugs first, then oldest LINEAGE, then the issue's own number so the order
    // is total (a comparator with ties is not reproducible).
    eligible.sort((a, b) => {
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
            blastRadius = declaredFiles.includes("*")
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

        const unmergeable = unmergeableReason(targetFiles);
        if (unmergeable) {
            skipped.push({
                number: issue.number,
                reason: unmergeable,
                action: "relabel-human",
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
            (p) => !appendOnly.some((a) => pathsOverlap(p, a))
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
