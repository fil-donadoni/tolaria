// eoe (Edge of Eternities) — colorless behavior tests (ADR 0043 colour split).
//
// Tezzeret, Cruel Captain (issue #3229). Three things earn assertions here and
// the rest rides the shipped frameworks:
//   * the AND-of-card-types rider on the 0 ability. `TargetRequirement.type`
//     arrays are OR-of-types (issue #974), so "if it's an ARTIFACT CREATURE" is
//     two nested `objectMatchesFilter` gates. Each of the three shapes a legal
//     target can have — artifact creature, plain creature, non-creature artifact
//     — is asserted, because a single-gate slip passes the first and fails the
//     other two SILENTLY (a +1/+1 counter appearing on a Grizzly Bears).
//   * the non-loyalty loyalty-counter gain, which must land on the very
//     `loyalty` counter the engine's own cost/SBA machinery reads.
//   * the −7 emblem's PHASE trigger — the first phase-triggered emblem, and the
//     one place where the counters-then-animate ORDER is observable.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getDefinition } from "../../../index";
import { TEZZERET_CRUEL_CAPTAIN_EMBLEM_ID } from "../../../emblems";
import type { GameEvent, TargetSelection } from "../../../types";

const tezzeret = getDefinition("02e8e540-8aa3-4e6a-9a11-c3949cab5f0f");
const solRing = getDefinition("c4300d24-1cae-4dd5-be7e-38cc677cf5bd");
const ornithopter = getDefinition("59cc9bdb-7cf2-4795-bac7-ffff605c9eb0");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const icyManipulator = getDefinition("29dc1596-a2e7-4d60-9f99-89babaef8a06");

const ARTIFACT_ETB = "tezzeret-cruel-captain-artifact-loyalty";
const ZERO = "tezzeret-cruel-captain-zero";
const MINUS3 = "tezzeret-cruel-captain-minus3";
const MINUS7 = "tezzeret-cruel-captain-minus7";
const EMBLEM_TRIGGER = "tezzeret-cruel-captain-emblem-combat";

