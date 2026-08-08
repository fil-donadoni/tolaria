// BOK — colorless card behavior tests (ADR 0043 colour split).
//
// Umezawa's Jitte (issue #1341). The announce-time modal machinery it
// introduced is covered end-to-end at the GRE → game.ts seam in
// `convex/__tests__/modalActivatedAbility.test.ts`; this file covers the
// CARD: the combat-damage trigger keyed on the EQUIPPED creature (including
// the control-change case that rules out a "creature you control" scope), and
// the charge counters surviving the wire projection — the counters are what
// the client reads to decide whether the modal ability is even affordable.

import { describe, it, expect } from "vitest";
import { umezawasJitte } from "../colorless";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

/** Jitte attached to `bear1`, a creature `bearController` controls. */
function setup(bearController = "p1"): {
    state: GameState;
    jitte: CardInstanceState;
    bear: CardInstanceState;
} {
    const jitte = makeInstance(umezawasJitte.id, {
        id: "jitte1",
        controllerId: "p1",
        ownerId: "p1",
        attachedTo: "bear1",
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear1",
        controllerId: bearController,
        ownerId: bearController,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: bearController === "p1" ? [jitte, bear] : [jitte],
            }),
            makePlayer("p2", {
                battlefield: bearController === "p2" ? [bear] : [],
            }),
        ],
    });
    return {
        state,
        jitte: state.players[0].battlefield[0],
        bear: state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "bear1")!,
    };
}

const combatDamage = (sourceId: string, controllerId: string) => ({
    type: "DAMAGE_DEALT" as const,
    sourceInstanceId: sourceId,
    sourceControllerId: controllerId,
    target: { type: "player" as const, id: "p2" },
    amount: 2,
    isCombat: true,
});

describe("Umezawa's Jitte (BOK #155, issue #1341)", () => {
    it("charge trigger fires on the EQUIPPED creature's combat damage only", () => {
        const { state, jitte } = setup();
        const trigger = umezawasJitte.triggeredAbilities![0];

        expect(trigger.matches(combatDamage("bear1", "p1"), jitte, state)).toBe(
            true
        );
        // CR 510 — non-combat damage from the same creature doesn't count.
        expect(
            trigger.matches(
                { ...combatDamage("bear1", "p1"), isCombat: false },
                jitte,
                state
            )
        ).toBe(false);
        // Some other creature's combat damage doesn't count.
        expect(
            trigger.matches(combatDamage("someone-else", "p1"), jitte, state)
        ).toBe(false);
        // Neither does the Jitte's own (it never deals combat damage, but the
        // guard is what keeps the host check honest).
        expect(
            trigger.matches(combatDamage("jitte1", "p1"), jitte, state)
        ).toBe(false);
    });

    it("still fires when a control-change moved the host to the opponent (CR 301.5c)", () => {
        const { state, jitte } = setup("p2");
        const trigger = umezawasJitte.triggeredAbilities![0];
        // The Equipment stays attached through the control change, so the
        // trigger must NOT be scoped to "a creature you control".
        expect(jitte.attachedTo).toBe("bear1");
        expect(trigger.matches(combatDamage("bear1", "p2"), jitte, state)).toBe(
            true
        );
    });

    it("does not fire while unattached", () => {
        const { state, jitte } = setup();
        jitte.attachedTo = undefined;
        const trigger = umezawasJitte.triggeredAbilities![0];
        expect(trigger.matches(combatDamage("bear1", "p1"), jitte, state)).toBe(
            false
        );
    });

    // The charge counters drive the client-side affordability gate for the
    // modal ability, so they have to survive the projection (CR 122).
    it("charge counters and the attachment survive the wire projection", () => {
        const { state } = setup();
        const live = state.players[0].battlefield.find(
            (c) => c.id === "jitte1"
        )!;
        live.counters = { charge: 2 };

        const projected = projectPublicState(state, 1, "p1");
        const slimJitte = projected.players[0].battlefield.find(
            (c) => c.id === "jitte1"
        )!;
        expect(slimJitte.counters?.charge).toBe(2);
        expect(slimJitte.attachedTo).toBe("bear1");
    });
});
