import { describe, expect, it } from "vitest";
import {
    churnMarkdown,
    dequeueCause,
    queueChurn,
    type ChurnFacts,
} from "../lib/queue-churn";
import facts from "./fixtures/queue-churn/window.json";

const churn = queueChurn(facts as ChurnFacts);

describe("queueChurn (issue #6171)", () => {
    it("counts queue-lane runs in the half-open window, by conclusion", () => {
        expect(churn.queueLane.runs).toBe(6);
        expect(churn.queueLane.byConclusion).toEqual({
            cancelled: 2,
            success: 2,
            failure: 1,
            running: 1,
        });
        expect(churn.queueLane.perMerge).toBe(2);
    });

    it("counts pr-refresh runs in the window per merged PR", () => {
        expect(churn.merges).toBe(3);
        expect(churn.prRefresh).toEqual({ runs: 2, perMerge: 2 / 3 });
    });

    it("counts only Mergify dequeue comments in the window, by cause", () => {
        expect(churn.dequeues.total).toBe(3);
        expect(churn.dequeues.byCause).toEqual({
            "checks-failed": 1,
            conflict: 1,
            "manually-updated": 1,
            interrupted: 0,
            other: 0,
        });
    });

    it("has no ratio without a merge", () => {
        const none = queueChurn({ ...(facts as ChurnFacts), mergedPrs: [] });
        expect(none.queueLane.perMerge).toBeNull();
        expect(churnMarkdown(none, facts.window)).toContain("n/a");
    });

    it("reads the cause off the Reason section only", () => {
        expect(dequeueCause("failing checks, no Reason heading")).toBe("other");
        expect(dequeueCause("## Reason\nthe queue was interrupted")).toBe(
            "interrupted"
        );
    });
});