function tezzeretOnBattlefield(loyalty = 4) {
    return makeInstance(tezzeret.id, {
        id: "tez1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Tezzeret's loyalty abilities on the stack and resolves it
 *  through the real path (the loyalty COST is exercised in game.ts; the card
 *  test asserts the EFFECT — the Chandra harness). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const source = state.players[0].battlefield.find((c) => c.id === "tez1")!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

function loyaltyOf(state: GameState): number {
    return (
        state.players[0].battlefield.find((c) => c.id === "tez1")!.counters
            ?.loyalty ?? 0
    );
}

describe("Tezzeret, Cruel Captain — artifact ETB grows loyalty (CR 122.1 / 603.6a)", () => {
    function tezzeretWith(entering: {
        id: string;
        cardId: string;
        types: string[];
    }): GameState {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        tezzeretOnBattlefield(),
                        makeInstance(entering.cardId, {
                            id: entering.id,
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const event: GameEvent = {
            type: "PERMANENT_ENTERED",
            instanceId: entering.id,
            controllerId: "p1",
            types: entering.types,
        } as GameEvent;
        placeTriggersOnStack(state, collectTriggers(state, [event]));
        return state;
    }

    it("puts a loyalty counter on Tezzeret when an artifact you control enters", () => {
        const state = tezzeretWith({
            id: "ring",
            cardId: solRing.id,
            types: ["Artifact"],
        });
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(ARTIFACT_ETB);
        resolveTopOfStack(state);
        // The SAME field `LOYALTY_COUNTER_KEY` names, so the gain is visible to
        // the −N cost check and to the CR 704.5i zero-loyalty SBA.
        expect(loyaltyOf(state)).toBe(5);
    });

    it("does NOT fire for a non-artifact permanent (CR 109.2 filter)", () => {
        const state = tezzeretWith({
            id: "bears",
            cardId: grizzlyBears.id,
            types: ["Creature"],
        });
        expect(state.stack).toHaveLength(0);
    });

    it("does NOT fire for an artifact an OPPONENT controls", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tezzeretOnBattlefield()] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(solRing.id, {
                            id: "oppRing",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        const event: GameEvent = {
            type: "PERMANENT_ENTERED",
            instanceId: "oppRing",
            controllerId: "p2",
            types: ["Artifact"],
        } as GameEvent;
        expect(collectTriggers(state, [event])).toHaveLength(0);
    });
});

describe("Tezzeret, Cruel Captain — 0: untap, then the artifact-creature rider (CR 205, issue #974)", () => {
    function boardWith(cardId: string, id: string): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        tezzeretOnBattlefield(),
                        makeInstance(cardId, {
                            id,
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    function counterOn(state: GameState, id: string): number {
        return (
            state.players[0].battlefield.find((c) => c.id === id)!.counters?.[
                "+1/+1"
            ] ?? 0
        );
    }

    it("an ARTIFACT CREATURE is untapped AND gets a +1/+1 counter", () => {
        const state = boardWith(ornithopter.id, "thopter");
        activate(state, ZERO, [{ type: "permanent", id: "thopter" }]);
        const thopter = state.players[0].battlefield.find(
            (c) => c.id === "thopter"
        )!;
        expect(thopter.isTapped).toBe(false);
        expect(counterOn(state, "thopter")).toBe(1);
    });

    it("a plain CREATURE is untapped and gets NO counter (it is not an artifact)", () => {
        const state = boardWith(grizzlyBears.id, "bears");
        activate(state, ZERO, [{ type: "permanent", id: "bears" }]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bears")!.isTapped
        ).toBe(false);
        expect(counterOn(state, "bears")).toBe(0);
    });

    it("a NON-CREATURE artifact is untapped and gets NO counter", () => {
        const state = boardWith(icyManipulator.id, "icy");
        activate(state, ZERO, [{ type: "permanent", id: "icy" }]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "icy")!.isTapped
        ).toBe(false);
        expect(counterOn(state, "icy")).toBe(0);
    });
});

describe("Tezzeret, Cruel Captain — −3 tutor (CR 202.3 / 701.23e)", () => {
    it("offers only artifact cards with mana value 1 or less", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tezzeretOnBattlefield()],
                    library: [
                        makeInstance(ornithopter.id, {
                            id: "libThopter",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        makeInstance(solRing.id, {
                            id: "libRing",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        // mv 4 — over the ceiling.
                        makeInstance(icyManipulator.id, {
                            id: "libIcy",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        // not an artifact.
                        makeInstance(grizzlyBears.id, {
                            id: "libBears",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS3);
        const choice = state.pendingChoices![0];
        expect(choice.kind).toBe("search-library");
        expect([...(choice.candidateIds ?? [])].sort()).toEqual([
            "libRing",
            "libThopter",
        ]);
    });
});

describe("Tezzeret, Cruel Captain — −7 emblem (phase-triggered emblem, CR 114 / 507)", () => {
    function withEmblem(artifact: { cardId: string; id: string }): GameState {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        tezzeretOnBattlefield(7),
                        makeInstance(artifact.cardId, {
                            id: artifact.id,
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS7);
        expect(state.emblems).toHaveLength(1);
        expect(state.emblems![0]).toMatchObject({
            ownerId: "p1",
            emblemId: TEZZERET_CRUEL_CAPTAIN_EMBLEM_ID,
        });
        return state;
    }

    const combatBegin = (activePlayerId: string): GameEvent =>
        ({
            type: "PHASE_BEGIN",
            phase: "BEGINNING_OF_COMBAT",
            activePlayerId,
        }) as GameEvent;

    it("a NON-CREATURE artifact becomes a 0/0 Robot artifact creature that is a 3/3 on the wire", () => {
        const state = withEmblem({ cardId: icyManipulator.id, id: "icy" });
        const triggers = collectTriggers(state, [combatBegin("p1")]);
        expect(triggers.map((t) => t.triggeredAbilityId)).toEqual([
            EMBLEM_TRIGGER,
        ]);
        placeTriggersOnStack(state, triggers);
        // Sole mandatory target auto-selects (CR 603.3d).
        expect(state.stack[0].targets).toEqual([
            { type: "permanent", id: "icy" },
        ]);
        resolveTopOfStack(state);

        const icy = state.players[0].battlefield.find((c) => c.id === "icy")!;
        expect(icy.counters?.["+1/+1"]).toBe(3);
        // SURFACE assertion through the reducer the client actually reads.
        const wire = projectPublicState(
            state,
            "p1"
        ).players[0].battlefield.find((c) => c.id === "icy")!;
        expect(wire.types).toContain("Creature");
        expect(wire.types).toContain("Artifact");
        expect(wire.subtypes).toContain("Robot");
        // The wire carries the layer-7a BASE P/T plus the counters; the
        // effective body is the layer pipeline's answer (CR 613.4) — three
        // +1/+1 counters on a 0/0 base is a 3/3, so the Robot never exists as a
        // 0/0 the SBAs could bury.
        expect(wire.power).toBe(0);
        expect(wire.counters?.["+1/+1"]).toBe(3);
        expect(getEffectivePower(state, icy)).toBe(3);
        expect(getEffectiveToughness(state, icy)).toBe(3);
    });

    it("an artifact that is ALREADY a creature just gets the counters (the animation is skipped)", () => {
        const state = withEmblem({ cardId: ornithopter.id, id: "thopter" });
        placeTriggersOnStack(
            state,
            collectTriggers(state, [combatBegin("p1")])
        );
        resolveTopOfStack(state);
        const wire = projectPublicState(
            state,
            "p1"
        ).players[0].battlefield.find((c) => c.id === "thopter")!;
        // Ornithopter is a printed 0/2, so the counters make it 3/5 — proof the
        // 0/0 base P/T set did NOT run.
        const thopter = state.players[0].battlefield.find(
            (c) => c.id === "thopter"
        )!;
        expect(getEffectivePower(state, thopter)).toBe(3);
        expect(getEffectiveToughness(state, thopter)).toBe(5);
        expect(wire.subtypes).not.toContain("Robot");
    });

    it("does not fire on the OPPONENT's beginning of combat (CR 114.3 owner-scoped 'your turn')", () => {
        const state = withEmblem({ cardId: icyManipulator.id, id: "icy" });
        expect(collectTriggers(state, [combatBegin("p2")])).toHaveLength(0);
    });

    it("with no artifact to target the trigger is removed from the stack (CR 603.3d)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tezzeretOnBattlefield(7)] }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS7);
        placeTriggersOnStack(
            state,
            collectTriggers(state, [combatBegin("p1")])
        );
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTarget).toBeUndefined();
    });
});
