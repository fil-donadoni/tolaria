// Chalice of the Void — "Whenever a player casts a spell with mana value equal
// to the number of charge counters on this artifact, counter that spell."
// (CR 603.2 trigger event, CR 202.3e stack mana value, CR 701.6a counter).
// Driven through the REAL cast path so `emitSpellCastEvent` supplies
// `spellManaValue` and the engine places and resolves the trigger.

import { describe, it, expect } from "vitest";
import { tryAutoCommitPendingCast } from "../../../../game";
import { getCardByName } from "../../..";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";

const CHALICE = getCardByName("Chalice of the Void").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id; // {1}{G}, mana value 2
const BLACK_LOTUS = getCardByName("Black Lotus").id; // {0}, mana value 0

/** p1 controls a Chalice with `charge` counters; p2 is one commit away from
 *  putting `spellId` on the stack. */
function stateWith(charge: number, spellId: string): GameState {
    const chalice = makeInstance(CHALICE, {
        id: "chalice",
        controllerId: "p1",
        ownerId: "p1",
        ...(charge > 0 ? { counters: { charge } } : {}),
    });
    const spell = makeInstance(spellId, {
        id: "spell",
        controllerId: "p2",
        ownerId: "p2",
        zone: "hand",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [chalice] }),
            makePlayer("p2", {
                hand: [spell],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
            }),
        ],
        activePlayerId: "p2",
        priorityPlayerId: "p2",
        pendingCast: {
            playerId: "p2",
            cardInstanceId: "spell",
            manaCost: spellId === GRIZZLY_BEARS ? { G: 1, generic: 1 } : {},
            tappedLandIds: [],
        },
    });
}

describe("Chalice of the Void — counter on equal mana value (CR 603.2 / 202.3e)", () => {
    it("counters a spell whose mana value equals the charge counters", () => {
        const state = stateWith(2, GRIZZLY_BEARS);
        tryAutoCommitPendingCast(state, "p2");
        expect(state.stack).toHaveLength(2); // the spell + Chalice's trigger
        resolveTopOfStack(state);
        expect(state.stack.map((s) => s.id)).not.toContain("spell");
        expect(
            state.players.find((p) => p.id === "p2")!.graveyard.map((c) => c.id)
        ).toContain("spell");
    });

    it("does not trigger on a different mana value", () => {
        const state = stateWith(1, GRIZZLY_BEARS);
        tryAutoCommitPendingCast(state, "p2");
        expect(state.stack.map((s) => s.id)).toEqual(["spell"]);
    });

    it("with no charge counters (X=0) counters a mana value 0 spell", () => {
        const state = stateWith(0, BLACK_LOTUS);
        tryAutoCommitPendingCast(state, "p2");
        resolveTopOfStack(state);
        expect(state.stack.map((s) => s.id)).not.toContain("spell");
    });

    it("with no charge counters leaves a mana value 2 spell alone", () => {
        const state = stateWith(0, GRIZZLY_BEARS);
        tryAutoCommitPendingCast(state, "p2");
        expect(state.stack.map((s) => s.id)).toEqual(["spell"]);
    });

    it("enters with X charge counters, X being the cast X (CR 614.1c / 107.3m)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, CHALICE, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        const chalice = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(chalice?.counters?.charge).toBe(2);
    });
});
