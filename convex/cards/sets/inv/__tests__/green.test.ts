// Per-card behavior tests for INV green cards (`convex/cards/sets/inv/green.ts`).
//
// First-printing audit (ADR 0041): some cards exercised below were first
// implemented as part of this INV tranche but are REPRINTS — their
// definitions now live in their earliest-paper-printing home sets, and INV
// keeps only a `CardPrint`. The behaviour suites stay with the tranche that
// authored them and import the definition from its home module.

import { describe, it, expect } from "vitest";
import {
    blurredMongoose,
    canopySurge,
    elfhameSanctuary,
    kavuChameleon,
    kavuLair,
    restock,
    tangle,
    wanderingStream,
} from "../green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { registerTokenDefinition } from "../../..";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { advancePhase, finalizeCleanup } from "../../../../gre/phases";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { STATIC_EFFECT_CTX } from "../../../../gre/layers";
import { isGuardedAgainst } from "../../../../gre/permanentGuard";
import { getLegalTargets } from "../../../../gre/rules";
import { plains, island, swamp } from "../../lea/colorless";

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

// DSL effects[] card (issue #1283) — the recipient is the ENTERING
// creature's controller, read via `{ ref: "$event.controllerId" }`, not
// Kavu Lair's own controller. External-behavior test kept as-is; it exercises
// the same outcome regardless of resolve()/effects[] internals.
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

// A flying creature with toughness high enough that 4 damage (the kicked
// mode) stays observable as marked damage rather than tripping the lethal-
// damage SBA (which this test deliberately doesn't drive, per the interpreter
// suite's `dealDamage` convention).
const FLYER_ID = "test-inv-green-canopy-flyer";
registerTokenDefinition({
    id: FLYER_ID,
    name: FLYER_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 6,
    staticAbilities: ["flying"],
});

describe("Canopy Surge (Kicker {2}, CR 702.33 / 120.1, issue #1097)", () => {
    function castCanopySurge(kicked: boolean): GameState {
        // A flying creature under the CASTER's OWN control (p1) — proves the
        // sweep is controller-agnostic ("each creature with flying", not
        // "each creature YOUR OPPONENT controls"). Without this fixture, a
        // controller-scoped regression (e.g. the sweep accidentally reading
        // only the non-active player's battlefield) would slip through even
        // though every other assertion here stayed green.
        const casterFlyer = makeInstance(FLYER_ID, {
            id: "surge-caster-flyer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const flyer = makeInstance(FLYER_ID, {
            id: "surge-flyer",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Blurred Mongoose has no flying — proves the sweep is selective.
        const grounded = makeInstance(blurredMongoose.id, {
            id: "surge-grounded",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [casterFlyer] }),
                makePlayer("p2", { battlefield: [flyer, grounded] }),
            ],
        });
        const item = pushSpell(state, canopySurge.id, "p1");
        if (kicked) item.kickerCount = 1;
        resolveTopOfStack(state);
        return state;
    }

    it("unkicked deals 1 damage to each creature with flying and each player", () => {
        const state = castCanopySurge(false);
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        const casterFlyer = state.players[0].battlefield.find(
            (c) => c.id === "surge-caster-flyer"
        )!;
        expect(casterFlyer.damageMarked ?? 0).toBe(1);
        const flyer = state.players[1].battlefield.find(
            (c) => c.id === "surge-flyer"
        )!;
        expect(flyer.damageMarked ?? 0).toBe(1);
        const grounded = state.players[1].battlefield.find(
            (c) => c.id === "surge-grounded"
        )!;
        expect(grounded.damageMarked ?? 0).toBe(0);
    });

    it("kicked deals 4 damage to each creature with flying and each player instead", () => {
        const state = castCanopySurge(true);
        expect(state.players[0].life).toBe(16);
        expect(state.players[1].life).toBe(16);
        const casterFlyer = state.players[0].battlefield.find(
            (c) => c.id === "surge-caster-flyer"
        )!;
        expect(casterFlyer.damageMarked ?? 0).toBe(4);
        const flyer = state.players[1].battlefield.find(
            (c) => c.id === "surge-flyer"
        )!;
        expect(flyer.damageMarked ?? 0).toBe(4);
        const grounded = state.players[1].battlefield.find(
            (c) => c.id === "surge-grounded"
        )!;
        expect(grounded.damageMarked ?? 0).toBe(0);
    });

    it("declares the kicker cost {2}", () => {
        expect(canopySurge.kicker?.cost).toEqual({ X: 2 });
    });

    it("wire format — damage to the flying creature and both players survives projectPublicState", () => {
        const state = castCanopySurge(false);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(19);
        expect(projected.players[1].life).toBe(19);
        const slimFlyer = projected.players[1].battlefield.find(
            (c) => c.id === "surge-flyer"
        )!;
        expect(slimFlyer.damageMarked ?? 0).toBe(1);
    });
});

