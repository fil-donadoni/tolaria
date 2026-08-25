// Catalogue guard for MORPH cards (CR 702.37, issue #2705).
//
// CR 702.37c gives the face-down spell "no text, no name, no subtypes, and no
// mana cost", and those values "are the copiable values of that object's
// characteristics". Everything a card's printed text would add to a cast —
// a target requirement, an additional cost, a mode, an {X}, a kicker, a
// buyback — therefore does NOT apply to the face-down cast.
//
// The engine implements the face-down cast by riding the ordinary CR 118.9
// alternative-cost path (`announceCast.alternativeCostId`), which reads those
// clauses off the printed `CardDefinition`. `castAdjustedTargetRequirement`
// suppresses the target requirement explicitly; the REST are suppressed by
// this guard instead, fail-closed: no shipped morph card may declare them, so
// a future card that does reds the gate here rather than shipping a clause
// silently applied to the wrong object.
//
// The guard also pins two facts the rest of the implementation relies on:
//   * a morph card is a CREATURE card, which is what makes the face-down cast's
//     TIMING provably identical to the face-up one (a creature spell either
//     way, CR 117.1a) and so lets `castTimingBaseLegal` stay morph-free;
//   * no morph cost contains {X}, which is what makes CR 702.37f (other
//     abilities referring to the X chosen as the morph action was taken)
//     unreachable rather than unimplemented.
//
// This is a sweep over the WHOLE catalogue, not a per-card test: it holds for
// every morph card that ever ships, including ones nobody remembers to test.

import { describe, expect, it } from "vitest";
import { getAllCards } from "../index";
import { MORPH_CAST_ALT_COST_ID } from "../../gre/morph";
import type { CardDefinition } from "../types";

const morphCards: CardDefinition[] = getAllCards().filter(
    (c) => c.morph !== undefined
);

describe("morph cards (CR 702.37)", () => {
    it("the catalogue ships at least one morph card", () => {
        // Without this the whole file is vacuously green on an empty set — the
        // shape the identity-only-test guard exists to catch.
        expect(morphCards.map((c) => c.name)).toContain("Exalted Angel");
    });

    it.each(morphCards.map((c) => [c.name, c] as const))(
        "%s — a morph card is a creature card (CR 702.37c face-down spell timing)",
        (_name, card) => {
            expect(card.types).toContain("Creature");
        }
    );

    it.each(morphCards.map((c) => [c.name, c] as const))(
        "%s — declares no clause the face-down spell would lose (CR 702.37c 'no text')",
        (_name, card) => {
            expect(card.targetRequirement).toBeUndefined();
            expect(card.additionalCosts).toBeUndefined();
            expect(card.modes).toBeUndefined();
            expect(card.kickers).toBeUndefined();
            expect(card.buyback).toBeUndefined();
            // CR 107.3 — an {X} in the printed cost is announced as part of the
            // cast, and a face-down cast has no printed cost to announce it in.
            expect(
                typeof (card.manaCost as { X?: unknown } | undefined)?.X
            ).not.toBe("string");
        }
    );

    it.each(morphCards.map((c) => [c.name, c] as const))(
        "%s — the morph TURN-UP cost is fixed (CR 702.37f X is unreachable)",
        (_name, card) => {
            expect(typeof (card.morph as { X?: unknown }).X).not.toBe("string");
        }
    );

    it.each(morphCards.map((c) => [c.name, c] as const))(
        "%s — declares no alternative cost colliding with the synthesized morph cast id",
        (_name, card) => {
            for (const alt of card.alternativeCosts ?? []) {
                expect(alt.id).not.toBe(MORPH_CAST_ALT_COST_ID);
            }
        }
    );
});
