// Integration test: undoing a tap-for-mana refunds the life its inline self-
// damage / life-cost riders took (CR 106.4 / 605.1a).
//
// The bug: painlands (Adarkar Wastes cycle), Ancient Tomb, and Mana Confluence
// deal damage / pay life as part of resolving their mana ability — inline, with
// NO stack (CR 605.3a). Tapping such a source for mana while holding priority,
// then undoing the tap before the mana is spent, used to refund the floated
// mana but leave the life loss applied. The whole mana-ability activation is
// reversible in that window (until the mana is spent or an event intervenes),
// so the life must come back too — Arena's mana-undo semantics.
//
// This differs from City of Brass, whose "becomes tapped" TRIGGER goes on the
// stack (CR 603.3, covered by untapToggleTrigger.test.ts): once on the stack it
// can't be undone, so that tap is blocked from untapping entirely. Painland-
// style inline riders never touch the stack, so their tap stays reversible.
//
// The fix snapshots the real life delta (`recordLifePaidOnTap`) on the tap and
// restores it (`restoreLifePaidOnUntap`) on the untap, symmetric with the mana
// refund. There is no convex-test harness, so the priority path replicates the
// `tapUntap` branch over the real rider + snapshot functions, and the payment
// path calls the REAL `tapSourceIntoPayment` end-to-end.

import { describe, it, expect } from "vitest";
import {
    recordLifePaidOnTap,
    restoreLifePaidOnUntap,
    applyColoredTapSelfDamage,
    applyUnconditionalTapSelfDamage,
    applyManaAbilityLifeCost,
    tapSourceIntoPayment,
} from "../game";
import {
    emitPermanentTapped,
    type GameState,
    type PlayerState,
    type CardInstanceState,
} from "../gre/state";
import { getActivatedManaAbility } from "../gre/constants";
import { compactState, expandState } from "../gre/serialize";
import type { ManaCost } from "../cards/types";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

const ADARKAR_WASTES = "09dd9023-f7ee-4e99-8821-7059deb83730"; // {C} painless | {W}/{U} → 1 dmg
const ANCIENT_TOMB = "30e401e3-282b-4524-87e1-c6cd50cd6d00"; // {C}{C}, deals 2 to you every tap
const MANA_CONFLUENCE = "504a69eb-3c2d-4bb1-b117-252b15acf0c2"; // {T}, Pay 1 life: any color

/** Replicates the `tapUntap` priority tap-for-mana branch over the REAL rider +
 *  snapshot functions: float the mana, run the inline riders (coloured ping /
 *  unconditional ping / life cost), then record the life actually paid. */
function priorityTapForMana(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    chosen: ManaCost
): void {
    const ability = getActivatedManaAbility(card);
    const lifeBeforeTap = player.life;
    emitPermanentTapped(state, card, true, chosen);
    for (const [color, amount] of Object.entries(chosen)) {
        if (typeof amount === "number" && amount > 0) {
            const key = color as keyof PlayerState["manaPool"];
            player.manaPool[key] = (player.manaPool[key] ?? 0) + amount;
        }
    }
    card.isTapped = true;
    card.chosenMana = chosen;
    applyColoredTapSelfDamage(state, ability, card, player.id, chosen);
    applyUnconditionalTapSelfDamage(state, ability, card, player.id);
    applyManaAbilityLifeCost(state, ability, player.id);
    recordLifePaidOnTap(card, lifeBeforeTap, player.life);
}

/** Replicates the `tapUntap` untap branch: refund the floated mana, then
 *  restore the life via the REAL helper (as `tapUntap` / untapForPayment do). */
function untapToggle(player: PlayerState, card: CardInstanceState): void {
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
    restoreLifePaidOnUntap(player, card);
    card.isTapped = false;
}

