// Pure derivation shared between the public GitHub-issue body
// (`buildGameStateSection`, `convex/bugReports.ts`) and the `/admin/bug-
// reports` detail view's header (`BugReportSnapshotHeader`,
// `src/components/admin/`), issue #2250. `describeOwedInput` is already
// exercised via `convex/__tests__/bugReports.test.ts` (re-exported
// unchanged); this file covers the new structured entry point.
import { describe, it, expect } from "vitest";
import { summarizeGameSnapshot } from "../bugReportSummary";

describe("summarizeGameSnapshot (issue #2250)", () => {
    it("derives the header facts from the state", () => {
        const summary = summarizeGameSnapshot({
            gameId: "g1",
            seq: 5,
            state: {
                turn: 3,
                phase: "COMBAT",
                activePlayerId: "p1",
                priorityPlayerId: "p2",
            },
        });
        expect(summary).toEqual({
            gameId: "g1",
            seq: 5,
            turn: "3",
            phase: "COMBAT",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            owedInput: [],
        });
    });

    it("includes owed input alongside the facts", () => {
        const summary = summarizeGameSnapshot({
            gameId: "g1",
            seq: 1,
            state: { pendingChoices: [{ kind: "a" }, { kind: "b" }] },
        });
        expect(summary.owedInput).toEqual(["pendingChoices[2]"]);
    });

    it('falls back to "?" for missing facts', () => {
        const summary = summarizeGameSnapshot({
            gameId: "g",
            seq: 0,
            state: {},
        });
        expect(summary.turn).toBe("?");
        expect(summary.phase).toBe("?");
        expect(summary.activePlayerId).toBe("?");
        expect(summary.priorityPlayerId).toBe("?");
    });
});
