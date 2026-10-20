import { describe, it, expect } from "vitest";
import {
    classify,
    ORPHAN_IDLE_MINUTES,
    parseWorktreeList,
    type WorktreeFacts,
} from "../worktree-gc";
import { ORIGIN_BASE } from "../lib/branches";

/**
 * Worktree GC. The decision is destructive and the asymmetry is total: keeping
 * a finished worktree costs disk and a false collision; removing an unfinished
 * one costs the work. So every "keep" reason is asserted individually — a
 * classifier that had drifted to "remove everything clean" would still satisfy
 * a test that only checked the happy path.
 */

/** A hand-made branch: the ancestry rules, not the issue-worktree ones. */
const base: WorktreeFacts = {
    path: "/repo-wip",
    branch: "wip/refactor",
    dirty: false,
    unmerged: 0,
    locked: false,
    inUse: false,
    unpushed: 0,
};

/** An issue worktree with no PR, no claim, idle, everything pushed — the
 *  one shape the orphan sweep removes without a PR verdict (issue #6083). */
const orphan: WorktreeFacts = {
    path: "/repo-issue-5509",
    branch: "fix/issue-5509",
    dirty: false,
    unmerged: 2,
    locked: false,
    inUse: false,
    unpushed: 0,
    liveClaim: false,
    idleMinutes: ORPHAN_IDLE_MINUTES + 1,
};

describe("worktree-gc — classify", () => {
    it("removes a clean worktree whose branch is already in origin/main", () => {
        expect(classify(base).action).toBe("remove");
    });

    it("keeps anything with uncommitted work", () => {
        const v = classify({ ...base, dirty: true });
        expect(v.action).toBe("keep");
        expect(v.reason).toMatch(/uncommitted/);
    });

    it("keeps a branch carrying commits origin/main does not have", () => {
        const v = classify({ ...base, unmerged: 3 });
        expect(v.action).toBe("keep");
        expect(v.reason).toContain(`not in ${ORIGIN_BASE}`);
    });

    it("removes a branch whose PR MERGED, even though ancestry still calls it unmerged", () => {
        // Every PR here lands as a SQUASH, so the branch's own commit is never
        // an ancestor of main and `rev-list origin/main..HEAD` reads 1 forever.
        // The first version of this tool therefore kept 26 of 36 worktrees,
        // every one of them freshly merged.
        const v = classify({ ...base, unmerged: 1, mergedPr: true });
        expect(v.action).toBe("remove");
        expect(v.reason).toMatch(/PR merged/);
    });

    it("keeps a branch whose PR is still OPEN, merged-looking ancestry or not", () => {
        expect(classify({ ...base, unmerged: 0, openPr: true }).action).toBe(
            "keep"
        );
        expect(
            classify({ ...base, unmerged: 1, openPr: true, mergedPr: true })
                .action
        ).toBe("keep");
    });

    it("still keeps a branch with no PR at all and commits of its own", () => {
        // The PR verdict is an ADDITIONAL way to be finished, never a
        // replacement for the ancestry check: a branch nobody opened a PR for
        // is exactly the work this tool must not throw away.
        expect(classify({ ...base, unmerged: 2 }).action).toBe("keep");
    });

    it("keeps dirty work even when the PR merged", () => {
        expect(classify({ ...base, dirty: true, mergedPr: true }).action).toBe(
            "keep"
        );
    });

    it("keeps a locked worktree", () => {
        expect(classify({ ...base, locked: true }).action).toBe("keep");
    });

    it("keeps dirty-AND-unmerged (no rule cancels another)", () => {
        expect(classify({ ...base, dirty: true, unmerged: 5 }).action).toBe(
            "keep"
        );
    });

    it("removes a detached worktree only when it has nothing unmerged", () => {
        expect(classify({ ...base, branch: null }).action).toBe("remove");
        expect(classify({ ...base, branch: null, unmerged: 1 }).action).toBe(
            "keep"
        );
    });
});

