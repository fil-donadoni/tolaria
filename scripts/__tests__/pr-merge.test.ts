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
    it("pins the admitted head when merge:manual passes one (issue #6238)", () => {
        expect(mergeArgs(6218, "abc123")).toEqual([
            "pr",
            "merge",
            "6218",
            "--squash",
            "--match-head-commit",
            "abc123",
        ]);
        expect(parseArgs(["6218", "--head=abc123"]).head).toBe("abc123");
    });

    it("adds the admin bypass only when merge:manual asks (issue #6263)", () => {
        expect(mergeArgs(6259, "abc123", true)).toEqual([
            "pr",
            "merge",
            "6259",
            "--squash",
            "--match-head-commit",
            "abc123",
            "--admin",
        ]);
        expect(mergeArgs(6259)).not.toContain("--admin");
        expect(parseArgs(["6259", "--admin"]).admin).toBe(true);
        expect(parseArgs(["6259"]).admin).toBeUndefined();
    });

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

// Issue #6473. After the queue cut-over (issue #5643) `post-merge.yml` runs the
// post-merge steps for every push to the base, whoever merged. The notice
// issue #4159 added still said they "have NOT run" and sent a session to
// `land`, which `deny-guard.sh` refuses it (issue #5469).
describe("pr-merge.ts — followUpNotice", () => {
    it("names post-merge.yml as the owner of the post-merge steps and asks nothing of the reader", () => {
        const lines = followUpNotice(4153, false);
        expect(lines.length).toBeGreaterThan(0);
        const text = lines.join("\n");
        expect(text).toContain("post-merge.yml");
        expect(text).toMatch(/nothing is left to run by hand/);
        expect(text).not.toMatch(/NOT run/);
        expect(text).not.toMatch(/gate:run/);
        expect(text).not.toMatch(/\bland\b/);
    });

    it("says nothing when `land` is the caller", () => {
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

// Proof-of-failure: restored the pre-#6473 three-line `land` notice —
// "names post-merge.yml as the owner" went red. Reverted.
//
// Proof-of-failure: made `parseArgs` read `argv[argv.length - 1]` instead of
// the first positional — both `parseArgs` cases went red, because `land`
// passes `<pr> --from-land`. Reverted.
