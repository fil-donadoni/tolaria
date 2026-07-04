// LTR — per-card behavior tests for blue cards in
// `convex/cards/sets/ltr/blue.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { lorienRevealed } from "../blue";
import { makePlayer, makeState, pushSpell } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { makeInstance } from "../../../__tests__/setup";
import { registerTokenDefinition } from "../../..";

const FILLER_ID = "test-ltr-filler";
registerTokenDefinition({
    id: FILLER_ID,
    name: "Test Filler",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Sorcery"],
});

describe("Lórien Revealed (CR 121.1, issue #677)", () => {
    it("draws three cards", () => {
        const lib = ["l0", "l1", "l2", "l3"].map((id) =>
            makeInstance(FILLER_ID, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, lorienRevealed.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].library).toHaveLength(1);
    });
});
