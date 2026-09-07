import { describe, it, expect } from "vitest";
import { releaseDecision, type HealthRecord } from "../release";
import { issueWorktree } from "../wt-new";

/**
 * `bun run release` (ADR 0116) — the one decision it makes is pure: the
 * release branch moves iff the last health record is GREEN and is about the
 * exact base tip being promoted. Everything else is git plumbing.
 */
describe("release — releaseDecision", () => {
    const tip = "a".repeat(40);
    const other = "b".repeat(40);
    const green: HealthRecord = { sha: tip, status: "green" };

    it("releases a green record on the base tip", () => {
        expect(releaseDecision(tip, green)).toEqual({
            kind: "release",
            sha: tip,
        });
    });

    it("refuses when no health record exists", () => {
        const d = releaseDecision(tip, null);
        expect(d.kind).toBe("refuse");
    });

    it("refuses a green record about a DIFFERENT sha — an older tip's green is not this tip's", () => {
        const d = releaseDecision(tip, { ...green, sha: other });
        expect(d.kind).toBe("refuse");
        expect(d.kind === "refuse" && d.reason).toMatch(/not the base tip/);
    });

    it("refuses a red record and names the failed step and log", () => {
        const d = releaseDecision(tip, {
            sha: tip,
            status: "red",
            failedStep: "test",
            log: "/x/health.log",
        });
        expect(d.kind).toBe("refuse");
        expect(d.kind === "refuse" && d.reason).toMatch(/RED/);
        expect(d.kind === "refuse" && d.reason).toMatch(/failed at test/);
        expect(d.kind === "refuse" && d.reason).toMatch(/health\.log/);
    });

    it("refuses a still-running record — never races another health run", () => {
        const d = releaseDecision(tip, { sha: tip, status: "running" });
        expect(d.kind).toBe("refuse");
        expect(d.kind === "refuse" && d.reason).toMatch(/RUNNING/);
    });
});

describe("wt:new — issueWorktree", () => {
    it("derives the sibling worktree and the branch from the issue number", () => {
        expect(issueWorktree("/Users/x/tolaria", 3124, "feat")).toEqual({
            branch: "feat/issue-3124",
            worktree: "/Users/x/tolaria-issue-3124",
        });
        expect(issueWorktree("/Users/x/tolaria", 7, "fix").branch).toBe(
            "fix/issue-7"
        );
    });
});
