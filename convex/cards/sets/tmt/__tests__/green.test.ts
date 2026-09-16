// tmt (Teenage Mutant Ninja Turtles) — green behavior tests (ADR 0043 colour
// split).
//
// Michelangelo, Weirdness to 11 (issue #3230). First consumer of the
// `"counter-placed"` `ReplacementEventKind` (CR 122.1 / 614); the FRAMEWORK
// (CR 614.5 one-shot bookkeeping, the two seams, the zero rewrite) is proven
// with synthetic sources in `gre/__tests__/countReplacements.test.ts`, so this
// file asserts the CARD — the three conditions of its scope, its ETB token, and
// the token's own ability closing the loop back through the same seam.
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import {
    addCounterToCard,
    flushPendingEvents,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const michelangelo = getDefinition("18477047-218d-4b2a-a086-37431b6a3025");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

const MUTAGEN_ABILITY = "mutagen-token-sacrifice-counter";

function michelangeloOnBattlefield(id = "mike") {
    return makeInstance(michelangelo.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
    });
}

/** Runs Michelangelo's ETB through the real trigger pass: the permanent is
 *  already on the battlefield, `PERMANENT_ENTERED` is announced, the trigger is
 *  collected onto the stack and resolved. */
function resolveEtb(state: GameState, instanceId: string): void {
    const self = state.players[0].battlefield.find((c) => c.id === instanceId)!;
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "PERMANENT_ENTERED",
            instanceId: self.id,
            controllerId: self.controllerId,
            ownerId: self.ownerId,
            types: [...self.types],
            subtypes: [...self.subtypes],
            isToken: false,
        },
    ];
    processPendingActionTriggers(state);
    while (state.stack.length > 0) resolveTopOfStack(state);
}

describe("Michelangelo, Weirdness to 11 — counter rider (CR 122.1 / 614, issue #3230)", () => {
    it("adds one to a +1/+1 placement on a creature its controller controls, itself included", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [michelangeloOnBattlefield(), bears],
                }),
                makePlayer("p2"),
            ],
        });
        addCounterToCard(state, state.players[0].battlefield[1], "+1/+1", 1);
        expect(state.players[0].battlefield[1].counters).toEqual({
            "+1/+1": 2,
        });
        expect(getEffectivePower(state, state.players[0].battlefield[1])).toBe(
            4
        );
        expect(
            getEffectiveToughness(state, state.players[0].battlefield[1])
        ).toBe(4);

        // "a creature you control" includes Michelangelo himself.
        addCounterToCard(state, state.players[0].battlefield[0], "+1/+1", 1);
        expect(state.players[0].battlefield[0].counters).toEqual({
            "+1/+1": 2,
        });
    });

    it("does NOT apply to another counter type or to an opponent's creature", () => {
        const theirBears = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        michelangeloOnBattlefield(),
                        makeInstance(grizzlyBears.id, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", { battlefield: [theirBears] }),
            ],
        });
        const mine = state.players[0].battlefield[1];
        addCounterToCard(state, mine, "-1/-1", 2);
        expect(mine.counters).toEqual({ "-1/-1": 2 });

        addCounterToCard(state, state.players[1].battlefield[0], "+1/+1", 1);
        expect(state.players[1].battlefield[0].counters).toEqual({
            "+1/+1": 1,
        });

        // Any OTHER counter type on his own creature is untouched too — the
        // scope is three conditions (type, card type, controller), not one.
        const self = state.players[0].battlefield[0];
        addCounterToCard(state, self, "charge", 1);
        expect(self.counters).toEqual({ charge: 1 });
    });
});

describe("Michelangelo, Weirdness to 11 — Mutagen token (CR 111 / 707.2, issue #3230)", () => {
    it("his ETB creates one Mutagen, and the token's ability survives projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [michelangeloOnBattlefield()],
                }),
                makePlayer("p2"),
            ],
        });
        resolveEtb(state, "mike");

        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        expect(tokens[0].subtypes).toContain("Mutagen");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === tokens[0].id
        )!;
        const def = getDefinition((slim.card as { id: string }).id);
        expect(def.activatedAbilities?.[0]?.id).toBe(MUTAGEN_ABILITY);
        expect(def.activatedAbilities?.[0]?.sorcerySpeedOnly).toBe(true);
        expect(def.imagePrintId).toBe("6559c423-449c-4e8e-8384-3ce78183e317");
    });

    it("the Mutagen's own counter closes the loop through the same seam: one counter becomes two", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [michelangeloOnBattlefield(), bears],
                }),
                makePlayer("p2"),
            ],
        });
        resolveEtb(state, "mike");
        flushPendingEvents(state);

        const mutagen = state.players[0].battlefield.find((c) => c.isToken)!;
        state.stack.push({
            ...mutagen,
            zone: "stack",
            castById: "p1",
            abilityId: MUTAGEN_ABILITY,
            targets: [{ type: "permanent", id: "bears" }],
        });
        resolveTopOfStack(state);

        const after = state.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(after.counters).toEqual({ "+1/+1": 2 });
    });
});
