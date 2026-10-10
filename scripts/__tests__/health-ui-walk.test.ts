// The full `check:ui` walk is a health step (issue #4913): a PR's receipt is
// SCOPED to its diff (ADR 0131), so the every-surface walk that backstops the
// scoper's residuals must run somewhere, and `health` is the one place that
// already runs what no diff can pay for (issue #4490). Since issue #5378 only
// `--ui-all` — `release` — runs it; a batch run owes no walk.
import { describe, expect, it } from "vitest";
import { HEALTH_SCRIPTS, healthStepArgs } from "../lib/health-step";

describe("health runs the full check:ui walk (issue #4913)", () => {
    it("is the LAST health step — every offline verdict comes first", () => {
        expect(HEALTH_SCRIPTS.at(-1)).toBe("check:ui --all");
    });

    it("its argv forces the full scope: `bun run check:ui --all`", () => {
        expect(healthStepArgs("check:ui --all")).toEqual([
            "run",
            "check:ui",
            "--all",
        ]);
        expect(healthStepArgs("check:all")).toEqual(["run", "check:all"]);
    });
});
