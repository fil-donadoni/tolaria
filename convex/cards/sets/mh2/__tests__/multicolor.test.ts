// mh2 — multicolor behavior tests (ADR 0043 colour split).
//
// Master of Death is a pure-DSL card reusing already-shipped Ops. Both its
// abilities suspend for a live choice the canned smoke generator can't drive
// (the ETB `scryReorder` order-top pick; the upkeep `mayPay` Pay/Skip
// decision), so per the per-Op regime it earns a hand-written test. The
// graveyard-zone upkeep recursion mirrors Squee, Goblin Nabob (mmq/red.ts),
// here gated by a 1-life cost (CR 117.3a).

import { describe, it, expect } from "vitest";
import { masterOfDeath } from "..";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

describe("Master of Death (CR 701.25 ETB surveil 2; CR 603.6e graveyard-zone upkeep return for 1 life)", () => {
    function gyState(): GameState {
        const mod = makeInstance(masterOfDeath.id, {
            id: "mod",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        return makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [makePlayer("p1", { graveyard: [mod] }), makePlayer("p2")],
        });
    }

    const upkeep = {
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: "p1",
    };

    it("triggers on its controller's upkeep from the graveyard", () => {
        const state = gyState();
        const triggers = collectTriggers(state, [upkeep]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggeredAbilityId).toBe(
            "master-of-death-upkeep-return"
        );
    });

    it("does NOT trigger on the opponent's upkeep (CR 109.5)", () => {
        const state = gyState();
        const oppUpkeep = { ...upkeep, activePlayerId: "p2" };
        expect(collectTriggers(state, [oppUpkeep])).toHaveLength(0);
    });

    it("returns itself to hand and pays 1 life when accepted", () => {
        const state = gyState();
        state.players[0].life = 20;
        state.stack.push(...collectTriggers(state, [upkeep]));
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay

        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("may-pay");
        expect(pending.cost).toMatchObject({ life: 1 });

        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const p1 = state.players[0];
        expect(p1.life).toBe(19);
        expect(p1.hand.some((c) => c.id === "mod")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "mod")).toBe(false);
    });

    it("stays in the graveyard and pays no life when declined", () => {
        const state = gyState();
        state.players[0].life = 20;
        state.stack.push(...collectTriggers(state, [upkeep]));
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0];
        expect(p1.life).toBe(20);
        expect(p1.graveyard.some((c) => c.id === "mod")).toBe(true);
        expect(p1.hand.some((c) => c.id === "mod")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Grist, the Hunger Tide (issue #2391)
//
// Three things get pinned here that no catalogue sweep can:
//  1. the CR 113.6c off-battlefield static, at BOTH ends — the registry-backed
//     hidden-zone snapshot (`getGraveyardCards`, via the −5's own count) and
//     the instance materialisation the client sees through
//     `projectPublicState` — plus its negative, that the ability switches OFF
//     the instant Grist resolves onto the battlefield as a planeswalker;
//  2. the +1's unbounded repeat, at zero / one / several consecutive Insect
//     mills and at an empty library (CR 701.17b), including the
//     self-referential case where the milled Insect card IS a Grist;
//  3. the −2's optional sacrifice and its CR 603.12 reflexive trigger.

import { gristTheHungerTide } from "../multicolor";
import { grizzlyBears } from "../../lea/green";
import { xantidSwarm } from "../../scg/green";
import type { CardInstanceState } from "../../../../gre/state";
import { isCreature } from "../../../../gre/constants";
import { checkStateBasedActions } from "../../../../gre/sba";
import { handCardMatchesFilter } from "../../../../gre/alternativeCost";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

const GRIST = gristTheHungerTide.id;
const PLUS1 = "grist-the-hunger-tide-plus1";
const MINUS2 = "grist-the-hunger-tide-minus2";
const MINUS5 = "grist-the-hunger-tide-minus5";

function gristOnBattlefield(loyalty = 3): CardInstanceState {
    return makeInstance(GRIST, {
        id: "grist",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Grist's loyalty abilities on the stack and resolves it
 *  through the real path (the DKA/CLB planeswalker-test convention). */
function activate(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: GameState["stack"][number]["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

describe("Grist, the Hunger Tide — off-battlefield static (CR 113.6c)", () => {
    it("is a 1/1 Insect creature in a graveyard, and the client sees it through projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(GRIST, {
                            id: "gy-grist",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        checkStateBasedActions(state);

        const inGy = state.players[0].graveyard[0];
        expect(isCreature(inGy)).toBe(true);
        expect(inGy.types).toContain("Planeswalker"); // CR 205.1b — IN ADDITION
        expect(inGy.subtypes).toEqual(
            expect.arrayContaining(["Grist", "Insect"])
        );
        expect([inGy.power, inGy.toughness]).toEqual([1, 1]);

        // SURFACE — the client reads the projected instance, never the state.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].graveyard.find(
            (c) => c.id === "gy-grist"
        )!;
        expect(isCreature(slim as unknown as CardInstanceState)).toBe(true);
        expect(slim.subtypes).toContain("Insect");
    });

    it("is a creature card in HAND for a cost filter that reads hand cards", () => {
        const inHand = makeInstance(GRIST, {
            id: "hand-grist",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        expect(handCardMatchesFilter(inHand, { type: "Creature" })).toBe(true);
        expect(handCardMatchesFilter(inHand, { subtype: "Insect" })).toBe(true);
        // A control card: an ordinary planeswalker-less creature-less card is
        // unaffected by the new branch.
        const bearsInHand = makeInstance(grizzlyBears.id, {
            id: "hand-bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        expect(handCardMatchesFilter(bearsInHand, { subtype: "Insect" })).toBe(
            false
        );
    });

    it("STOPS being a creature the instant it resolves onto the battlefield", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const spell = makeInstance(GRIST, {
            id: "grist-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        state.players[0].hand.push(spell);
        checkStateBasedActions(state);
        // While in hand it is a creature card…
        expect(isCreature(state.players[0].hand[0])).toBe(true);

        // …cast it and resolve it as a permanent.
        state.players[0].hand = [];
        state.stack.push({ ...spell, zone: "stack", castById: "p1" });
        resolveTopOfStack(state);

        const perm = state.players[0].battlefield.find(
            (c) => c.id === "grist-spell"
        )!;
        expect(isCreature(perm)).toBe(false);
        expect(perm.types).toEqual(["Planeswalker"]);
        expect(perm.subtypes).toEqual(["Grist"]);
        expect(perm.power).toBeUndefined();
        expect(perm.toughness).toBeUndefined();
        // CR 306.5b — and it entered with its printed starting loyalty.
        expect(perm.counters?.loyalty).toBe(3);
    });
});

describe("Grist, the Hunger Tide — +1 repeat loop (CR 701.17 mill)", () => {
    function stateWithLibrary(libraryCardIds: string[]): GameState {
        const library = libraryCardIds.map((cardId, i) =>
            makeInstance(cardId, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [gristOnBattlefield()],
                    library,
                }),
                makePlayer("p2"),
            ],
        });
    }

    const insectTokens = (state: GameState) =>
        state.players[0].battlefield.filter((c) => c.isToken);

    it("stops after one pass when the milled card is not an Insect card", () => {
        const state = stateWithLibrary([grizzlyBears.id, grizzlyBears.id]);
        activate(state, state.players[0].battlefield[0], PLUS1);

        expect(insectTokens(state)).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(1);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["lib0"]);
        // No EXTRA loyalty counter beyond the 3 it started with (the +1 cost
        // itself is paid by the activation path, not by resolution).
        expect(
            state.players[0].battlefield.find((c) => c.id === "grist")!.counters
                ?.loyalty
        ).toBe(3);
    });

    it("repeats once for one Insect card milled", () => {
        const state = stateWithLibrary([xantidSwarm.id, grizzlyBears.id]);
        activate(state, state.players[0].battlefield[0], PLUS1);

        expect(insectTokens(state)).toHaveLength(2);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "lib0",
            "lib1",
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "grist")!.counters
                ?.loyalty
        ).toBe(4);
    });

    it("repeats once per consecutive Insect card, counting a milled GRIST as an Insect card (CR 113.6c)", () => {
        // lib0/lib1 are Grist cards — Insect cards only because the CR 113.6c
        // static functions in the library and graveyard. lib2 ends the loop.
        const state = stateWithLibrary([GRIST, GRIST, grizzlyBears.id]);
        activate(state, state.players[0].battlefield[0], PLUS1);

        expect(insectTokens(state)).toHaveLength(3);
        expect(state.players[0].library).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "lib0",
            "lib1",
            "lib2",
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "grist")!.counters
                ?.loyalty
        ).toBe(5);

        // SURFACE — the loyalty count and every token the loop created are what
        // the client renders.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.find((c) => c.id === "grist")!
                .counters?.loyalty
        ).toBe(5);
        const projectedTokens = projected.players[0].battlefield.filter(
            (c) => c.isToken
        );
        expect(projectedTokens).toHaveLength(3);
        expect(projectedTokens[0].subtypes).toEqual(["Insect"]);
        expect([
            projectedTokens[0].power,
            projectedTokens[0].toughness,
        ]).toEqual([1, 1]);
    });

    it("creates the token but mills nothing on an empty library (CR 701.17b)", () => {
        const state = stateWithLibrary([]);
        activate(state, state.players[0].battlefield[0], PLUS1);

        expect(insectTokens(state)).toHaveLength(1);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(
            state.players[0].battlefield.find((c) => c.id === "grist")!.counters
                ?.loyalty
        ).toBe(3);
    });
});

describe("Grist, the Hunger Tide — −2 optional sacrifice + reflexive trigger (CR 603.12)", () => {
    function board(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        gristOnBattlefield(),
                        makeInstance(grizzlyBears.id, {
                            id: "fodder",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "victim",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    it("destroys the target on a SEPARATE stack object whose target is announced after the sacrifice", () => {
        const state = board();
        activate(state, state.players[0].battlefield[0], MINUS2);

        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["fodder"],
        });
        expect(
            state.players[0].battlefield.some((c) => c.id === "fodder")
        ).toBe(false);

        const reflexive = state.stack.find((s) => s.reflexiveTrigger)!;
        expect(reflexive).toBeDefined();

        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "permanent", id: "victim" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);

        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
    });

    it("creates no reflexive trigger when the controller declines the optional sacrifice", () => {
        const state = board();
        activate(state, state.players[0].battlefield[0], MINUS2);

        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: [],
        });

        expect(
            state.players[0].battlefield.some((c) => c.id === "fodder")
        ).toBe(true);
        expect(state.stack.some((s) => s.reflexiveTrigger)).toBe(false);
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(true);
    });
});

describe("Grist, the Hunger Tide — −5 (CR 118.2 life loss scaled to graveyard creature cards)", () => {
    it("counts every creature card in your graveyard, INCLUDING a Grist there (CR 113.6c)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [gristOnBattlefield(5)],
                    graveyard: [
                        makeInstance(grizzlyBears.id, {
                            id: "gy-bears",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                        makeInstance(GRIST, {
                            id: "gy-grist",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        state.players[1].life = 20;
        activate(state, state.players[0].battlefield[0], MINUS5);

        // Grizzly Bears (a creature card) + the second Grist (a creature card
        // only because it is not on the battlefield) = 2.
        expect(state.players[1].life).toBe(18);
    });

    it("takes no life when the graveyard holds no creature cards", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gristOnBattlefield(5)] }),
                makePlayer("p2"),
            ],
        });
        state.players[1].life = 20;
        activate(state, state.players[0].battlefield[0], MINUS5);
        expect(state.players[1].life).toBe(20);
    });
});
