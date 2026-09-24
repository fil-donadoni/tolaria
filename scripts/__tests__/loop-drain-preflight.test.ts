import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    REAL_BUN,
    tmp,
    writeStub,
    stubGhCountingFrom,
    stubClaudeProgress,
    planJson,
    stubBunPlanHead,
    run,
    passLogCount,
} from "./loop-drain-harness";

installLoopDrainHarness();

describe("pre-flight — WHICH issue, on WHICH tier (#3083)", () => {
    /** One pass with an argv-recording `claude`, then stop on max-passes.
     *  Returns the argv the driver handed to `claude`. */
    const argvForOnePass = (extraArgs: string[] = []): string[] => {
        const argvFile = path.join(tmp, "claude-argv");
        writeStub(
            "claude",
            [
                `{ echo "argc=$#"; for a in "$@"; do echo "arg=$a"; done; } > "${argvFile}"`,
                `echo "recorded"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({ args: ["--max-passes", "1", ...extraArgs] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
        return fs.readFileSync(argvFile, "utf8").trim().split("\n");
    };

    it("drains a queue whose head is ESCALATED instead of stalling on it", () => {
        // The wall this exists to remove: /next-issue §1 stops the pass —
        // BEFORE claiming — when the issue's model:* label outranks the
        // session tier. Nothing gets claimed, so the same issue is at the head
        // next pass, and an unattended run dies on no-progress with the queue
        // untouched. 47 of 233 open ready-for-agent issues carry model:opus.
        stubGhCountingFrom(5);
        stubBunPlanHead(2707, "opus");
        expect(argvForOnePass()).toEqual([
            "argc=4",
            "arg=--model",
            "arg=opus",
            "arg=-p",
            "arg=/next-issue 2707",
        ]);
    });

    it("uses the DEFAULT tier for an unlabelled head, not a blanket escalation", () => {
        // The other half of the same guard: routing follows the label, so an
        // unlabelled issue must not be dragged up to the escalated tier just
        // because the previous one was.
        stubGhCountingFrom(5);
        stubBunPlanHead(3083, "sonnet");
        expect(argvForOnePass()).toEqual([
            "argc=4",
            "arg=--model",
            "arg=sonnet",
            "arg=-p",
            "arg=/next-issue 3083",
        ]);
    });

    it("the --dry-run echo names the resolved issue and tier", () => {
        // A dry run is how a human checks a night BEFORE committing to it; an
        // echo that hid which issue and which tier were resolved would make
        // the pre-flight unauditable.
        stubGhCountingFrom(5);
        stubBunPlanHead(2707, "opus");
        const r = run({ args: ["--max-passes", "1", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stderr).toMatch(/issue #2707 on tier opus/);
        expect(r.stderr).toMatch(
            /would run: CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude --model opus -p "\/next-issue 2707"/
        );
    });

    it("STOPS the run when the planner cannot answer, rather than letting a pass pick for itself (#3088)", () => {
        // The one place the driver's usual "a janitor must not end the night"
        // trade goes the other way. A pass handed the bare prompt picks its
        // own issue and `/next-issue` knows nothing about HITL, so it would
        // implement AND `land` work reserved for a human. Losing the rest of a
        // night is the cheaper failure.
        stubGhCountingFrom(5);
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo "queue:plan: gh API error" >&2`,
                `  exit 1`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        writeStub("claude", `echo "must not run" >&2\nexit 0`);
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.stdout).toMatch(/reason=preflight-error/);
        expect(r.status).toBe(1);
        expect(passLogCount()).toBe(0);
    });

    it("says so on stderr when it stops, never silently", () => {
        stubGhCountingFrom(5);
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then exit 1; fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        stubClaudeProgress();
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.stderr).toMatch(/pre-flight FAILED/);
        expect(r.stderr).toMatch(/STOPPING/);
    });

    it("stops rather than trusting a head the planner returned in an unusable shape", () => {
        // A plan whose batch[0].number is not an integer must not reach the
        // pass as a prompt argument — `/next-issue not-a-number` burns a pass,
        // and unattended it burns one EVERY pass. Two layers reject it (the
        // `bun -e` type check, then the shell revalidation of what it
        // returned) and this stays green with either one alone: it was proven
        // red only with BOTH removed, which is the honest statement of what it
        // guards — the pair, not one of them.
        stubGhCountingFrom(5);
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo '{"version":1,"batch":[{"number":"not-a-number","model":"opus"}],"deferred":[],"skipped":[],"staleClaims":[]}'`,
                `  exit 0`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        writeStub("claude", `echo "must not run" >&2\nexit 0`);
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.stdout).toMatch(/reason=preflight-error/);
        expect(passLogCount()).toBe(0);
    });

    it("asks the planner to EXCLUDE HITL work — an unattended pass cannot supply the human it wants (#3088)", () => {
        // HITL means "a person looks before it merges". Since ADR 0110 retired
        // the merge-train the pass ends in `land`, which merges — so an
        // unattended run must never be handed that work at all. Asserted on
        // the argv the driver passes the planner, because the eligibility rule
        // lives in the planner and the driver's only job is to ask for it: a
        // shell-side filter here would be a second definition of eligible.
        stubGhCountingFrom(5);
        const planArgvFile = path.join(tmp, "plan-argv");
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo "$*" > "${planArgvFile}"`,
                `  cat <<'PLANEOF'`,
                planJson(4242, "sonnet"),
                `PLANEOF`,
                `  exit 0`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        stubClaudeProgress();
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.readFileSync(planArgvFile, "utf8")).toContain(
            "--exclude-hitl"
        );
    });

    it("parses a plan even though `bun run` prints a banner on stderr (regression)", () => {
        // The bug a real dry run found and no unit test could: the pre-flight
        // captured `bun run queue:plan 2>&1`, so `bun run`'s own
        // `$ bun scripts/queue-plan.ts …` banner landed inside the captured
        // stdout and JSON.parse threw on every real plan. Against a 230-issue
        // queue it resolved NOTHING, silently degrading every pass. Only
        // stdout is the plan.
        stubGhCountingFrom(5);
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo "$ bun scripts/queue-plan.ts --cap \\"1\\"" >&2`,
                `  echo "warning: something on stderr" >&2`,
                `  cat <<'PLANEOF'`,
                planJson(2288, "opus"),
                `PLANEOF`,
                `  exit 0`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        expect(argvForOnePass()).toEqual([
            "argc=4",
            "arg=--model",
            "arg=opus",
            "arg=-p",
            "arg=/next-issue 2288",
        ]);
    });

    it("stops on an empty batch — and a deferred issue's number is not a head", () => {
        // The reason the plan is read through `bun -e` and not a `grep -o` on
        // the JSON: `deferred` and `skipped` entries carry `number` fields
        // too, so a first-match scan hands the pass a DEFERRED issue exactly
        // when the batch is empty and it must hand it nothing.
        stubGhCountingFrom(5);
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo '{"version":1,"batch":[],"deferred":[{"number":9999,"reason":"blocked","conflictsWith":null}],"skipped":[],"staleClaims":[]}'`,
                `  exit 0`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        writeStub("claude", `echo "$@" > "${path.join(tmp, "ran")}"\nexit 0`);
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.stdout).toMatch(/reason=preflight-error/);
        expect(passLogCount()).toBe(0);
        // The deferred issue must not have leaked into a prompt on the way out.
        expect(fs.existsSync(path.join(tmp, "ran"))).toBe(false);
    });
});

