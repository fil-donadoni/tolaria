// The robustness audit's plan for a PR (issue #9361): the health trigger read
// on the merge ref's first-parent diff. Each case builds a throwaway repo.
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { outputLines, planForMergeRef } from "../blade-robustness-plan";

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
