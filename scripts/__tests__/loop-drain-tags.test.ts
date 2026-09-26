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
import {
    installLoopDrainHarness,
    writeStub,
    stubGhCountingFrom,
    stubClaudeProgress,
    stubBunPlanHead,
    stubBunUsageWindow,
    run,
    logLines,
} from "./loop-drain-harness";
import { parseFields } from "../lib/loop-render";

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
            /^loop-drain\[pass\]: pass 1 — issue #2707 on tier opus\.$/m
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
        // epoch pass exit pct queue_before queue_after spent budget reason
        const [, pass, exit, pct, qb, qa, spent, budget, reason] =
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

    it("tags a run-level warning", () => {
        stubGhCountingFrom(0);
        const r = run({ args: ["--claude-args", ""] });
        expect(r.stderr).toMatch(
            /^loop-drain\[warn\]: WARNING — --claude-args is empty/m
        );
    });
});
