import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    tmp,
    stubGhCountingFrom,
    stubClaudeProgress,
    run,
    passLogCount,
} from "./loop-drain-harness";
import {
    INFRA_REMEDY,
    PREFLIGHT_CONVEX_STEP,
    recordInfra,
} from "../lib/health-verdict";

installLoopDrainHarness();

describe("loop-drain — an INFRA health verdict (issue #4943)", () => {
    it("prints the step and the recorded remedy, and still runs the pass", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        const dir = path.join(tmp, ".claude", "telemetry", "health");
        fs.mkdirSync(dir, { recursive: true });
        // Written by the same function health-main uses, so the sh reader is
        // proven against the real record shape, not a hand-typed one.
        recordInfra({
            dir,
            infra: {
                sha: "abc",
                status: "infra",
                failedStep: PREFLIGHT_CONVEX_STEP,
                reason: INFRA_REMEDY["convex-down"],
            },
            previous: null,
            redMarkerStanding: false,
        });
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.stderr).toContain(
            `loop-drain[warn]: release health is INFRA (at preflight:convex) — the tip is unproven, not red: ${INFRA_REMEDY["convex-down"]}`
        );
        expect(r.stdout).toMatch(/reason=max-passes /);
        expect(passLogCount()).toBe(1);
    });

    it("says nothing when the last run was not INFRA", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        const dir = path.join(tmp, ".claude", "telemetry", "health");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, "last.json"),
            JSON.stringify({ sha: "abc", status: "green" }, null, 2)
        );
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.stderr).not.toMatch(/INFRA/);
    });
});