describe("Restock (CR 400.7 return, CR 608.2 exile-self, issue #1097)", () => {
    it("returns both targeted graveyard cards to hand and exiles itself instead of the graveyard", () => {
        const gyCardA = makeInstance(blurredMongoose.id, {
            id: "restock-gyA",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const gyCardB = makeInstance(kavuLair.id, {
            id: "restock-gyB",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [gyCardA, gyCardB] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, restock.id, "p1", [
            { type: "graveyard-card", id: "restock-gyA", playerId: "p1" },
            { type: "graveyard-card", id: "restock-gyB", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "restock-gyA",
            "restock-gyB",
        ]);
        // Exiled, not put into the graveyard (CR 608.2 "Exile ~").
        expect(
            state.players[0].graveyard.find((c) => c.id === item.id)
        ).toBeUndefined();
        expect(state.players[0].exile.map((c) => c.id)).toContain(item.id);
    });

    it("declares a two-card own-graveyard target requirement", () => {
        expect(restock.targetRequirement).toEqual({
            type: "card",
            count: 2,
            zone: "graveyard",
            controller: "you",
        });
    });

    it("wire format — the returned cards and the self-exile survive projectPublicState", () => {
        const gyCardA = makeInstance(blurredMongoose.id, {
            id: "restock-wireA",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const gyCardB = makeInstance(kavuLair.id, {
            id: "restock-wireB",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [gyCardA, gyCardB] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, restock.id, "p1", [
            { type: "graveyard-card", id: "restock-wireA", playerId: "p1" },
            { type: "graveyard-card", id: "restock-wireB", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(2);
        expect(projected.players[0].exile.map((c) => c.id)).toContain(item.id);
    });
});

describe("Elfhame Sanctuary (CR 504.1 skip-draw-step, CR 603.6a upkeep, issue #1097)", () => {
    /** Fires the upkeep trigger by advancing UNTAP → UPKEEP (mirrors Fasting's
     *  harness, `drk/__tests__/white.test.ts`): the phase-begin trigger scan
     *  places `elfhame-sanctuary-upkeep` on the stack, suspended at the head of
     *  the priority window. */
    function enterUpkeep(state: GameState): void {
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
    }

    function makeSanctuary() {
        return makeInstance(elfhameSanctuary.id, {
            id: "sanctuary",
            controllerId: "p1",
            ownerId: "p1",
        });
    }

    it("snapshot: card definition wiring (oracle + upkeep trigger)", () => {
        expect(elfhameSanctuary.types).toEqual(["Enchantment"]);
        expect(elfhameSanctuary.manaCost).toEqual({ X: 1, G: 1 });
        const ids = (elfhameSanctuary.triggeredAbilities ?? []).map(
            (t) => t.id
        );
        expect(ids).toContain("elfhame-sanctuary-upkeep");
    });

    it("decline: no search, no skip — draws normally next draw step (CR 608.2b)", () => {
        const sanctuary = makeSanctuary();
        const land = makeInstance(plains.id, {
            id: "sanct-land",
            ownerId: "p1",
            zone: "library",
        });
        const filler = makeInstance(kavuChameleon.id, {
            id: "sanct-filler",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sanctuary],
                    library: [filler, land],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            turn: 2,
            phase: "UNTAP",
        });
        enterUpkeep(state);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "elfhame-sanctuary-upkeep"
            )
        ).toBe(true);
        resolveTopOfStack(state); // suspends at the cost-free may-pay
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.skipDrawStepThisTurn).toBeUndefined();

        advancePhase(state); // UPKEEP → DRAW
        expect(state.phase).toBe("DRAW");
        // Turn-based draw fires normally (no skip armed).
        expect(state.players[0].hand.map((c) => c.id)).toEqual([
            "sanct-filler",
        ]);
    });

    it("accept + found: reveals, hands the land, shuffles, and skips the draw step", () => {
        const sanctuary = makeSanctuary();
        const land = makeInstance(plains.id, {
            id: "sanct-land-2",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sanctuary],
                    library: [land],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            turn: 2,
            phase: "UNTAP",
        });
        enterUpkeep(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.pendingChoices?.[0]?.kind).toBe("search-library");
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sanct-land-2"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toEqual([
            "sanct-land-2",
        ]);
        expect(state.players[0].library).toHaveLength(0);
        expect(state.skipDrawStepThisTurn).toEqual(["p1"]);

        advancePhase(state); // UPKEEP → DRAW: the armed skip consumes here.
        expect(state.phase).toBe("DRAW");
        // Still just the one hand card — no additional draw happened, and the
        // flag is spliced back out (one-shot).
        expect(state.players[0].hand.map((c) => c.id)).toEqual([
            "sanct-land-2",
        ]);
        expect(state.skipDrawStepThisTurn).toBeUndefined();
    });

    it('accept + no basic land found: still shuffles and STILL skips the draw step (CR 608.2b — "if you do" gates on having searched, not on finding a land)', () => {
        const sanctuary = makeSanctuary();
        // No basic land in the library at all — the search comes up empty.
        const filler = makeInstance(kavuChameleon.id, {
            id: "sanct-nofind-filler",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sanctuary],
                    library: [filler],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            turn: 2,
            phase: "UNTAP",
        });
        enterUpkeep(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.pendingChoices?.[0]?.kind).toBe("search-library");
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual([]);
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[0].hand).toHaveLength(0);
        // Searched (found nothing), so "if you do" still fires — the skip is
        // armed regardless of the empty find.
        expect(state.skipDrawStepThisTurn).toEqual(["p1"]);

        advancePhase(state); // UPKEEP → DRAW
        expect(state.phase).toBe("DRAW");
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("wire format — the armed skip flag survives projectPublicState (Omit-based passthrough)", () => {
        const sanctuary = makeSanctuary();
        const land = makeInstance(plains.id, {
            id: "sanct-land-wire",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sanctuary], library: [land] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            turn: 2,
            phase: "UNTAP",
        });
        enterUpkeep(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sanct-land-wire"],
        });
        expect(state.skipDrawStepThisTurn).toEqual(["p1"]);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.skipDrawStepThisTurn).toEqual(["p1"]);
    });
});

