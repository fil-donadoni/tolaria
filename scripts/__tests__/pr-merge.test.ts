import { describe, it, expect } from "vitest";
import {
    settleVerdict,
    isTransientMergeRefusal,
    mergeArgs,
    followUpNotice,
    parseArgs,
    type PrSettleView,
} from "../pr-merge";

// Issue #2536. A force-push invalidates GitHub's cached view of the PR, and
// the merge is refused while that recomputes — twice on 2026-08-18, on trees
// that had not changed and a `main` that had not moved. These are the two
// decisions that turn that window into a bounded retry instead of a failed
// landing (which, under land's one-lock design, costs a whole extra heavy
// gate). Both are pure; the poll/retry loop around them is thin plumbing,
// untested per repo convention (land.ts, docs-lane.ts).

const settled: PrSettleView = {
    state: "OPEN",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
};

describe("pr-merge.ts — settleVerdict", () => {
    it("merges a settled, clean, open PR", () => {
        expect(settleVerdict(settled)).toEqual({ kind: "ready" });
    });

    it("treats the post-force-push UNKNOWN window as unsettled, not as failure", () => {
        // The #2524 shape: `mergeable` has not been recomputed yet. Reading
        // this as "cannot merge" is exactly the bug — it merged clean on a
        // plain retry seconds later.
        expect(
            settleVerdict({
                state: "OPEN",
                mergeable: "UNKNOWN",
                mergeStateStatus: "UNKNOWN",
            })
        ).toEqual({ kind: "unsettled" });
        expect(
            settleVerdict({
                state: "OPEN",
                mergeable: null,
                mergeStateStatus: null,
            })
        ).toEqual({ kind: "unsettled" });
        // Either field alone still unsettled — they do not recompute together.
        expect(
            settleVerdict({ ...settled, mergeStateStatus: "UNKNOWN" })
        ).toEqual({ kind: "unsettled" });
        expect(settleVerdict({ ...settled, mergeable: "UNKNOWN" })).toEqual({
            kind: "unsettled",
        });
    });

    it("blocks a REAL conflict terminally — never retried", () => {
        expect(
            settleVerdict({ ...settled, mergeable: "CONFLICTING" }).kind
        ).toBe("blocked");
        expect(
            settleVerdict({ ...settled, mergeStateStatus: "DIRTY" }).kind
        ).toBe("blocked");
    });

    it("reports an already-merged PR as success, idempotently", () => {
        // The merge may have landed on an attempt whose response was lost;
        // re-merging is impossible and failing would be a lie.
        expect(settleVerdict({ ...settled, state: "MERGED" })).toEqual({
            kind: "merged",
        });
    });

    it("reads state BEFORE mergeable — a merged PR reports CONFLICTING/UNKNOWN and must not be called a conflict", () => {
        // GitHub leaves `mergeable` meaningless once a PR is merged. Checking
        // it first would turn a successful landing into a terminal failure.
        expect(
            settleVerdict({
                state: "MERGED",
                mergeable: "CONFLICTING",
                mergeStateStatus: "DIRTY",
            })
        ).toEqual({ kind: "merged" });
    });

    it("blocks a closed PR", () => {
        expect(settleVerdict({ ...settled, state: "CLOSED" }).kind).toBe(
            "blocked"
        );
    });

    it("treats an unreadable PR (gh hiccup) as unsettled, not as ready", () => {
        expect(
            settleVerdict({
                state: null,
                mergeable: "MERGEABLE",
                mergeStateStatus: "CLEAN",
            })
        ).toEqual({ kind: "unsettled" });
    });
});

