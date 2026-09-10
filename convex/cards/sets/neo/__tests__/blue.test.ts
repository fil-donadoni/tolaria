import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getDefinition } from "../../../index";
import { resolveTopOfStack } from "../../../../gre/state";

// Sink into Stupor // Soporific Springs — {1}{U}{U} Instant with a Land back
// face (CR 712.3, ADR 0122). "Return target spell or nonland permanent an
// opponent controls to its owner's hand."
//
// The layout's own coverage (the twin, the CR 712.12 land play, 712.14b,
// 712.19) is `gre/__tests__/modalDoubleFaced.test.ts`. What is tested HERE is
// the FRONT face's script, whose whole point is that one announced target may
// be either kind of object: `moveSpellFromStack` acts if it is a spell and
// skips otherwise (CR 608.2b), `moveZone` acts if it is a permanent and skips
// otherwise. Exactly one applies to any target, so the pair IS the
// disjunction — and a test that exercised only one leg would leave the other
// looking implemented.
const sinkIntoStupor = getDefinition("5358b87a-1a29-426d-b165-40c97da2c14d");
const BEAR_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears (LEA)

describe("Sink into Stupor (CR 712.3 / 601.2c)", () => {
    it("returns a target PERMANENT an opponent controls to its owner's hand", () => {
        const bear = makeInstance(BEAR_ID, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, sinkIntoStupor.id, "p1");
        item.targets = [{ type: "permanent", id: "bear" }];

        resolveTopOfStack(state);

        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bear"]);
    });

    it("returns a target SPELL to its owner's hand without countering it (CR 712.8a-independent, 701.6-adjacent)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const victim = pushSpell(state, BEAR_ID, "p2");
        const item = pushSpell(state, sinkIntoStupor.id, "p1");
        item.targets = [{ type: "spell", id: victim.id }];

        resolveTopOfStack(state);

        // The bear spell left the stack for its owner's hand — not the
        // graveyard, which is where a COUNTER would have put it (CR 701.6a).
        expect(state.stack.some((s) => s.id === victim.id)).toBe(false);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].hand).toHaveLength(1);
    });
});