describe("Tangle (CR 615 all-combat prevention + CR 508.1/502.1 attacker untap-lock, issue #1097)", () => {
    it("prevents all combat damage this turn", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, tangle.id, "p1");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });

    it("arms skipNextUntap on each ATTACKING creature, leaving a non-attacker untouched", () => {
        const attacker = makeInstance(blurredMongoose.id, {
            id: "tangle-attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const bystander = makeInstance(kavuChameleon.id, {
            id: "tangle-bystander",
            controllerId: "p2",
            ownerId: "p2",
        });
        // An attacker under the CASTER's own control too — proves the sweep
        // is controller-agnostic ("each creature that's attacking", not
        // "each creature your opponent attacked with").
        const casterAttacker = makeInstance(blurredMongoose.id, {
            id: "tangle-caster-attacker",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [casterAttacker] }),
                makePlayer("p2", { battlefield: [attacker, bystander] }),
            ],
        });
        pushSpell(state, tangle.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find(
                (c) => c.id === "tangle-attacker"
            )!.skipNextUntap
        ).toBe(true);
        expect(
            state.players[0].battlefield.find(
                (c) => c.id === "tangle-caster-attacker"
            )!.skipNextUntap
        ).toBe(true);
        expect(
            state.players[1].battlefield.find(
                (c) => c.id === "tangle-bystander"
            )!.skipNextUntap
        ).toBeUndefined();
    });

    it("wire format — the armed skipNextUntap flags survive projectPublicState", () => {
        const attacker = makeInstance(blurredMongoose.id, {
            id: "tangle-wire-attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const bystander = makeInstance(kavuChameleon.id, {
            id: "tangle-wire-bystander",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker, bystander] }),
            ],
        });
        pushSpell(state, tangle.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.preventAllCombatDamageThisTurn).toBe(true);
        const slimAttacker = projected.players[1].battlefield.find(
            (c) => c.id === "tangle-wire-attacker"
        )!;
        expect(slimAttacker.skipNextUntap).toBe(true);
        const slimBystander = projected.players[1].battlefield.find(
            (c) => c.id === "tangle-wire-bystander"
        )!;
        expect(slimBystander.skipNextUntap).toBeUndefined();
    });
});
