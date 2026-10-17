import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    baseStepName,
    bisectFirstRed,
    bisectWorktreePid,
    LADDER_MARK,
    laddered,
    remainingGates,
    culpritLine,
    flakeVerdict,
    flakyIssueTitle,
    flakySubjects,
    freshRunPlan,
    lastGreenOf,
    prOfSubject,
    vitestCommands,
    type ProbeOutcome,
} from "../lib/health-bisect";
import {
    buildEvidence,
    evidenceFiles,
    evidenceSummary,
    withEvidenceLine,
} from "../lib/health-evidence";
import { HEALTH_SCRIPTS, splitHealthGates } from "../lib/health-step";
import type { Verdict } from "../lib/health-verdict-store";

/**
 * The RED ladder (issue #5645): a fresh run of a RED, the GREEN a flake
 * closes it with, and the bisect that names the culprit PR.
 */

const RED: Verdict = {
    sha: "a".repeat(40),
    status: "red",
    step: "test (retry: node-engine, assertion)",
    tests: ["convex/gre/__tests__/cut.test.ts"],
};

describe("freshRunPlan — what a RED re-runs", () => {
    it("re-runs the files the evidence names, over the verdict's cut list", () => {
        const plan = freshRunPlan(
            RED,
            ["a.test.ts", "b.test.ts"],
            HEALTH_SCRIPTS
        );
        expect(plan).toEqual({
            kind: "tests",
            step: "test",
            files: ["a.test.ts", "b.test.ts"],
        });
    });
    it("falls back to the verdict's tests when no evidence was published", () => {
        expect(freshRunPlan(RED, [], HEALTH_SCRIPTS)).toEqual({
            kind: "tests",
            step: "test",
            files: ["convex/gre/__tests__/cut.test.ts"],
        });
    });
    it("re-runs the failed step when the RED names no file", () => {
        const plan = freshRunPlan(
            { status: "red", step: "check:all" },
            [],
            HEALTH_SCRIPTS
        );
        expect(plan).toEqual({ kind: "step", step: "check:all" });
    });
    it("has nothing to re-run for a RED naming neither — it stands", () => {
        expect(
            freshRunPlan(
                { status: "red", step: "preflight:odd" },
                [],
                HEALTH_SCRIPTS
            ).kind
        ).toBe("none");
    });
    it("re-runs nothing that is not a RED", () => {
        expect(
            freshRunPlan(
                { ...RED, status: "green" },
                ["a.test.ts"],
                HEALTH_SCRIPTS
            ).kind
        ).toBe("none");
        expect(freshRunPlan(null, [], HEALTH_SCRIPTS).kind).toBe("none");
    });
    it("strips a retry note off the step", () => {
        expect(baseStepName("test (retry: bot-node, timeout)")).toBe("test");
        expect(baseStepName("check:all")).toBe("check:all");
        expect(baseStepName(undefined)).toBeUndefined();
    });
});

describe("vitestCommands — the blade's specs under their own config", () => {
    it("splits the blade's specs from the default projects", () => {
        expect(
            vitestCommands([
                "scripts/__tests__/x.test.ts",
                "convex/gre/ai/blade/__tests__/must.spec.ts",
            ])
        ).toEqual([
            { args: ["vitest", "run", "scripts/__tests__/x.test.ts"], env: {} },
            {
                args: [
                    "vitest",
                    "run",
                    "--config",
                    "vitest.blade.config.ts",
                    "convex/gre/ai/blade/__tests__/must.spec.ts",
                ],
                env: { BLADE_TIER: "must" },
            },
        ]);
    });
});

describe("a RED that does not reproduce closes as GREEN and files the flake", () => {
    it("writes a GREEN on the RED's sha, naming the flake", () => {
        const plan = {
            kind: "tests" as const,
            step: "test",
            files: ["a.test.ts"],
        };
        const v = flakeVerdict({
            sha: RED.sha,
            plan,
            machine: "huawei",
            at: "2026-10-17T00:00:00Z",
        });
        expect(v.status).toBe("green");
        expect(v.sha).toBe(RED.sha);
        expect(v.step).toBe("flake: test passed on a fresh run");
    });
    it("files one issue per flaky file, titled by the file (the dedup key)", () => {
        const plan = {
            kind: "tests" as const,
            step: "test",
            files: ["a.test.ts", "b.test.ts"],
        };
        expect(
            flakySubjects(plan).map((s) => flakyIssueTitle(plan, s))
        ).toEqual(["Flaky test: a.test.ts", "Flaky test: b.test.ts"]);
        const step = { kind: "step" as const, step: "check:all" };
        expect(
            flakySubjects(step).map((s) => flakyIssueTitle(step, s))
        ).toEqual(["Flaky health step: check:all"]);
    });
});

describe("bisectFirstRed — the first red commit after the last GREEN", () => {
    const commits = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];
    const redFrom =
        (i: number) =>
        (sha: string): ProbeOutcome =>
            commits.indexOf(sha) >= i ? "red" : "green";

    it.each([0, 1, 3, 6])("names commit %i when it broke the test", (i) => {
        const r = bisectFirstRed(commits, redFrom(i));
        expect(r.culprit).toBe(commits[i]);
        expect(r.probes.length).toBeLessThanOrEqual(3);
    });
    it("names no culprit when a probe could not run", () => {
        const r = bisectFirstRed(commits, () => "infra");
        expect(r.culprit).toBeNull();
        expect(r.reason).toMatch(/could not run/);
    });
    it("names no culprit over an empty range", () => {
        expect(bisectFirstRed([], () => "red").culprit).toBeNull();
    });
    it("takes the newest GREEN ancestor as the range's start", () => {
        const store: Record<string, Verdict> = {
            p2: { sha: "p2", status: "infra" },
            p3: { sha: "p3", status: "green" },
            p5: { sha: "p5", status: "green" },
        };
        expect(
            lastGreenOf(["p1", "p2", "p3", "p4", "p5"], (s) => store[s] ?? null)
        ).toBe("p3");
        expect(lastGreenOf(["p1"], () => null)).toBeNull();
    });
});

