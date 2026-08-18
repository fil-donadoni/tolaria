import { describe, it, expect } from "vitest";
import { classify, parseWorktreeList } from "../worktree-gc";

/**
 * Worktree GC. The decision is destructive and the asymmetry is total: keeping
 * a finished worktree costs disk and a false collision; removing an unfinished
 * one costs the work. So every "keep" reason is asserted individually — a
 * classifier that had drifted to "remove everything clean" would still satisfy
 * a test that only checked the happy path.
 */

const base = {
    path: "/repo-issue-1851",
    branch: "fix/issue-1851",
    dirty: false,
    unmerged: 0,
    locked: false,
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
        expect(v.reason).toMatch(/not in origin\/main/);
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