describe("worktree-gc — classify, issue worktrees no merge cleans up (issue #6083)", () => {
    it("removes a merged PR's worktree", () => {
        expect(classify({ ...orphan, mergedPr: true, unpushed: 3 })).toEqual({
            action: "remove",
            reason: "PR merged",
        });
    });

    it("keeps a merged branch's worktree while its issue is claimed again (a reopened issue resumed on it)", () => {
        // `sync` removes a merged PR's worktree at merge, before any claim;
        // the sweep meets a claim on a merged branch only when a session took
        // the issue up again.
        expect(
            classify({ ...orphan, mergedPr: true, liveClaim: true })
        ).toEqual({ action: "keep", reason: "issue claimed (in-progress)" });
    });

    it("removes a closed-unmerged PR's worktree when clean and fully pushed, idle or not", () => {
        expect(classify({ ...orphan, closedPr: true, idleMinutes: 1 })).toEqual(
            {
                action: "remove",
                reason: "PR closed unmerged, every commit pushed",
            }
        );
    });

    it("keeps a closed-unmerged PR's worktree holding a local-only commit", () => {
        const v = classify({ ...orphan, closedPr: true, unpushed: 1 });
        expect(v.action).toBe("keep");
        expect(v.reason).toMatch(/only on this disk/);
    });

    it("keeps an unpushed-count it could not read", () => {
        expect(
            classify({ ...orphan, closedPr: true, unpushed: null }).action
        ).toBe("keep");
    });

    it("keeps a no-PR worktree whose issue carries a live claim", () => {
        const v = classify({ ...orphan, liveClaim: true });
        expect(v).toEqual({
            action: "keep",
            reason: "issue claimed (in-progress)",
        });
        expect(
            classify({ ...orphan, liveClaim: true, closedPr: true }).action
        ).toBe("keep");
        expect(classify({ ...orphan, liveClaim: null }).action).toBe("keep");
    });

    it("removes a no-PR, no-claim worktree idle past the threshold, clean and pushed", () => {
        const v = classify(orphan);
        expect(v.action).toBe("remove");
        expect(v.reason).toMatch(/^no PR, no claim, idle/);
    });

    it("keeps a no-PR worktree changed within the threshold, or of unknown age", () => {
        expect(
            classify({ ...orphan, idleMinutes: ORPHAN_IDLE_MINUTES - 1 }).action
        ).toBe("keep");
        expect(classify({ ...orphan, idleMinutes: null }).action).toBe("keep");
        expect(classify({ ...orphan, idleMinutes: undefined }).action).toBe(
            "keep"
        );
    });

    it("keeps a fresh no-PR worktree with no commits until it is idle (a pass between claim and first commit)", () => {
        expect(
            classify({ ...orphan, unmerged: 0, idleMinutes: 5 }).action
        ).toBe("keep");
    });

    it("keeps a dirty, locked, or in-use worktree whatever its PR says", () => {
        for (const pr of [{}, { closedPr: true }, { mergedPr: true }]) {
            expect(classify({ ...orphan, ...pr, dirty: true }).action).toBe(
                "keep"
            );
            expect(classify({ ...orphan, ...pr, locked: true }).action).toBe(
                "keep"
            );
            expect(classify({ ...orphan, ...pr, inUse: true }).action).toBe(
                "keep"
            );
            expect(classify({ ...orphan, ...pr, inUse: null }).action).toBe(
                "keep"
            );
        }
    });
});

describe("worktree-gc — parseWorktreeList", () => {
    it("reads paths, branches and locks out of git's porcelain", () => {
        const porcelain = [
            "worktree /Users/x/tolaria",
            "HEAD abc",
            "branch refs/heads/main",
            "",
            "worktree /Users/x/tolaria-gate",
            "HEAD def",
            "detached",
            "",
            "worktree /Users/x/tolaria-issue-1851",
            "HEAD 123",
            "branch refs/heads/fix/issue-1851",
            "locked",
            "",
        ].join("\n");

        expect(parseWorktreeList(porcelain)).toEqual([
            {
                path: "/Users/x/tolaria",
                branch: "main",
                locked: false,
            },
            {
                path: "/Users/x/tolaria-gate",
                branch: null,
                locked: false,
            },
            {
                path: "/Users/x/tolaria-issue-1851",
                branch: "fix/issue-1851",
                locked: true,
            },
        ]);
    });
});
