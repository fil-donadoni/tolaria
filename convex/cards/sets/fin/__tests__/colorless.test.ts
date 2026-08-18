// FIN (Final Fantasy) — colorless card behavior tests (ADR 0043 colour
// split). Starting Town (issue #1306, parent PRD #620): CR 614.1c
// self-conditional tapped-entry (turn-gated) + TWO independent {T} mana
// abilities with different costs — the exact multi-ability shape the
// #675-era stub believed unsupported. Re-audit found `tapUntap` /
// `tapSourceIntoPayment` already resolve a submitted `manaChoiceIndex`
// against the UNIFIED option list across every `activatedAbilities` entry
// (`getManaTapOptionsDetailed`), carrying the CHOSEN ability's own
// `cost.life` through `applyManaAbilityLifeCost` — so this is just two plain
// activated mana abilities, no new primitive needed.

import { describe, it, expect } from "vitest";
import { startingTown } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    getManaTapOptions,
    getManaTapOptionsDetailed,
} from "../../../../gre/constants";
import { tapSourceIntoPayment } from "../../../../game";
import { shouldEnterTapped } from "../../../../gre/state";

describe("Starting Town (CR 614.1c turn-gated tapped-entry + two {T} mana abilities)", () => {
    it("declares a turn-gated entersTappedUnless and two independently-costed activated abilities", () => {
        expect(startingTown.types).toEqual(["Land"]);
        expect(startingTown.subtypes).toEqual(["Town"]);
        expect(startingTown.entersTappedUnless).toBeTypeOf("function");
        expect(startingTown.entersTapped).toBeUndefined();
        const [colorless, anyColor] = startingTown.activatedAbilities!;
        expect(colorless.cost).toEqual({ tap: true });
        expect(colorless.manaProduced).toEqual({ C: 1 });
        expect(anyColor.cost).toEqual({ tap: true, life: 1 });
        expect(anyColor.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    // CR 500.1 — "your first, second, or third turn" is the controller's OWN
    // turn ordinal, read directly off `LandEntryStateView.activePlayerId` +
    // each player's `turnsTaken` (issue #1871, second pass). The first pass's
    // seat-parity reconstruction from the global `turn` counter (`(view.turn
    // - seatIndex - 1) % seatCount === 0`) was inverted PERMANENTLY by any
    // extra turn (CR 500.7) — caught in review because it read correctly
    // against a hand-built view literal and was wrong on a real
    // `GameState`-shaped board the moment an extra turn happened. These
    // direct-predicate tests exercise the fixed field reads; the
    // `shouldEnterTapped` describe block below exercises the same fix
    // through the real engine entry point on a full `GameState`.
    const twoSeatView = {
        players: [
            { id: "p1", battlefield: [], turnsTaken: 1 },
            { id: "p2", battlefield: [], turnsTaken: 1 },
        ],
        turn: 1,
        activePlayerId: "p1",
    };

    it.each([1, 2, 3])(
        "controller's own turn: satisfied when turnsTaken is %i (1st/2nd/3rd turn)",
        (turnsTaken) => {
            expect(
                startingTown.entersTappedUnless!(
                    {
                        ...twoSeatView,
                        players: [
                            { id: "p1", battlefield: [], turnsTaken },
                            { id: "p2", battlefield: [], turnsTaken: 1 },
                        ],
                    },
                    "p1"
                )
            ).toBe(true);
        }
    );

    it("controller's own turn: NOT satisfied on their 4th turn (turnsTaken 4) — regression for issue #1871", () => {
        expect(
            startingTown.entersTappedUnless!(
                {
                    ...twoSeatView,
                    players: [
                        { id: "p1", battlefield: [], turnsTaken: 4 },
                        { id: "p2", battlefield: [], turnsTaken: 1 },
                    ],
                },
                "p1"
            )
        ).toBe(false);
    });

    it("not the controller's turn: fails closed to NOT satisfied regardless of turnsTaken", () => {
        expect(
            startingTown.entersTappedUnless!(
                { ...twoSeatView, activePlayerId: "p2" },
                "p1"
            )
        ).toBe(false);
    });

    it("a player not in `view.players` (unknown seat, and never the active player in a real game) never satisfies the predicate — fail-closed", () => {
        expect(startingTown.entersTappedUnless!(twoSeatView, "unseated")).toBe(
            false
        );
    });

    // Through the real entry point (`shouldEnterTapped` → `resolveEntersTapped`
    // → this predicate) on a full `GameState` built by the shared `makeState`
    // fixture — proves the fix against the ACTUAL object the sole call site
    // passes, not a hand-built view literal (the shape-3 gap the review
    // finding named: the old predicate's own tests never caught the
    // extra-turn regression because none of them went through this path).
    describe("through shouldEnterTapped (issue #1871)", () => {
        it("p1's own 1st turn (fresh game): untapped", () => {
            const state = makeState({
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer("p1", { turnsTaken: 1 }),
                    makePlayer("p2", { turnsTaken: 0 }),
                ],
            });
            const town = makeInstance(startingTown.id, { controllerId: "p1" });
            expect(shouldEnterTapped(state, town)).toBe(false);
        });

        it("post-Time-Walk: p1 active again on global turn 2 (their OWN 2nd turn, turnsTaken 2): untapped", () => {
            // CR 500.7 — an extra turn is inserted directly after the turn
            // that granted it; `turn` only advances by 1, but the SAME
            // player is active again and their `turnsTaken` legitimately
            // reaches 2. The old `(view.turn - seatIndex - 1) % seatCount`
            // reconstruction read global turn 2 as "p2's seat-parity turn"
            // and wrongly tapped p1's land here.
            const state = makeState({
                turn: 2,
                activePlayerId: "p1",
                players: [
                    makePlayer("p1", { turnsTaken: 2 }),
                    makePlayer("p2", { turnsTaken: 0 }),
                ],
            });
            const town = makeInstance(startingTown.id, { controllerId: "p1" });
            expect(shouldEnterTapped(state, town)).toBe(false);
        });

        it("p2 flashes it in during p1's turn: tapped (fail-closed, not p2's turn)", () => {
            const state = makeState({
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer("p1", { turnsTaken: 1 }),
                    makePlayer("p2", { turnsTaken: 0 }),
                ],
            });
            const town = makeInstance(startingTown.id, { controllerId: "p2" });
            expect(shouldEnterTapped(state, town)).toBe(true);
        });

        it("controller's own 4th turn: tapped", () => {
            const state = makeState({
                turn: 7,
                activePlayerId: "p1",
                players: [
                    makePlayer("p1", { turnsTaken: 4 }),
                    makePlayer("p2", { turnsTaken: 3 }),
                ],
            });
            const town = makeInstance(startingTown.id, { controllerId: "p1" });
            expect(shouldEnterTapped(state, town)).toBe(true);
        });
    });

    it("exposes exactly 6 tap options: {C} plus the 5 any-colour choices", () => {
        const town = makeInstance(startingTown.id, { controllerId: "p1" });
        expect(getManaTapOptions(town)).toEqual([
            { C: 1 },
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
        const detailed = getManaTapOptionsDetailed(town);
        expect(detailed[0].source).toMatchObject({
            kind: "activated",
            abilityId: "starting-town-colorless",
        });
        expect(detailed[1].source).toMatchObject({
            kind: "activated",
            abilityId: "starting-town-any-color",
        });
    });

    it("tapping for {C} (index 0) costs no life", () => {
        const town = makeInstance(startingTown.id, {
            id: "town-1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [town] }),
                makePlayer("p2"),
            ],
        });
        const player = state.players[0];
        tapSourceIntoPayment(state, player, town, 0, []);
        expect(player.manaPool.C).toBe(1);
        expect(player.life).toBe(20);
    });

    it("tapping for a colour (index 1 = {W}) costs 1 life — the OTHER ability's cost, not the free one's", () => {
        const town = makeInstance(startingTown.id, {
            id: "town-1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [town] }),
                makePlayer("p2"),
            ],
        });
        const player = state.players[0];
        tapSourceIntoPayment(state, player, town, 1, []);
        expect(player.manaPool.W).toBe(1);
        expect(player.life).toBe(19);
    });
});
