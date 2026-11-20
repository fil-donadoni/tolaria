// The robustness audit's plan for a PR (issue #9361): the health trigger read
// on the PR's own change — `<base>...<head>` (issue #10319), the merge ref's
// first-parent diff only as the by-hand fallback. Each case builds a
// throwaway repo.
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
    outputLines,
    planForMergeRef,
    planForPullRequest,
} from "../blade-robustness-plan";

const dirs: string[] = [];
afterAll(() =>
    dirs.forEach((d) =>
        rmSync(d, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    )
);

function git(root: string, ...args: string[]): void {
    execFileSync(
        "git",
        ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
        {
            cwd: root,
            stdio: "ignore",
        }
    );
}

function revParse(root: string, rev: string): string {
    return execFileSync("git", ["rev-parse", rev], {
        cwd: root,
        encoding: "utf8",
    }).trim();
}

function commitFiles(
    root: string,
    message: string,
    files: Record<string, string>
): string {
    for (const [p, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, p)), { recursive: true });
        writeFileSync(join(root, p), body);
    }
    git(root, "add", "-A");
    git(root, "commit", "-q", "--allow-empty", "-m", message);
    return revParse(root, "HEAD");
}

/**
 * PR #10295's shape: the base gains a closure file AFTER `stale`, the PR
 * branches from that newer base and changes one non-Bot file; `staging`
 * (the base branch) then moves on with another closure file. `mergeRef` is
 * the PR merged into the STALE base tip — the ref GitHub handed out.
 */
function staleMergeRefRepo(): {
    root: string;
    head: string;
    mergeRef: string;
} {
    const root = mkdtempSync(join(tmpdir(), "robustness-plan-"));
    dirs.push(root);
    git(root, "init", "-q", "-b", "staging");
    const stale = commitFiles(root, "stale base", { "README.md": "x" });
    commitFiles(root, "base: Bot change", {
        "convex/gre/ai/evalWeights.ts": "export {}",
    });
    git(root, "checkout", "-q", "-b", "pr");
    const head = commitFiles(root, "pr: ui only", { "src/hand.tsx": "x" });
    git(root, "checkout", "-q", "staging");
    commitFiles(root, "base: later Bot change", {
        "convex/gre/ai/evalWeights.ts": "export const w = 1",
    });
    git(root, "checkout", "-q", "--detach", stale);
    git(root, "-c", "core.editor=true", "merge", "-q", "--no-ff", head);
    return { root, head, mergeRef: revParse(root, "HEAD") };
}

function repoWith(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "robustness-plan-"));
    dirs.push(root);
    git(root, "init", "-q");
    git(root, "commit", "-q", "--allow-empty", "-m", "base");
    for (const [p, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, p)), { recursive: true });
        writeFileSync(join(root, p), body);
    }
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "pr");
    return root;
}

describe("planForMergeRef (issue #9361)", () => {
    it("a diff touching no Bot-glob file owes nothing", () => {
        const root = repoWith({ "tools/unrelated.txt": "x" });
        expect(planForMergeRef(root).kind).toBe("none");
    });

    it("a changed file in the audit's closure is FULL", () => {
        const root = repoWith({ "convex/gre/ai/evalWeights.ts": "export {}" });
        expect(planForMergeRef(root).kind).toBe("full");
    });

    it("a root commit has no first parent: undecidable is FULL", () => {
        const root = mkdtempSync(join(tmpdir(), "robustness-plan-"));
        dirs.push(root);
        git(root, "init", "-q");
        git(root, "commit", "-q", "--allow-empty", "-m", "only");
        expect(planForMergeRef(root).kind).toBe("full");
    });
});

describe("planForPullRequest (issue #10319)", () => {
    it("reproduces PR #10295: the stale merge ref reads FULL on base files", () => {
        const { root } = staleMergeRefRepo();
        const mode = planForMergeRef(root);
        expect(mode.kind).toBe("full");
        expect(mode.reason).toContain("convex/gre/ai/evalWeights.ts");
    });

    it("the PR's own change has no Bot-glob file: NONE, base moves ignored", () => {
        const { root, head } = staleMergeRefRepo();
        expect(planForPullRequest(root, "staging", head)).toEqual({
            kind: "none",
            reason: "no Bot-glob file changed",
        });
    });

    it("a PR changing a closure file is FULL", () => {
        const { root } = staleMergeRefRepo();
        git(root, "checkout", "-q", "pr");
        const head = commitFiles(root, "pr: bot", {
            "convex/gre/ai/evalWeights.ts": "export const w = 2",
        });
        expect(planForPullRequest(root, "staging", head).kind).toBe("full");
    });

    it("an unreadable head is FULL", () => {
        const { root } = staleMergeRefRepo();
        expect(planForPullRequest(root, "staging", "0".repeat(40)).kind).toBe(
            "full"
        );
    });
});

describe("outputLines", () => {
    it("none: empty labels", () => {
        expect(outputLines({ kind: "none", reason: "a  b" })).toEqual([
            "mode=none",
            "labels=",
            "reason=a b",
        ]);
    });

    it("incremental: the labels as a JSON array", () => {
        expect(
            outputLines({ kind: "incremental", reason: "r", labels: ["x"] })
        ).toContain('labels=["x"]');
    });
});
