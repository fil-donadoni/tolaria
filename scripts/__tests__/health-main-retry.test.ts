import { spawnSync } from "node:child_process";
import {
    chmodSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { failingFiles, failLines } from "../lib/health-evidence";
import {
    healthStepCommand,
    noBailChain,
    TEST_CHAIN_SCRIPTS,
    type HealthStep,
    type StepResult,
} from "../lib/health-step";
import {
    failedVitestProjects,
    OWN_CONFIG_PROJECT_SCRIPTS,
    planLaneRetry,
    ROOT_CHAIN_PROJECTS,
    retryCauseOf,
    retryDecision,
    retryNote,
    runStepWithRetry,
} from "../lib/health-retry";
import {
    decodeStatus,
    DESCRIPTION_MAX,
    encodeDescription,
} from "../lib/health-verdict-store";

/**
 * Health re-runs a failed vitest project once before writing RED (issue
 * #5461). The seam is `runStepWithRetry`, driven here by a fake step runner:
 * `health-main.ts` runs `main()` on load and cannot be imported.
 */
const TEST_STEP: HealthStep = {
    ordinal: 6,
    total: 6,
    name: "test",
    cmd: "bun",
    args: ["run", "test"],
};

const APP_CMD =
    "$ bun scripts/gate.ts heavy 'vitest run --project node-engine --project node-tooling --project dom'";
const BOT_CMD =
    "$ bun scripts/gate.ts heavy 'vitest run --project bot-node --project bot-dom'";

const FAIL_ENGINE = `${APP_CMD}\n FAIL  |node-engine| convex/gre/__tests__/stack.test.ts > stack > pops\n`;

function result(ok: boolean, output = ""): StepResult {
    return {
        ok,
        status: ok ? 0 : 1,
        signal: null,
        elapsedMs: 1,
        output,
    };
}

/** A runner answering each call from `script`, recording the steps run. */
function fakeRunner(script: StepResult[]) {
    const ran: HealthStep[] = [];
    return {
        ran,
        run: async (s: HealthStep) => {
            ran.push(s);
            const next = script[ran.length - 1];
            if (!next) throw new Error(`unexpected step ${s.name}`);
            return next;
        },
    };
}

describe("failedVitestProjects", () => {
    it("names the tagged projects, sorted and unique", () => {
        const out = [
            " FAIL  |node-engine| a.test.ts > x",
            " FAIL  |dom| b.test.tsx > y",
            "\u001b[31m FAIL \u001b[39m |node-engine| c.test.ts > z",
        ].join("\n");
        expect(failedVitestProjects(out)).toEqual(["dom", "node-engine"]);
    });

    it("is null when any failure carries no project tag", () => {
        const out = " FAIL  |dom| b.test.tsx > y\n FAIL  d.test.ts > crashed";
        expect(failedVitestProjects(out)).toBeNull();
    });

    it("is null when no FAIL line exists", () => {
        expect(failedVitestProjects("tsc: error TS2322")).toBeNull();
    });
});

describe("retryDecision", () => {
    it("owes the chain scripts that never started", () => {
        expect(retryDecision("test", FAIL_ENGINE)).toEqual({
            plan: {
                projects: ["node-engine"],
                remaining: ["test:bot", "test:blade"],
            },
        });
        const bot = `${APP_CMD}\n${BOT_CMD}\n FAIL  |bot-node| x.bot.test.ts > y\n`;
        expect(retryDecision("test", bot)).toEqual({
            plan: { projects: ["bot-node"], remaining: ["test:blade"] },
        });
    });

    it("never retries a step other than test", () => {
        expect(retryDecision("check:all", FAIL_ENGINE)).toEqual({
            refused: "only the `test` step is re-run",
        });
    });
});

describe("runStepWithRetry — the health-main seam", () => {
    it("fail then pass: GREEN with the retried project named", async () => {
        const f = fakeRunner([
            result(false, FAIL_ENGINE),
            result(true),
            result(true),
            result(true),
        ]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.result.ok).toBe(true);
        expect(out.retried).toEqual(["node-engine"]);
        expect(retryNote("test", out.retried!)).toBe(
            "test (retry: node-engine)"
        );
        // Exactly the failed project, then the chain that never started.
        expect(f.ran.map((s) => s.args)).toEqual([
            ["run", "test"],
            ["scripts/gate.ts", "heavy", "vitest run --project node-engine"],
            ["run", "test:bot"],
            ["run", "test:blade"],
        ]);
    });

    it("fail then fail: RED, the second failure is the result", async () => {
        const second = result(
            false,
            " FAIL  |node-engine| convex/gre/__tests__/stack.test.ts > stack > pops\n"
        );
        const f = fakeRunner([result(false, FAIL_ENGINE), second]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.result).toBe(second);
        expect(out.retried).toEqual(["node-engine"]);
        expect(f.ran).toHaveLength(2);
    });

    it("an untagged failure is RED at once, no retry", async () => {
        const f = fakeRunner([result(false, "boom, no FAIL line")]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.result.ok).toBe(false);
        expect(out.retried).toBeUndefined();
        expect(f.ran).toHaveLength(1);
    });

    it("a green first run runs once", async () => {
        const f = fakeRunner([result(true)]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.retried).toBeUndefined();
        expect(f.ran).toHaveLength(1);
    });

    it("a chain script failing after a green retry is RED", async () => {
        const f = fakeRunner([
            result(false, FAIL_ENGINE),
            result(true),
            result(false, "blade red"),
        ]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.result.ok).toBe(false);
        expect(f.ran).toHaveLength(3);
    });
});

describe("the retry note in the verdict", () => {
    it("survives the commit-status description round trip", () => {
        const step = retryNote("test", ["node-engine"]);
        const desc = encodeDescription({
            sha: "a".repeat(40),
            status: "green",
            step,
            machine: "mac",
        });
        const v = decodeStatus({
            sha: "a".repeat(40),
            state: "success",
            description: desc,
            targetUrl: null,
            createdAt: null,
        });
        expect(v?.step).toBe("test (retry: node-engine)");
    });
});

describe("retryDecision — review hardening", () => {
    it("a test printing a later chain's marker cannot skip that chain", () => {
        const noisy = `${FAIL_ENGINE}stdout: --project bot-node BLADE_TIER=must\n`;
        expect(retryDecision("test", noisy)).toMatchObject({
            plan: { remaining: ["test:bot", "test:blade"] },
        });
    });

    it("unhandled errors beside a tagged FAIL are RED at once", () => {
        expect(
            retryDecision("test", `${FAIL_ENGINE}\n⎯⎯⎯ Unhandled Errors ⎯⎯⎯\n`)
        ).toEqual({
            refused:
                "vitest reported an unhandled error the FAIL lines do not explain",
        });
    });

    it("a test NAME saying 'unhandled rejection' does not refuse the re-run (issue #8073)", () => {
        const named =
            "stdout | src/lib/diagnostics/__tests__/console-ring.test.ts > console ring > captures an uncaught error and an unhandled rejection\n";
        expect(retryDecision("test", `${FAIL_ENGINE}${named}`)).toHaveProperty(
            "plan"
        );
    });

    it("vitest's 'Vitest caught N unhandled errors' line still refuses (issue #8073)", () => {
        expect(
            retryDecision(
                "test",
                `${FAIL_ENGINE}\n Vitest caught 2 unhandled errors during the test run.\n`
            )
        ).toEqual({
            refused:
                "vitest reported an unhandled error the FAIL lines do not explain",
        });
    });

    it("a signal-killed first run is never retried", async () => {
        const killed = {
            ...result(false, FAIL_ENGINE),
            status: null,
            signal: "SIGKILL" as const,
        };
        const f = fakeRunner([killed]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.retried).toBeUndefined();
        expect(f.ran).toHaveLength(1);
    });
});

describe("a refused retry names its reason (issue #5939)", () => {
    // The RED of 8442d0b4 said only "not a retryable test failure", and its
    // log stayed on the machine that ran it.
    async function refusal(step: HealthStep, first: StepResult) {
        const lines: string[] = [];
        const out = await runStepWithRetry(step, fakeRunner([first]).run, (l) =>
            lines.push(l)
        );
        expect(out.retried).toBeUndefined();
        return { refused: out.refused, log: lines.join("") };
    }

    it("each refusal says which rule held the step, in the result and the log", async () => {
        const cases: [HealthStep, StepResult, string][] = [
            [
                TEST_STEP,
                result(false, "boom"),
                "no vitest FAIL line in the output",
            ],
            [
                TEST_STEP,
                result(false, `${FAIL_ENGINE} FAIL  a.test.ts > x\n`),
                "a FAIL line names no vitest project",
            ],
            [
                TEST_STEP,
                result(false, `${FAIL_ENGINE}\n⎯⎯⎯ Unhandled Errors ⎯⎯⎯\n`),
                "vitest reported an unhandled error the FAIL lines do not explain",
            ],
            [
                TEST_STEP,
                {
                    ...result(false, FAIL_ENGINE),
                    status: null,
                    signal: "SIGKILL",
                },
                "killed by SIGKILL — a crash or OOM kill is not a flaky test",
            ],
            [
                { ...TEST_STEP, name: "check:all" },
                result(false, FAIL_ENGINE),
                "only the `test` step is re-run",
            ],
        ];
        for (const [step, first, reason] of cases) {
            const r = await refusal(step, first);
            expect(r.refused).toBe(reason);
            expect(r.log).toBe(
                `health-main: ${step.name} failed — not re-run: ${reason}\n`
            );
        }
    });

    it("a step that passes, or is re-run, carries no refusal", async () => {
        const green = await runStepWithRetry(
            TEST_STEP,
            fakeRunner([result(true)]).run
        );
        expect(green.refused).toBeUndefined();
        const rerun = await runStepWithRetry(
            TEST_STEP,
            // The retry, then the two chain scripts it never reached.
            fakeRunner([
                result(false, FAIL_ENGINE),
                result(true),
                result(true),
                result(true),
            ]).run
        );
        expect(rerun.refused).toBeUndefined();
    });
});

describe("the retry note separates a timeout from an assertion (issue #5484)", () => {
    const TIMEOUT_BOT = [
        BOT_CMD,
        " FAIL  |bot-node| convex/gre/__tests__/difficulty.bot.test.ts > difficulty > the expert preset is not weaker",
        "Error: Test timed out in 60000ms.",
        "      Tests  1 failed | 40 passed (41)",
        "",
    ].join("\n");
    const ASSERT_BOT = [
        BOT_CMD,
        " FAIL  |bot-node| convex/gre/__tests__/difficulty.bot.test.ts > difficulty > the expert preset is not weaker",
        "AssertionError: expected 3 to be greater than or equal to 4",
        "      Tests  1 failed | 40 passed (41)",
        "",
    ].join("\n");

    it("reads the cause of the first failure", () => {
        expect(retryCauseOf(TIMEOUT_BOT)).toBe("timeout");
        expect(retryCauseOf(ASSERT_BOT)).toBe("assertion");
    });

    it("a timeout that passes on the retry is noted as one", async () => {
        const f = fakeRunner([
            result(false, TIMEOUT_BOT),
            result(true),
            result(true),
        ]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.result.ok).toBe(true);
        expect(out.cause).toBe("timeout");
        expect(retryNote("test", out.retried!, out.cause)).toBe(
            "test (retry: bot-node, timeout)"
        );
    });

    it("an assertion failure is noted as one", async () => {
        const f = fakeRunner([
            result(false, ASSERT_BOT),
            result(true),
            result(true),
        ]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.cause).toBe("assertion");
        expect(retryNote("test", out.retried!, out.cause)).toBe(
            "test (retry: bot-node, assertion)"
        );
    });

    it("the cause survives the commit-status description round trip", () => {
        const desc = encodeDescription({
            sha: "a".repeat(40),
            status: "green",
            step: retryNote("test", ["bot-node"], "timeout"),
            machine: "mac",
        });
        expect(
            decodeStatus({
                sha: "a".repeat(40),
                state: "success",
                description: desc,
                targetUrl: null,
                createdAt: null,
            })?.step
        ).toBe("test (retry: bot-node, timeout)");
    });
});

describe("planLaneRetry — the queue lane's one re-run (issue #5640)", () => {
    const CMD = "bunx vitest run --project node-engine --project bot-node";
    const FAIL =
        " FAIL  |node-engine| convex/gre/__tests__/stack.test.ts > stack > pops\n" +
        " FAIL  |bot-node| convex/gre/ai/x.bot.test.ts > x\n" +
        "\n Test Files  2 failed | 3 passed (5)\n";

    it("narrows the re-run to the failed projects and the failing files", () => {
        const plan = planLaneRetry(CMD, FAIL);
        expect(plan?.projects).toEqual(["bot-node", "node-engine"]);
        expect(plan?.files).toEqual([
            "convex/gre/__tests__/stack.test.ts",
            "convex/gre/ai/x.bot.test.ts",
        ]);
        expect(plan?.command).toBe(
            "bunx vitest run --project bot-node --project node-engine 'convex/gre/__tests__/stack.test.ts' 'convex/gre/ai/x.bot.test.ts'"
        );
    });

    it("a test NAME saying 'unhandled rejection' does not refuse the lane re-run (issue #8073)", () => {
        expect(
            planLaneRetry(
                CMD,
                "stdout | src/lib/diagnostics/__tests__/console-ring.test.ts > console ring > captures an uncaught error and an unhandled rejection\n" +
                    FAIL
            )
        ).not.toBeNull();
        expect(
            planLaneRetry(
                CMD,
                FAIL +
                    "\n Vitest caught 1 unhandled error during the test run.\n"
            )
        ).toBeNull();
    });

    it("names the cause of the first failure", () => {
        const timed =
            " FAIL  |node-engine| a.test.ts > t\nError: Test timed out in 5000ms.\n\n Test Files  1 failed | 3 passed (4)\n Tests  1 failed | 3 passed\n";
        expect(planLaneRetry(CMD, timed)?.cause).toBe("timeout");
        expect(planLaneRetry(CMD, FAIL)?.cause).toBe("assertion");
    });

    it("never retries a command that is not a vitest run", () => {
        expect(planLaneRetry("bun run check:ts", FAIL)).toBeNull();
        expect(planLaneRetry("bunx eslint src", FAIL)).toBeNull();
    });

    it("never re-runs a crashed or summary-less run: unrun files would go green", () => {
        const one = " FAIL  |node-engine| a.test.ts > t\n";
        expect(planLaneRetry(CMD, one)).toBeNull();
        expect(
            planLaneRetry(
                CMD,
                one +
                    "FATAL ERROR: Reached heap limit - JavaScript heap out of memory\n Test Files  1 failed (1)\n"
            )
        ).toBeNull();
        expect(
            planLaneRetry(
                CMD,
                one +
                    "Error: Worker exited unexpectedly\n Test Files  1 failed (1)\n"
            )
        ).toBeNull();
    });

    it("never absorbs a failure the FAIL lines do not explain", () => {
        expect(planLaneRetry(CMD, "boom, no FAIL line")).toBeNull();
        expect(
            planLaneRetry(CMD, FAIL + " FAIL  d.test.ts > untagged\n")
        ).toBeNull();
        expect(
            planLaneRetry(CMD, FAIL + "\n⎯⎯⎯ Unhandled Errors ⎯⎯⎯\n")
        ).toBeNull();
    });
});

describe("the hosted early run runs every suite without bail (issue #7656)", () => {
    const BLADE_CMD =
        "$ bun scripts/gate.ts light 'BLADE_TIER=must vitest run --config vitest.blade.config.ts'";

    it("only an early run's `test` step leaves the `&&` chain", () => {
        expect(healthStepCommand("test")).toEqual({
            cmd: "bun",
            args: ["run", "test"],
        });
        expect(healthStepCommand("check:all", { noBail: true })).toEqual({
            cmd: "bun",
            args: ["run", "check:all"],
        });
        const early = healthStepCommand("test", { noBail: true });
        expect(early.cmd).toBe("sh");
        expect(early.args).toEqual(["-c", noBailChain(TEST_CHAIN_SCRIPTS)]);
    });

    it("the chain is `bun run test`'s, in its order", () => {
        const pkg = JSON.parse(
            readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(
            [...pkg.scripts.test.matchAll(/bun run (test:[\w-]+)/g)].map(
                (m) => m[1]
            )
        ).toEqual([...TEST_CHAIN_SCRIPTS]);
    });

    /** Runs the early chain against a stub `bun` that fails the scripts in
     *  `failing`, and returns its exit code and the scripts it ran. */
    function runChain(
        failing: readonly string[],
        infra: readonly string[] = []
    ): {
        status: number | null;
        ran: string[];
    } {
        const dir = mkdtempSync(join(tmpdir(), "no-bail-"));
        try {
            const log = join(dir, "ran");
            const stub = join(dir, "bun");
            writeFileSync(
                stub,
                `#!/bin/sh\necho "$2" >> "${log}"\ncase " ${failing.join(" ")} " in *" $2 "*) exit 1;; esac\ncase " ${infra.join(" ")} " in *" $2 "*) exit 77;; esac\nexit 0\n`
            );
            chmodSync(stub, 0o755);
            const { cmd, args } = healthStepCommand("test", { noBail: true });
            const r = spawnSync(cmd, args, {
                env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
                encoding: "utf8",
                timeout: 10_000,
            });
            const ran = readFileSync(log, "utf8").split("\n").filter(Boolean);
            return { status: r.status, ran };
        } finally {
            rmSync(dir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
        }
    }

    it("a red first suite does not stop the next ones, and the step fails", () => {
        expect(runChain(["test:app"])).toEqual({
            status: 1,
            ran: ["test:app", "test:bot", "test:blade"],
        });
        expect(runChain(["test:bot", "test:blade"]).status).toBe(1);
    });

    it("a gate that never ran stays INFRA (77) unless a suite failed", () => {
        expect(runChain([], ["test:bot"]).status).toBe(77);
        expect(runChain(["test:blade"], ["test:app"]).status).toBe(1);
        expect(runChain(["test:app"], ["test:bot"]).status).toBe(1);
    });

    it("every suite green: the step passes", () => {
        expect(runChain([])).toEqual({
            status: 0,
            ran: ["test:app", "test:bot", "test:blade"],
        });
    });

    it("the evidence and the retry read every suite's failures", async () => {
        const output = [
            APP_CMD,
            " FAIL  |node-engine| convex/gre/__tests__/stack.test.ts > stack > pops",
            BOT_CMD,
            " FAIL  |bot-node| convex/gre/ai/__tests__/x.bot.test.ts > x > y",
            BLADE_CMD,
        ].join("\n");
        expect(failingFiles(output)).toEqual([
            "convex/gre/__tests__/stack.test.ts",
            "convex/gre/ai/__tests__/x.bot.test.ts",
        ]);
        // Every suite started: the retry owes no chain script after it.
        expect(retryDecision("test", output)).toEqual({
            plan: { projects: ["bot-node", "node-engine"], remaining: [] },
        });
    });
});

describe("the verdict description names how many failing files it cut (issue #7656)", () => {
    const SHA = "a".repeat(40);
    const back = (description: string) =>
        decodeStatus({
            sha: SHA,
            state: "failure",
            description,
            targetUrl: null,
            createdAt: null,
        });
    const red = (tests: string[]) =>
        encodeDescription({
            sha: SHA,
            status: "red",
            step: "test",
            machine: "github-hosted/runner-1",
            failure: "assertion",
            tests,
        });

    it("files past the limit: whole paths that fit, then `more: N`", () => {
        const tests = Array.from(
            { length: 9 },
            (_, i) => `scripts/__tests__/suite-${i}.test.ts`
        );
        const d = red(tests);
        expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
        const v = back(d);
        expect(v?.tests?.length).toBeGreaterThan(0);
        expect(v?.tests).toEqual(tests.slice(0, v?.tests?.length));
        expect((v?.tests?.length ?? 0) + (v?.testsMore ?? 0)).toBe(9);
    });

    it("no path fits: `more: N` alone", () => {
        const d = red([`${"x/".repeat(60)}a.test.ts`, "b.test.ts"]);
        expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(back(d)).toMatchObject({ testsMore: 2 });
        expect(back(d)?.tests).toBeUndefined();
    });

    it("every path fits: no `more` field", () => {
        const d = red(["a.test.ts", "b.test.ts"]);
        expect(back(d)?.tests).toEqual(["a.test.ts", "b.test.ts"]);
        expect(back(d)?.testsMore).toBeUndefined();
    });
});

/**
 * A retry can only help if vitest can run what it names (issue #8459): a blade
 * RED was retried as `vitest run --project blade`, which the root config cannot
 * select, so it died at startup and its output replaced the real failure's.
 */
describe("a retry runs each project under the config declaring it", () => {
    const repo = join(import.meta.dirname, "..", "..");
    const configs = readdirSync(repo).filter((f) =>
        /^vitest(\..+)?\.config\.ts$/.test(f)
    );
    const declaredBy = (config: string): string[] =>
        [
            ...readFileSync(join(repo, config), "utf8").matchAll(
                /^\s*name: "([^"]+)"/gm
            ),
        ].map((m) => m[1]);
    const scripts = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"))
        .scripts as Record<string, string>;
    const failOf = (project: string): string =>
        ` FAIL  |${project}| convex/x.test.ts > a > b\n`;

    const secondRun = async (project: string): Promise<string[] | null> => {
        const f = fakeRunner([
            result(false, failOf(project)),
            result(false, failOf(project)),
        ]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        return out.refused ? null : f.ran[1].args;
    };

    it("sweeps every project every vitest config declares", async () => {
        const root = declaredBy("vitest.config.ts");
        expect(root.length).toBeGreaterThan(0);
        for (const config of configs)
            for (const project of declaredBy(config)) {
                const args = await secondRun(project);
                if (args === null) continue;
                const line = args.join(" ");
                if (line.includes("--project")) {
                    expect(root, `${project} (${config})`).toContain(project);
                    expect(config).toBe("vitest.config.ts");
                } else {
                    // A chain script, whose own command names the config.
                    expect(scripts[args[1]], project).toContain(
                        `--config ${config}`
                    );
                }
            }
    });

    it("retries the blade under its own config", async () => {
        expect(await secondRun("blade")).toEqual(["run", "test:blade"]);
    });

    it("refuses a project no chain script runs", () => {
        const decision = retryDecision("test", failOf("ladder"));
        expect(decision).toEqual({
            refused: "no chain script runs ladder",
        });
    });

    it("every chain project is a project its config declares", () => {
        const root = declaredBy("vitest.config.ts");
        for (const p of ROOT_CHAIN_PROJECTS) expect(root).toContain(p);
        for (const p of Object.keys(OWN_CONFIG_PROJECT_SCRIPTS))
            expect(
                configs.some((c) => declaredBy(c).includes(p)),
                p
            ).toBe(true);
    });

    it("a lane retry never selects a project the root cannot", () => {
        const output = `${failOf("blade")}\n Test Files  1 failed (1)\n`;
        expect(
            planLaneRetry(
                "bunx vitest run --config vitest.blade.config.ts",
                output
            )
        ).toBeNull();
    });

    it("a retry that names no failing test keeps the first failure's", async () => {
        const startup = 'Error: No projects matched the filter "blade".\n';
        const f = fakeRunner([
            result(false, failOf("blade")),
            result(false, startup),
        ]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.result.ok).toBe(false);
        expect(failLines(out.result.output).length).toBe(1);
        expect(out.result.output).toContain(startup);
    });

    it("a retry that names its own failure reports only that", async () => {
        const second = failOf("blade").replace("a > b", "c > d");
        const f = fakeRunner([
            result(false, failOf("blade")),
            result(false, second),
        ]);
        const out = await runStepWithRetry(TEST_STEP, f.run);
        expect(out.result.output).toBe(second);
    });
});
