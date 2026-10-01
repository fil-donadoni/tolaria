import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    tmp,
    writeStub,
    stubGhCountingFrom,
    stubClaudeProgress,
    planBranch,
    run,
    passLogCount,
} from "./loop-drain-harness";

installLoopDrainHarness();

/** `bun` stub whose `convex:ensure` fails with a log tail, as the real one
 *  does when the backend never answered (issue #4945). It must sit BEFORE
 *  `planBranch()`, whose own `CONVEX_ENSURE_UP` would answer first. */
const stubConvexEnsureFails = (): void => {
    writeStub(
        "bun",
        [
            `if [ "$1" = "run" ] && [ "$2" = "convex:ensure" ]; then`,
            `  echo "convex:ensure: FAILED — backend never answered; log tail: boom" >&2`,
            `  exit 1`,
            `fi`,
            `case "$*" in`,
            `  *loop-doctor.ts*) exit 0 ;;`,
            `esac`,
            planBranch(),
            `exit 1`,
        ].join("\n")
    );
};

describe("loop-drain — the local Convex backend (issue #4945)", () => {
    it("stops with reason=convex-down and the ensure's output when convex:ensure fails", () => {
        stubGhCountingFrom(3);
        stubClaudeProgress();
        stubConvexEnsureFails();
        const r = run();
        expect(r.status).toBe(1);
        expect(r.stdout).toMatch(
            /loop-drain\[summary\]: passes=0 reason=convex-down /
        );
        expect(r.stderr).toMatch(/backend never answered; log tail: boom/);
        expect(passLogCount()).toBe(0);
    });

    it("is named convex-down, never health-red, when the RED marker also stands", () => {
        stubGhCountingFrom(3);
        stubClaudeProgress();
        stubConvexEnsureFails();
        const red = path.join(tmp, ".claude", "telemetry", "health", "RED");
        fs.mkdirSync(path.dirname(red), { recursive: true });
        fs.writeFileSync(red, "sha=abc step=check:ui\n");
        const r = run();
        expect(r.stdout).toMatch(/reason=convex-down /);
        expect(r.stdout).not.toMatch(/reason=health-red/);
    });

    it("runs the pass when convex:ensure succeeds", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.stdout).toMatch(/reason=max-passes /);
        expect(passLogCount()).toBe(1);
    });
});
