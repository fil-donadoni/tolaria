// NPH — colorless card behavior tests (ADR 0043 colour split).
//
// Batterskull (issue #1340) is the Living Weapon tracer (CR 702.92). The
// keyword itself introduces no new engine capability — it is `createToken`
// (with a `bind`) followed by the generic `attach` Op, both already exercised
// by Cori-Steel Cutter — so what these tests lock is the CARD-VISIBLE
// behavior the DSL smoke sweep can't assert on its own:
//
//  1. The ETB trigger really produces a 0/0 black Phyrexian Germ and attaches
//     the Equipment to THAT token (the bind→ref handoff), leaving a 4/4
//     vigilant lifelinker on the board — GRE and through the wire projection.
//  2. The Germ is alive ONLY because of the Equipment: bouncing Batterskull
//     with its own `{3}` ability detaches it, and the unbuffed 0/0 Germ dies
//     to the zero-toughness SBA (CR 704.5f) on the next check. That is the
//     printed play pattern and the one interaction a static-only test misses.

import { describe, it, expect } from "vitest";
import { batterskull } from "../colorless";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { tokenPrintIdFor } from "../../../tokenPrintLookup";

/** Board with a single Batterskull already on the battlefield. */
function setup(): { state: GameState; skull: CardInstanceState } {
    const skull = makeInstance(batterskull.id, {
        id: "skull1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [skull] }), makePlayer("p2")],
    });
    return { state, skull: state.players[0].battlefield[0] };
}

/** Puts the Living Weapon ETB trigger on the stack the way the engine does
 *  (CR 603.6a) and resolves it. */
function resolveLivingWeapon(state: GameState, skull: CardInstanceState): void {
    state.stack.push({
        ...skull,
        zone: "stack",
        castById: skull.controllerId,
        triggeredAbilityId: "batterskull-living-weapon",
        triggerSourceId: skull.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: skull.id,
            controllerId: skull.controllerId,
            types: batterskull.types,
        },
        targets: undefined,
    } as StackItem);
    resolveTopOfStack(state);
}

function findGerm(state: GameState): CardInstanceState | undefined {
    return state.players[0].battlefield.find(
        (c) => c.isToken && c.subtypes?.includes("Germ")
    );
}

