/**
 * GREEN by event (ADR 0159 § 4, issue #6990): is the base tip owed a batch
 * health run NOW? `health-early`'s `classify` asks it on every push, beside
 * the declared-repair question (`health-repair-merge.ts`), and dispatches
 * health.yml's `gate` when the answer is yes — so the two-hourly cron is the
 * fallback, not the clock that decides when the next GREEN can exist.
 *
 * Due when the base has landed one batch — `LANDINGS_PER_BATCH` merges (ADR
 * 0154's cadence, 20) — since the newest verdict in the store, and no health
 * run is in flight on the pivot. A landing is a commit the queue merged (its
 * subject ends in ` (#N)`); the base's own derive and sync commits are not
 * landings. The pure decision is `batchDue`; `landingsSince` reads the
 * commits through `gh`'s compare endpoint (a hosted checkout is shallow).
 */
import { gh } from "./gh";
import { pivotRunInFlight } from "./health-pivot";

/** health.yml's queued or running runs — a gate dispatched but not yet
 *  past its job setup has no pivot marker, and every push until it does
 *  would dispatch again (review of this PR, finding 4). */
export function healthRunsPending(
    run: (args: string[]) => string = gh
): boolean {
    for (const status of ["queued", "in_progress"]) {
        const out = run([
            "run",
            "list",
            "--workflow",
            "health.yml",
            "--status",
            status,
            "--limit",
            "1",
            "--json",
            "databaseId",
        ]);
        if ((JSON.parse(out) as unknown[]).length > 0) return true;
    }
    return false;
}
import { originRepo, verdictStore } from "./health-verdict-store";

/** Landings per batch health run (ADR 0154: 20 landings / 8 h; the clock
 *  half is health.yml's two-hourly schedule). */
export const LANDINGS_PER_BATCH = 20;

/** A run marker older than this is a dead run, not one in flight — the
 *  same bound `health-main`'s own in-flight probe uses. */
export const RUN_IN_FLIGHT_MAX_MS = 90 * 60 * 1000;

/** A commit the queue merged: a squash merge's subject ends in ` (#N)`. */
const LANDING_SUBJECT = / \(#\d+\)$/;

/** How many of `subjects` are landings. Pure. */
export function landingsIn(subjects: readonly string[]): number {
    return subjects.filter((s) => LANDING_SUBJECT.test(s.trim())).length;
}

/**
 * The decision, pure: due when `landingsSinceVerdict` reaches the batch and
 * no run is in flight. `landingsSinceVerdict` is null when the store holds
 * no verdict at all in the history it reads — then every landing in that
 * history is unverdicted, and a batch of them is due like any other.
 */
export function batchDue(input: {
    readonly landingsSinceVerdict: number;
    readonly inFlight: boolean;
    readonly perBatch?: number;
}): boolean {
    if (input.inFlight) return false;
    return input.landingsSinceVerdict >= (input.perBatch ?? LANDINGS_PER_BATCH);
}

/** The subjects of the commits `from..to` on origin, through the compare
 *  endpoint (up to 250 — more than any batch). */
export function subjectsBetween(
    root: string,
    from: string,
    to: string,
    run: (args: string[]) => string = gh
): string[] {
    const repo = originRepo(root);
    return run([
        "api",
        `repos/${repo}/compare/${from}...${to}`,
        "--jq",
        '.commits[].commit.message | split("\\n")[0]',
    ])
        .split("\n")
        .filter((l) => l !== "");
}

/**
 * Total: any unreadable fact answers "not due" — the cron's turn, which is
 * only slower, never wrong. The newest verdict of ANY status counts: an
 * INFRA or a RED on a recent tip is a run that happened; the ladder and the
 * cron own what follows it. "In flight" is a pivot run marker OR a queued /
 * running `health.yml` run: the marker appears only after the gate's job
 * setup and admission wait.
 */
export function pushOwesBatchRun(
    root: string,
    sha: string,
    deps: {
        readonly latestVerdictSha?: () => string | null;
        readonly subjects?: (from: string, to: string) => string[];
        readonly inFlight?: () => boolean;
        readonly now?: number;
    } = {}
): boolean {
    try {
        const latest = (
            deps.latestVerdictSha ??
            (() => verdictStore(root).latest()?.sha ?? null)
        )();
        // No verdict within the history the store reads (`HISTORY_DEPTH`
        // 60 commits — about 25–35 landings on the current base, the rest
        // derive / sync commits): a batch of unverdicted landings in all
        // likelihood, so the run is due unless one is in flight.
        const landings =
            latest === null
                ? LANDINGS_PER_BATCH
                : landingsIn(
                      (
                          deps.subjects ??
                          ((f, t) => subjectsBetween(root, f, t))
                      )(latest, sha)
                  );
        const inFlight = (
            deps.inFlight ??
            (() =>
                pivotRunInFlight(
                    root,
                    deps.now ?? Date.now(),
                    RUN_IN_FLIGHT_MAX_MS
                ) !== null || healthRunsPending())
        )();
        return batchDue({ landingsSinceVerdict: landings, inFlight });
    } catch {
        return false;
    }
}