describe("health RED — the green-main invariant (ADR 0110)", () => {
    const redMarker = (): string =>
        path.join(tmp, ".claude", "telemetry", "health", "RED");

    const writeRed = (): void => {
        fs.mkdirSync(path.dirname(redMarker()), { recursive: true });
        fs.writeFileSync(redMarker(), "main @ deadbeef red at test:app\n");
    };

    it("stops before running any pass when the marker exists", () => {
        // "A RED marker means fix-forward FIRST — never stack unrelated work
        // on a red tip" (ADR 0110). `land` only WARNS, which is the right
        // strength for a human who can read it; unattended there is nobody to.
        stubGhCountingFrom(5);
        stubClaudeProgress();
        writeRed();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.stdout).toMatch(/reason=health-red/);
        expect(passLogCount()).toBe(0);
    });

    it("exits non-zero — a red tip is a fault, not a clean finish", () => {
        // stop-file / max-passes / queue-empty / budget all exit 0; this must
        // not join them, or a wrapper that checks the exit code reads a night
        // aborted on a broken main as a night that finished its work.
        stubGhCountingFrom(5);
        writeRed();
        expect(run({ args: ["--claude-args", "x"] }).status).toBe(1);
    });

    it("names the marker's contents on stderr, so the morning log says what to fix", () => {
        stubGhCountingFrom(5);
        writeRed();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.stderr).toMatch(/the base tip is RED/);
        expect(r.stderr).toMatch(/red at test:app/);
    });

    it("runs normally when the marker is absent (proof the check is the marker, not the directory)", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        fs.mkdirSync(path.dirname(redMarker()), { recursive: true });
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.stdout).not.toMatch(/reason=health-red/);
        expect(passLogCount()).toBe(1);
    });
});
