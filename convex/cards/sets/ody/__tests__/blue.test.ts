// ODY (Odyssey) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { upheaval } from "../blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { validateEffectScript } from "../../../../gre/effects/validate";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";

const BEAR_ID = "test-odyblue-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

const LAND_ID = "test-odyblue-land";
registerTokenDefinition({
    id: LAND_ID,
    name: LAND_ID,
    rarity: "common",
    manaCost: {},
    types: ["Land"],
});

const permFor = (id: string, controllerId: string, def: string = BEAR_ID) =>
    makeInstance(def, { id, controllerId, ownerId: controllerId });

// Upheaval — "Return all permanents to their owners' hands." (CR 400.7.) The
// first DSL card composing forEach's `$each` with moveZone's target-shape
// (`to: "hand"`) — the interpreter-level permanent test for the combination
// lives in `convex/gre/effects/__tests__/interpreter.test.ts` ("forEach +
// moveZone — mass bounce"); this file covers Upheaval's own card shape.
describe("Upheaval (return all permanents to hand — mass bounce, CR 400.7, issue #685)", () => {
    it("is a {4}{U}{U} sorcery, DSL-only with a valid Effect Script and no targets", () => {
        expect(upheaval.manaCost).toEqual({ X: 4, U: 2 });
        expect(upheaval.types).toEqual(["Sorcery"]);
        expect(upheaval.targetRequirement).toBeUndefined();
        expect(upheaval.resolve).toBeUndefined();
        expect(upheaval.resolveSteps).toBeUndefined();
        expect(validateEffectScript(upheaval)).toEqual([]);
    });

    it("returns every permanent on BOTH battlefields — every type, both players, no scope", () => {
        const myCreature = permFor("uphA", "p1");
        const myLand = permFor("uphB", "p1", LAND_ID);
        const theirCreature = permFor("uphC", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myCreature, myLand] }),
                makePlayer("p2", { battlefield: [theirCreature] }),
            ],
        });
        pushSpell(state, upheaval.id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull(); // never suspended
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "uphA",
            "uphB",
        ]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["uphC"]);
    });

    it("a bounced token ceases to exist instead (CR 111.7 SBA)", () => {
        const token = makeInstance(BEAR_ID, {
            id: "uphTok",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [token] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, upheaval.id, "p1");
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].hand.some((c) => c.id === "uphTok")).toBe(
            false
        );
    });

    it("resolves cleanly when no permanent is in play (CR 608.2b)", () => {
        const state = makeState();
        pushSpell(state, upheaval.id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack).toHaveLength(0);
    });

    // Wire format (mandatory — the effect is fully client-visible).
    it("wire format: the mass-bounce outcome survives projectPublicState", () => {
        const mine = permFor("uphW1", "p1");
        const theirs = permFor("uphW2", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        pushSpell(state, upheaval.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield).toHaveLength(0);
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(projected.players[0].hand).toHaveLength(1);
        // ADR 0026 — a permanent bounced from the battlefield stays PUBLIC
        // knowledge (every player watched it move), so the opponent's slot
        // carries its real identity rather than a hidden `null`.
        expect(projected.players[1].hand).toHaveLength(1);
        expect(projected.players[1].hand[0]).not.toBeNull();
    });
});
