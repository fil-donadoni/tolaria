// rav — blue behavior tests (ADR 0043 colour split).
//
// Remand is the OTHER half of the public→hidden bug class fixed in #1696: it
// counters a spell and redirects it to its owner's HAND. The stack is public
// (CR 405.1), so both players saw exactly which card went back — CR 400.2's
// concealment of the hand does not un-reveal it. Same ADR 0026 `knownTo`
// mechanism as Memory Lapse's library-top redirect, no parallel marker.
import { describe, it, expect } from "vitest";
import { remand } from "../blue";
import { makePlayer, makeState, pushSpell } from "../../../__tests__/setup";
import { resolveTopOfStack, getPlayer } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { grizzlyBears } from "../../lea";

function setupRemand() {
    const state = makeState({ players: [makePlayer("p1"), makePlayer("p2")] });
    const bears = pushSpell(state, grizzlyBears.id, "p2");
    bears.id = "bears-spell";
    pushSpell(state, remand.id, "p1", [{ type: "spell", id: "bears-spell" }]);
    return state;
}

describe("Remand — counter to owner's hand (CR 701.5a / 400.2, #1696)", () => {
    it("returns the countered spell to its owner's hand, known to both players", () => {
        const state = setupRemand();
        resolveTopOfStack(state);
        const p2 = getPlayer(state, "p2");
        expect(p2.hand.map((c) => c.id)).toEqual(["bears-spell"]);
        expect([...(p2.hand[0].knownTo ?? [])].sort()).toEqual(["p1", "p2"]);
    });

    it("shows the returned card to the opponent through the wire projection", () => {
        const state = setupRemand();
        resolveTopOfStack(state);
        // p1 (the non-owner) sees the identity in p2's otherwise-hidden hand.
        const asP1 = projectPublicState(state, 1, "p1");
        const p2Hand = asP1.players.find((p) => p.id === "p2")!.hand;
        expect(p2Hand).toHaveLength(1);
        expect(p2Hand[0]?.card.id).toBe(grizzlyBears.id);
        // p2 (the owner) sees their own card flagged as seen by the opponent —
        // the Arena-style eye icon.
        const asP2 = projectPublicState(state, 1, "p2");
        const own = asP2.players.find((p) => p.id === "p2")!.hand;
        expect(own[0]?.seenByOpponent).toBe(true);
    });

    it("does not expose the rest of the owner's hand (negative direction)", () => {
        const state = setupRemand();
        // Give p2 a second, never-seen card in hand before the counter resolves.
        const hidden = pushSpell(state, grizzlyBears.id, "p2");
        state.stack = state.stack.filter((s) => s.id !== hidden.id);
        hidden.id = "hidden-card";
        hidden.zone = "hand";
        getPlayer(state, "p2").hand.push(hidden);
        resolveTopOfStack(state);
        const asP1 = projectPublicState(state, 1, "p1");
        const p2Hand = asP1.players.find((p) => p.id === "p2")!.hand;
        expect(p2Hand).toHaveLength(2);
        expect(p2Hand.filter((c) => c !== null)).toHaveLength(1);
    });
});