describe("the culprit in the evidence", () => {
    it("reads the PR off a squash-merge subject", () => {
        expect(
            prOfSubject("health.yml with a bisect (issue #5645) (#5701)")
        ).toBe(5701);
        expect(prOfSubject("a direct commit")).toBeNull();
    });
    it("rides in the evidence's header, where health:status prints it", () => {
        const ev = buildEvidence({
            sha: RED.sha,
            step: "test",
            machine: "huawei",
            logPath: "/tmp/x.log",
            output: " FAIL  |node-engine| convex/gre/__tests__/cut.test.ts > cuts\n",
            status: 1,
            signal: null,
            at: "2026-10-17T00:00:00Z",
        });
        expect(evidenceFiles(ev.body)).toEqual([
            "convex/gre/__tests__/cut.test.ts",
        ]);
        const line = culpritLine({
            result: {
                culprit: "b".repeat(40),
                probes: [{ sha: "b".repeat(40), outcome: "red" }],
            },
            good: "c".repeat(40),
            commits: 3,
            subject: "break the cut (#5700)",
        });
        expect(line).toMatch(/^- \*\*culprit:\*\* PR #5700 · `bbbbbbbbbbbb`/);
        const body = withEvidenceLine(ev.body, line);
        expect(evidenceSummary(body)).toContain(line);
        expect(withEvidenceLine(body, line)).toBe(body);
    });
});

/** The seeded broken commit: a real repository, one commit that breaks the
 *  "test" (`check.sh` exits 1), probed at each commit the way the bisect
 *  probes — the files at that commit, run. */
describe("the bisect on a seeded broken commit", () => {
    let dir: string | null = null;
    afterEach(() => {
        if (dir)
            rmSync(dir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
        dir = null;
    });

    function git(args: string[]): string {
        const r = spawnSync("git", args, { cwd: dir!, encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr);
        return r.stdout.trim();
    }

    it("names the PR whose commit broke the test", () => {
        dir = mkdtempSync(join(tmpdir(), "health-bisect-"));
        git(["init", "-q", "-b", "main"]);
        git(["config", "user.email", "t@example.com"]);
        git(["config", "user.name", "t"]);
        const commit = (msg: string, ok: boolean) => {
            writeFileSync(join(dir!, "check.sh"), ok ? "exit 0\n" : "exit 1\n");
            writeFileSync(join(dir!, "n.txt"), msg);
            git(["add", "."]);
            git(["commit", "-q", "-m", msg]);
            return git(["rev-parse", "HEAD"]);
        };
        const good = commit("green base (#5000)", true);
        commit("one (#5001)", true);
        commit("two (#5002)", true);
        const broken = commit("break it (#5003)", false);
        commit("four (#5004)", false);
        const red = commit("five (#5005)", false);
        const commits = git([
            "rev-list",
            "--first-parent",
            "--reverse",
            `${good}..${red}`,
        ]).split("\n");
        expect(commits).toHaveLength(5);
        const probe = (sha: string): ProbeOutcome =>
            spawnSync("sh", ["-c", `git show ${sha}:check.sh | sh`], {
                cwd: dir!,
            }).status === 0
                ? "green"
                : "red";
        expect(probe(red)).toBe("red");
        expect(probe(good)).toBe("green");
        const result = bisectFirstRed(commits, probe);
        expect(result.culprit).toBe(broken);
        const line = culpritLine({
            result,
            good,
            commits: commits.length,
            subject: git(["log", "-1", "--format=%s", result.culprit!]),
        });
        expect(line).toContain("PR #5003");
    });
});

describe("remainingGates — a flake closes GREEN only once its run's unreached gates pass", () => {
    const offline = splitHealthGates(HEALTH_SCRIPTS).offline;
    it("owes the later tiers of test's chain after a test:app file", () => {
        const plan = {
            kind: "tests" as const,
            step: "test",
            files: ["scripts/__tests__/x.test.ts"],
        };
        expect(remainingGates(plan, offline)).toEqual([
            "test:bot",
            "test:blade",
        ]);
    });
    it("owes the blade after a Bot file, nothing after a blade spec", () => {
        const bot = {
            kind: "tests" as const,
            step: "test",
            files: ["convex/gre/ai/__tests__/a.bot.test.ts"],
        };
        expect(remainingGates(bot, offline)).toEqual(["test:blade"]);
        const blade = {
            kind: "tests" as const,
            step: "test",
            files: ["convex/gre/ai/blade/__tests__/m.spec.ts"],
        };
        expect(remainingGates(blade, offline)).toEqual([]);
    });
    it("owes every later step after a failed guard step", () => {
        expect(
            remainingGates({ kind: "step", step: "check:all" }, offline)
        ).toEqual([
            "check:gaps",
            "check:targets",
            "check:test-hygiene",
            "test",
        ]);
    });
});

describe("a RED is climbed once", () => {
    it("reads the culprit line as the mark its ladder ran", () => {
        expect(laddered(`head\n${LADDER_MARK}PR #1 · x\n\n### Failures`)).toBe(
            true
        );
        expect(laddered("head\n- **files:** `a`")).toBe(false);
        expect(laddered(null)).toBe(false);
    });
    it("knows a probe worktree and the pid that made it", () => {
        expect(bisectWorktreePid("/code/mtg/tolaria-bisect-4242-3")).toBe(4242);
        expect(bisectWorktreePid("/code/mtg/tolaria-issue-4242")).toBeNull();
    });
});
