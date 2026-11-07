import { describe, expect, it } from "vitest";
import {
    churnMarkdown,
    dequeueCause,
    isDequeueComment,
    queueChurn,
    type ChurnFacts,
} from "../lib/queue-churn";
import dequeues from "./fixtures/queue-churn/dequeue-comments.json";
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
            "checks-timeout": 0,
            conflict: 1,
            "ready-to-land-gone": 0,
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

    it("reads a comment without a code off the Reason section only", () => {
        expect(dequeueCause("failing checks, no Reason heading")).toBe("other");
        expect(dequeueCause("## Reason\nthe queue was interrupted")).toBe(
            "interrupted"
        );
    });

    it("reads the unticked conditions of a comment without a code", () => {
        expect(dequeueCause("## Reason\n> - [ ] `label=ready-to-land`")).toBe(
            "ready-to-land-gone"
        );
    });

    it.each(dequeues.map((d) => [d.source, d.cause, d.body]))(
        "classifies the real Mergify comment %s as %s",
        (_source, cause, body) => {
            expect(isDequeueComment(body)).toBe(true);
            expect(dequeueCause(body)).toBe(cause);
        }
    );

    const dequeued = (code: string, rest: string): string =>
        `<!---\n-*- Mergify Payload -*-\n${JSON.stringify({ state: "dequeued", dequeue_reason: { code } })}\n-*- Mergify Payload End -*-\n-->\n${rest}`;

    it("prefers the payload code over the comment's text", () => {
        expect(
            dequeueCause(dequeued("CHECKS_FAILED", "## Reason\ninterrupted"))
        ).toBe("checks-failed");
    });

    it("reads an unknown code as other", () => {
        expect(
            dequeueCause(dequeued("NEVER_SEEN", "## Reason\nfailing checks"))
        ).toBe("other");
    });

    it("counts only an unticked queue condition under PR_DEQUEUED", () => {
        expect(
            dequeueCause(
                dequeued(
                    "PR_DEQUEUED",
                    "> - [x] `-conflict`\n>   - [ ] `label=ready-to-land`"
                )
            )
        ).toBe("ready-to-land-gone");
    });

    it("ignores the merge conditions list under PR_DEQUEUED", () => {
        expect(
            dequeueCause(
                dequeued(
                    "PR_DEQUEUED",
                    "> - [ ] `-label=land-failed`\n\n- [ ] `label=ready-to-land`"
                )
            )
        ).toBe("other");
    });
});
