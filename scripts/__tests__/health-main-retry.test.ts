import { describe, it, expect } from "vitest";
import type { HealthStep, StepResult } from "../lib/health-step";
import {
    failedVitestProjects,
    planRetry,
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
