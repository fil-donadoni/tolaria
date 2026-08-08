// Manual phase stepping (manual-mode QA round 3, item 5).
//
// The stepper is what Space dispatches, and the ONE thing that must not drift
// is its relationship to the two fallbacks around it: `manualPhase`
// (`manual-game-context.ts`) reads an unset/unknown marker as
// `PRECOMBAT_MAIN`, and `manualEndTurn` resets to the head of the order. A
// stepper that disagreed with either would either rewind the turn on the first
// keypress or reach a phase the board renders as something else.
import { describe, expect, it } from "vitest";
import { MANUAL_PHASE_ORDER } from "@convex/manual";
import { manualPhase } from "~/lib/manual-game-context";
import { nextManualPhase } from "~/lib/manual-phase";

describe("nextManualPhase", () => {
    it("steps through the whole turn in CR 500.1 order", () => {
        for (let i = 0; i < MANUAL_PHASE_ORDER.length - 1; i++) {
            expect(nextManualPhase(MANUAL_PHASE_ORDER[i])).toBe(
                MANUAL_PHASE_ORDER[i + 1]
            );
        }
    });

    it("wraps cleanup back to untap rather than ending the turn", () => {
        // Ending the turn is Enter's job (`manualEndTurn` — it moves the turn
        // number and the active seat). Space must never do it by accident.
        expect(nextManualPhase("CLEANUP")).toBe("UNTAP");
    });

    it("an unset marker steps forward from where the board reads it, not from the start", () => {
        // A fresh Manual Game has no marker; the board shows `PRECOMBAT_MAIN`.
        // Stepping to `UNTAP` would look like Space rewound the turn.
        expect(manualPhase(undefined)).toBe("PRECOMBAT_MAIN");
        expect(nextManualPhase(undefined)).toBe("BEGINNING_OF_COMBAT");
        expect(nextManualPhase("NOT_A_PHASE")).toBe("BEGINNING_OF_COMBAT");
    });

    it("every phase it can reach is one the board's own validator accepts", () => {
        let phase: string = MANUAL_PHASE_ORDER[0];
        for (let i = 0; i < MANUAL_PHASE_ORDER.length + 1; i++) {
            phase = nextManualPhase(phase);
            expect(manualPhase(phase)).toBe(phase);
        }
    });
});
