/**
 * Health facts one machine produces and the other acts on, kept on the pivot
 * (GitHub commit statuses, the verdict store's own transport — issue #5593,
 * census of issue #5589 § 4), never in a machine-local file:
 *
 *  - **run marker** — context `health-run`, a `pending` status on the sha a
 *    health run gates, written when the run starts. The cadence on the other
 *    machine reads it, so a run in flight is visible before its verdict lands
 *    (no double fire). It carries no "done" write: a run is over once a
 *    settled `health` verdict newer than the marker stands for its sha, or
 *    once the marker is older than the stale bound (a run that died).
 *  - **repair issues** — context `health-fix`, on the standing RED sha, the
 *    `/health-fix` issues whose PR is the repair. `land` on either machine
 *    reads them; they retire with the RED itself (only read under a RED).
 *    A repair declared on an earlier RED of the same run (no GREEN or AMBER
 *    since) is still read, while its issue is open (issue #7139): a later
 *    tip that went RED again still holds the culprit that repair reverts.
 *
 * Only the `github` backend has a pivot: with the `file` store there is one
 * machine's markers and its local ledger already is the whole truth, so every
 * function here is a no-op / null. Every function is total — a pivot that
 * cannot be written costs the visibility, never the run; one that cannot be
 * read reads as "nothing known" (callers keep their local reading).
 */
import {
    githubVerdictStore,
    lineageBlocks,
    machineName,
    originRepo,
    realGh,
    verdictStore,
    type GhRunner,
    type Verdict,
    type VerdictStore,
} from "./health-verdict-store";

export const RUN_CONTEXT = "health-run";
export const FIX_CONTEXT = "health-fix";

export interface PivotOpts {
    run?: GhRunner;
}

/** The status store for one pivot context. */
function pivotStore(
    root: string,
    context: string,
    opts: PivotOpts
): VerdictStore {
    return githubVerdictStore({
        repo: originRepo(root),
        run: opts.run,
        context,
    });
}

function warn(what: string, e: unknown): void {
    console.error(`health pivot: ${what} — ${(e as Error).message}`);
}

/** Publish "a health run is gating `sha`". Advisory: never throws. */
export function publishRunMarker(
    root: string,
    sha: string,
    opts: PivotOpts = {}
): void {
    try {
        pivotStore(root, RUN_CONTEXT, opts).write({
            sha,
            status: "amber",
            step: "running",
            machine: machineName(),
        });
    } catch (e) {
        warn("the run marker could not be published", e);
    }
}

/**
 * Is a health run in flight on the pivot, whichever machine started it?
 * Returns the reason line (the shape `healthRunInFlight` returns), or null.
 * `stored` reads the settled `health` verdict of a sha (injected for tests).
 */
export function pivotRunInFlight(
    root: string,
    now: number,
    staleMs: number,
    opts: PivotOpts & {
        stored?: (sha: string) => Verdict | null;
    } = {}
): string | null {
    try {
        const marker = pivotStore(root, RUN_CONTEXT, opts).latest();
        if (marker === null || marker.status !== "amber" || !marker.at)
            return null;
        // This machine's own run is judged by its pid probe (`last.json`):
        // a marker it left behind from a killed run must not hold the fire.
        if (marker.machine === machineName()) return null;
        const startedAt = Date.parse(marker.at);
        if (!Number.isFinite(startedAt) || now - startedAt >= staleMs)
            return null;
        const settled = (
            opts.stored ??
            ((sha) => verdictStore(root, { run: opts.run }).read(sha))
        )(marker.sha);
        const settledAt = settled?.at ? Date.parse(settled.at) : NaN;
        if (
            settled !== null &&
            settled.status !== "amber" &&
            Number.isFinite(settledAt) &&
            settledAt >= startedAt
        )
            return null;
        return `a health run on ${marker.sha.slice(0, 8)} is already in flight${marker.machine ? ` on ${marker.machine}` : ""} (pivot)`;
    } catch (e) {
        warn("the run marker could not be read", e);
        return null;
    }
}

/** The standing RED's sha, or null when none stands or the store is down. */
function standingRedSha(root: string, opts: PivotOpts): string | null {
    return standingRedRun(root, opts)[0] ?? null;
}

/** The standing RED's sha and those of the REDs before it back to the last
 *  GREEN or AMBER, newest first; [] when no RED stands. */
function standingRedRun(root: string, opts: PivotOpts): string[] {
    const lineage = verdictStore(root, { run: opts.run }).lineage();
    if (!lineageBlocks(lineage.kind) || !lineage.verdict) return [];
    return (lineage.reds ?? [lineage.verdict]).map((v) => v.sha);
}

