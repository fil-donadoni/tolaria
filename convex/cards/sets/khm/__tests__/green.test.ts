// khm (Kaldheim) — green behavior tests (ADR 0043 colour split).
//
// Esika's Chariot (issue #3229). Crew itself is covered by Smuggler's Copter
// (`sets/kld/__tests__/colorless.test.ts`); what earns assertions here is the
// pair the card introduces: an "any number of tokens in one Op" ETB, and an
// attack trigger whose ANNOUNCED target is filtered by token-ness
// (`TargetRequirement.isToken`, CR 111.5) — including the recursion that makes
// the card what it is, a copy of a token being itself a token (CR 111.1), so
// the Chariot can copy the Cat it made last turn.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import {
    getLegalTargets,
    targetingSourceFromCard,
} from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import type { GameEvent } from "../../../types";

const esikasChariot = getDefinition("a87606cc-fbf0-4e2c-9798-f1c935d0573d");
const elvishArchers = getDefinition("1cb9d405-f2b5-4e10-a405-feafd2a87d90");

const ETB = "esikas-chariot-etb-cats";
const ATTACK = "esikas-chariot-attack-copy";
const CREW = "esikas-chariot-crew";

function chariotOnBattlefield() {
    return makeInstance(esikasChariot.id, {
        id: "chariot1",
        controllerId: "p1",
        ownerId: "p1",
    });
}

const ETB_EVENT: GameEvent = {
    type: "PERMANENT_ENTERED",
    instanceId: "chariot1",
    controllerId: "p1",
    types: ["Artifact"],
} as GameEvent;

const ATTACK_EVENT: GameEvent = {
    type: "ATTACKERS_DECLARED",
    attackerIds: ["chariot1"],
    attackingPlayerId: "p1",
} as GameEvent;

/** Fires one of the Chariot's TRIGGERED abilities through the real collect →
 *  place → resolve path (a hand-built trigger StackItem is not the same object
 *  the engine builds, and an untargeted one would resolve as a permanent
 *  spell). `targets`, when given, fills the announced slot the sweep raises. */
function fireTrigger(
    state: GameState,
    event: GameEvent,
    abilityId: string,
    targets?: { type: "permanent"; id: string }[]
): void {
    const triggers = collectTriggers(state, [event]).filter(
        (t) => t.triggeredAbilityId === abilityId
    );
    expect(triggers).toHaveLength(1);
    placeTriggersOnStack(state, triggers);
    if (targets) {
        expect(state.pendingTarget!.kind).toBe("trigger");
        state.pendingTarget!.selected = targets;
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
    }
    resolveTopOfStack(state);
}

/** Activates the crew ability and resolves it (the loyalty/crew COST is
 *  exercised in game.ts; the card test asserts the EFFECT). */
function activate(state: GameState, abilityId: string): void {
    const source = state.players[0].battlefield.find(
        (c) => c.id === "chariot1"
    )!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId,
    });
    resolveTopOfStack(state);
}

/** The attack trigger's legal target ids, read through the SAME authority the
 *  mutation and the client both use (`getLegalTargets`, ADR 0068). */
function attackTargetIds(state: GameState): string[] {
    const chariot = state.players[0].battlefield.find(
        (c) => c.id === "chariot1"
    )!;
    const req = (esikasChariot.triggeredAbilities ?? []).find(
        (a) => a.id === ATTACK
    )!.targetRequirement!;
    return getLegalTargets(
        state,
        req,
        targetingSourceFromCard(chariot, false),
        "p1"
    )
        .filter((t) => t.type === "permanent")
        .map((t) => t.id)
        .sort();
}

