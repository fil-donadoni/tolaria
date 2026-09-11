// TOR (Torment) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const circularLogic = getDefinition("cd9198d6-201d-4175-8f70-eef92d7d5bb5");
const lightningBolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

/** N cards in p1's graveyard — the tally Circular Logic prices its tax off. */
const graveyardOf = (n: number) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(lightningBolt.id, {
            id: `gy${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        })
    );

/** p1 casts Circular Logic at a Bolt p2 aimed at p1. Returns the Bolt's item. */
function castAtBolt(state: ReturnType<typeof makeState>) {
    const bolt = pushSpell(state, lightningBolt.id, "p2", [
        { type: "player", id: "p1" },
    ]);
    pushSpell(state, circularLogic.id, "p1", [{ type: "spell", id: bolt.id }]);
    return bolt;
}

// Circular Logic — the FIRST card on the `mayPay` Op's fourth cost shape,
// `{ genericEqualTo }` (issue #2714): a generic mana amount BUILT from a
// runtime tally rather than reduced from a printed base. The counter half is
// Mana Leak's shipped shape; what these cases guard is the PRICE, which no
// other card in the pool computes at resolution time.
describe("Circular Logic (counter unless controller pays {1} per graveyard card, CR 118.12a / 701.6a)", () => {
    it("prices the tax off the CASTER's graveyard, not the taxed player's", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: graveyardOf(3) }),
                makePlayer("p2", { graveyard: graveyardOf(7) }),
            ],
        });
        castAtBolt(state);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        // CR 118.12a — the TARGET spell's controller is the one offered the pay.
        expect(head.playerId).toBe("p2");
        // CR 109.5 — "your graveyard" is Circular Logic's controller's: three
        // cards, NOT the seven sitting in p2's own graveyard.
        expect(head.cost).toEqual({ mana: { generic: 3 } });
    });

    it("declining the payment counters the target spell", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: graveyardOf(2) }),
                makePlayer("p2"),
            ],
        });
        const bolt = castAtBolt(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(bolt.id);
        expect(state.players[0].life).toBe(20); // the Bolt never resolved
    });

    it("paying the tally lets the spell resolve, spending exactly that much", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: graveyardOf(2) }),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
                }),
            ],
        });
        const bolt = castAtBolt(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Two cards in the graveyard = {2}, so one colourless is left over.
        expect(state.players[1].manaPool.C).toBe(1);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeDefined();
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
    });

    it("an EMPTY graveyard prices the tax at {0}, which anyone can pay", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const bolt = castAtBolt(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // CR 118.3a — players can always pay 0 mana; the leg is EMPTY, never
        // absent (an absent cost is the cost-free "you may" shape).
        expect(head.cost).toEqual({ mana: {} });
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.stack.find((s) => s.id === bolt.id)).toBeDefined();
        expect(state.players[1].manaPool.C).toBe(0); // nothing was spent
    });

    it("the countered-and-graveyarded outcome survives the wire projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: graveyardOf(5) }),
                makePlayer("p2"),
            ],
        });
        const bolt = castAtBolt(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].graveyard.map((c) => c.id)).toContain(
            bolt.id
        );
        expect(projected.stack).toHaveLength(0);
    });
});
