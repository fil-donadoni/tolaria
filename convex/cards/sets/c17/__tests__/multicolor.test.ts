// c17 (Commander 2017) — multicolor behavior tests (ADR 0043 colour split).
//
// Fractured Identity (issue #1568): "Exile target nonland permanent. Each
// player other than its controller creates a token that's a copy of it."
// Exercises the new `{ opponentOf: EffectPlayerRef }` player-ref construct
// end to end through the real card — the Op-level construct combination is
// covered generically in `gre/effects/__tests__/interpreter.test.ts`; this
// file proves the CARD (target requirement + `createTokenCopy` +
// `opponentOf(controllerOf(target))` + `exile`, in order) resolves correctly
// for both possible target-controller assignments (own permanent vs.
// opponent's — the target carries no controller restriction, CR 115.1c).

import { describe, it, expect } from "vitest";
import { fracturedIdentity } from "../multicolor";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

describe("Fractured Identity (CR 707.2 / 111.1 / 601.2c, issue #1568)", () => {
    it("exiles the OPPONENT's target permanent and gives the CASTER a copy (each player other than its controller)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "fi-opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, fracturedIdentity.id, "p1", [
            { type: "permanent", id: "fi-opp-bear" },
        ]);
        resolveTopOfStack(state);

        // The original is exiled from p2's battlefield (CR 608.2h — copy is
        // taken as it looked BEFORE the exile).
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toContain(
            "fi-opp-bear"
        );

        // p2 is the target's controller, so "each player other than its
        // controller" = p1 ONLY (two-player game) — the CASTER gets the
        // copy, not the target's own controller.
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].battlefield).toHaveLength(1);
        const copy = state.players[0].battlefield[0];
        expect(copy.isToken).toBe(true);
        expect(copy.card.id).toBe(grizzlyBears.id);
        expect(getEffectivePower(state, copy)).toBe(2);
        expect(getEffectiveToughness(state, copy)).toBe(2);
    });

    it("targeting the CASTER's OWN permanent instead hands the copy to the OPPONENT (the complement follows the target's controller, not the caster)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "fi-own-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, fracturedIdentity.id, "p1", [
            { type: "permanent", id: "fi-own-bear" },
        ]);
        resolveTopOfStack(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].exile.map((c) => c.id)).toContain(
            "fi-own-bear"
        );
        // p1 (the caster) is the target's controller here, so the copy goes
        // to p2 — the OTHER seat, not the caster.
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield[0].card.id).toBe(grizzlyBears.id);
    });

    it("the token copy's characteristics survive projection (wire format)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "fi-wire-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, fracturedIdentity.id, "p1", [
            { type: "permanent", id: "fi-wire-bear" },
        ]);
        resolveTopOfStack(state);
        const copyId = state.players[0].battlefield[0].id;

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === copyId
        )!;
        expect(slim.card.id).toBe(grizzlyBears.id);
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
        // The original is gone from the opponent's (slim, opponent-view)
        // battlefield too.
        expect(
            projected.players[1].battlefield.find(
                (c) => c.id === "fi-wire-bear"
            )
        ).toBeUndefined();
    });
});