describe("untapping a tap-for-mana refunds paid life (CR 106.4 / 605.1a)", () => {
    describe("Adarkar Wastes — painland coloured-tap ping (priority)", () => {
        it("coloured tap pings for 1 and records it; untap toggle refunds the life and the mana", () => {
            const land = makeInstance(ADARKAR_WASTES, { id: "wastes" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [land] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];

            // Coloured choice {W}: the rider pings the controller for 1.
            priorityTapForMana(state, p1, p1.battlefield[0], { W: 1 });
            expect(p1.life).toBe(19);
            expect(p1.manaPool.W).toBe(1);
            expect(p1.battlefield[0].lifePaidThisTap).toBe(1);

            // Undo before spending: both the mana AND the life come back.
            untapToggle(p1, p1.battlefield[0]);
            expect(p1.life).toBe(20);
            expect(p1.manaPool.W).toBe(0);
            expect(p1.battlefield[0].isTapped).toBe(false);
            expect(p1.battlefield[0].lifePaidThisTap).toBeUndefined();
        });

        it("the painless {C} tap costs no life and records nothing to refund", () => {
            const land = makeInstance(ADARKAR_WASTES, { id: "wastes" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [land] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];

            // Colourless choice {C}: no ping (the rider only fires on colour).
            priorityTapForMana(state, p1, p1.battlefield[0], { C: 1 });
            expect(p1.life).toBe(20);
            expect(p1.battlefield[0].lifePaidThisTap).toBeUndefined();

            untapToggle(p1, p1.battlefield[0]);
            expect(p1.life).toBe(20);
        });
    });

    describe("Ancient Tomb — unconditional 2-damage ping (priority)", () => {
        it("every tap pings for 2; untap toggle refunds both", () => {
            const tomb = makeInstance(ANCIENT_TOMB, { id: "tomb" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [tomb] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];

            priorityTapForMana(state, p1, p1.battlefield[0], { C: 2 });
            expect(p1.life).toBe(18);
            expect(p1.battlefield[0].lifePaidThisTap).toBe(2);

            untapToggle(p1, p1.battlefield[0]);
            expect(p1.life).toBe(20);
            expect(p1.battlefield[0].lifePaidThisTap).toBeUndefined();
        });
    });

    describe("Mana Confluence — Pay 1 life cost (priority)", () => {
        it("the life-payment cost is refunded on untap", () => {
            const conf = makeInstance(MANA_CONFLUENCE, { id: "conf" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [conf] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];

            priorityTapForMana(state, p1, p1.battlefield[0], { R: 1 });
            expect(p1.life).toBe(19);
            expect(p1.battlefield[0].lifePaidThisTap).toBe(1);

            untapToggle(p1, p1.battlefield[0]);
            expect(p1.life).toBe(20);
            expect(p1.battlefield[0].lifePaidThisTap).toBeUndefined();
        });
    });

    describe("payment path — real tapSourceIntoPayment / restore", () => {
        it("Adarkar Wastes tapped to pay a cost records the ping; reversing the source refunds it", () => {
            const land = makeInstance(ADARKAR_WASTES, { id: "wastes" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [land] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];
            const tappedLandIds: string[] = [];

            // manaChoices [{C},{W},{U}] — index 1 = {W}, the coloured ping.
            tapSourceIntoPayment(
                state,
                p1,
                p1.battlefield[0],
                1,
                tappedLandIds
            );
            expect(p1.life).toBe(19);
            expect(p1.battlefield[0].lifePaidThisTap).toBe(1);
            expect(tappedLandIds).toContain("wastes");

            // untapForPayment reverses the source (mana refund tested elsewhere).
            restoreLifePaidOnUntap(p1, p1.battlefield[0]);
            expect(p1.life).toBe(20);
            expect(p1.battlefield[0].lifePaidThisTap).toBeUndefined();
        });

        it("Ancient Tomb tapped to pay a cost records the 2-damage ping and refunds it on reversal", () => {
            const tomb = makeInstance(ANCIENT_TOMB, { id: "tomb" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [tomb] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];
            const tappedLandIds: string[] = [];

            // Fixed {C}{C} output — no mana choice index.
            tapSourceIntoPayment(
                state,
                p1,
                p1.battlefield[0],
                undefined,
                tappedLandIds
            );
            expect(p1.life).toBe(18);
            expect(p1.battlefield[0].lifePaidThisTap).toBe(2);

            restoreLifePaidOnUntap(p1, p1.battlefield[0]);
            expect(p1.life).toBe(20);
            expect(p1.battlefield[0].lifePaidThisTap).toBeUndefined();
        });
    });

    describe("serialization round-trip (schema-drift guard)", () => {
        it("preserves lifePaidThisTap across compactState/expandState", () => {
            const land = makeInstance(ADARKAR_WASTES, {
                id: "wastes",
                isTapped: true,
            });
            land.lifePaidThisTap = 1;
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [land] }),
                    makePlayer("p2"),
                ],
            });

            const restored = expandState(compactState(state));
            const slim = restored.players[0].battlefield.find(
                (c) => c.id === "wastes"
            )!;
            expect(slim.lifePaidThisTap).toBe(1);
        });
    });
});
