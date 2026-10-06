import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    REAL_BUN,
    tmp,
    queueFile,
    greenShaFile,
    writeStub,
    stubGhCountingFrom,
    planJson,
    CONVEX_ENSURE_UP,
    run,
} from "./loop-drain-harness";

installLoopDrainHarness();

/**
 * Issue #4763: a pass that pushed its PR and then died leaves a `stranded`
 * claim. `queue:plan` names it in `resume`, and the driver hands it to the
 * next pass as `/next-ticket N --resume` BEFORE any new pick — once per issue
 * per run, so one wedged PR cannot eat the whole drain.
 */
describe("loop-drain — resumes stranded claims first (issue #4763)", () => {
    /** A plan whose `batch[0]` is #101 and whose `resume` names `resume`. */
    const stubPlanWithResume = (
        resume: { number: number; pr: number | null; model: string }[]
    ): void => {
        const plan = { ...JSON.parse(planJson(101, "sonnet")), resume };
        writeStub(
            "bun",
            [
                CONVEX_ENSURE_UP,
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo "$ bun scripts/queue-plan.ts" >&2`,
                `  cat <<'PLANEOF'`,
                JSON.stringify(plan),
                `PLANEOF`,
                `  exit 0`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
    };

    /** `claude` that records `--model` and `-p` per pass, and makes progress
     *  so the run keeps going. */
    const stubClaudeRecording = (): string => {
        const file = path.join(tmp, "claude-prompts");
        writeStub(
            "claude",
            [
                `m=""; p=""`,
                `while [ $# -gt 0 ]; do`,
                `  case "$1" in --model) m="$2"; shift ;; -p) p="$2"; shift ;; esac`,
                `  shift`,
                `done`,
                `echo "$m|$p" >> "${file}"`,
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `echo "sha-$n" > "${greenShaFile}"`,
                `exit 0`,
            ].join("\n")
        );
        return file;
    };

    it("pass 1 resumes the stranded claim on ITS tier; pass 2 does not resume it again", () => {
        stubGhCountingFrom(5);
        stubPlanWithResume([{ number: 4506, pr: 4760, model: "opus" }]);
        const prompts = stubClaudeRecording();
        const r = run({ args: ["--max-passes", "2"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.readFileSync(prompts, "utf8").trim().split("\n")).toEqual([
            "opus|/next-ticket 4506 --resume",
            "sonnet|/next-ticket 101",
        ]);
        expect(r.stderr).toMatch(/resuming stranded claim #4506 \(PR #4760\)/);
    });

    it("a stranded branch with no PR is resumed too, and says so", () => {
        stubGhCountingFrom(5);
        stubPlanWithResume([{ number: 4761, pr: null, model: "sonnet" }]);
        const prompts = stubClaudeRecording();
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.readFileSync(prompts, "utf8").trim()).toBe(
            "sonnet|/next-ticket 4761 --resume"
        );
        expect(r.stderr).toMatch(
            /resuming stranded claim #4761 \(pushed branch, no PR\)/
        );
    });

    it("no `resume` in the plan → the batch head, unchanged", () => {
        stubGhCountingFrom(5);
        stubPlanWithResume([]);
        const prompts = stubClaudeRecording();
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.readFileSync(prompts, "utf8").trim()).toBe(
            "sonnet|/next-ticket 101"
        );
        expect(r.stderr).not.toMatch(/resuming stranded/);
    });
});
