import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    issuesToReopen,
    reopenComment,
    revertPrBody,
} from "../lib/health-ladder";
import { planRevertSet } from "../lib/health-revert-set";
import { revertedCommitsOf } from "../lib/ui-scope";
import { landingRestoresParent } from "../ui-gate/verify-receipt";

/**
 * The revert set of a culprit later commits depend on (issue #6766), on a
 * real git repository: the culprit is reverted together with the later
 * commits its revert conflicts with, in one worktree, and every reverted
 * PR's issue reopens; past the cap, the plan names every commit it needs.
 */
let repo: string;

function git(...args: string[]): string {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

/** Commit `files` with `subject`; returns the full sha. */
function commit(subject: string, files: Record<string, string>): string {
    for (const [path, text] of Object.entries(files))
        writeFileSync(join(repo, path), text);
    git("add", "-A");
    git("commit", "-q", "-m", subject);
    return git("rev-parse", "HEAD");
}

const read = (path: string) => readFileSync(join(repo, path), "utf8");

beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "revert-set-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(repo, "src", "ui"), { recursive: true });
    commit("base", { "a.txt": "1\n2\n3\n", "b.txt": "x\n" });
});

afterEach(() => {
    rmSync(repo, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
});

function plan(culprit: string, cap?: number) {
    const base = git("rev-parse", "HEAD");
    git("checkout", "-q", "--detach", base);
    return planRevertSet({ wt: repo, culprit, base, cap });
}

describe("planRevertSet — the culprit and the later commits it needs (issue #6766)", () => {
    it("a culprit nothing depends on is reverted alone", () => {
        const culprit = commit("feat: two (#100)", { "a.txt": "1\ntwo\n3\n" });
        commit("unrelated (#101)", { "b.txt": "y\n" });
        const p = plan(culprit);
        expect(p.kind).toBe("applies");
        expect(p.set.map((c) => c.pr)).toEqual([100]);
        expect(read("a.txt")).toBe("1\n2\n3\n");
        expect(read("b.txt")).toBe("y\n");
    });

    it("a culprit with a dependent PR on top is reverted together with it, and both issues reopen", () => {
        const culprit = commit("feat: two (#100)", { "a.txt": "1\ntwo\n3\n" });
        commit("unrelated (#101)", { "b.txt": "y\n" });
        commit("dep: two! (#102)", { "a.txt": "1\ntwo!\n3\n" });
        // Alone, the culprit's revert conflicts: the dependent is on top.
        const base = git("rev-parse", "HEAD");
        expect(
            spawnSync("git", ["revert", "--no-edit", culprit], { cwd: repo })
                .status
        ).not.toBe(0);
        git("revert", "--abort");
        git("reset", "--hard", "-q", base);

        const p = plan(culprit);
        expect(p.kind).toBe("applies");
        // Newest first, the culprit last; the unrelated PR stays.
        expect(p.set.map((c) => c.pr)).toEqual([102, 100]);
        expect(read("a.txt")).toBe("1\n2\n3\n");
        expect(read("b.txt")).toBe("y\n");
        expect(git("rev-list", "--count", `${base}..HEAD`)).toBe("2");

        const [dependent, culpritCommit] = p.set;
        const closes: Record<number, number[]> = { 100: [10], 102: [12] };
        const reopening = issuesToReopen(culpritCommit, [dependent], (pr) =>
            pr === null ? [] : (closes[pr] ?? [])
        );
        expect(reopening).toEqual([
            { n: 10 },
            { n: 12, dependent: { sha: dependent.sha, pr: 102 } },
        ]);
        const comment = reopenComment({
            red: "a".repeat(40),
            culprit: culpritCommit,
            revertPr: 7000,
            evidence: null,
            dependent: reopening[1].dependent,
        });
        expect(comment).toContain("PR #102 depends on PR #100");
        expect(comment).toContain("PR #7000 reverts both");
    });

    it("`land`'s revert line holds for a set: each DOM path back at the parent of the oldest reverted commit touching it", () => {
        const before = {
            "src/ui/Panel.tsx": "export const a = 1;\n",
            "src/ui/Other.tsx": "export const b = 1;\n",
        };
        commit("ui files", before);
        const culprit = commit("feat: panel (#100)", {
            "src/ui/Panel.tsx": "export const a = 2;\n",
        });
        commit("dep: panel and other (#102)", {
            "src/ui/Panel.tsx": "export const a = 3;\n",
            "src/ui/Other.tsx": "export const b = 3;\n",
        });
        const base = git("rev-parse", "HEAD");
        const p = plan(culprit);
        expect(p.kind).toBe("applies");
        const changed = git("diff", "--name-only", base, "HEAD").split("\n");
        expect(changed.sort()).toEqual(Object.keys(before).sort());

        const body = revertPrBody({
            issue: 6001,
            red: "a".repeat(40),
            culprit: p.set[1],
            revertedSha: p.set[1].full,
            culpritIssues: [],
            dependents: [p.set[0]],
        });
        const reverted = revertedCommitsOf(body);
        expect(reverted).toEqual([p.set[0].full, p.set[1].full]);
        expect(landingRestoresParent(reverted, changed, repo)).toBe(true);
        // The culprit alone does not account for the dependent's own path.
        expect(landingRestoresParent(culprit, changed, repo)).toBe(false);
    });

    it("a hot file pulls in only the dependent, never every later commit touching it", () => {
        const lines = (two: string, nine: string) =>
            ["1", two, "3", "4", "5", "6", "7", "8", nine, "10", ""].join("\n");
        commit("ten lines", { "a.txt": lines("2", "9") });
        const culprit = commit("feat: two (#100)", {
            "a.txt": lines("two", "9"),
        });
        commit("dep: two! (#101)", { "a.txt": lines("two!", "9") });
        commit("far edit (#102)", { "a.txt": lines("two!", "nine") });
        commit("far edit again (#103)", { "a.txt": lines("two!", "NINE") });
        const p = plan(culprit, 3);
        expect(p.kind).toBe("applies");
        expect(p.set.map((c) => c.pr)).toEqual([101, 100]);
        expect(read("a.txt")).toBe(lines("2", "NINE"));
    });

    it("a set past the cap is not made: the plan names every commit it needs", () => {
        const culprit = commit("feat: two (#100)", { "a.txt": "1\ntwo\n3\n" });
        commit("dep 1 (#101)", { "a.txt": "1\ntwo1\n3\n" });
        commit("dep 2 (#102)", { "a.txt": "1\ntwo2\n3\n" });
        commit("dep 3", { "a.txt": "1\ntwo3\n3\n" });
        const p = plan(culprit, 3);
        expect(p.kind).toBe("cap");
        expect(p.set.map((c) => c.pr)).toEqual([null, 102, 101, 100]);
        expect(p.set[0].sha).toHaveLength(12);
    });
});
