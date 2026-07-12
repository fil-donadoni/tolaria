// Per-card behavior tests for INV green cards (`convex/cards/sets/inv/green.ts`).

import { describe, it, expect } from "vitest";
import {
    blurredMongoose,
    fertileGround,
    kavuChameleon,
    kavuLair,
    wanderingStream,
} from "../green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    emitPermanentTapped,
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { finalizeCleanup } from "../../../../gre/phases";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { STATIC_EFFECT_CTX } from "../../../../gre/layers";
import { isGuardedAgainst } from "../../../../gre/permanentGuard";
import { getLegalTargets } from "../../../../gre/rules";
import { plains, island, swamp, forest } from "../../lea/colorless";

const CREATURE_REQ = { type: "Creature", count: 1 } as const;

/** Answer the head pending choice with `picks` (an option id for
 *  requestOptionChoice) — drives the staged-resume resolution forward one
 *  round-trip (pattern from `convex/cards/sets/vis/__tests__/blue.test.ts`). */
function answer(state: GameState, picks: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: picks,
    });
}

describe("Blurred Mongoose (CR 701.5c can't-be-countered, 702.18 Shroud)", () => {
    it("declares cantBeCountered and shroud", () => {
        expect(blurredMongoose.cantBeCountered).toBe(true);
        expect(blurredMongoose.staticAbilities).toContain("shroud");
        expect(blurredMongoose.power).toBe(2);
        expect(blurredMongoose.toughness).toBe(1);
    });

    it("shroud makes it an illegal target for a spell/ability, from any source (CR 702.18)", () => {
        const mongoose = makeInstance(blurredMongoose.id, {
            id: "mongoose",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mongoose] }),
                makePlayer("p2"),
            ],
        });
        // Unlike hexproof, shroud is NOT controller-relative — it bars even
        // the mongoose's own controller's spells/abilities.
        expect(
            isGuardedAgainst(state, mongoose, "cantBeTargeted", {
                isSpell: true,
                controllerId: "p1",
            })
        ).toBe(true);
        const legal = getLegalTargets(
            state,
            CREATURE_REQ,
            [],
            "p2",
            undefined,
            ["Instant"],
            [],
            true
        ).map((t) => t.id);
        expect(legal).not.toContain("mongoose");
    });
});

describe("Kavu Chameleon (CR 701.5c can't-be-countered, 305.7 / 613.1d colour change)", () => {
    it("declares cantBeCountered and its stats", () => {
        expect(kavuChameleon.cantBeCountered).toBe(true);
        expect(kavuChameleon.power).toBe(4);
        expect(kavuChameleon.toughness).toBe(4);
        expect(
            kavuChameleon.activatedAbilities?.some(
                (a) => a.id === "kavu-chameleon-color"
            )
        ).toBe(true);
    });

    it("becomes the chosen color and reverts to its printed color at CLEANUP (CR 514.2)", () => {
        const kavu = makeInstance(kavuChameleon.id, {
            id: "kavu",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu] }),
                makePlayer("p2"),
            ],
        });
        // Green before activation (mana-cost-derived, no override yet).
        expect(STATIC_EFFECT_CTX.getColors(kavu)).toEqual(["G"]);

        state.stack.push({
            ...kavu,
            zone: "stack",
            castById: "p1",
            abilityId: "kavu-chameleon-color",
            targets: [],
        } as StackItem);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the color pick
        answer(state, ["W"]); // choose White

        const after = state.players[0].battlefield.find(
            (c) => c.id === "kavu"
        )!;
        expect(STATIC_EFFECT_CTX.getColors(after)).toEqual(["W"]);

        // Wire format: the colour change survives the projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "kavu"
        )!;
        expect(STATIC_EFFECT_CTX.getColors(slim)).toEqual(["W"]);

        // CR 514.2 — "until end of turn" reverts at CLEANUP.
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(STATIC_EFFECT_CTX.getColors(after)).toEqual(["G"]);
    });
});

