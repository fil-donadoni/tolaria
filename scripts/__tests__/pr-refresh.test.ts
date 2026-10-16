import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_BRANCH } from "../lib/branches";
import {
    conflictComment,
    parseConflictPaths,
    selectRefreshCandidates,
    type RefreshPr,
} from "../lib/pr-refresh";
import { refreshPr } from "../pr-refresh";

const pr = (over: Partial<RefreshPr>): RefreshPr => ({
    number: 1,
    headRefName: "feat/issue-1",
    headRefOid: "a".repeat(40),
    mergeable: "MERGEABLE",
    isCrossRepository: false,
    labels: ["ready-to-land"],
    files: ["a.ts"],
    ...over,
});

describe("selectRefreshCandidates", () => {
    it("takes a CONFLICTING queued PR whatever the push touched", () => {
        const got = selectRefreshCandidates(
            [pr({ mergeable: "CONFLICTING" })],
            new Set()
        );
        expect(got.map((c) => [c.pr.number, c.reason])).toEqual([
            [1, "conflicting"],
        ]);
    });

    it("takes a PR whose files the base push touched, with the overlap", () => {
        const got = selectRefreshCandidates(
            [pr({ files: ["a.ts", "b.ts"] })],
            new Set(["b.ts", "c.ts"])
        );
        expect(got).toHaveLength(1);
        expect(got[0].reason).toBe("base-touched");
        expect(got[0].overlap).toEqual(["b.ts"]);
    });

    it("leaves a clean, untouched PR alone", () => {
        expect(selectRefreshCandidates([pr({})], new Set(["z.ts"]))).toEqual(
            []
        );
    });

    it("with an unknown push range, only CONFLICTING qualifies", () => {
        const got = selectRefreshCandidates(
            [pr({ number: 1 }), pr({ number: 2, mergeable: "CONFLICTING" })],
            null
        );
        expect(got.map((c) => c.pr.number)).toEqual([2]);
    });

    it("never takes a fork, an unqueued PR or a land-failed one", () => {
        const conflicting = { mergeable: "CONFLICTING" };
        expect(
            selectRefreshCandidates(
                [
                    pr({ ...conflicting, isCrossRepository: true }),
                    pr({ ...conflicting, labels: [] }),
                    pr({
                        ...conflicting,
                        labels: ["ready-to-land", "land-failed"],
                    }),
                ],
                new Set()
            )
        ).toEqual([]);
    });
});

describe("parseConflictPaths", () => {
    it("drops git's rebase chatter and keeps the paths", () => {
        expect(
            parseConflictPaths(
                [
                    "Auto-merging scripts/x.ts",
                    "CONFLICT (content): Merge conflict in scripts/x.ts",
                    "error: could not apply abc123... msg",
                    "hint: Resolve all conflicts manually",
                    "scripts/x.ts",
                    "scripts/y.ts",
                    "scripts/x.ts",
                    "",
                ].join("\n")
            )
        ).toEqual(["scripts/x.ts", "scripts/y.ts"]);
    });

    it("is empty when nothing conflicted", () => {
        expect(parseConflictPaths("")).toEqual([]);
    });
});

describe("conflictComment", () => {
    it("lists every path and says whether a pass is handed the repair", () => {
        const body = conflictComment({
            paths: ["a.ts", "b.ts"],
            base: "staging",
            repairable: true,
        });
        expect(body).toContain("- `a.ts`");
        expect(body).toContain("- `b.ts`");
        expect(body).toContain("repair pick");
        expect(
            conflictComment({
                paths: ["a.ts"],
                base: "staging",
                repairable: false,
            })
        ).toContain("a human repairs it");
    });
});

describe("refreshPr — real git, a bare origin", () => {
    let dir: string;
    let origin: string;
    let primary: string;

    function git(args: string[], cwd: string): string {
        const r = spawnSync("git", args, { cwd, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        }
        return r.stdout.trim();
    }
    function commit(file: string, text: string, msg: string): void {
        writeFileSync(join(primary, file), text);
        git(["add", file], primary);
        git(["commit", "-m", msg], primary);
    }
    /** A PR branch off the current base tip, pushed; the base then moves on. */
    function queuedBranch(file: string): string {
        git(["checkout", "-b", "feat/issue-9"], primary);
        commit(file, "pr change\n", "pr edit");
        git(["push", "origin", "feat/issue-9"], primary);
        const oid = git(["rev-parse", "HEAD"], primary);
        git(["checkout", BASE_BRANCH], primary);
        return oid;
    }
    function baseMoves(file: string): void {
        commit(file, "base change\n", "base edit");
        git(["push", "origin", BASE_BRANCH], primary);
    }
    const deps = { prepare: () => true, push: true };

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-pr-refresh-test-"));
        origin = join(dir, "origin.git");
        primary = join(dir, "primary");
        git(["init", "--bare", "-b", BASE_BRANCH, origin], dir);
        git(["clone", origin, primary], dir);
        git(["config", "user.email", "test@example.com"], primary);
        git(["config", "user.name", "Test"], primary);
        commit("shared.txt", "base\n", "base");
        git(["push", "origin", BASE_BRANCH], primary);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    });

    it("rebases a PR the base moved under and pushes it", () => {
        const oid = queuedBranch("pr.txt");
        baseMoves("other.txt");
        const out = refreshPr(
            primary,
            { headRefName: "feat/issue-9", headRefOid: oid },
            deps
        );
        expect(out.kind).toBe("pushed");
        const pushed = git(["rev-parse", "feat/issue-9"], origin);
        expect(pushed).not.toBe(oid);
        // The new head carries the base's commit under the PR's.
        expect(git(["log", "--format=%s", "feat/issue-9"], origin)).toContain(
            "base edit"
        );
        // The primary's own checkout was never touched.
        expect(git(["rev-parse", "--abbrev-ref", "HEAD"], primary)).toBe(
            BASE_BRANCH
        );
    });

    it("reports the conflicting paths and pushes nothing", () => {
        const oid = queuedBranch("shared.txt");
        baseMoves("shared.txt");
        const out = refreshPr(
            primary,
            { headRefName: "feat/issue-9", headRefOid: oid },
            deps
        );
        expect(out).toEqual({ kind: "conflict", paths: ["shared.txt"] });
        expect(git(["rev-parse", "feat/issue-9"], origin)).toBe(oid);
    });

    it("leaves a PR whose head moved since it was read", () => {
        const oid = queuedBranch("pr.txt");
        const out = refreshPr(
            primary,
            { headRefName: "feat/issue-9", headRefOid: "b".repeat(40) },
            deps
        );
        expect(out.kind).toBe("skipped");
        expect(git(["rev-parse", "feat/issue-9"], origin)).toBe(oid);
    });

    it("pushes nothing when the PR already sits on the base tip", () => {
        const oid = queuedBranch("pr.txt");
        const out = refreshPr(
            primary,
            { headRefName: "feat/issue-9", headRefOid: oid },
            deps
        );
        expect(out.kind).toBe("unchanged");
    });

    it("a dry run rebases but does not push", () => {
        const oid = queuedBranch("pr.txt");
        baseMoves("other.txt");
        const out = refreshPr(
            primary,
            { headRefName: "feat/issue-9", headRefOid: oid },
            { ...deps, push: false }
        );
        expect(out.kind).toBe("pushed");
        expect(git(["rev-parse", "feat/issue-9"], origin)).toBe(oid);
    });
});
