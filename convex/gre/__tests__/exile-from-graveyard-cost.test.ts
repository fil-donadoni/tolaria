// Cluster C1 (FEM, #569) — exile-from-graveyard as an activation cost.
// CR 602.1 / 118.5 / 406. Full-path integration test for the cost-CHOICE
// submission that crosses GRE → game.ts → UI. The project has no convex-test
// harness (ADR 0001 / moves-integration.test.ts), so — like
// sacrifice-cost-activation.test.ts — the production mutation handlers
// (activateAbility's legality + deferral, selectActivationExileCost, and the
// tryAutoCommitPendingActivation commit step) are mirrored here as pure
// functions that drive the REAL exported GRE state functions, keeping the same
// branch order and gating the mutations use. A divergence (forgetting to move
// the cards to exile, splitting the cost across two graveyards, paying with the
// wrong card type, or committing before the pick) fails this test.

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    getOpponentId,
    isManaCostCovered,
    normalizeManaCost,
    payManaCost,
    commitLandsForCost,
    moveCard,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingActivation,
    type StackItem,
} from "../state";
import { getDefinition } from "../../cards";
import type { CardType } from "../../cards/types";
import { nightSoil } from "../../cards/sets/fem";
import { grizzlyBears } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

// --- mirror of game.ts canPayExileFromGraveyard ----------------------------
function canPayExileFromGraveyard(
    state: GameState,
    count: number,
    cardType?: CardType
): boolean {
    return state.players.some(
        (p) =>
            p.graveyard.filter(
                (c) => cardType === undefined || c.types.includes(cardType)
            ).length >= count
    );
}

/** Mirror of activateAbility's legality + deferral for an ability with
 *  `cost.exileFromGraveyard`. Returns the entered pendingActivation. */
function activateWithExileCost(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    abilityId: string
): PendingActivation {
    const player = getPlayer(state, playerId);
    const card = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!card) throw new Error("Card not on battlefield");
    const def = getDefinition((card.card as { id: string }).id);
    const ability = def.activatedAbilities?.find((a) => a.id === abilityId);
    if (!ability) throw new Error("Ability not found");

    // CR 602.1 / 118.5 — illegal unless one graveyard holds enough matching
    // cards.
    if (ability.cost.exileFromGraveyard) {
        const { count, cardType } = ability.cost.exileFromGraveyard;
        if (!canPayExileFromGraveyard(state, count, cardType)) {
            throw new Error(
                "No single graveyard has enough cards to pay the exile cost"
            );
        }
    }

    const manaCost = ability.cost.mana
        ? normalizeManaCost(ability.cost.mana)
        : undefined;
    const pa: PendingActivation = {
        playerId,
        cardInstanceId: card.id,
        abilityId,
        manaCost: manaCost ?? {},
        tappedLandIds: [],
        tapSource: !!ability.cost.tap,
        sacrificeSource: !!ability.cost.sacrifice,
        ...(ability.cost.exileFromGraveyard
            ? {
                  exileFromGraveyardChoice: {
                      count: ability.cost.exileFromGraveyard.count,
                      ...(ability.cost.exileFromGraveyard.cardType !== undefined
                          ? {
                                cardType:
                                    ability.cost.exileFromGraveyard.cardType,
                            }
                          : {}),
                  },
              }
            : {}),
    };
    state.pendingActivation = pa;
    return pa;
}

/** Mirror of tryAutoCommitPendingActivation, gated on the exile pick + mana.
 *  Moves the picked cards graveyard → exile, pushes the ability, resolves. */
function commitActivation(state: GameState, playerId: string): boolean {
    const pa = state.pendingActivation;
    if (!pa || pa.playerId !== playerId) return false;
    const player = getPlayer(state, playerId);
    if (!isManaCostCovered(player.manaPool, pa.manaCost)) return false;
    if (
        pa.exileFromGraveyardChoice &&
        !pa.exileFromGraveyardChoice.pickedCardIds
    ) {
        return false;
    }

    const card = player.battlefield.find((c) => c.id === pa.cardInstanceId)!;
    payManaCost(player.manaPool, pa.manaCost);
    commitLandsForCost(player, pa.manaCost);

    if (pa.exileFromGraveyardChoice?.pickedCardIds) {
        const owner = state.players.find(
            (p) => p.id === pa.exileFromGraveyardChoice!.pickedGraveyardOwnerId
        )!;
        for (const id of pa.exileFromGraveyardChoice.pickedCardIds) {
            moveCard(owner, id, "graveyard", "exile");
        }
    }

    const stackItem: StackItem = {
        ...structuredClone(card),
        zone: "stack" as const,
        castById: playerId,
        abilityId: pa.abilityId,
    };
    state.stack.push(stackItem);
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.pendingActivation = undefined;
    resolveTopOfStack(state);
    return true;
}

/** Mirror of selectActivationExileCost: enforce single-graveyard, exact count,
 *  and type filter; record the pick; attempt commit. */
