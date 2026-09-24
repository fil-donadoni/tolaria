import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    DRIVER,
    REAL_BUN,
    tmp,
    queueFile,
    writeStub,
    stubGhCountingFrom,
    stubClaudeProgress,
    stubClaudeNoProgress,
    stubBunUsageWindow,
    planBranch,
    stubBunReap,
    run,
    passLogCount,
} from "./loop-drain-harness";

installLoopDrainHarness();

describe("--prompt — the prompt each pass runs", () => {
    /** `claude` stub that RECORDS its own argv, one line per element, and
     * exits 0. This is what makes the quoting assertions real: a dry-run
     * echo only proves the driver can print the prompt, while the argv file
     * proves what the process actually received — the difference between
     * `claude -p "/process-gh-issues figli di 2405"` (one argument) and the
     * word-split `-p /process-gh-issues figli di 2405` (four), which would
     * silently drain the wrong queue all night. */
    const stubClaudeRecordingArgv = (): string => {
        const argvFile = path.join(tmp, "claude-argv");
        writeStub(
            "claude",
            [
                `{ echo "argc=$#"; for a in "$@"; do echo "arg=$a"; done; } > "${argvFile}"`,
                `echo "recorded"`,
                `exit 0`,
            ].join("\n")
        );
        return argvFile;
    };

    /** One pass with a real (argv-recording) `claude`, then stop on
     * max-passes. Returns the argv the driver handed to `claude`. */
    const argvForOnePass = (extraArgs: string[]): string[] => {
        stubGhCountingFrom(5);
        const argvFile = stubClaudeRecordingArgv();
        const r = run({
            args: ["--claude-args", "x", "--max-passes", "1", ...extraArgs],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
        return fs.readFileSync(argvFile, "utf8").trim().split("\n");
    };

    it("defaults to /next-issue with the resolved issue appended and its tier injected (#3083)", () => {
        // The default path is the single-session pipeline (ADR 0110), and the
        // pass is HANDED its issue and its tier rather than re-deriving both
        // from inside the model's context. The default `bun` stub answers the
        // pre-flight with issue 101 on sonnet.
        expect(argvForOnePass([])).toEqual([
            "argc=5",
            "arg=--model",
            "arg=sonnet",
            "arg=-p",
            "arg=/next-issue 101",
            "arg=x",
        ]);
    });

    it("a --prompt override switches the pre-flight OFF — no issue appended, no --model injected, the multi-word prompt ONE argument", () => {
        // An operator who names the prompt owns the whole invocation: the
        // driver must not append an issue number to a scoped prompt, nor
        // second-guess the tier they launched with.
        expect(
            argvForOnePass(["--prompt", "/process-gh-issues figli di 2405"])
        ).toEqual([
            "argc=3",
            "arg=-p",
            "arg=/process-gh-issues figli di 2405",
            "arg=x",
        ]);
    });

    it("treats $(...) / backticks in the prompt as literal text, never as shell", () => {
        const prompt = "/process-gh-issues $(touch pwned) `touch pwned2` a=b";
        expect(argvForOnePass(["--prompt", prompt])).toEqual([
            "argc=3",
            "arg=-p",
            `arg=${prompt}`,
            "arg=x",
        ]);
        expect(fs.existsSync(path.join(tmp, "pwned"))).toBe(false);
        expect(fs.existsSync(path.join(tmp, "pwned2"))).toBe(false);
    });

    it("prints the prompt actually used in the --dry-run echo", () => {
        // The dry run is how a human checks a scoped run BEFORE committing a
        // night to it — echoing the hardcoded default there would be a lie.
        stubGhCountingFrom(5);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-passes",
                "1",
                "--dry-run",
                "--prompt",
                "/process-gh-issues figli di 2405",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stderr).toMatch(
            /would run: CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p "\/process-gh-issues figli di 2405" x/
        );
    });

    it('rejects an empty --prompt instead of running `claude -p ""` forever', () => {
        stubGhCountingFrom(5);
        const r = run({ args: ["--claude-args", "x", "--prompt", ""] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/--prompt must not be empty/);
        expect(passLogCount()).toBe(0);
    });
});

describe("bad arguments", () => {
    it("rejects an unknown flag", () => {
        const r = run({ args: ["--not-a-real-flag"] });
        expect(r.status).toBe(2);
    });

    it("rejects a non-numeric --max-passes instead of silently running unbounded", () => {
        // Before the fix, `[ "$MAX_PASSES" -gt 0 ] 2>/dev/null` swallowed
        // `test`'s error on a non-numeric value, the `if` read that as
        // "false", and the driver ran with NO pass ceiling at all — exit 0,
        // no error, just unbounded.
        stubGhCountingFrom(1000);
        stubClaudeProgress();
        const r = run({
            args: ["--claude-args", "x", "--max-passes", "abc"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/--max-passes must be a non-negative integer/);
        expect(passLogCount()).toBe(0);
    });

    it("rejects a non-numeric --max-pct instead of silently comparing against 0", () => {
        // Before the fix, awk's `m+0` coerced "abc" to 0, so the guard
        // tripped on pass 0 with reason=budget and exit 0 — a typo silently
        // reported as a normal, successful stop.
        stubGhCountingFrom(5);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--budget",
                "10000",
                "--max-pct",
                "abc",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/--max-pct must be numeric/);
        expect(passLogCount()).toBe(0);
    });

    it("rejects a non-numeric --budget (suffix/separator shapes)", () => {
        stubGhCountingFrom(5);
        const r = run({ args: ["--claude-args", "x", "--budget", "2M"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/--budget must be a plain number/);
        expect(passLogCount()).toBe(0);
    });

    it("accepts a valid numeric --max-passes/--max-pct/--budget combination", () => {
        stubGhCountingFrom(1000);
        stubClaudeProgress();
        stubBunUsageWindow(10, 100);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-passes",
                "2",
                "--max-pct",
                "80",
                "--budget",
                "10000",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
    }, 15000);
});

/**
 * Orphan-claim reap (#2627).
 *
 * A pass that dies holding claims leaves `in-progress` on issues nothing will
 * ever release; every later pass skips them as somebody else's live work. The
 * skill has asked its pass to sweep "every pass, unconditionally, before
 * selection" since it was written — as PROSE in SKILL.md §1a, which an LLM
 * pass follows or does not. These tests pin the mechanical half: the DRIVER
 * runs the sweep, before it counts the queue, and never decides for itself
 * what is stale.
 */
describe("orphan-claim reap (#2627)", () => {
    it("delegates the verdict to loop-doctor instead of carrying a claim rule of its own", () => {
        // AC: "The existing claim classifier is the sole authority; no second
        // age threshold is added." A source check, deliberately — the
        // behavioural tests below would pass just as happily against a shell
        // re-implementation that greps `gh issue list` for old claims, which
        // is exactly the drift this AC forbids (and the shape already sitting
        // in queue-plan.ts's `staleClaimHours`, a second opinion this driver
        // must not reach for).
        const source = fs.readFileSync(DRIVER, "utf8");
        expect(source).toMatch(/loop-doctor\.ts/);
        expect(source).toMatch(/--release/);
        // The driver must not edit labels itself, nor own an hours
        // threshold. (`--remove-label` appears once in a COMMENT about the
        // handoff grace period, so the label assertion is on the invocation
        // shape, not the flag string.)
        expect(source).not.toMatch(/gh\s+issue\s+edit/);
        expect(source).not.toMatch(/STALE_CLAIM_HOURS|staleClaimHours/i);
    });

    it("sweeps BEFORE the queue is counted, so a reclaimed issue is work this pass can pick up", () => {
        // The 2026-08-19 shape end to end: the queue reads empty because the
        // only remaining candidates are claimed by a pass that died. Sweeping
        // after the count would let the driver quit with `queue-empty` on a
        // queue the sweep was about to refill — so the ordering IS the fix,
        // and this test is the only thing that pins it.
        stubGhCountingFrom(0);
        stubBunReap(
            [
                // Release exactly once: the "orphan" it reclaims returns to
                // the unclaimed queue.
                `    if [ ! -f "${path.join(tmp, "reaped")}" ]; then`,
                `      : > "${path.join(tmp, "reaped")}"`,
                `      echo 1 > "${queueFile}"`,
                `      echo "released  #1841 — no branch, no PR, untouched for 30h"`,
                `    fi`,
                `    exit 0`,
            ].join("\n")
        );
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
        // One pass ran: without the sweep preceding the count, the driver
        // would have seen 0 and stopped before running any.
        expect(passLogCount()).toBe(1);
    });

    it("reports what the sweep reclaimed, so an operator can see it in the driver's own output", () => {
        // AC: "The release is recorded, so an operator can see what was
        // reclaimed and why." loop-doctor writes the durable record into the
        // claim journal; the driver's job is not to swallow it.
        stubGhCountingFrom(1);
        stubBunReap(
            [
                `    echo "released  #1841 — no branch, no PR, untouched for 30h"`,
                `    exit 0`,
            ].join("\n")
        );
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.stderr).toMatch(/orphan-claim sweep/);
        expect(r.stderr).toMatch(/released {2}#1841 — no branch, no PR/);
    });

    it("is a janitor, not a guard — a failing sweep is reported and the run continues", () => {
        // An unattended run must not die because `gh` rate-limited the
        // sweep. But it must not go quiet either: a janitor that stopped
        // running without saying so is how the prose version of this rule
        // failed in the first place.
        stubGhCountingFrom(1);
        stubBunReap(
            [`    echo "gh: API rate limit exceeded" >&2`, `    exit 1`].join(
                "\n"
            )
        );
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stderr).toMatch(/orphan-claim sweep FAILED/);
        expect(r.stderr).toMatch(/API rate limit exceeded/);
        expect(passLogCount()).toBe(1);
    });

    // ── --dry-run must reach no `gh issue edit` (round-2 review) ─────────
    //
    // The sweep runs at step 3b, ABOVE the `--dry-run` branch that only ECHOES
    // the pass — so before the guard, `loop:drain --dry-run` reclaimed claims
    // and wrote them to the GitHub board. The verdict behind those writes was
    // correct; the flag's contract ("lands nothing") was not.
    //
    // Deliberately end-to-end through the REAL loop-doctor rather than an argv
    // assertion on a stub: what the flag promises is that no `gh issue edit`
    // happens, and only running the thing that would issue it can show that.
    // `gh` here is a recorder, exactly as the reviewer's repro was.
    const stubRealSweepAgainstRecordingGh = (): string => {
        const editLog = path.join(tmp, "gh-issue-edit-calls");
        const claimedJson = path.join(tmp, "claimed.json");
        // 30h stale, so `classifyClaim` reads it as an orphan on the
        // no-branch/no-PR path (2h threshold) and `--release` would edit it.
        fs.writeFileSync(
            claimedJson,
            JSON.stringify([
                {
                    number: 9001,
                    title: "an orphaned claim",
                    updatedAt: new Date(
                        Date.now() - 30 * 60 * 60 * 1000
                    ).toISOString(),
                },
            ])
        );
        writeStub(
            "gh",
            [
                `args="$*"`,
                `case "$args" in`,
                // The one write in the whole subsystem. Recorded, never made.
                `  *"issue edit"*) echo "$args" >> "${editLog}" ; exit 0 ;;`,
                `  *"pr list"*) echo '[]' ; exit 0 ;;`,
                // loop-doctor's claimed-issue read (the driver's own counts
                // ask for `--json number` only).
                `  *"number,title,updatedAt"*) cat "${claimedJson}" ; exit 0 ;;`,
                `  *) cat "${queueFile}" 2>/dev/null || echo 0 ;;`,
                `esac`,
            ].join("\n")
        );
        // loop-doctor's branch scans: no local branch, no remote branch.
        writeStub("git", `exit 0`);
        // Forward everything to the real bun, so the sweep the driver invokes
        // is the real `scripts/loop-doctor.ts` — except the pre-flight's own
        // `queue:plan`, which would otherwise run the real planner against the
        // recording `gh` above, fail to resolve a head, and stop the run
        // before the sweep's assertions have anything to look at.
        writeStub("bun", [planBranch(), `exec "${REAL_BUN}" "$@"`].join("\n"));
        fs.writeFileSync(queueFile, "1");
        return editLog;
    };

    /** Hermetic ledger root: without this, an ambient CLAUDE_PROJECT_DIR (set
     *  in every Claude Code session, including the one running this suite)
     *  would point the real loop-doctor at the REPO's claims.jsonl and have it
     *  append a release row there. */
    const sweepEnv = () => ({ CLAUDE_PROJECT_DIR: tmp });

    it("--dry-run runs the sweep in report-only mode and makes NO board write", () => {
        const editLog = stubRealSweepAgainstRecordingGh();
        const r = run({
            args: ["--claude-args", "x", "--dry-run", "--max-passes", "1"],
            env: sweepEnv(),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        // THE assertion: not one `gh issue edit` was reached.
        expect(
            fs.existsSync(editLog)
                ? fs.readFileSync(editLog, "utf8")
                : "(no gh issue edit call)"
        ).toBe("(no gh issue edit call)");
        expect(r.stderr).not.toMatch(/^released {2}#9001/m);
        // The sweep still RAN and still reported the orphan it can see —
        // report-only, not skipped, so a dry run still shows the operator
        // what a real run would reclaim.
        expect(r.stderr).toMatch(/\[dry-run\] orphan-claim sweep/);
        expect(r.stderr).toMatch(/#9001/);
        expect(r.stderr).toMatch(/1 claimed, 1 orphaned/);
    });

    it("without --dry-run the same setup DOES edit the board (the paired half — proof the recorder works)", () => {
        const editLog = stubRealSweepAgainstRecordingGh();
        stubClaudeNoProgress();
        const r = run({
            args: ["--claude-args", "x", "--max-passes", "1"],
            env: sweepEnv(),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.existsSync(editLog)).toBe(true);
        expect(fs.readFileSync(editLog, "utf8")).toMatch(
            /issue edit 9001 --remove-label in-progress/
        );
    });

    it("sweeps on EVERY pass, not once per run", () => {
        // A pass can die holding claims at any point in an overnight run, so
        // a once-at-startup sweep would leave every later orphan standing
        // until morning — the exact latency #2627 is about.
        const counter = path.join(tmp, "reap-calls");
        stubGhCountingFrom(3);
        stubBunReap(
            [
                `    n=$(cat "${counter}" 2>/dev/null || echo 0)`,
                `    echo $((n + 1)) > "${counter}"`,
                `    exit 0`,
            ].join("\n")
        );
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x", "--max-passes", "3"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(passLogCount()).toBe(3);
        expect(Number(fs.readFileSync(counter, "utf8").trim())).toBe(3);
    });
});
