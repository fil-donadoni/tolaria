// Kicker {X} — a Kicker whose mana leg carries the variable X (issue #2141).
//
// CR 107.3a: a spell announces ONE X, and "any X in its mana cost or in any
// alternative cost or additional cost it has equals the announced value" — so
// a "Kicker {X}" is priced at the spell's own `chosenX`, never a second
// variable. CR 601.2b: the value of a variable cost is announced only for a
// cost "that will be paid as it's being cast", so an UNPAID Kicker {X} owes no
// X. CR 107.3m: the ETB trigger of the permanent that spell became reads that
// same X.
//
// Like `kicker.test.ts`, this drives the REAL exported pieces `announceCast`
// uses (`finalizeTargetSelection` folds the cost and puts the spell on the
// stack) over the real GRE state, then resolves it — with a serializer
// round-trip between the ETB trigger reaching the stack and resolving, the
// DB save every mutation performs there.

import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../game";
import {
    foldKickerCosts,
    kickerAnnouncesX,
    paidKickersAnnounceX,
} from "../kicker";
import {
    getPlayer,
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
} from "../state";
import { compactState, expandState } from "../serialize";
import { mvOfStackItem } from "../targetFilters";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup";
import { verdelothTheAncient } from "../../cards/sets/inv/green";
import { burstLightning } from "../../cards/sets/zen/red";
import { fireball } from "../../cards/sets/lea";

function verdelothInHand(id: string) {
    return makeInstance(verdelothTheAncient.id, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        id,
    });
}

function castVerdeloth(
    greenMana: number,
    announce: Pick<PendingTarget, "kickerPayments" | "chosenX">
): GameState {
    const verdeloth = verdelothInHand("verdeloth");
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [verdeloth],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: greenMana, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "verdeloth",
        targetType: "any",
        count: 0,
        selected: [],
        ...announce,
    };
    finalizeTargetSelection(state, pt, "p1");
    return state;
}

/** Resolve the spell, save/load the state the way every mutation does, then
 *  resolve whatever its ETB put on the stack. */
function resolveThroughEtb(state: GameState): GameState {
    resolveTopOfStack(state);
    resolveTriggerOrder(state);
    let loaded = expandState(compactState(state));
    while (loaded.stack.length > 0) {
        resolveTopOfStack(loaded);
        loaded = expandState(compactState(loaded));
    }
    return loaded;
}

function saprolingsOf(state: GameState): number {
    return getPlayer(state, "p1").battlefield.filter((c) =>
        c.subtypes.includes("Saproling")
    ).length;
}

describe("Kicker {X} — which casts announce X (CR 107.3a / 601.2b)", () => {
    it("a Kicker whose mana leg carries {X} announces X; a fixed one does not", () => {
        expect(kickerAnnouncesX(verdelothTheAncient.kickers![0])).toBe(true);
        expect(kickerAnnouncesX(burstLightning.kickers![0])).toBe(false);
    });

    it("only a PAID Kicker {X} owes the announcement", () => {
        expect(paidKickersAnnounceX(verdelothTheAncient, { kicker: 1 })).toBe(
            true
        );
        expect(paidKickersAnnounceX(verdelothTheAncient, undefined)).toBe(
            false
        );
        expect(paidKickersAnnounceX(burstLightning, { kicker: 1 })).toBe(false);
    });

    it("folds the Kicker's {X} at the spell's one announced X", () => {
        const cost: Record<string, number> = { X: 4, G: 2 };
        foldKickerCosts(cost, verdelothTheAncient, { kicker: 1 }, 5);
        expect(cost).toEqual({ X: 9, G: 2 });
    });
});

describe("Verdeloth the Ancient — Kicker {X} cast to resolution (CR 107.3a / 107.3m)", () => {
    it.each([0, 2, 5])(
        "kicked with X = %i: pays {4}{G}{G} + X and creates X Saprolings",
        (x) => {
            // Exactly the kicked total: nothing may be left over, nothing short.
            const state = castVerdeloth(6 + x, {
                kickerPayments: { kicker: 1 },
                chosenX: x,
            });
            expect(getPlayer(state, "p1").manaPool.G).toBe(0);
            const item = state.stack.find((s) => s.id === "verdeloth");
            expect(item?.chosenX).toBe(x);
            expect(item?.kickerPayments).toEqual({ kicker: 1 });

            const after = resolveThroughEtb(state);
            expect(saprolingsOf(after)).toBe(x);
        }
    );

    it("unkicked: pays only {4}{G}{G} and creates no Saproling", () => {
        const state = castVerdeloth(8, {});
        expect(getPlayer(state, "p1").manaPool.G).toBe(2);
        const after = resolveThroughEtb(state);
        expect(saprolingsOf(after)).toBe(0);
        expect(
            getPlayer(after, "p1").battlefield.some((c) => c.id === "verdeloth")
        ).toBe(true);
    });
});

describe("mana value of a spell kicked for X (CR 202.3 / 202.3e)", () => {
    it("the Kicker's X is not part of the mana cost, so it adds nothing", () => {
        const state = castVerdeloth(9, {
            kickerPayments: { kicker: 1 },
            chosenX: 3,
        });
        const item = state.stack.find((s) => s.id === "verdeloth")!;
        expect(mvOfStackItem(item)).toBe(6);
    });

    it("an {X} in the mana cost still counts at the announced value", () => {
        expect(mvOfStackItem({ card: { id: fireball.id }, chosenX: 3 })).toBe(
            4
        );
    });
});
