// Frontend wiring for the Domain-driven CR 601.2f cost reduction (issue
// #1958, Draco / Stratadon).
//
// A cost reduction correct in the GRE is routinely invisible in the UI: the
// client never sees `GameState`, only the output of the view reducers, and it
// never recomputes CR 601.2f for itself — it renders whatever cost the server
// PARKED on `PendingCast.manaCost` and gates the Pay button on that same
// number. So every SURFACE assertion here runs through the REAL reducer
// (`projectPublicState`) over a `pendingCast` built by the REAL engine fold
// (`getCostModifiers` + `applyCostModifiers`, the exact pair `announceCast`
// calls). A hand-written {6} would prove nothing: it would pass whether or not
// the reduction ever reached the wire.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { draco } from "@convex/cards/sets/pls/colorless";
import {
    forest,
    island,
    mountain,
    plains,
    swamp,
} from "@convex/cards/sets/lea/colorless";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    type GameState,
} from "@convex/gre/state";
import type { ManaCost, ManaPool, PendingCast } from "~/types/game";
import {
    isManaCostCovered,
    pendingCastRemainingGeneric,
} from "~/lib/card-utils";

const BASICS = [plains, island, swamp, mountain, forest];

/** A board where p1 controls `domain` distinct basic land types plus Draco in
 *  hand, with the cast already announced: `pendingCast.manaCost` is produced by
 *  the SAME `getCostModifiers` + `applyCostModifiers` fold the server runs at
 *  announcement, so the number under test is the engine's, not the test's. */
function announcedDracoState(domain: number, pool: number): GameState {
    const dracoCard = makeInstance(draco.id, {
        id: "draco-hand",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const lands = BASICS.slice(0, domain).map((def, i) =>
        makeInstance(def.id, {
            id: `surface-land-${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [dracoCard],
                battlefield: lands,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: pool },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const manaCost = normalizeManaCost(draco.manaCost ?? {});
    applyCostModifiers(manaCost, getCostModifiers(state, dracoCard, "spell"));
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: dracoCard.id,
        manaCost,
        tappedLandIds: [],
    };
    return state;
}

/** The viewer's own `pendingCast` as the board actually receives it — through
 *  the real wire projection, never the fat `GameState`. */
function projectedPendingCast(state: GameState): PendingCast {
    const projected = projectPublicState(state, 1, "p1");
    const pendingCast = projected.pendingCast as PendingCast | undefined;
    expect(pendingCast).toBeDefined();
    return pendingCast!;
}

describe("Domain cost reduction reaches the cast-cost surface (CR 601.2f, issue #1958)", () => {
    it("the payment surface shows the REDUCED generic, not Draco's printed {16}", () => {
        const state = announcedDracoState(5, 6);
        const pendingCast = projectedPendingCast(state);
        // {16} - 5 × {2} = {6}. This is the number the PaymentBanner renders
        // and the Improvise/land-tap affordance gates on.
        expect(pendingCastRemainingGeneric(pendingCast)).toBe(6);
        expect(pendingCastRemainingGeneric(pendingCast)).not.toBe(16);
    });

    it("scales with Domain across the whole 0–5 range on the projected state", () => {
        for (const [domain, owed] of [
            [0, 16],
            [1, 14],
            [2, 12],
            [3, 10],
            [4, 8],
            [5, 6],
        ] as const) {
            const pendingCast = projectedPendingCast(
                announcedDracoState(domain, 0)
            );
            expect(pendingCastRemainingGeneric(pendingCast)).toBe(owed);
        }
    });

    it("the Pay affordance opens at the reduced price and not at the printed one", () => {
        const state = announcedDracoState(5, 6);
        const projected = projectPublicState(state, 1, "p1");
        const me = projected.players[0];
        const pendingCast = projectedPendingCast(state);
        // Six floating covers the reduced {6}: the client would enable Pay.
        expect(
            isManaCostCovered(
                me.manaPool as ManaPool,
                pendingCast.manaCost as ManaCost
            )
        ).toBe(true);
        // One short is still short — the gate is a real comparison, not a
        // blanket "reduced spells are always payable".
        expect(
            isManaCostCovered(
                { W: 0, U: 0, B: 0, R: 0, G: 0, C: 5 } as ManaPool,
                pendingCast.manaCost as ManaCost
            )
        ).toBe(false);
    });

    it("the announced price is LOCKED — a land entering mid-payment does not re-price it (CR 601.2f)", () => {
        // Announce at Domain 2 → {12} owed.
        const state = announcedDracoState(2, 0);
        expect(pendingCastRemainingGeneric(projectedPendingCast(state))).toBe(
            12
        );
        // Three more basic land types hit the battlefield while the cast is
        // still being paid for. Domain is now 5, but the total cost was locked
        // in at announcement and must NOT drop to {6}.
        for (const [i, def] of BASICS.slice(2).entries()) {
            state.players[0].battlefield.push(
                makeInstance(def.id, {
                    id: `late-land-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        expect(pendingCastRemainingGeneric(projectedPendingCast(state))).toBe(
            12
        );
    });
});
