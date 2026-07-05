// Integration test for the standalone untap-toggle guard against an
// irreversible tap-for-mana (issue #793, CR 603.3).
//
// The bug: tapping a mana source for mana while holding priority resolves the
// mana ability, then puts its "becomes tapped" triggered ability on the stack
// (City of Brass self-damage) — or fires a third-party watcher (Manabarbs on
// every land tap). Per CR 603.3 a triggered ability, once on the stack, cannot
// be undone. The old untap-toggle nonetheless refunded the mana and untapped
// the source, leaving the trigger's damage applied — an illegal state.
//
// The fix flags the tapped source (`tapTriggerCommitted`) when the tap-for-mana
// grows the stack (class-wide, keyed on stack growth, not on a card name), and
// the `tapUntap` untap branch rejects the toggle while the flag is set —
// mirroring the existing `manaCommitted` "mana already spent" guard. The flag
// is cleared when the source untaps at the untap step and when its mana is
// committed to a spell.
//
// This file replicates the `tapUntap` mutation body over real GRE primitives
// (the same pattern as autoTapForPayment.test.ts), since there is no
// convex-test harness: the tap branch emits PERMANENT_TAPPED, floats the mana,
// flushes triggers, and calls `markTapTriggerCommitment`; the untap branch runs
// the mutation's guard order before refunding.

import { describe, it, expect } from "vitest";
import { markTapTriggerCommitment } from "../game";
import {
    emitPermanentTapped,
    processPendingActionTriggers,
    resolveTopOfStack,
    commitLandsForCost,
    type GameState,
    type PlayerState,
    type CardInstanceState,
} from "../gre/state";
import type { ManaCost } from "../cards/types";
import { untapStep } from "../gre/phases";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

const CITY_OF_BRASS = "f4e32327-380d-471e-813b-4c27477787ce"; // {T}: any color; becomes tapped → 1 dmg
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // {T}: G, no trigger
const MANABARBS = "6121f72f-680f-4bb4-ae4d-37ee4ebed4d8"; // any land tapped for mana → 1 dmg

/** Replicates the `tapUntap` tap-for-mana branch over real primitives: float
 *  the produced mana, emit PERMANENT_TAPPED, flush the trigger pass, and set
 *  the irreversibility flag if the flush grew the stack. */
function priorityTapForMana(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    produced: ManaCost
): void {
    emitPermanentTapped(state, card, true, produced);
    for (const [color, amount] of Object.entries(produced)) {
        if (typeof amount === "number" && amount > 0) {
            const key = color as keyof PlayerState["manaPool"];
            player.manaPool[key] = (player.manaPool[key] ?? 0) + amount;
        }
    }
    card.isTapped = true;
    card.chosenMana = produced;
    const stackSizeBefore = state.stack.length;
    processPendingActionTriggers(state);
    markTapTriggerCommitment(state, card, stackSizeBefore);
}

/** Replicates the `tapUntap` untap branch guards (mutation order:
 *  `manaCommitted` first, then `tapTriggerCommitted`) before refunding. Throws
 *  exactly the mutation's error strings so a rejected toggle is observable. */
function attemptUntapToggle(
    player: PlayerState,
    card: CardInstanceState
): void {
    if (card.isTapped && card.manaCommitted) {
        throw new Error("Cannot untap: mana already spent");
    }
    if (card.isTapped && card.tapTriggerCommitted) {
        throw new Error("Cannot untap: tap trigger already on the stack");
    }
    // Refund the floated mana and untap (the ordinary "misclick undo").
    for (const [color, amount] of Object.entries(card.chosenMana ?? {})) {
        if (typeof amount === "number" && amount > 0) {
            const key = color as keyof PlayerState["manaPool"];
            player.manaPool[key] = Math.max(
                0,
                (player.manaPool[key] ?? 0) - amount
            );
        }
    }
    card.chosenMana = undefined;
    card.isTapped = false;
}

