// Unit tests for `drawTrigger` (CR 121.1 "when you draw a card") and its
// `nthDrawThisTurn` condition (issue #781, CR 121.1). Resolve-time behavior
// with a real card scenario lives in `sets/mom/__tests__/blue.test.ts`
// (Faerie Mastermind) and `sets/dmu/__tests__/black.test.ts` (Sheoldred).

import { describe, it, expect } from "vitest";
import type { CardDrawnEvent, PermanentView } from "../../../types";
import { drawTrigger, nthDrawThisTurn } from "../drawTrigger";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self-1",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeEvent(overrides: Partial<CardDrawnEvent> = {}): CardDrawnEvent {
    return {
        type: "CARD_DRAWN",
        playerId: "p2",
        count: 1,
        ...overrides,
    };
}

describe("drawTrigger — scope vocabulary", () => {
    const baseArgs = { id: "t", oracleText: "test", resolve: () => {} };

    it("scope: 'your' fires only when the drawer equals the source's controller", () => {
        const trig = drawTrigger({ ...baseArgs, scope: "your" });
        const self = makeSelf({ controllerId: "p1" });
        expect(trig.matches(makeEvent({ playerId: "p1" }), self)).toBe(true);
        expect(trig.matches(makeEvent({ playerId: "p2" }), self)).toBe(false);
    });

    it("scope: 'opponents' fires only when the drawer differs from the controller", () => {
        const trig = drawTrigger({ ...baseArgs, scope: "opponents" });
        const self = makeSelf({ controllerId: "p1" });
        expect(trig.matches(makeEvent({ playerId: "p1" }), self)).toBe(false);
        expect(trig.matches(makeEvent({ playerId: "p2" }), self)).toBe(true);
    });

    it("scope: 'each' fires on any drawer", () => {
        const trig = drawTrigger({ ...baseArgs, scope: "each" });
        const self = makeSelf({ controllerId: "p1" });
        expect(trig.matches(makeEvent({ playerId: "p1" }), self)).toBe(true);
        expect(trig.matches(makeEvent({ playerId: "p2" }), self)).toBe(true);
    });
});

describe("nthDrawThisTurn (issue #781, CR 121.1) — per-player 'Nth draw' condition", () => {
    it("N=2 fires exactly on the drawer's second card this turn (index 1), not the first or third", () => {
        const condition = nthDrawThisTurn(2);
        const self = makeSelf();
        // First draw: drawIndexThisTurn = 0 -> no fire.
        expect(condition(makeEvent({ drawIndexThisTurn: 0 }), self)).toBe(
            false
        );
        // Second draw: drawIndexThisTurn = 1 -> fires.
        expect(condition(makeEvent({ drawIndexThisTurn: 1 }), self)).toBe(true);
        // Third draw: drawIndexThisTurn = 2 -> does NOT fire ("second card"
        // is exact, not "2nd or later").
        expect(condition(makeEvent({ drawIndexThisTurn: 2 }), self)).toBe(
            false
        );
    });

    it("N=1 fires on the drawer's first card (index 0) — the general 'Nth draw' template", () => {
        const condition = nthDrawThisTurn(1);
        const self = makeSelf();
        expect(condition(makeEvent({ drawIndexThisTurn: 0 }), self)).toBe(true);
        expect(condition(makeEvent({ drawIndexThisTurn: 1 }), self)).toBe(
            false
        );
    });

    it("an event with no drawIndexThisTurn reads as the drawer's first draw (fallback convention)", () => {
        // Mirrors `nthSpellThisTurn`'s own fallback — a pre-#781 hand-built
        // fixture that never set the field.
        expect(nthDrawThisTurn(1)(makeEvent(), makeSelf())).toBe(true);
        expect(nthDrawThisTurn(2)(makeEvent(), makeSelf())).toBe(false);
    });

    it("composes with scope: 'opponents' as a drawTrigger.condition (Faerie Mastermind's exact template)", () => {
        const trig = drawTrigger({
            id: "t",
            oracleText: "x",
            scope: "opponents",
            condition: nthDrawThisTurn(2),
            resolve: () => {},
        });
        const self = makeSelf({ controllerId: "p1" });
        // The controller's OWN draws never count, regardless of index.
        expect(
            trig.matches(
                makeEvent({ playerId: "p1", drawIndexThisTurn: 1 }),
                self
            )
        ).toBe(false);
        // An opponent's first/third draws don't fire...
        expect(
            trig.matches(
                makeEvent({ playerId: "p2", drawIndexThisTurn: 0 }),
                self
            )
        ).toBe(false);
        expect(
            trig.matches(
                makeEvent({ playerId: "p2", drawIndexThisTurn: 2 }),
                self
            )
        ).toBe(false);
        // ...but the opponent's exact SECOND draw does.
        expect(
            trig.matches(
                makeEvent({ playerId: "p2", drawIndexThisTurn: 1 }),
                self
            )
        ).toBe(true);
    });
});
