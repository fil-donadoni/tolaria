import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    DEFAULT_FIX_ATTEMPTS,
    loopDecision,
    parseFixBound,
    publishVerdict,
    pushRefusal,
    reconcileRecord,
    releaseDecision,
    type HealthRecord,
    type LoopInputs,
} from "../release";
import { issueWorktree } from "../lib/issue-worktree";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import {
    fileVerdictStore,
    githubVerdictStore,
    type GhRunner,
    type Verdict,
} from "../lib/health-verdict-store";

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

    it("refuses an INFRA record as unrepairable — no fixer for a tip never shown wrong (issue #4938)", () => {
        const d = releaseDecision(tip, {
            sha: tip,
            status: "infra",
            failedStep: "test",
        });
        expect(d).toEqual({
            kind: "refuse",
            reason: expect.stringMatching(/INFRA/),
            red: false,
        });
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

describe("the AFK loop repairs only through the bounded headless fixer (issue #5589)", () => {
    it("loop-drain.sh stops on a RED it may not repair, and never calls release", () => {
        // PRD issue #3197 left the overnight repair out of scope; the owner
        // authorised it in issue #5589 — ONE `health:fix --headless` per RED
        // tip, decided by `health:fix --plan`, never `release`.
        const sh = readFileSync(join(__dirname, "..", "loop-drain.sh"), "utf8");
        // Through the verdict store since issue #5462.
        expect(sh).toMatch(/health:status --json/);
        expect(sh).toMatch(/stopping rather than stacking work on a red tip/);
        expect(sh).not.toMatch(/bun run release/);
        // Every invocation (messages name `bun run health:fix` for a human,
        // the driver runs it `--silent`): the plan, then the headless fixer.
        const calls = [
            ...sh.matchAll(/bun run --silent health:fix (\S+)/g),
        ].map((m) => m[1]);
        expect(calls).toEqual(["--plan", "--headless"]);
    });
});

describe("the fix loop's dependency cannot vanish silently (PR #3209 deleted it once)", () => {
    /**
     * Issue #3199 shipped `scripts/health-fix.ts` and its test in PR #3207.
     * PR #3209 — a `convex/cards` change that touched neither — landed a
     * rebase that DELETED both, and the `package.json` entry with them. The
     * deletion was invisible: the module and the only suite that imported it
     * went together, so nothing on the base branch was left to fail. It
     * surfaced two PRs later, as `Cannot find module './health-fix'` in a
     * `land` rebase.
     *
     * The loop in `release.ts` spawns that script. This is the guard that
     * fails on the base branch the moment it goes missing again, from a suite
     * that is not the one deleted with it.
     */
    const root = join(__dirname, "..", "..");

    it("ships scripts/health-fix.ts", () => {
        expect(existsSync(join(root, "scripts", "health-fix.ts"))).toBe(true);
    });

    it("keeps the `health:fix` entry point — the manual path out of a RED marker", () => {
        const pkg = JSON.parse(
            readFileSync(join(root, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(pkg.scripts["health:fix"]).toBe("bun scripts/health-fix.ts");
    });
});

/**
 * Release through the verdict store (issue #5466): a RED written by the other
 * machine refuses here, and the release's own verdict is written back.
 */
describe("release — reconcileRecord (store vs local last.json)", () => {
    const tip = "a".repeat(40);
    const redByHuawei: Verdict = {
        sha: tip,
        status: "red",
        step: "test:bot",
        machine: "huawei",
    };

    it("a stored RED refuses even with no local record, naming step and machine", () => {
        const d = releaseDecision(tip, reconcileRecord(tip, null, redByHuawei));
        expect(d).toMatchObject({ kind: "refuse", red: true });
        expect(d.kind === "refuse" && d.reason).toMatch(
            /RED.*test:bot.*huawei/
        );
    });

    it("a stored RED beats a local running or green record about the same sha", () => {
        for (const status of ["running", "green"] as const)
            expect(
                reconcileRecord(tip, { sha: tip, status }, redByHuawei)?.status
            ).toBe("red");
    });

    it("a stored GREEN stands in for a missing local record", () => {
        const rec = reconcileRecord(tip, null, { sha: tip, status: "green" });
        expect(releaseDecision(tip, rec)).toEqual({
            kind: "release",
            sha: tip,
        });
    });

    it("a stored verdict about ANOTHER sha is not evidence", () => {
        expect(
            reconcileRecord(tip, null, { ...redByHuawei, sha: "b".repeat(40) })
        ).toBeNull();
    });
});

describe("release — publishVerdict through the file backend", () => {
    const tip = "c".repeat(40);

    it("writes RED (raises the marker) and GREEN (clears it) through the store", () => {
        const root = mkdtempSync(join(tmpdir(), "release-store-"));
        const dir = join(root, ".claude", "telemetry", "health");
        mkdirSync(dir, { recursive: true });
        const store = () => fileVerdictStore({ root });
        publishVerdict(
            store,
            { sha: tip, status: "red", failedStep: "x" },
            null
        );
        expect(existsSync(join(dir, "RED"))).toBe(true);
        publishVerdict(store, { sha: tip, status: "green" }, null);
        expect(existsSync(join(dir, "RED"))).toBe(false);
    });

    it("writes nothing for a running record or one the store already holds", () => {
        const calls: Verdict[] = [];
        const store = () =>
            ({
                write: (v: Verdict) => (calls.push(v), { written: true }),
            }) as never;
        publishVerdict(store, { sha: tip, status: "running" }, null);
        publishVerdict(
            store,
            { sha: tip, status: "green" },
            { sha: tip, status: "green" }
        );
        expect(calls).toEqual([]);
    });
});

describe("release — publishVerdict through the github backend (fake gh)", () => {
    it("POSTs the commit status for the released tip", () => {
        const tip = "d".repeat(40);
        const posts: string[][] = [];
        const run: GhRunner = (args) => {
            if (args[1] === "-X") posts.push(args);
            return { status: 0, stdout: "{}", stderr: "" };
        };
        const store = () => githubVerdictStore({ repo: "owner/tolaria", run });
        publishVerdict(store, { sha: tip, status: "green" }, null);
        expect(posts).toHaveLength(1);
        expect(posts[0]).toContain(`repos/owner/tolaria/statuses/${tip}`);
        expect(posts[0]).toContain("state=success");
        expect(posts[0].some((a) => a.startsWith("description=GREEN"))).toBe(
            true
        );
    });
});

describe("release — pushRefusal, the last word before the push (issue #5647)", () => {
    const tip = "a".repeat(40);

    it("lets a GREEN record about the sha through", () => {
        expect(pushRefusal(tip, { sha: tip, status: "green" })).toBeNull();
    });

    it.each(["red", "infra", "running"] as const)(
        "refuses a %s record — the release branch moves only to a GREEN tip",
        (status) => {
            expect(pushRefusal(tip, { sha: tip, status })).toMatch(/health is/);
        }
    );

    it("refuses a GREEN record about another sha, and no record at all", () => {
        expect(
            pushRefusal(tip, { sha: "b".repeat(40), status: "green" })
        ).toMatch(/not the base tip/);
        expect(pushRefusal(tip, null)).toMatch(/no health record/);
    });
});

describe("release.yml — dispatch under the release Environment (issue #5647)", () => {
    const yml = readFileSync(
        join(__dirname, "..", "..", ".github", "workflows", "release.yml"),
        "utf8"
    );

    it("runs only through `bun run release`, never a raw push, under the Environment", () => {
        expect(yml).toMatch(/^\s+environment: release$/m);
        expect(yml).toMatch(/bun run release --no-fix --gate-only/);
        expect(yml).not.toMatch(/git push/);
    });

    it("the push step is skipped on a dry run", () => {
        expect(yml).toMatch(
            /if: \$\{\{ !inputs\.dry_run \}\}\n\s+run: bun run release --no-fix\n/
        );
        expect(yml).toMatch(
            /if: \$\{\{ inputs\.dry_run \}\}\n\s+run: bun run release --no-fix --gate-only/
        );
    });
});
