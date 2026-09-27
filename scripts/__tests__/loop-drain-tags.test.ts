// The driver's tagged output (issue #4721, ADR 0147). The AFK terminal
// renderer (`scripts/lib/loop-render.ts`) classifies lines by a closed set of
// tags and never by message text, so the tags ARE the contract between the
// two: a tag the driver stops emitting silently turns a pass rule or the
// summary box back into body text, and nothing else would notice.
//
// The pass-END line is new and carries the log row's facts; asserting it field
// by field against the row is what keeps the footer from describing a pass
// the log does not have.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    installLoopDrainHarness,
    writeStub,
    stubGhCountingFrom,
    stubClaudeProgress,
    stubBunPlanHead,
    stubBunUsageWindow,
    run,
    logLines,
    tmp,
    bin,
} from "./loop-drain-harness";
import { parseFields } from "../lib/loop-render";
import { SESSION_ID_RE as UUID_RE } from "../lib/live-activity";

installLoopDrainHarness();

/** The `k=v` fields of the one `loop-drain[end]:` line in `text`. */
const endFields = (text: string): Record<string, string>[] =>
    text
        .split("\n")
        .filter((l) => l.startsWith("loop-drain[end]: "))
        .map((l) => parseFields(l));

describe("driver output tags (issue #4721)", () => {
    it("tags the pass start, the pass end and the run summary", () => {
        stubGhCountingFrom(5);
        stubBunPlanHead(2707, "opus");
        stubClaudeProgress();
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);

        expect(r.stderr).toMatch(
            /^loop-drain\[pass\]: pass 1 — issue #2707 on tier opus\. session=[0-9a-f-]{36}$/m
        );
        expect(r.stdout).toMatch(
            /^loop-drain\[summary\]: passes=1 reason=max-passes .* duration=\d+$/m
        );
        // The untagged `loop-drain summary:` form is gone — one shape only.
        expect(r.stdout).not.toMatch(/loop-drain summary:/);
    });

    it("emits a pass-end line carrying the log row's own facts", () => {
        stubGhCountingFrom(5);
        stubBunPlanHead(2707, "opus");
        stubClaudeProgress();
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);

        const rows = logLines();
        expect(rows).toHaveLength(1);
        // epoch pass exit pct queue_before queue_after spent budget session reason
        const [, pass, exit, pct, qb, qa, spent, budget, , reason] =
            rows[0].split(" ");
        const ends = endFields(r.stderr);
        expect(ends).toHaveLength(1);
        expect(ends[0]).toMatchObject({
            pass,
            exit,
            pct,
            queue_before: qb,
            queue_after: qa,
            spent,
            budget,
            reason,
            ceiling: "-",
            retry: "0",
        });
        expect(ends[0].duration).toMatch(/^\d+$/);
    });

    it("carries the effective ceiling on the run banner, the pass end and the summary", () => {
        stubGhCountingFrom(5);
        stubClaudeProgress();
        stubBunUsageWindow(10, 100);
        const r = run({
            args: ["--max-passes", "1", "--budget", "1000", "--max-pct", "80"],
            env: { TOLARIA_LOOP_ALLOW_NO_BUDGET: "" },
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);

        expect(r.stderr).toMatch(
            /^loop-drain\[run\]: run \S+ — budget 1000 .* effective ceiling 800 tokens/m
        );
        expect(endFields(r.stderr)[0]).toMatchObject({
            spent: "100",
            budget: "1000",
            ceiling: "800",
        });
        expect(r.stdout).toMatch(
            /^loop-drain\[summary\]: .*spent=100 budget=1000 ceiling=800 /m
        );
    });

    it("carries the retry delay on a crashed pass and tags the crash as an error", () => {
        stubGhCountingFrom(5);
        writeStub("claude", `echo "boom"\nexit 17`);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-passes",
                "1",
                "--error-backoff-secs",
                "1",
            ],
        });
        expect(endFields(r.stderr)[0]).toMatchObject({
            exit: "17",
            reason: "claude-retry",
            retry: "1",
        });
        expect(r.stderr).toMatch(/^loop-drain\[error\]: pass 1 crashed/m);
    });

    it("binds each pass to ONE session id: argv, pass tag and log row agree (issue #4722)", () => {
        stubGhCountingFrom(5);
        stubBunPlanHead(2707, "opus");
        // Records each pass's argv on its own line, then makes progress.
        const argvFile = path.join(tmp, "claude-argv");
        stubClaudeProgress();
        const progress = fs.readFileSync(path.join(bin, "claude"), "utf8");
        writeStub(
            "claude",
            `echo "$*" >> "${argvFile}"\n${progress.replace(/^#!.*\n/, "")}`
        );
        const r = run({ args: ["--max-passes", "2"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);

        const fromArgv = fs
            .readFileSync(argvFile, "utf8")
            .trim()
            .split("\n")
            .map((l) => /--session-id (\S+) /.exec(l)?.[1]);
        const fromTags = [
            ...r.stderr.matchAll(/^loop-drain\[pass\]: .* session=(\S+)$/gm),
        ].map((m) => m[1]);
        const fromRows = logLines().map((l) => l.split(" ")[8]);

        expect(fromArgv).toHaveLength(2);
        for (const id of fromArgv) expect(id).toMatch(UUID_RE);
        expect(fromTags).toEqual(fromArgv);
        expect(fromRows).toEqual(fromArgv);
        // A fresh id per pass — two passes never share a transcript.
        expect(fromArgv[0]).not.toBe(fromArgv[1]);
    });

    it.skipIf(fs.existsSync("/proc/sys/kernel/random/uuid"))(
        "stops preflight-error, running no pass, when no session id can be minted",
        () => {
            stubGhCountingFrom(5);
            stubClaudeProgress();
            writeStub("uuidgen", "exit 1");
            const r = run({ args: ["--max-passes", "1"] });
            expect(r.stdout).toMatch(/reason=preflight-error/);
            expect(r.stderr).toMatch(/could not mint a session id/);
            expect(r.stderr).not.toMatch(/loop-drain\[pass\]/);
            expect(logLines()).toHaveLength(0);
        }
    );

    it("tags the override path's pass with its session id too", () => {
        stubGhCountingFrom(5);
        stubClaudeProgress();
        const r = run({
            args: ["--max-passes", "1", "--prompt", "/process-gh-issues x"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stderr).toMatch(
            /^loop-drain\[pass\]: pass 1 — prompt "\/process-gh-issues x"\. session=[0-9a-f-]{36}$/m
        );
    });

    it("tags a run-level warning", () => {
        stubGhCountingFrom(0);
        const r = run({ args: ["--claude-args", ""] });
        expect(r.stderr).toMatch(
            /^loop-drain\[warn\]: WARNING — --claude-args is empty/m
        );
    });
});
