// The DEV-only AI trace seam, and the one property `check:ui`'s
// `game-debug-sheet-ai` surface rests on (ADR 0132 §4, issue #3652): the
// decision ring the surface measures is NON-EMPTY, and it got that way without
// a Bot ever holding priority.
//
// The other half of that claim — that the Bot is never owed an input while the
// probe measures — is a property of the declared position, and is asserted
// where the position lives (`scripts/__tests__/ui-gate-game-scenarios.test.ts`
// holds `activePlayer`/`priority` on the human seat). What can only be
// asserted here is that the seam fills the ring AT ALL, through the real box,
// and that a second call leaves the same ring: the lane retries an Infra
// Verdict by re-walking the surface, so a seam that appended would measure a
// different screen on the retry than on the first attempt.
//
// `.bot.test.tsx`, not `.test.tsx`: it drives the real `trace-store`, a
// bot-only module, and `bot-suite-boundary.test.ts` puts every test that
// imports one in the bot suite.
import { describe, it, expect, beforeEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
    clearAiDecisions,
    clearAiEscalations,
    clearAiTraces,
    getAiDecisions,
    getAiEscalations,
    getAiTraces,
    recordAiDecision,
    recordAiEscalation,
} from "~/lib/ai/trace-store";
import {
    AI_TRACE_SEAM_RECORDS,
    AI_TRACE_SEAM_TRACES,
} from "~/lib/ai/dev-trace-seam";

import AiDecisionTraceBox from "../ai-decision-trace-box";

beforeEach(() => {
    cleanup();
    // ALL THREE stores, because all three render inside the one measured box
    // and none of them is per-test state otherwise — the module holds them for
    // the lifetime of the page, which is the whole point of the case below.
    clearAiTraces();
    clearAiEscalations();
    clearAiDecisions();
    // The install is once-per-page by design, so the fixture has to undo it
    // between cases or only the first would exercise it.
    delete window.__tolariaAiTrace;
});

/** Seed through the global exactly as the walk does — `page.evaluate` reaches
 *  the seam by NAME, never by import, so a test that called the module
 *  function directly would pass while the walk found nothing. */
function seedThroughTheGlobal(): number {
    const seam = window.__tolariaAiTrace;
    if (!seam) throw new Error("the box mounted without installing the seam");
    let seeded = 0;
    act(() => {
        seeded = seam.seed();
    });
    return seeded;
}

describe("the AI trace seam (issue #3652)", () => {
    it("is installed by the box the surface measures, under the name the walk evaluates", () => {
        expect(window.__tolariaAiTrace).toBeUndefined();
        render(<AiDecisionTraceBox />);
        expect(typeof window.__tolariaAiTrace?.seed).toBe("function");
    });

    it("leaves the ring non-empty — the box stops showing its empty state", () => {
        render(<AiDecisionTraceBox />);
        // The state the walk used to measure, after pressing every `Clear`.
        expect(screen.getByText("No bot decision yet.")).toBeTruthy();

        expect(seedThroughTheGlobal()).toBe(AI_TRACE_SEAM_RECORDS);

        expect(screen.queryByText("No bot decision yet.")).toBeNull();
        expect(
            screen.getByText(
                new RegExp(`last decisions \\(${AI_TRACE_SEAM_RECORDS}\\)`)
            )
        ).toBeTruthy();
        // Every seeded decision is on screen by its own chosen move, so the
        // ring is a LIST and not one row rendered three times.
        for (const trace of AI_TRACE_SEAM_TRACES) {
            expect(
                screen.getAllByText(new RegExp(trace.chosen)).length
            ).toBeGreaterThan(0);
        }
    });

    it("is idempotent — a retried walk measures the ring the first attempt did", () => {
        render(<AiDecisionTraceBox />);
        seedThroughTheGlobal();
        const first = getAiTraces().map((r) => r.trace.chosen);

        expect(seedThroughTheGlobal()).toBe(AI_TRACE_SEAM_RECORDS);

        expect(getAiTraces().map((r) => r.trace.chosen)).toEqual(first);
        expect(
            screen.getByText(
                new RegExp(`last decisions \\(${AI_TRACE_SEAM_RECORDS}\\)`)
            )
        ).toBeTruthy();
    });

    it("empties the sibling logs the Bot fills before a position can be loaded", () => {
        // THE REGRESSION THIS GUARDS (PR #3697 review round 1). The node this
        // surface measures is `[data-ai-trace-body]`, and it holds THREE
        // sections: the ring, the escalation log and the outcome log. Each of
        // the latter two renders a header, a count, a `Clear` button and a row
        // list the moment its own store is non-empty.
        //
        // The Bot fills the outcome log on every walk, and the declared
        // position cannot prevent it: the pregame mulligan is a real decision
        // the Bot answers directly (`useVsAiDriver` → `recordAiDecision`), and
        // no scenario can be loaded during it at all — CR 103.5, where
        // `assertLiveGameCanContinue` refuses the MULLIGAN phase. Neither
        // sibling store is cleared on a game swap either; only the ring is. So
        // a seam that cleared the ring alone left a row count that moved with
        // whether the deal happened to need a mulligan.
        recordAiDecision({ outcome: "direct" });
        recordAiEscalation({
            rung: 1,
            expectedKind: "priority",
            action: "pass",
        });
        render(<AiDecisionTraceBox />);
        // The state the walk actually arrives in: the ring empty, both logs
        // holding a row and each offering its own `Clear`.
        expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(
            2
        );

        seedThroughTheGlobal();

        expect(getAiDecisions()).toEqual([]);
        expect(getAiEscalations()).toEqual([]);
        // One `Clear` left — the ring's, now the only non-empty section.
        expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(
            1
        );
    });

    it("pushes decisions the box renders as ordinary ones, never as the degraded path", () => {
        // `via: "worker"` on every seeded record: an `inline` one renders the
        // `fallback` badge (`ai-decision-summary.tsx`), which would put a
        // control on the measured screen that no healthy game shows.
        render(<AiDecisionTraceBox />);
        seedThroughTheGlobal();
        expect(getAiTraces().every((r) => r.via === "worker")).toBe(true);
        expect(screen.queryByText("fallback")).toBeNull();
    });
});
