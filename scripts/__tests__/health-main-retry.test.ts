import { describe, it, expect } from "vitest";
import type { HealthStep, StepResult } from "../lib/health-step";
import {
    failedVitestProjects,
    planLaneRetry,
    planRetry,
    retryCauseOf,
    retryNote,
    runStepWithRetry,
} from "../lib/health-retry";
import { decodeStatus, encodeDescription } from "../lib/health-verdict-store";

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

describe("planRetry", () => {
    it("owes the chain scripts that never started", () => {
        expect(planRetry("test", FAIL_ENGINE)).toEqual({
            projects: ["node-engine"],
            remaining: ["test:bot", "test:blade"],
        });
        const bot = `${APP_CMD}\n${BOT_CMD}\n FAIL  |bot-node| x.bot.test.ts > y\n`;
        expect(planRetry("test", bot)).toEqual({
            projects: ["bot-node"],
            remaining: ["test:blade"],
        });
    });

    it("never retries a step other than test", () => {
        expect(planRetry("check:all", FAIL_ENGINE)).toBeNull();
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

describe("planRetry — review hardening", () => {
    it("a test printing a later chain's marker cannot skip that chain", () => {
        const noisy = `${FAIL_ENGINE}stdout: --project bot-node BLADE_TIER=must\n`;
        expect(planRetry("test", noisy)?.remaining).toEqual([
            "test:bot",
            "test:blade",
        ]);
    });

    it("unhandled errors beside a tagged FAIL are RED at once", () => {
        expect(
            planRetry("test", `${FAIL_ENGINE}\n⎯ Unhandled Errors ⎯\n`)
        ).toBeNull();
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
        " FAIL  |bot-node| convex/gre/ai/x.bot.test.ts > x\n";

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

    it("names the cause of the first failure", () => {
        const timed =
            " FAIL  |node-engine| a.test.ts > t\nError: Test timed out in 5000ms.\n\n Tests  1 failed | 3 passed\n";
        expect(planLaneRetry(CMD, timed)?.cause).toBe("timeout");
        expect(planLaneRetry(CMD, FAIL)?.cause).toBe("assertion");
    });

    it("never retries a command that is not a vitest run", () => {
        expect(planLaneRetry("bun run check:ts", FAIL)).toBeNull();
        expect(planLaneRetry("bunx eslint src", FAIL)).toBeNull();
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
