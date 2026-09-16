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
import { clearAiTraces, getAiTraces } from "~/lib/ai/trace-store";
import {
    AI_TRACE_SEAM_RECORDS,
    AI_TRACE_SEAM_TRACES,
} from "~/lib/ai/dev-trace-seam";

import AiDecisionTraceBox from "../ai-decision-trace-box";

beforeEach(() => {
    cleanup();
    clearAiTraces();
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