function selectActivationExileCost(
    state: GameState,
    playerId: string,
    graveyardOwnerId: string,
    cardInstanceIds: string[]
): void {
    const pa = state.pendingActivation;
    if (!pa) throw new Error("No ability being activated");
    const ec = pa.exileFromGraveyardChoice;
    if (!ec) throw new Error("No exile-from-graveyard cost");
    if (ec.pickedCardIds) throw new Error("Exile cost already paid");
    if (cardInstanceIds.length !== ec.count) {
        throw new Error(
            `Must exile exactly ${ec.count} cards from a single graveyard`
        );
    }
    if (new Set(cardInstanceIds).size !== cardInstanceIds.length) {
        throw new Error("Duplicate card selected for the exile cost");
    }
    const owner = state.players.find((p) => p.id === graveyardOwnerId);
    if (!owner) throw new Error("Graveyard owner not in this game");
    for (const id of cardInstanceIds) {
        const c = owner.graveyard.find((g) => g.id === id);
        if (!c) throw new Error("Selected card is not in the chosen graveyard");
        if (ec.cardType !== undefined && !c.types.includes(ec.cardType)) {
            throw new Error(
                "Selected card does not match the exile cost filter"
            );
        }
    }
    ec.pickedGraveyardOwnerId = graveyardOwnerId;
    ec.pickedCardIds = [...cardInstanceIds];
    commitActivation(state, playerId);
}

/** A creature card sitting in a graveyard (the cost's eligible fuel). */
function graveyardCreature(id: string, ownerId: string): CardInstanceState {
    return makeInstance(grizzlyBears.id, {
        id,
        ownerId,
        controllerId: ownerId,
        zone: "graveyard",
    });
}

describe("exile-from-graveyard as an activation cost (CR 602.1 / 118.5 / 406)", () => {
    it("rejects activation when no single graveyard has two creature cards", () => {
        const soil = makeInstance(nightSoil.id, { id: "soil-1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [soil],
                    graveyard: [graveyardCreature("g1", "p1")], // only one
                }),
                makePlayer("p2", {
                    graveyard: [graveyardCreature("g2", "p2")], // one each — can't combine
                }),
            ],
        });
        expect(() =>
            activateWithExileCost(
                state,
                "p1",
                "soil-1",
                "night-soil-make-saproling"
            )
        ).toThrow(/exile cost/i);
    });

    it("enters pendingActivation with an exile-choice picker", () => {
        const soil = makeInstance(nightSoil.id, { id: "soil-1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [soil],
                    graveyard: [
                        graveyardCreature("g1", "p1"),
                        graveyardCreature("g2", "p1"),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        const pa = activateWithExileCost(
            state,
            "p1",
            "soil-1",
            "night-soil-make-saproling"
        );
        expect(pa.exileFromGraveyardChoice).toEqual({
            count: 2,
            cardType: "Creature",
        });
        // {1} is covered but commit is BLOCKED until the cards are picked.
        expect(commitActivation(state, "p1")).toBe(false);
        expect(state.stack).toHaveLength(0);
        // Cards untouched (exile deferred).
        expect(state.players[0].graveyard).toHaveLength(2);
        expect(state.players[0].exile ?? []).toHaveLength(0);
    });

    it("exiles exactly two creature cards from one graveyard and makes a Saproling", () => {
        const soil = makeInstance(nightSoil.id, { id: "soil-1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [soil],
                    graveyard: [
                        graveyardCreature("g1", "p1"),
                        graveyardCreature("g2", "p1"),
                        graveyardCreature("g3", "p1"),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        activateWithExileCost(
            state,
            "p1",
            "soil-1",
            "night-soil-make-saproling"
        );
        selectActivationExileCost(state, "p1", "p1", ["g1", "g2"]);

        // Cost paid: exactly the two picked cards moved to exile.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["g3"]);
        expect((state.players[0].exile ?? []).map((c) => c.id).sort()).toEqual([
            "g1",
            "g2",
        ]);
        // Effect resolved: a 1/1 green Saproling token.
        const tokens = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Saproling")
        );
        expect(tokens).toHaveLength(1);
        expect(tokens[0].power).toBe(1);
        expect(tokens[0].toughness).toBe(1);
    });

    it("can pay the cost from an OPPONENT's graveyard (CR 118.5 — any single graveyard)", () => {
        const soil = makeInstance(nightSoil.id, { id: "soil-1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [soil],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2", {
                    graveyard: [
                        graveyardCreature("o1", "p2"),
                        graveyardCreature("o2", "p2"),
                    ],
                }),
            ],
        });
        activateWithExileCost(
            state,
            "p1",
            "soil-1",
            "night-soil-make-saproling"
        );
        selectActivationExileCost(state, "p1", "p2", ["o1", "o2"]);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect((state.players[1].exile ?? []).map((c) => c.id).sort()).toEqual([
            "o1",
            "o2",
        ]);
        expect(
            state.players[0].battlefield.some((c) =>
                c.subtypes?.includes("Saproling")
            )
        ).toBe(true);
    });

    it("rejects splitting the cost across two graveyards (CR 118.5)", () => {
        const soil = makeInstance(nightSoil.id, { id: "soil-1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [soil],
                    graveyard: [
                        graveyardCreature("g1", "p1"),
                        graveyardCreature("g2", "p1"),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2", {
                    graveyard: [graveyardCreature("o1", "p2")],
                }),
            ],
        });
        activateWithExileCost(
            state,
            "p1",
            "soil-1",
            "night-soil-make-saproling"
        );
        // Try to take one from p1's graveyard while claiming p2 as the owner.
        expect(() =>
            selectActivationExileCost(state, "p1", "p2", ["g1", "o1"])
        ).toThrow(/not in the chosen graveyard/i);
    });
});