describe("Esika's Chariot — ETB Cats (CR 707.1 / 111, issue #3229)", () => {
    it("creates TWO 2/2 green Cat tokens in one resolution", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chariotOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });
        fireTrigger(state, ETB_EVENT, ETB);

        const cats = state.players[0].battlefield.filter((c) => c.isToken);
        expect(cats).toHaveLength(2);
        for (const cat of cats) {
            expect(cat.types).toEqual(["Creature"]);
            expect(cat.subtypes).toEqual(["Cat"]);
            expect(cat.power).toBe(2);
            expect(cat.toughness).toBe(2);
            expect(cat.controllerId).toBe("p1");
        }
    });

    it("the Vehicle is NOT a creature until crewed, and crew 4 animates it to its printed 4/4 (CR 301.7b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chariotOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[0].battlefield[0];
        expect(before.types).toEqual(["Artifact"]);
        expect(esikasChariot.staticAbilities).toContain("crew 4");

        activate(state, CREW);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "chariot1"
        )!;
        // SURFACE assertion through the wire projection, not the raw instance:
        // the client only ever sees the reducer's output.
        const wire = projectPublicState(
            state,
            1,
            "p1"
        ).players[0].battlefield.find((c) => c.id === "chariot1")!;
        expect(after.types).toContain("Creature");
        expect(wire.types).toContain("Creature");
        expect(wire.types).toContain("Artifact");
        expect(wire.power).toBe(4);
        expect(wire.toughness).toBe(4);
    });
});

describe("Esika's Chariot — attack trigger copies a TOKEN (CR 603.3d / 707.2, issue #3229)", () => {
    /** A board with the Chariot, one of its Cats, and a NONTOKEN creature. */
    function boardWithCat(): GameState {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        chariotOnBattlefield(),
                        makeInstance(elvishArchers.id, {
                            id: "nontoken",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(elvishArchers.id, {
                            id: "oppNontoken",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        fireTrigger(state, ETB_EVENT, ETB);
        return state;
    }

    it("only TOKENS YOU CONTROL are legal targets — nontokens and the opponent's board are not", () => {
        const state = boardWithCat();
        const legalIds = attackTargetIds(state);
        const catIds = state.players[0].battlefield
            .filter((c) => c.isToken)
            .map((c) => c.id)
            .sort();
        expect(legalIds).toEqual(catIds);
        expect(legalIds).not.toContain("nontoken");
        expect(legalIds).not.toContain("oppNontoken");
        expect(legalIds).not.toContain("chariot1");
    });

    it("copying a Cat produces a THIRD Cat that is itself a token, so the next attack can copy it (CR 111.1)", () => {
        const state = boardWithCat();
        const firstCat = state.players[0].battlefield.find((c) => c.isToken)!;

        fireTrigger(state, ATTACK_EVENT, ATTACK, [
            { type: "permanent", id: firstCat.id },
        ]);

        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(3);
        for (const t of tokens) {
            expect(t.subtypes).toEqual(["Cat"]);
            expect(t.power).toBe(2);
            expect(t.toughness).toBe(2);
        }

        // The COPY is a legal target for the next attack — the recursion the
        // card is built around.
        const legalIds = attackTargetIds(state);
        expect(legalIds).toHaveLength(3);
        expect(new Set(legalIds)).toEqual(new Set(tokens.map((t) => t.id)));
    });

    it("with no token on the battlefield the trigger is removed from the stack (CR 603.3d)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        chariotOnBattlefield(),
                        makeInstance(elvishArchers.id, {
                            id: "nontoken",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [ATTACK_EVENT]);
        expect(triggers.map((t) => t.triggeredAbilityId)).toEqual([ATTACK]);
        placeTriggersOnStack(state, triggers);
        // A required choice with no legal option removes the ability.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("a real attack declaration raises the target choice and the copy lands (full trigger path)", () => {
        const state = boardWithCat();
        const cat = state.players[0].battlefield.find((c) => c.isToken)!;
        placeTriggersOnStack(state, collectTriggers(state, [ATTACK_EVENT]));
        expect(state.pendingTarget!.kind).toBe("trigger");
        state.pendingTarget!.selected = [{ type: "permanent", id: cat.id }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(3);
    });
});
