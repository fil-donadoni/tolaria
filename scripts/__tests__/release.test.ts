import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    DEFAULT_FIX_ATTEMPTS,
    loopDecision,
    parseFixBound,
    releaseDecision,
    type HealthRecord,
    type LoopInputs,
} from "../release";
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

/**
 * The bounded fix loop (PRD issue #3197). `release` no longer ENDS on a RED
 * verdict — it hands the tip to the fixer and re-gates what comes back, up to
 * a bound. The whole branch is pure, so every path below is reached without
 * running a gate, spawning an agent, or touching a remote.
 */
describe("release — loopDecision", () => {
    const tip = "a".repeat(40);
    const next = "c".repeat(40);

    const gated = (last: HealthRecord | null): LoopInputs => ({
        tip,
        decision: releaseDecision(tip, last),
        verdict: null,
        attempt: 1,
        maxAttempts: DEFAULT_FIX_ATTEMPTS,
        interactive: true,
        fixEnabled: true,
    });
    const red: HealthRecord = {
        sha: tip,
        status: "red",
        failedStep: "test",
        log: "/x/health.log",
    };

    it("promotes on the first pass when the tip is green — nothing is spawned", () => {
        expect(loopDecision(gated({ sha: tip, status: "green" }))).toEqual({
            kind: "release",
            sha: tip,
        });
    });

    it("hands a RED tip to the fixer when there are rounds left and a terminal", () => {
        const decision = releaseDecision(tip, red);
        expect(loopDecision(gated(red))).toEqual({
            kind: "fix",
            sha: tip,
            // The handover names why this round went to the fixer.
            reason: decision.kind === "refuse" ? decision.reason : "",
        });
    });

    it("refuses without a terminal, and names the command to run by hand", () => {
        const d = loopDecision({ ...gated(red), interactive: false });
        expect(d.kind).toBe("stop");
        // The observed hole: `release` run from inside another Claude session
        // would have grilled into a pipe (issue #3187's session).
        expect(d.kind === "stop" && d.reason).toMatch(/bun run health:fix/);
        expect(d.kind === "stop" && d.reason).toMatch(/RED/);
    });

    it("refuses on the LAST round rather than starting a fix it cannot re-gate", () => {
        const d = loopDecision({
            ...gated(red),
            attempt: DEFAULT_FIX_ATTEMPTS,
        });
        expect(d.kind).toBe("stop");
        expect(d.kind === "stop" && d.reason).toMatch(
            /out of fix rounds \(3\)/
        );
    });

    it("still fixes on the round before the bound", () => {
        expect(
            loopDecision({ ...gated(red), attempt: DEFAULT_FIX_ATTEMPTS - 1 })
                .kind
        ).toBe("fix");
    });

    it("--no-fix reproduces today's refusal EXACTLY — same reason, nothing spawned", () => {
        const decision = releaseDecision(tip, red);
        const d = loopDecision({ ...gated(red), fixEnabled: false });
        expect(d).toEqual({
            kind: "stop",
            reason: decision.kind === "refuse" ? decision.reason : "",
        });
    });

    it("a refusal that is NOT a RED verdict just refuses, unchanged, even with rounds left", () => {
        // A missing record, a record about another sha, and a RUNNING one are
        // not repairable: the last would race another gate holding the sha.
        for (const last of [
            null,
            { sha: "b".repeat(40), status: "green" } as HealthRecord,
            { sha: tip, status: "running" } as HealthRecord,
        ]) {
            const decision = releaseDecision(tip, last);
            const d = loopDecision(gated(last));
            expect(d).toEqual({
                kind: "stop",
                reason: decision.kind === "refuse" ? decision.reason : "",
            });
        }
    });

    it("a landed verdict buys another round and names the PR", () => {
        const d = loopDecision({
            ...gated(red),
            verdict: {
                sha: tip,
                outcome: "landed",
                pr: 3187,
                note: "two lines",
            },
        });
        expect(d.kind).toBe("retry");
        expect(d.kind === "retry" && d.note).toMatch(/round 1/);
        expect(d.kind === "retry" && d.note).toMatch(/PR #3187/);
    });

    it("a stuck verdict ends the loop and carries the fixer's note", () => {
        const d = loopDecision({
            ...gated(red),
            verdict: {
                sha: tip,
                outcome: "stuck",
                note: "could not reproduce the red at the tip",
            },
        });
        expect(d.kind).toBe("stop");
        expect(d.kind === "stop" && d.reason).toMatch(/STUCK/);
        expect(d.kind === "stop" && d.reason).toMatch(/could not reproduce/);
    });

    it("a verdict is read BEFORE the bound and the terminal — a stuck fixer ends round 1", () => {
        // Fail-closed: nothing about a verdict that is not `landed` may leave
        // the loop able to promote. `parseVerdict` has already collapsed an
        // absent, malformed or mis-sha'd file into exactly this shape.
        const d = loopDecision({
            ...gated(red),
            interactive: false,
            attempt: 99,
            verdict: { sha: next, outcome: "stuck", note: "no verdict file" },
        });
        expect(d.kind).toBe("stop");
        expect(d.kind === "stop" && d.reason).toMatch(/STUCK/);
    });
});

describe("release — parseFixBound", () => {
    it("defaults to three rounds", () => {
        expect(parseFixBound(["bun", "release"])).toEqual({
            max: DEFAULT_FIX_ATTEMPTS,
        });
    });

    it("--max-fix-attempts=N moves the bound", () => {
        expect(parseFixBound(["--max-fix-attempts=5"])).toEqual({ max: 5 });
        expect(parseFixBound(["--max-fix-attempts=2"])).toEqual({ max: 2 });
    });

    it("refuses a bound of one, which would be --no-fix under a name promising the opposite", () => {
        // A round is a gate plus at most one fix, and a fix is only worth
        // starting when a later round can re-gate what it landed.
        const d = parseFixBound(["--max-fix-attempts=1"]);
        expect(d).toHaveProperty("error");
        expect("error" in d && d.error).toMatch(/--no-fix/);
    });

    it("refuses a garbage bound rather than silently defaulting", () => {
        // A typo that fell back to three would run two more gates than the
        // maintainer asked for, silently.
        for (const bad of ["0", "-1", "2.5", "many", ""]) {
            expect(parseFixBound([`--max-fix-attempts=${bad}`])).toHaveProperty(
                "error"
            );
        }
    });
});

describe("the AFK loop is NOT authorised to fix (PRD issue #3197, out of scope)", () => {
    it("loop-drain.sh still stops on the RED marker and never calls release", () => {
        // Authorising an agent to repair the base branch overnight, with no one
        // to grill, is a separate decision. The TTY rule would refuse it
        // anyway — this guards the layer above it.
        const sh = readFileSync(join(__dirname, "..", "loop-drain.sh"), "utf8");
        expect(sh).toMatch(/HEALTH_RED_FILE/);
        expect(sh).toMatch(/stopping rather than stacking work on a red tip/);
        expect(sh).not.toMatch(/bun run release/);
        expect(sh).not.toMatch(/health:fix/);
    });
});