describe("pr-merge.ts — isTransientMergeRefusal", () => {
    it("recognises both refusals actually observed in the settle window", () => {
        // Verbatim from the 2026-08-18 landings of #2524 and #2527.
        expect(
            isTransientMergeRefusal(
                "GraphQL: Pull Request is not mergeable (mergePullRequest)"
            )
        ).toBe(true);
        expect(
            isTransientMergeRefusal(
                "GraphQL: Base branch was modified. Review and try the merge again."
            )
        ).toBe(true);
    });

    it("fails CLOSED on anything unrecognised", () => {
        // An allowlist, not a denylist: a new failure mode must surface as a
        // loud failure, not be retried five times and reported as a settle
        // problem.
        expect(
            isTransientMergeRefusal(
                "GraphQL: Resource not accessible by personal access token"
            )
        ).toBe(false);
        expect(
            isTransientMergeRefusal("error: failed to run git: exit status 128")
        ).toBe(false);
        expect(isTransientMergeRefusal("")).toBe(false);
    });
});

describe("pr-merge.ts — mergeArgs", () => {
    it("squash-merges the requested PR", () => {
        expect(mergeArgs(2536)).toEqual(["pr", "merge", "2536", "--squash"]);
    });

    it("never passes --delete-branch", () => {
        // `gh --delete-branch` switches the LOCAL repo to the default branch
        // first, and `main` is checked out in the primary worktree while
        // `land` runs from a linked one — it dies AFTER the API merge has
        // landed. `land` deletes the refs itself, past the green-sha write.
        expect(mergeArgs(2536)).not.toContain("--delete-branch");
    });
});

// Issue #4159. `pr-merge` is the raw primitive: it merges, and `land` wraps it
// in a post-merge step list. CLAUDE.md § Merging sends a session here when only
// the MERGE failed, precisely so the lane gate is not re-paid — and the cost of
// that advice was silence: the PR landed and every housekeeping step was
// skipped with nothing said, which is issue #3253's loss (an unseeded scenario
// disappears without a word) reintroduced through the back door. Observed on
// PR #4153, 2026-09-19.
describe("pr-merge.ts — followUpNotice", () => {
    it("names what a hand-run merge still owes, and the one command that runs it", () => {
        const lines = followUpNotice(4153, false);
        expect(lines.length).toBeGreaterThan(0);
        const text = lines.join("\n");
        // The four steps whose silent absence is the bug, by the names a
        // reader can grep for.
        expect(text).toMatch(/preset-scenario seed/);
        expect(text).toMatch(/gaps:sync/);
        expect(text).toMatch(/fast-forward/);
        expect(text).toMatch(/landing record/);
        // The follow-up is `land` itself — which, on an already-MERGED PR,
        // runs the housekeeping and nothing else.
        expect(text).toContain("bun run gate:run land 4153");
        // Keyed on the run key `land` is always invoked with, so the
        // re-attach documented in /next-issue §5 works from anywhere.
        expect(text).toContain("TOLARIA_GATE_RUN_KEY=land-4153");
    });

    it("says nothing when `land` is the caller — it is about to run those very steps", () => {
        expect(followUpNotice(4153, true)).toEqual([]);
    });
});

describe("pr-merge.ts — parseArgs", () => {
    it("reads the PR number from the first positional, `#` and flags alike", () => {
        expect(parseArgs(["4153"])).toEqual({ pr: 4153, fromLand: false });
        expect(parseArgs(["#4153"])).toEqual({ pr: 4153, fromLand: false });
        expect(parseArgs(["4153", "--from-land"])).toEqual({
            pr: 4153,
            fromLand: true,
        });
    });

    it("is what `land`'s own merge step passes — the flag never shifts the PR number", () => {
        // `buildLockedCommand` emits `bun <pr-merge.ts> <pr> --from-land`.
        // A parser reading `process.argv[2]` positionally would still work
        // here; one reading the LAST argument would not, and this pins which.
        expect(parseArgs(["4153", "--from-land"]).pr).toBe(4153);
    });
});

// Proof-of-failure: made `followUpNotice` return `[]` unconditionally (the
// pre-#4159 silence) — "names what a hand-run merge still owes" went red.
// Reverted.
//
// Proof-of-failure: made `parseArgs` read `argv[argv.length - 1]` instead of
// the first positional — both `parseArgs` cases went red, because `land`
// passes `<pr> --from-land`. Reverted.
