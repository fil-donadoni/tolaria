import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    ladderRed,
    lastGreenOf,
    notReproduced,
    prOfSubject,
    runnerClass,
    settleFreshPass,
    settleHeldRed,
    vitestCommands,
    freshRunSteps,
    probeCommands,
    scopeLabel,
    sharedWorkerProjects,
    SHARED_WORKER_PROJECTS,
    type FreshPassEffects,
    type FreshRunEffects,
    type ProbeOutcome,
} from "../lib/health-bisect";
import {
    buildEvidence,
    evidenceFiles,
    evidenceSummary,
    withEvidenceLine,
} from "../lib/health-evidence";
import { HEALTH_SCRIPTS, splitHealthGates } from "../lib/health-step";
import {
    clearDeferredRed,
    defersRed,
    readDeferredRed,
    writeDeferredRed,
} from "../lib/health-verdict-job";
import {
    decodeStatus,
    encodeDescription,
    machineName,
    type Verdict,
} from "../lib/health-verdict-store";
import { runLastFiles } from "../lib/vitest-run-last";

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
                { file: "scripts/__tests__/x.test.ts" },
                { file: "convex/gre/ai/blade/__tests__/must.spec.ts" },
            ])
        ).toEqual([
            {
                args: ["vitest", "run", "scripts/__tests__/x.test.ts"],
                env: {},
                tests: [{ file: "scripts/__tests__/x.test.ts" }],
            },
            {
                args: [
                    "vitest",
                    "run",
                    "--config",
                    "vitest.blade.config.ts",
                    "convex/gre/ai/blade/__tests__/must.spec.ts",
                ],
                env: { BLADE_TIER: "must" },
                tests: [{ file: "convex/gre/ai/blade/__tests__/must.spec.ts" }],
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

describe("a fresh pass on another runner class is environment-dependent, never a flake (issue #5858)", () => {
    const hosted = machineName({
        GITHUB_ACTIONS: "true",
        RUNNER_ENVIRONMENT: "github-hosted",
    });
    const lane = machineName({
        GITHUB_ACTIONS: "true",
        RUNNER_ENVIRONMENT: "self-hosted",
    });
    it("a hosted runner's machine name carries its class, through the commit status", () => {
        expect(runnerClass(hosted)).toBe("github-hosted");
        expect(runnerClass(lane)).toBe("self-hosted");
        expect(runnerClass(machineName({}))).toBe("self-hosted");
        const decoded = decodeStatus({
            sha: RED.sha,
            state: "failure",
            description: encodeDescription({ ...RED, machine: hosted }),
            targetUrl: null,
            createdAt: null,
        });
        expect(runnerClass(decoded?.machine)).toBe("github-hosted");
    });
    it("a hosted RED that passes on lane stands, its evidence naming both machines", () => {
        const out = notReproduced({
            redMachine: hosted,
            freshMachine: "huawei",
        });
        expect(out.kind).toBe("environment");
        if (out.kind !== "environment") return;
        expect(out.line).toContain(`\`${hosted}\` (github-hosted)`);
        expect(out.line).toContain("`huawei` (self-hosted)");
        expect(out.line).toContain("not reproduced on another runner class");
        // Issue #7584: a one-worker pass never reproduced the RED's schedule.
        expect(out.line).not.toContain("not a flake");
        // The ladder's mark: the RED is climbed once, and names no culprit.
        expect(laddered(out.line)).toBe(true);
    });
    it("a RED and its fresh run on the same class are a flake, as before", () => {
        expect(
            notReproduced({ redMachine: "huawei", freshMachine: "macbook" })
        ).toEqual({ kind: "flake" });
        expect(
            notReproduced({ redMachine: hosted, freshMachine: hosted })
        ).toEqual({ kind: "flake" });
    });
});

describe("settleFreshPass — what the ladder does with a fresh pass (issue #5858)", () => {
    const hosted = machineName({
        GITHUB_ACTIONS: "true",
        RUNNER_ENVIRONMENT: "github-hosted",
    });
    const plan = { kind: "step" as const, step: "worktree:init" };

    /** The ladder's I/O, recorded. */
    function recorder(written = true) {
        const calls = {
            greens: [] as Verdict[],
            flakes: 0,
            published: [] as string[],
            notes: [] as string[],
        };
        const fx: FreshPassEffects = {
            note: (l) => calls.notes.push(l),
            writeGreen: (v) => {
                calls.greens.push(v);
                return written
                    ? { written: true }
                    : { written: false, reason: "newer verdict" };
            },
            fileFlake: () => calls.flakes++,
            publish: (l) => calls.published.push(l),
        };
        return { calls, fx };
    }

    function settle(redMachine: string, fx: FreshPassEffects, dryRun = false) {
        return settleFreshPass(
            {
                red: { sha: RED.sha, machine: redMachine },
                sha: RED.sha,
                plan,
                freshMachine: "huawei",
                at: "2026-10-18T00:00:00Z",
                dryRun,
            },
            fx
        );
    }

    it("a hosted RED passing on lane: no GREEN, no flake filed, the RED stands with both machines in its evidence", () => {
        const { calls, fx } = recorder();
        expect(settle(hosted, fx)).toBe(1);
        expect(calls.greens).toEqual([]);
        expect(calls.flakes).toBe(0);
        expect(calls.published).toHaveLength(1);
        expect(calls.published[0]).toContain(`\`${hosted}\``);
        expect(calls.published[0]).toContain("`huawei`");
        expect(laddered(calls.published[0]!)).toBe(true);
    });
    it("a RED on the fresh run's own class: the flake GREEN is written and filed, as before", () => {
        const { calls, fx } = recorder();
        expect(settle("macbook", fx)).toBe(0);
        expect(calls.greens).toHaveLength(1);
        expect(calls.greens[0]).toMatchObject({
            sha: RED.sha,
            status: "green",
            step: "flake: worktree:init passed on a fresh run",
            machine: "huawei",
        });
        expect(calls.flakes).toBe(1);
        expect(calls.published).toEqual([]);
    });
    it("a flake GREEN the store declines leaves the RED standing, nothing filed", () => {
        const { calls, fx } = recorder(false);
        expect(settle("macbook", fx)).toBe(1);
        expect(calls.flakes).toBe(0);
    });
    it("a dry run writes nothing but still walks the filing (which dry-runs itself)", () => {
        const { calls, fx } = recorder();
        expect(settle("macbook", fx, true)).toBe(0);
        expect(calls.greens).toEqual([]);
        expect(calls.flakes).toBe(1);
    });
});

describe("a cross-file leak in a shared-worker project reproduces in the whole project, never alone (issue #7584)", () => {
    const victim = "convex/gre/__tests__/loyaltyMoves.bot.test.ts";
    const failing = { file: victim, name: "loyalty moves > Jace" };
    const evidence = buildEvidence({
        sha: RED.sha,
        step: "test",
        output: ` FAIL  |bot-node| ${victim} > loyalty moves > Jace\nError: Card not found by name: Jace\n Test Files  1 failed (1)\n`,
        status: 1,
        signal: null,
        machine: "github-hosted-runner",
        at: "2026-10-29T00:00:00Z",
        logPath: "/tmp/x.log",
    }).body;
    const plan = {
        kind: "tests" as const,
        step: "test",
        files: [victim],
    };

    /** The fresh run's I/O: the victim passes alone, fails beside the
     *  rest of its project (the polluter registered a token first). */
    function leaky(wholeFails: boolean) {
        const runs: string[][] = [];
        const notes: string[] = [];
        const fx: FreshRunEffects = {
            note: (l) => notes.push(l),
            runTests: (cmds) => {
                const red: { file: string; name?: string }[] = [];
                for (const c of cmds) {
                    runs.push(c.args);
                    if (wholeFails && c.args.includes("--project"))
                        red.push(...c.tests);
                }
                return red;
            },
            runStep: () => true,
        };
        return { runs, notes, fx };
    }

    it("reads the shared-worker project off the evidence, else off the path", () => {
        expect(sharedWorkerProjects(evidence, [victim])).toEqual(["bot-node"]);
        expect(sharedWorkerProjects(null, [victim])).toEqual(["bot-node"]);
        expect(
            sharedWorkerProjects(null, ["convex/gre/__tests__/cut.test.ts"])
        ).toEqual(["node-engine"]);
        // A dom file keeps per-file isolation: alone is its whole schedule.
        expect(
            sharedWorkerProjects(
                buildEvidence({
                    sha: RED.sha,
                    step: "test",
                    output: " FAIL  |dom| src/components/Board.test.tsx > b\n",
                    status: 1,
                    signal: null,
                    machine: "huawei",
                    at: "2026-10-29T00:00:00Z",
                    logPath: "/tmp/x.log",
                }).body,
                ["src/components/Board.test.tsx"]
            )
        ).toEqual([]);
    });

    it("a bot-node file green alone but red in its project: reproduced, the bisect probes the project — never flake, never environment", () => {
        const { runs, fx } = leaky(true);
        const out = freshRunSteps(
            {
                plan,
                tests: [failing],
                projects: sharedWorkerProjects(evidence, plan.files),
                remaining: ["test:blade"],
            },
            fx
        );
        expect(out).toEqual({
            outcome: "red",
            scope: { kind: "projects", projects: ["bot-node"] },
        });
        // Alone first, then the whole project, one worker — no unreached
        // gate runs once it reproduced.
        expect(runs).toEqual([
            ["vitest", "run", victim],
            ["vitest", "run", "--project", "bot-node", "--no-file-parallelism"],
        ]);
        // The bisect's probes run that same scope, so a commit that only
        // ADDS the polluter (PR #7563) reads red.
        expect(probeCommands([failing], out.scope).map((c) => c.args)).toEqual([
            ["vitest", "run", "--project", "bot-node", "--no-file-parallelism"],
        ]);
        // The victim runs after every other bot-node file, its polluter
        // included — never by the duration cache's order, which ran
        // loyaltyMoves first and passed the whole project at 8491d0b85.
        expect(
            runLastFiles(probeCommands([failing], out.scope)[0]!.env)
        ).toEqual(new Set([victim]));
    });

    it("green in the project too: a pass whose environment line says what ran, never 'not a flake'", () => {
        const { runs, fx } = leaky(false);
        const out = freshRunSteps(
            {
                plan,
                tests: [failing],
                projects: ["bot-node"],
                remaining: [],
            },
            fx
        );
        expect(out.outcome).toBe("green");
        expect(runs).toHaveLength(2);
        const line = notReproduced({
            redMachine: machineName({
                GITHUB_ACTIONS: "true",
                RUNNER_ENVIRONMENT: "github-hosted",
            }),
            freshMachine: "huawei",
            ran: scopeLabel(plan, out.scope),
        });
        expect(line.kind).toBe("environment");
        if (line.kind !== "environment") return;
        expect(line.line).toContain(
            "the whole `bot-node` project(s) in one worker"
        );
        expect(line.line).not.toContain("not a flake");
    });

    it("a file outside every shared-worker project passes alone: no project re-run", () => {
        const { runs, fx } = leaky(true);
        const out = freshRunSteps(
            {
                plan: { ...plan, files: ["src/components/Board.test.tsx"] },
                tests: [{ file: "src/components/Board.test.tsx" }],
                projects: [],
                remaining: [],
            },
            fx
        );
        expect(out).toEqual({ outcome: "green", scope: { kind: "files" } });
        expect(runs).toHaveLength(1);
    });

    it("pins the shared-worker projects to vitest.config.ts's `isolate: false` ones", () => {
        const config = readFileSync(
            join(__dirname, "..", "..", "vitest.config.ts"),
            "utf8"
        );
        const off = [...config.matchAll(/name: "([\w-]+)"[\s\S]*?\n {16}\},/g)]
            .filter((m) => /\n\s*isolate: false,/.test(m[0]))
            .map((m) => m[1])
            .sort();
        expect(off).toEqual([...SHARED_WORKER_PROJECTS].sort());
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
            "check:issue-log-comments",
            "check:duplicate-test-blocks",
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

describe("a scheduled RED waits for its fresh run: one store write per run (issue #6986)", () => {
    const machine = machineName({});
    const plan = { kind: "tests" as const, step: "test", files: RED.tests! };
    let dir: string | undefined;
    afterEach(() => {
        if (dir)
            rmSync(dir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
        dir = undefined;
    });

    /** health-main's RED, then the ladder over a store that records writes. */
    function climb(freshRun: "green" | "red") {
        dir = mkdtempSync(join(tmpdir(), "held-red-"));
        const writes: Verdict[] = [];
        const write = (v: Verdict) => {
            writes.push(v);
            return { written: true as const };
        };
        // health-main --scheduled: the RED goes to disk, not the store.
        expect(defersRed("scheduled")).toBe(true);
        writeDeferredRed(dir, { ...RED, status: "red", machine });
        // The ladder: nothing on the store for the sha, so the held RED.
        const { verdict, held } = ladderRed(
            null,
            readDeferredRed(dir) as Verdict | null,
            RED.sha
        );
        expect(held).toBe(true);
        const code =
            freshRun === "green"
                ? settleFreshPass(
                      {
                          red: verdict,
                          sha: RED.sha,
                          plan,
                          freshMachine: machine,
                          at: "2026-10-25T17:57:44Z",
                          dryRun: false,
                      },
                      {
                          note: () => {},
                          writeGreen: write,
                          fileFlake: () => {},
                          publish: () => {},
                      }
                  )
                : 1;
        const d = dir;
        settleHeldRed(
            { held, verdict, code, dryRun: false },
            {
                note: () => {},
                writeRed: write,
                clear: () => clearDeferredRed(d),
            }
        );
        return { writes, code, left: readDeferredRed(d) };
    }

    it("first run red, fresh run green: ONE write, the GREEN — no RED ever reaches the store", () => {
        const { writes, code, left } = climb("green");
        expect(code).toBe(0);
        expect(writes.map((v) => v.status)).toEqual(["green"]);
        expect(left).toBeNull();
    });

    it("reproduced: ONE write, the held RED", () => {
        const { writes, code, left } = climb("red");
        expect(code).toBe(1);
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({
            sha: RED.sha,
            status: "red",
            machine,
        });
        expect(left).toBeNull();
    });

    it("an early run's RED is never held: its ladder reads the store", () => {
        expect(defersRed("early")).toBe(false);
        expect(defersRed("default")).toBe(false);
    });

    it("a held RED never shadows the store's verdict, nor climbs another sha", () => {
        const green: Verdict = { sha: RED.sha, status: "green" };
        expect(ladderRed(green, RED, RED.sha)).toEqual({
            verdict: green,
            held: false,
        });
        expect(ladderRed(null, RED, "b".repeat(40))).toEqual({
            verdict: null,
            held: false,
        });
    });

    it("a write that throws keeps the held RED on disk for the next health run", () => {
        let cleared = 0;
        const code = settleHeldRed(
            { held: true, verdict: RED, code: 1, dryRun: false },
            {
                note: () => {},
                writeRed: () => {
                    throw new Error("502");
                },
                clear: () => cleared++,
            }
        );
        expect(code).toBe(1);
        expect(cleared).toBe(0);
    });
});
