import { describe, it, expect } from "vitest";
import * as path from "path";
import {
    installLoopDrainHarness,
    tmp,
    stubGhCountingFrom,
    stubClaudeProgress,
    run,
    passLogCount,
} from "./loop-drain-harness";
import { fakeGh } from "./fake-gh";

installLoopDrainHarness();

describe("loop-drain — an INFRA health verdict (issue #4943)", () => {
    it("prints the step of an INFRA verdict from the store, and still runs the pass", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        const tip = "abc0".repeat(10);
        const gh = fakeGh(path.join(tmp, "fake-gh"));
        gh.setHistory([tip]);
        gh.seed(tip, {
            state: "error",
            context: "health",
            description: "INFRA · preflight:convex · MacBook",
        });
        const r = run({ args: ["--max-passes", "1"], env: gh.envNoPath });
        expect(r.stderr).toContain(
            "loop-drain[warn]: release health is INFRA (at preflight:convex) — the tip is unproven, not red"
        );
        expect(r.stdout).toMatch(/reason=max-passes /);
        expect(passLogCount()).toBe(1);
    });
});