/** Whether `issue` is closed on GitHub. A state that cannot be read counts
 *  as open: a stale repair admitted costs one landing, a live one refused
 *  blocks the base (issue #7139). */
function issueClosed(root: string, issue: number, opts: PivotOpts): boolean {
    const r = (opts.run ?? realGh)([
        "issue",
        "view",
        String(issue),
        "--repo",
        originRepo(root),
        "--json",
        "state",
        "--jq",
        ".state",
    ]);
    return r.status === 0 && r.stdout.trim() === "CLOSED";
}

/** The repair issues held for the standing RED: its own `health-fix`
 *  record, plus every still-open issue recorded on an earlier RED of the
 *  same run, whatever culprit each RED's bisect named — with two stacked
 *  culprits the later RED still holds the first (issue #7139). Throws when
 *  the pivot cannot be read. */
function readRepairRecords(
    root: string,
    opts: PivotOpts
): { issues: number[]; ladder: number[] } {
    const [standing, ...earlier] = standingRedRun(root, opts);
    if (standing === undefined) return { issues: [], ladder: [] };
    const store = pivotStore(root, FIX_CONTEXT, opts);
    const held = store.read(standing);
    const issues = new Set(held?.issues ?? []);
    const ladder = new Set(held?.ladderIssues ?? []);
    for (const sha of earlier) {
        const prior = store.read(sha);
        for (const n of prior?.issues ?? []) {
            if (!issues.has(n) && issueClosed(root, n, opts)) continue;
            issues.add(n);
            // Re-declared by hand on the later RED, it stays the ladder's.
            if (prior?.ladderIssues?.includes(n)) ladder.add(n);
        }
    }
    const ascending = (s: Set<number>) => [...s].sort((a, b) => a - b);
    return { issues: ascending(issues), ladder: ascending(ladder) };
}

/** The env var the ladder's headless fixer carries, so the `repair-issue` it
 *  runs records the issue as the ladder's own (issue #6554). */
export const LADDER_ATTEMPT_ENV = "TOLARIA_LADDER_ATTEMPT";

/** Record `issue` as a repair of the standing RED, on that sha's `health-fix`
 *  status. `ladder` marks it the RED ladder's own attempt's (issue #6554);
 *  absent, it is an interactive session's. Returns a note for the operator,
 *  or null when nothing was written (no pivot, no RED standing, store
 *  unreachable). Never throws. */
export function recordPivotRepairIssue(
    root: string,
    issue: number,
    opts: PivotOpts & { ladder?: boolean } = {}
): string | null {
    try {
        const store = pivotStore(root, FIX_CONTEXT, opts);
        const sha = standingRedSha(root, opts);
        if (sha === null) return null;
        const held = store.read(sha);
        const issues = new Set(held?.issues ?? []);
        issues.add(issue);
        const ladderIssues = new Set(held?.ladderIssues ?? []);
        if (opts.ladder) ladderIssues.add(issue);
        const ascending = (s: Set<number>) => [...s].sort((a, b) => a - b);
        store.write({
            sha,
            status: "amber",
            step: "repair",
            machine: machineName(),
            issues: ascending(issues),
            ...(ladderIssues.size > 0
                ? { ladderIssues: ascending(ladderIssues) }
                : {}),
        });
        return `repair issue #${issue} recorded on the pivot for ${sha.slice(0, 8)}`;
    } catch (e) {
        warn("the repair issue could not be recorded", e);
        return null;
    }
}

/** The repair issues the pivot holds for the standing RED (carried ones
 *  included, `readRepairRecords`); [] when none. */
export function pivotRepairIssues(
    root: string,
    opts: PivotOpts = {}
): number[] {
    try {
        return readRepairRecords(root, opts).issues;
    } catch (e) {
        warn("the repair issues could not be read", e);
        return [];
    }
}

/** `pivotRepairOrigins`, throwing when the pivot cannot be read — for a
 *  caller that must wait on an outage rather than read "no repair"
 *  (the lineage verdict, issue #6766). */
export function readPivotRepairOrigins(
    root: string,
    opts: PivotOpts = {}
): { ladder: number[]; foreign: number[] } {
    const { issues, ladder } = readRepairRecords(root, opts);
    return {
        ladder,
        foreign: issues.filter((n) => !ladder.includes(n)),
    };
}

/** The standing RED's repair issues split by who declared them (issue
 *  #6554): the ladder's own attempt's, and every other session's. */
export function pivotRepairOrigins(
    root: string,
    opts: PivotOpts = {}
): { ladder: number[]; foreign: number[] } {
    try {
        return readPivotRepairOrigins(root, opts);
    } catch (e) {
        warn("the repair issues could not be read", e);
        return { ladder: [], foreign: [] };
    }
}