describe("Batterskull (NPH #128, Living Weapon — issue #1340)", () => {
    it("definition sanity — cost, types, equip cost, DSL-only ability sites", () => {
        expect(batterskull.manaCost).toEqual({ generic: 5 });
        expect(batterskull.types).toEqual(["Artifact"]);
        expect(batterskull.subtypes).toEqual(["Equipment"]);

        // CR 702.6e — Equip {5}, sorcery-speed, creature you control.
        const equip = batterskull.activatedAbilities!.find(
            (a) => a.id === "batterskull-equip"
        )!;
        expect(equip.cost).toEqual({ mana: { generic: 5 } });
        expect(equip.sorcerySpeedOnly).toBe(true);
        expect(equip.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            controller: "you",
        });
        expect(equip.resolve).toBeUndefined();

        // The bounce ability is {3} (Scryfall Oracle), NOT the equip cost —
        // an easy transcription slip the card is famous for.
        const bounce = batterskull.activatedAbilities!.find(
            (a) => a.id === "batterskull-return"
        )!;
        expect(bounce.cost).toEqual({ mana: { generic: 3 } });
        expect(bounce.sorcerySpeedOnly).toBeUndefined();
        expect(bounce.resolve).toBeUndefined();

        // Living weapon is one DSL trigger, no closure.
        expect(batterskull.triggeredAbilities).toHaveLength(1);
        expect(batterskull.triggeredAbilities![0].effects).toBeDefined();
        expect(batterskull.triggeredAbilities![0].resolve).toBeUndefined();
    });

    // CR 114 / token art rule — Batterskull's OWN printing's Germ, not a
    // substitute borrowed from another Living Weapon card.
    it("resolves its own printed Phyrexian Germ token art", () => {
        expect(tokenPrintIdFor(batterskull.id, "Phyrexian Germ")).toBe(
            "65c65445-1016-4fd3-963e-1c9eb252d4a6"
        );
    });

    // CR 702.92a — create the Germ, THEN attach this Equipment to it.
    it("living weapon creates a 0/0 black Germ and attaches to it (GRE and wire format)", () => {
        const { state, skull } = setup();
        resolveLivingWeapon(state, skull);

        const germ = findGerm(state)!;
        expect(germ).toBeDefined();
        expect(germ.power).toBe(0);
        expect(germ.toughness).toBe(0);
        expect(germ.subtypes).toEqual(["Phyrexian", "Germ"]);
        expect(germ.types).toEqual(["Creature"]);
        expect(germ.controllerId).toBe("p1");

        // The bind→ref handoff: the Equipment is attached to the token the
        // SAME script just created (CR 601.2b — no announced-target form).
        expect(
            state.players[0].battlefield.find((c) => c.id === "skull1")!
                .attachedTo
        ).toBe(germ.id);

        // CR 611/613 — +4/+4 and the two keyword grants reach the host.
        expect(getEffectivePower(state, germ)).toBe(4);
        expect(getEffectiveToughness(state, germ)).toBe(4);
        expect(germ.staticAbilities).toContain("vigilance");
        expect(germ.staticAbilities).toContain("lifelink");

        // A 4/4 survives the SBA sweep — the Germ is only fragile unequipped.
        checkStateBasedActions(state);
        expect(findGerm(state)).toBeDefined();

        // Same assertion after the wire projection — the client renders the
        // buffed Germ off the slim state.
        const projected = projectPublicState(state, 1, "p1");
        const slimGerm = projected.players[0].battlefield.find(
            (c) => c.id === germ.id
        )!;
        expect(getEffectivePower(projected, slimGerm)).toBe(4);
        expect(getEffectiveToughness(projected, slimGerm)).toBe(4);
    });

    // The card's defining loop: bounce the Equipment, the Germ evaporates.
    it("bouncing Batterskull detaches it and the unbuffed 0/0 Germ dies (CR 704.5f)", () => {
        const { state, skull } = setup();
        resolveLivingWeapon(state, skull);
        const germId = findGerm(state)!.id;

        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "skull1"
        )!;
        state.stack.push({
            ...onBoard,
            zone: "stack",
            castById: "p1",
            abilityId: "batterskull-return",
            targets: undefined,
        } as StackItem);
        resolveTopOfStack(state);

        // Equipment is back in hand, off the battlefield.
        expect(
            state.players[0].battlefield.some((c) => c.id === "skull1")
        ).toBe(false);
        expect(state.players[0].hand.some((c) => c.id === "skull1")).toBe(true);

        // The Germ lost its only source of toughness and dies to the SBA.
        checkStateBasedActions(state);
        expect(state.players[0].battlefield.some((c) => c.id === germId)).toBe(
            false
        );
    });

    // CR 704.5q + 301.5c — re-equipping after a bounce is a normal Equip.
    it("equipping a real creature moves the buff off the Germ", () => {
        const { state, skull } = setup();
        resolveLivingWeapon(state, skull);
        const germId = findGerm(state)!.id;

        const bear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(bear);

        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "skull1"
        )!;
        state.stack.push({
            ...onBoard,
            zone: "stack",
            castById: "p1",
            abilityId: "batterskull-equip",
            targets: [{ type: "permanent", id: "bear1" }],
        } as StackItem);
        resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.find((c) => c.id === "skull1")!
                .attachedTo
        ).toBe("bear1");
        const bearOnBoard = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(getEffectiveToughness(state, bearOnBoard)).toBe(6); // 2 + 4

        // The abandoned Germ is a 0/0 again and dies.
        checkStateBasedActions(state);
        expect(state.players[0].battlefield.some((c) => c.id === germId)).toBe(
            false
        );
    });
});
