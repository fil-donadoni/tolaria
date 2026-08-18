#!/usr/bin/env bun
/**
 * `bun scripts/pr-merge.ts <PR#>` — squash-merge a PR that a force-push has
 * just updated, tolerating GitHub's asynchronous settle.
 *
 * WHY THIS EXISTS (issue #2536). `land` (scripts/land.ts) chained
 * `git push --force-with-lease && gh pr merge --squash` with nothing between
 * them. A force-push invalidates GitHub's cached view of the PR: the API
 * answers `mergeable: null` / `mergeStateStatus: UNKNOWN` until a background
 * job recomputes, and `mergePullRequest` refuses to act while that is pending.
 * Both refusals observed on 2026-08-18 came out of that window, on trees that
 * had not changed and a `main` that had not moved:
 *
 *   PR #2524  GraphQL: Pull Request is not mergeable (mergePullRequest)
 *   PR #2527  GraphQL: Base branch was modified. Review and try the merge again.
 *
 * Polled seconds later, both read `mergeable: true, mergeable_state: clean`,
 * and a plain retry merged each one to a tree hash identical to the gated
 * tree. So the classifier keys on "this refusal is transient", not on
 * `mergeable` alone — at least two distinct messages live in that window.
 *
 * WHY IT MATTERS MORE THAN A FLAKE. `land` holds the machine-wide heavy gate
 * lock across gate→merge precisely so the suite is paid ONCE per landing
 * (#2517). When the merge loses this race `land` exits non-zero and releases
 * the lock, so the next attempt re-pays a full heavy gate — reinstating the
 * N-gates-per-landing behaviour #2517 removed. Hence the retry lives HERE,
 * inside the lock, and never re-runs the gate: the tree is unchanged and
 * already verified.
 *
 * WHAT IT REFUSES TO PAPER OVER. A real conflict (`mergeable: CONFLICTING` /
 * `mergeStateStatus: DIRTY`) and a closed PR fail loudly, immediately, with no
 * retry — the same-looking "not mergeable" text is disambiguated by re-reading
 * the PR between attempts, never by trusting the message. Anything not on the
 * known-transient list is fatal too: the list is an allowlist, so an
 * unrecognised failure fails closed.
 */
import { gh } from "./lib/gh";

/** Bounded settle poll: 10 × 2s = 20s, then try the merge anyway and let the
 *  failure classifier speak. Both observed windows closed in single-digit
 *  seconds. */
const SETTLE_ATTEMPTS = 10;
const SETTLE_POLL_MS = 2_000;
/** Merge attempts, each preceded by a fresh settle poll. */
const MERGE_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = 3_000;

// ─────────────────────────────────────────────────────────────────────────
// Decisions — pure, so every case is testable without a network round trip.
// The plumbing below them is thin and untested, per repo convention
// (land.ts, docs-lane.ts, worktree-gc.ts).
// ─────────────────────────────────────────────────────────────────────────

/** The subset of `gh pr view --json state,mergeable,mergeStateStatus` this
 *  file reads. Every field is nullable: a PR GitHub has not finished
 *  recomputing answers `null`/`UNKNOWN`, and a `gh` failure leaves all three
 *  unknown. */
export interface PrSettleView {
    state: string | null;
    mergeable: string | null;
    mergeStateStatus: string | null;
}

export type SettleVerdict =
    /** Already merged — the merge landed (possibly on an earlier attempt
     *  whose response we lost). Success, idempotently. */
    | { kind: "merged" }
    /** GitHub has settled and nothing says no — attempt the merge. */
    | { kind: "ready" }
    /** Still recomputing after the force-push — poll again. */
    | { kind: "unsettled" }
    /** Terminal: a real conflict, or a PR that cannot be merged at all. */
    | { kind: "blocked"; reason: string };

/**
 * Classify one `gh pr view` reading.
 *
 * Order matters: `state` is checked first because a MERGED PR's `mergeable`
 * is meaningless (GitHub reports `CONFLICTING`/`UNKNOWN` on merged PRs), and
 * reading it before the state would turn a successful landing into a "real
 * conflict" failure.
 */
export function settleVerdict(view: PrSettleView): SettleVerdict {
    if (view.state === "MERGED") return { kind: "merged" };
    if (view.state === "CLOSED") {
        return { kind: "blocked", reason: "PR is closed" };
    }
    if (view.state === null) return { kind: "unsettled" };
    if (view.mergeable === "CONFLICTING" || view.mergeStateStatus === "DIRTY") {
        return {
            kind: "blocked",
            reason: "PR conflicts with the base branch (mergeable: CONFLICTING / mergeStateStatus: DIRTY)",
        };
    }
    if (view.mergeable === "UNKNOWN" || view.mergeable === null) {
        return { kind: "unsettled" };
    }
    if (view.mergeStateStatus === "UNKNOWN" || view.mergeStateStatus === null) {
        return { kind: "unsettled" };
    }
    return { kind: "ready" };
}

