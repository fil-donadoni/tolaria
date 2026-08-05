import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

import {
    classifyRole,
    summarizeLoop,
    type ScorecardReceipt,
    type TelemetryEvent,
} from "../lib/scorecard";

/**
 * Loop scorecard (issue #2187, PRD #2180).
 *
 * **The metric definitions are the deliverable, so they are pinned against a
 * FROZEN sample.** A rate that is silently redefined is worse than no rate: the
 * series stays plausible while measuring something else, and nothing in a diff
 * distinguishes "fixed the denominator" from "changed what the number means".
 * Every expectation below is a definition; changing one is a deliberate edit.
 */

const FIXTURES = path.join(__dirname, "fixtures", "telemetry");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const events = (): TelemetryEvent[] =>
    fs
        .readFileSync(path.join(FIXTURES, "events.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as TelemetryEvent);

const receipts = (): ScorecardReceipt[] =>
    JSON.parse(
        fs.readFileSync(path.join(FIXTURES, "receipts.json"), "utf8")
    ) as ScorecardReceipt[];

// The fixture's batch-a events span ts 1000..2200; ts 9000+ is the
// out-of-window batch that must not leak into any figure.
const WINDOW = { from: 900, to: 3000 };
const card = () =>
    summarizeLoop({ events: events(), receipts: receipts(), window: WINDOW });

describe("the window is a real filter, not a label", () => {
    it("excludes events outside it", () => {
        // batch-later carries 999,999 tokens at ts 9000. If the filter were
        // cosmetic every token figure would be dominated by it.
        expect(card().tokensByRole.implement).toBe(100_000);
        expect(card().agentSpawns).toBe(6);
    });
});

describe("issuesShipped — the definition", () => {
    it("counts an issue whose implement receipt is pr-open and unblocked", () => {
        // #101: implement pr-open + approve.
        expect(card().issuesShipped).toBe(2);
    });

    it("counts an issue whose blocking verdict a fixup answered", () => {
        // #102: implement pr-open, review BLOCKING, fixup pr-open. The block was
        // resolved and the PR shipped — excluding it would inflate every
        // per-issue cost by exactly the work the loop is designed to do.
        const only = summarizeLoop({
            events: [],
            receipts: [
                {
                    batch: "b",
                    role: "implement",
                    issue: 102,
                    outcome: "pr-open",
                },
                { batch: "b", role: "review", issue: 102, outcome: "blocking" },
                { batch: "b", role: "fixup", issue: 102, outcome: "pr-open" },
            ],
            window: WINDOW,
        });
        expect(only.issuesShipped).toBe(1);
    });

    it("does NOT count an issue still on an unanswered blocking verdict", () => {
        const only = summarizeLoop({
            events: [],
            receipts: [
                {
                    batch: "b",
                    role: "implement",
                    issue: 102,
                    outcome: "pr-open",
                },
                { batch: "b", role: "review", issue: 102, outcome: "blocking" },
            ],
            window: WINDOW,
        });
        expect(only.issuesShipped).toBe(0);
    });

    it("does NOT count an issue whose latest receipt is wip", () => {
        const only = summarizeLoop({
            events: [],
            receipts: [
                {
                    batch: "b",
                    role: "implement",
                    issue: 102,
                    outcome: "pr-open",
                },
                { batch: "b", role: "fixup", issue: 102, outcome: "wip" },
            ],
            window: WINDOW,
        });
        expect(only.issuesShipped).toBe(0);
    });

    it("does NOT count a collision", () => {
        expect(card().collisionAborts).toBe(1);
        // #103 collided; it is neither shipped nor silently dropped.
        expect(card().issuesShipped).toBe(2);
    });
});

describe("tokens by role", () => {
    it("splits the fixture exactly", () => {
        const c = card();
        expect(c.tokensByRole).toEqual({
            implement: 100_000, // #101 40k + #102 60k
            review: 20_000, // 12k + 8k
            fixup: 15_000,
            orchestrator: 0, // no non-Agent post event carries tokens
            unclassified: 5_000, // the Explore spawn: not a loop role
        });
    });

    it("reports per-issue figures against the shipped denominator", () => {
        expect(card().tokensPerIssueByRole?.implement).toBe(50_000);
        expect(card().tokensPerIssueByRole?.review).toBe(10_000);
    });

    it("reports what it could not attribute, rather than folding it in", () => {
        // 5k of 140k agent tokens. A split that quietly bucketed the Explore
        // spawn into `implement` would look identical to a real one.
        expect(card().unclassifiedTokenShare).toBeCloseTo(5000 / 140_000, 6);
    });

    it("classifies each role from the spawn's own fields", () => {
        const at = (desc: string, type: string | null = null): TelemetryEvent =>
            ({
                ts: 1,
                phase: "pre",
                session: "s",
                tool: "Agent",
                id: "x",
                agent_desc: desc,
                agent_type: type,
            }) as TelemetryEvent;
        expect(classifyRole(at("Review PR for #12"))).toBe("review");
        expect(classifyRole(at("anything", "code-reviewer"))).toBe("review");
        expect(classifyRole(at("Fixup #12 after blocking"))).toBe("fixup");
        expect(classifyRole(at("Implement #12"))).toBe("implement");
        expect(classifyRole(at("work on #12"))).toBe("implement");
        expect(classifyRole(at("map the subsystem", "Explore"))).toBe(
            "unclassified"
        );
        expect(
            classifyRole({
                ts: 1,
                phase: "pre",
                session: "s",
                tool: "Bash",
                id: "x",
            } as TelemetryEvent)
        ).toBe("orchestrator");
    });
});

describe("review-blocking rate — the evidence for cheap-implementer/strong-reviewer", () => {
    it("is blocked ÷ reviews, with the denominator reported", () => {
        expect(card().reviewsRecorded).toBe(2);
        expect(card().reviewBlockingRate).toBe(0.5);
    });

    it("is null, not zero, when no review was recorded", () => {
        // "the reviewer blocked nothing" and "no review happened" are the same
        // number and opposite facts.
        const only = summarizeLoop({
            events: events(),
            receipts: [
                { batch: "b", role: "implement", issue: 1, outcome: "pr-open" },
            ],
            window: WINDOW,
        });
        expect(only.reviewBlockingRate).toBeNull();
        expect(only.reviewsRecorded).toBe(0);
    });
});

describe("fixup rounds as a distribution — the tail is the point", () => {
    it("reports a histogram, not a mean", () => {
        // #101 shipped with 0 fixups, #102 with 1.
        expect(card().fixupRounds).toEqual({ 0: 1, 1: 1 });
    });

    it("keeps a three-round issue visible instead of averaging it away", () => {
        const only = summarizeLoop({
            events: [],
            receipts: [
                { batch: "b", role: "implement", issue: 1, outcome: "pr-open" },
                { batch: "b", role: "implement", issue: 2, outcome: "pr-open" },
                { batch: "b", role: "implement", issue: 3, outcome: "pr-open" },
                { batch: "b", role: "fixup", issue: 3, outcome: "wip" },
                { batch: "b", role: "fixup", issue: 3, outcome: "wip" },
                { batch: "b", role: "fixup", issue: 3, outcome: "pr-open" },
            ],
            window: WINDOW,
        });
        // A mean would read 1.0 and hide that one issue took three rounds.
        expect(only.fixupRounds).toEqual({ 0: 2, 3: 1 });
    });
});

describe("one gate per landing tree — the invariant, measured", () => {
    it("counts only FULL gates, not the light pre-PR gate", () => {
        // The fixture runs `bun run test`, `bun run check:pr`, `bun run check:all`.
        // `check:pr` is the light gate and must not inflate the count.
        expect(card().gateRuns).toBe(2);
        expect(card().gateRunsPerShippedIssue).toBe(1);
    });
});

describe("model tier — the failure this loop has already paid for", () => {
    it("counts spawns that passed no model and inherited the session tier", () => {
        // #102's implement spawn and the fixup spawn passed no model.
        expect(card().inheritedModelSpawns).toBe(2);
        expect(card().agentSpawns).toBe(6);
        expect(card().inheritedModelShare).toBeCloseTo(2 / 6, 6);
    });
});

describe("an empty window says so", () => {
    it("reports zeroes AND flags that there was nothing to measure", () => {
        const empty = summarizeLoop({
            events: events(),
            receipts: [],
            window: { from: 500_000, to: 600_000 },
        });
        expect(empty.hasData).toBe(false);
        expect(empty.issuesShipped).toBe(0);
        expect(empty.notes.join(" ")).toMatch(/nothing to measure/i);
    });

    it("never divides by zero — per-issue figures are null, not Infinity or 0", () => {
        const noShips = summarizeLoop({
            events: events(),
            receipts: [
                {
                    batch: "batch-a",
                    role: "implement",
                    issue: 1,
                    outcome: "wip",
                },
            ],
            window: WINDOW,
        });
        expect(noShips.issuesShipped).toBe(0);
        expect(noShips.wallClockPerIssueSec).toBeNull();
        expect(noShips.gateRunsPerShippedIssue).toBeNull();
        expect(noShips.tokensPerIssueByRole).toBeNull();
        expect(noShips.notes.join(" ")).toMatch(/per-issue figure is null/i);
    });

    it("distinguishes no-telemetry from no-receipts", () => {
        const noEvents = summarizeLoop({
            events: [],
            receipts: receipts(),
            window: WINDOW,
        });
        expect(noEvents.hasData).toBe(true);
        expect(noEvents.notes.join(" ")).toMatch(/No telemetry events/);
        expect(noEvents.issuesShipped).toBe(2); // receipt figures are still real
    });
});

describe("the CLI prints the scorecard for a window", () => {
    it("runs against the frozen fixture and emits the pinned numbers", () => {
        const result = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "loop-scorecard.ts"),
                "--days",
                "36500", // wide enough to contain the fixture's 1970 timestamps
                "--events",
                path.join(FIXTURES, "events.jsonl"),
                "--receipts",
                path.join(FIXTURES, "no-such-dir"),
                "--json",
            ],
            { cwd: REPO_ROOT, encoding: "utf8" }
        );
        expect(result.status, result.stderr).toBe(0);
        const parsed = JSON.parse(result.stdout) as {
            agentSpawns: number;
            gateRuns: number;
            notes: string[];
        };
        // No receipt directory: telemetry figures are real, receipt figures say so.
        expect(parsed.agentSpawns).toBe(7); // includes the out-of-window batch
        expect(parsed.gateRuns).toBe(2);
        expect(parsed.notes.join(" ")).toMatch(/No receipts supplied/);
    });
});
