// DST — colorless card behavior tests (ADR 0043 colour split).
//
// Skullclamp (issue #1306, engine half #1350) locks two things the rest of
// the Equipment subsystem doesn't already cover:
//
//  1. A NEGATIVE `pt-buff` through `AURA_AFFECTS_HOST` (+1/-1) — including
//     the interaction that defines the card: equipping an X/1 kills it via
//     the zero-toughness SBA (CR 704.5f) and the dies-trigger then draws.
//  2. The `attachmentsBeforeLeave` last-known-information payload (#1350):
//     the SBA detaches the Equipment BEFORE triggers are collected, so the
//     trigger can only recognise its former host from the event payload.
//     The end-to-end test drives the real order (removePermanentTo →
//     checkStateBasedActions, which detaches and only then drains the events
//     onto the stack → resolveTopOfStack) — the only arrangement that can
//     catch a payload dropped by the SBA.

import { describe, it, expect } from "vitest";
import { skullclamp } from "../colorless";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { collectTriggers } from "../../../../gre/triggers";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

/** Resolve Skullclamp's Equip ability against `targetId`, the way the engine
 *  does (activated ability on the stack, CR 702.6e). */
function equipTo(state: GameState, clampId: string, targetId: string): void {
    const clamp = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === clampId)!;
    state.stack.push({
        ...clamp,
        zone: "stack",
        castById: clamp.controllerId,
        abilityId: "skullclamp-equip",
        targets: [{ type: "permanent", id: targetId }],
    } as StackItem);
    resolveTopOfStack(state);
}

function setup(creatureOverrides: Partial<CardInstanceState> = {}): {
    state: GameState;
    clamp: CardInstanceState;
    bear: CardInstanceState;
} {
    const clamp = makeInstance(skullclamp.id, {
        id: "clamp1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear1",
        controllerId: "p1",
        ownerId: "p1",
        ...creatureOverrides,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [clamp, bear],
                library: [
                    makeInstance(grizzlyBears.id, {
                        id: "lib1",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "lib2",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "lib3",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    return {
        state,
        clamp: state.players[0].battlefield[0],
        bear: state.players[0].battlefield[1],
    };
}

describe("Skullclamp (DST #140, issue #1306 / engine #1350)", () => {
    // CR 611/613 layer 7c — the buff is +1/-1, not +1/+1.
    it("equipped creature gets +1/-1 (GRE and wire format)", () => {
        const { state } = setup();
        equipTo(state, "clamp1", "bear1");
        const bear = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(bear.attachedTo).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "clamp1")!
                .attachedTo
        ).toBe("bear1");
        expect(getEffectivePower(state, bear)).toBe(3); // 2 + 1
        expect(getEffectiveToughness(state, bear)).toBe(1); // 2 - 1

        // Same assertion through the wire projection — the client renders the
        // shrunken toughness off the slim state.
        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(getEffectivePower(projected, slimBear)).toBe(3);
        expect(getEffectiveToughness(projected, slimBear)).toBe(1);
    });

    // The card's headline loop: equip → creature dies → draw two.
    it("draws two cards when the equipped creature dies (LKI through the SBA detach)", () => {
        const { state } = setup();
        equipTo(state, "clamp1", "bear1");
        state.pendingEvents = [];

        removePermanentTo(state, "bear1", "graveyard");
        const events = state.pendingEvents ?? [];
        const left = events.find((e) => e.type === "PERMANENT_LEFT")!;
        expect(
            left.type === "PERMANENT_LEFT" && left.attachmentsBeforeLeave
        ).toEqual(["clamp1"]);

        // Engine order: the SBA sweep detaches the Equipment (CR 704.5q) and
        // only THEN drains the pending events onto the stack (CR 603.3b) —
        // the trigger must survive its own detach.
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "clamp1")!
                .attachedTo
        ).toBeUndefined();

        expect(state.stack).toHaveLength(1);
        while (state.stack.length > 0) resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[0].library).toHaveLength(1);
    });

    // CR 704.5f — the -1 toughness is itself lethal to an X/1, which is the
    // whole reason the card is banned everywhere: equip, creature dies, draw.
    it("equipping an X/1 kills it via the SBA and still draws two", () => {
        const { state } = setup({ power: 1, toughness: 1 });
        equipTo(state, "clamp1", "bear1");
        state.pendingEvents = [];

        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear1")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "bear1")).toBe(
            true
        );

        expect(state.stack.length).toBeGreaterThanOrEqual(1);
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(2);
    });

    // The trigger is host-scoped: an unrelated creature dying draws nothing.
    it("does not fire when a creature it was NOT attached to dies", () => {
        const { state } = setup();
        const other = makeInstance(grizzlyBears.id, {
            id: "other1",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(other);
        equipTo(state, "clamp1", "bear1");
        state.pendingEvents = [];

        removePermanentTo(state, "other1", "graveyard");
        const triggers = collectTriggers(state, state.pendingEvents ?? []);
        expect(triggers).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(0);
    });
});