/**
 * Known-transient merge refusals — the ones GitHub emits while its own view
 * of a force-pushed PR is still settling. An ALLOWLIST on purpose: anything
 * unrecognised is fatal, so a genuinely new failure mode fails closed instead
 * of being retried five times and then reported as a settle problem.
 *
 * `not mergeable` is deliberately on the list even though a REAL conflict
 * produces the same words: the loop re-reads the PR before every retry, and
 * `settleVerdict` turns a conflict into a terminal `blocked` there. The
 * message never decides that on its own.
 */
const TRANSIENT_REFUSALS: RegExp[] = [
    /Pull Request is not mergeable/i,
    /Base branch was modified/i,
    /Head branch was modified/i,
    /try the merge again/i,
    /mergeable state is unknown/i,
];

export function isTransientMergeRefusal(output: string): boolean {
    return TRANSIENT_REFUSALS.some((re) => re.test(output));
}

/**
 * The `gh` argv for the merge itself.
 *
 * NO `--delete-branch`, ever: `gh` switches the LOCAL repo to the default
 * branch before deleting, and `main` is checked out in the primary worktree
 * while `land` runs from a linked one — so that step dies with
 * `fatal: 'main' is already used by worktree at …` AFTER the API merge has
 * already landed (found first in `scripts/docs-lane.ts:315-321`). `land`
 * deletes the refs itself, past the green-sha write. Pure so the prohibition
 * is asserted on the argv that actually ships, not on a shell string that no
 * longer contains it (#2536).
 */
export function mergeArgs(pr: number): string[] {
    return ["pr", "merge", String(pr), "--squash"];
}

// ─────────────────────────────────────────────────────────────────────────
// Plumbing
// ─────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message: string): never {
    console.error(`pr-merge: ${message}`);
    process.exit(1);
}

function readPr(pr: number): PrSettleView {
    try {
        const raw = gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "state,mergeable,mergeStateStatus",
        ]);
        const info = JSON.parse(raw) as Partial<PrSettleView>;
        return {
            state: info.state ?? null,
            mergeable: info.mergeable ?? null,
            mergeStateStatus: info.mergeStateStatus ?? null,
        };
    } catch {
        // A `gh` hiccup reads exactly like "not settled yet" — poll again.
        return { state: null, mergeable: null, mergeStateStatus: null };
    }
}

/** Poll until the PR leaves the post-force-push UNKNOWN window, or the budget
 *  runs out (in which case the merge is attempted anyway and its own failure
 *  is classified). */
async function settle(pr: number): Promise<SettleVerdict> {
    let verdict: SettleVerdict = { kind: "unsettled" };
    for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt++) {
        verdict = settleVerdict(readPr(pr));
        if (verdict.kind !== "unsettled") return verdict;
        if (attempt === 1) {
            console.log(
                `pr-merge: PR #${pr} not settled after the force-push — polling`
            );
        }
        await sleep(SETTLE_POLL_MS);
    }
    return verdict;
}

/** Returns combined stdout+stderr on failure, null on success. */
function attemptMerge(pr: number): string | null {
    try {
        gh(mergeArgs(pr));
        return null;
    } catch (err) {
        const e = err as {
            stdout?: unknown;
            stderr?: unknown;
            message?: string;
        };
        return [e.stdout, e.stderr, e.message]
            .map((part) => (part == null ? "" : String(part)))
            .join("\n")
            .trim();
    }
}

async function main(): Promise<void> {
    const raw = (process.argv[2] ?? "").replace(/^#/, "");
    const pr = Number(raw);
    if (!Number.isInteger(pr) || pr <= 0) {
        fail("usage: bun scripts/pr-merge.ts <PR#>");
    }

    for (let attempt = 1; attempt <= MERGE_ATTEMPTS; attempt++) {
        const verdict = await settle(pr);
        if (verdict.kind === "merged") {
            console.log(`pr-merge: PR #${pr} is merged`);
            return;
        }
        if (verdict.kind === "blocked") fail(verdict.reason);

        const failure = attemptMerge(pr);
        if (failure === null) {
            console.log(`pr-merge: PR #${pr} merged (attempt ${attempt})`);
            return;
        }
        if (!isTransientMergeRefusal(failure)) {
            fail(`gh pr merge failed:\n${failure}`);
        }
        console.log(
            `pr-merge: transient refusal on attempt ${attempt}/${MERGE_ATTEMPTS} — ` +
                `re-reading the PR and retrying\n${failure}`
        );
        await sleep(RETRY_BACKOFF_MS * attempt);
    }

    // Budget exhausted: one last read, because the merge may have landed on
    // the attempt whose response we classified as a refusal.
    if (settleVerdict(readPr(pr)).kind === "merged") {
        console.log(`pr-merge: PR #${pr} is merged`);
        return;
    }
    fail(
        `PR #${pr} still refusing to merge after ${MERGE_ATTEMPTS} attempts — ` +
            `the tree is gated and unchanged, so retry \`bun scripts/pr-merge.ts ${pr}\` ` +
            `rather than re-running the gate`
    );
}

if (import.meta.main) {
    void main();
}