describe("untap-toggle after an irreversible tap-for-mana (CR 603.3, #793)", () => {
    describe("City of Brass — own becomes-tapped self-damage trigger", () => {
        it("tapping for mana puts the damage trigger on the stack and flags the source irreversible", () => {
            const city = makeInstance(CITY_OF_BRASS, { id: "city" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [city] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];

            priorityTapForMana(state, p1, p1.battlefield[0], { R: 1 });

            // The becomes-tapped trigger is now on the stack (CR 603.3).
            expect(state.stack.length).toBe(1);
            expect(p1.battlefield[0].tapTriggerCommitted).toBe(true);
            expect(p1.manaPool.R).toBe(1);
        });

        it("rejects the untap-toggle; source stays tapped, mana floated, life at post-damage total", () => {
            const city = makeInstance(CITY_OF_BRASS, { id: "city" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [city] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];
            priorityTapForMana(state, p1, p1.battlefield[0], { R: 1 });
            // Resolve the self-damage trigger (player passes / it resolves).
            resolveTopOfStack(state);
            expect(p1.life).toBe(19);

            expect(() =>
                attemptUntapToggle(p1, p1.battlefield[0])
            ).toThrowError("Cannot untap: tap trigger already on the stack");
            // Source stays tapped, mana stays floated, life stays at 19.
            expect(p1.battlefield[0].isTapped).toBe(true);
            expect(p1.manaPool.R).toBe(1);
            expect(p1.life).toBe(19);
        });

        it("clears the flag at the untap step so next turn's tap is undoable", () => {
            const city = makeInstance(CITY_OF_BRASS, { id: "city" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [city] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];
            priorityTapForMana(state, p1, p1.battlefield[0], { R: 1 });
            expect(p1.battlefield[0].tapTriggerCommitted).toBe(true);

            state.phase = "UNTAP";
            untapStep(state);

            expect(p1.battlefield[0].isTapped).toBe(false);
            expect(p1.battlefield[0].tapTriggerCommitted).toBeUndefined();
        });

        it("clears the flag when the floated mana is committed to a spell", () => {
            const city = makeInstance(CITY_OF_BRASS, { id: "city" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [city] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];
            priorityTapForMana(state, p1, p1.battlefield[0], { R: 1 });
            expect(p1.battlefield[0].tapTriggerCommitted).toBe(true);

            // CR 603.3 — mana spent on a spell: manaCommitted takes over the
            // untap block and the tap-trigger flag is dropped.
            commitLandsForCost(p1, { R: 1 });
            expect(p1.battlefield[0].manaCommitted).toBe(true);
            expect(p1.battlefield[0].tapTriggerCommitted).toBeUndefined();
        });
    });

    describe("Forest — plain land, no becomes-tapped trigger (no regression)", () => {
        it("tapping for mana leaves the source undoable; untap-toggle refunds", () => {
            const forest = makeInstance(FOREST, { id: "forest" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [forest] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];

            priorityTapForMana(state, p1, p1.battlefield[0], { G: 1 });
            // No trigger fired, so no flag and the stack stays empty.
            expect(state.stack.length).toBe(0);
            expect(p1.battlefield[0].tapTriggerCommitted).toBeUndefined();
            expect(p1.manaPool.G).toBe(1);

            // The ordinary "misclick undo" still works.
            attemptUntapToggle(p1, p1.battlefield[0]);
            expect(p1.battlefield[0].isTapped).toBe(false);
            expect(p1.manaPool.G).toBe(0);
        });
    });

    describe("Manabarbs — third-party land-tap watcher (class-wide, not City-specific)", () => {
        it("an opponent's Manabarbs makes tapping any land for mana irreversible", () => {
            const forest = makeInstance(FOREST, { id: "forest" });
            const barbs = makeInstance(MANABARBS, {
                id: "barbs",
                controllerId: "p2",
                ownerId: "p2",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [forest] }),
                    makePlayer("p2", { battlefield: [barbs] }),
                ],
            });
            const p1 = state.players[0];

            priorityTapForMana(state, p1, p1.battlefield[0], { G: 1 });
            // Manabarbs' trigger fired off p1's land tap (class-wide detection).
            expect(state.stack.length).toBe(1);
            expect(p1.battlefield[0].tapTriggerCommitted).toBe(true);

            expect(() =>
                attemptUntapToggle(p1, p1.battlefield[0])
            ).toThrowError("Cannot untap: tap trigger already on the stack");
            expect(p1.battlefield[0].isTapped).toBe(true);
        });
    });
});