// Wandering Stream is the only shipped user of the Domain value's `times`
// multiplier (`{ domain: { of: "controller", times: 2 } }`) — the interpreter
// already has a permanent unit test for `times` (ADR 0045 new-construct
// regime); this is the CARD-level wiring assertion (review finding on issue
// #1066 / PR #1091).
describe("Wandering Stream (CR 119.3a life gain, Domain, issue #1066)", () => {
    it("gains 2 life for EACH basic land type controlled (times: 2)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "ws-pl",
                            controllerId: "p1",
                        }),
                        makeInstance(island.id, {
                            id: "ws-is",
                            controllerId: "p1",
                        }),
                        makeInstance(swamp.id, {
                            id: "ws-sw",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, wanderingStream.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(26); // 20 + (3 basic types * 2)
    });

    it("gains no life for a player with no basic lands", () => {
        const state = makeState();
        pushSpell(state, wanderingStream.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

// resolve() card (twin of Wild Growth, `lea/green.ts` — see the card's own
// justification comment). Full engine integration: attach → tap the
// enchanted land for mana → the `PERMANENT_TAPPED` trigger fires → suspends
// on the runtime colour choice → resumes → adds the chosen colour on top of
// the land's own mana.
describe("Fertile Ground (CR 603.2 tapped-for-mana trigger, additional mana of chosen color)", () => {
    it("matches only the attached host's mana tap (Wild Growth precedent)", () => {
        const trig = fertileGround.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "fg",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as const,
            subtypes: ["Aura"],
            isTapped: false,
            attachedTo: "host-forest",
            card: {},
        };
        const host = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "host-forest",
            controllerId: "p1",
            permanentTypes: ["Land"] as const,
            permanentSubtypes: ["Forest"],
            forMana: true,
            manaProduced: { G: 1 },
        };
        expect(
            trig!.matches(host as never, self as never, undefined as never)
        ).toBe(true);
        expect(
            trig!.matches(
                { ...host, permanentId: "other-forest" } as never,
                self as never,
                undefined as never
            )
        ).toBe(false);
    });

    it("adds one mana of the chosen color on top of the land's own tap", () => {
        const land = makeInstance(forest.id, {
            id: "host-forest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(fertileGround.id, {
            id: "fg",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-forest",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, aura] }),
                makePlayer("p2"),
            ],
        });

        emitPermanentTapped(state, land, true, { G: 1 });
        processPendingActionTriggers(state);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the color pick
        answer(state, ["W"]);

        expect(state.players[0].manaPool.W).toBe(1);
    });
});

// resolve() card — see the card's own justification comment (event-field
// player ref: the recipient is the ENTERING creature's controller, not
// Kavu Lair's).
describe("Kavu Lair (CR 603.6a ETB, power 4+ creature, controller draws)", () => {
    it("the entering creature's OWN controller draws, even when it isn't Kavu Lair's controller", () => {
        const lair = makeInstance(kavuLair.id, {
            id: "lair",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bigCreature = makeInstance(blurredMongoose.id, {
            id: "big",
            controllerId: "p2",
            ownerId: "p2",
            power: 4,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lair] }),
                makePlayer("p2", {
                    library: [makeInstance(plains.id, { id: "lib-1" })],
                }),
            ],
        });
        state.players[1].battlefield.push(bigCreature);
        state.pendingEvents = [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "big",
                controllerId: "p2",
                types: ["Creature"],
            },
        ];
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        // p2 (the entering creature's controller) draws — NOT p1 (Kavu Lair's
        // controller).
        expect(state.players[1].hand.length).toBe(1);
        expect(state.players[0].hand.length).toBe(0);
    });

    it("does not trigger for a creature under power 4", () => {
        const lair = makeInstance(kavuLair.id, {
            id: "lair",
            controllerId: "p1",
            ownerId: "p1",
        });
        const smallCreature = makeInstance(blurredMongoose.id, {
            id: "small",
            controllerId: "p2",
            ownerId: "p2",
            power: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lair] }),
                makePlayer("p2"),
            ],
        });
        state.players[1].battlefield.push(smallCreature);
        state.pendingEvents = [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "small",
                controllerId: "p2",
                types: ["Creature"],
            },
        ];
        processPendingActionTriggers(state);
        expect(state.stack.length).toBe(0);
    });
});
