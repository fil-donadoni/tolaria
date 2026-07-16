// FIN (Final Fantasy) — multicolor card behavior tests (ADR 0043 colour
// split). Each card's describe block cites the CR section it exercises.
//
// Vivi Ornitier (issue #1179) exercises the NEW non-tap choice-based mana
// activation pathway end-to-end: GRE (`getEffectiveManaChoices` board-
// conditional on her effective power, issue #927), backend integration
// (`resolveNonTapManaChoice` / `assertActivationTimingLegal`, the real
// `convex/game.ts` primitives the `activateManaAbility` mutation calls — no
// convex-test harness in this repo, see `untapRefundsLife.test.ts` for the
// established pattern), and the wire format (counters/power survive
// `projectPublicState`, so the picker's option list matches client-side).

import { describe, it, expect } from "vitest";
import { viviOrnitier } from "../multicolor";
import { farrelitePriest } from "../../fem/white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getEffectiveManaChoices } from "../../../../gre/constants";
import { projectPublicState } from "../../../../gameProjections";
import {
    assertActivationTimingLegal,
    resolveNonTapManaChoice,
} from "../../../../game";
import type { CardInstanceState } from "../../../../gre/state";

const VIVI_ID = viviOrnitier.id;
const ABILITY_ID = "vivi-ornitier-mana";

function battlefieldsOf(
    ...players: { id: string; battlefield: readonly CardInstanceState[] }[]
) {
    return players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
}

describe("Vivi Ornitier (CR 605.1a / 605.3c / 602.5b — non-tap choice-based mana ability, issue #1179)", () => {
    it("declares a free, non-tap, non-stack, once-per-turn, controller-turn-only mana ability with no static manaChoices fallback", () => {
        const ability = viviOrnitier.activatedAbilities!.find(
            (a) => a.id === ABILITY_ID
        )!;
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toEqual({});
        expect(ability.controllerTurnOnly).toBe(true);
        expect(ability.oncePerTurn).toBe(true);
        expect(typeof ability.getManaChoices).toBe("function");
        // Deliberately no static `manaChoices` — see the card-file comment:
        // a truthy fallback would make `getActivatedManaAbility` (the
        // click-to-TAP recognizer) mistake this free ability for a tappable
        // mana source.
        expect(ability.manaChoices).toBeUndefined();
    });

    it("getManaChoices enumerates every {U}/{R} split summing to her CURRENT effective power (CR 613.4, issue #927)", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const choices = getEffectiveManaChoices(
            vivi,
            "p1",
            battlefieldsOf(...state.players)
        );

        expect(choices).not.toBeNull();
        // X = 2: (U0R2), (U1R1), (U2R0).
        expect(choices).toHaveLength(3);
        expect(choices).toEqual(
            expect.arrayContaining([{ R: 2 }, { U: 1, R: 1 }, { U: 2 }])
        );
    });

    it("at base power 0 (no counters yet), the only legal choice is 0 mana", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const choices = getEffectiveManaChoices(
            vivi,
            "p1",
            battlefieldsOf(...state.players)
        );
        expect(choices).toEqual([{}]);
    });

    it("resolveNonTapManaChoice adds the CHOSEN mana directly to the pool, bypassing any closure (CR 605.1a)", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 3 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const player = state.players[0];

        const choices = getEffectiveManaChoices(
            vivi,
            "p1",
            battlefieldsOf(...state.players)
        )!;
        const allURIndex = choices.findIndex((c) => (c.U ?? 0) === 3 && !c.R);
        expect(allURIndex).toBeGreaterThanOrEqual(0);

        const chosen = resolveNonTapManaChoice(
            state,
            player,
            vivi,
            ABILITY_ID,
            allURIndex
        );

        expect(chosen).toEqual({ U: 3 });
        expect(player.manaPool.U).toBe(3);
        expect(player.manaPool.R).toBe(0);
        // CR 602.5 — the activation count is bumped so a second activation
        // this turn is rejected by `assertActivationTimingLegal`.
        expect(vivi.activationsThisTurn?.[ABILITY_ID]).toBe(1);
    });

    it("returns null (no choice-based non-tap mana ability) for a fixed-output source like Farrelite Priest, so the caller falls back to its resolve()", () => {
        const priest = makeInstance(farrelitePriest.id, {
            id: "priest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", { battlefield: [priest] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const result = resolveNonTapManaChoice(
            state,
            state.players[0],
            priest,
            "farrelite-priest-mana",
            undefined
        );
        expect(result).toBeNull();
    });

    it("throws when a choice exists but no manaChoiceIndex was submitted", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        expect(() =>
            resolveNonTapManaChoice(
                state,
                state.players[0],
                vivi,
                ABILITY_ID,
                undefined
            )
        ).toThrow(/choose a mana color/i);
    });

    it("throws on an out-of-range manaChoiceIndex", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        expect(() =>
            resolveNonTapManaChoice(
                state,
                state.players[0],
                vivi,
                ABILITY_ID,
                99
            )
        ).toThrow(/invalid mana choice/i);
    });

    it("CR 602.5b — assertActivationTimingLegal rejects a second activation this turn (once-per-turn) and off-controller-turn activation", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
        });
        const ability = viviOrnitier.activatedAbilities!.find(
            (a) => a.id === ABILITY_ID
        )!;

        // Legal the first time.
        expect(() =>
            assertActivationTimingLegal(state, vivi, ability)
        ).not.toThrow();

        resolveNonTapManaChoice(state, state.players[0], vivi, ABILITY_ID, 0);

        // Once-per-turn — a second activation this turn is illegal.
        expect(() => assertActivationTimingLegal(state, vivi, ability)).toThrow(
            /once each turn/i
        );

        // Controller-turn-only — illegal on the opponent's turn even with a
        // fresh activation count.
        vivi.activationsThisTurn = {};
        state.activePlayerId = "p2";
        expect(() => assertActivationTimingLegal(state, vivi, ability)).toThrow(
            /your turn/i
        );
    });

    it("wire format: counters (and so the effective-power-driven choice list) survive projectPublicState (CR 613.4)", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const fatChoices = getEffectiveManaChoices(
            vivi,
            "p1",
            battlefieldsOf(...state.players)
        );

        const projected = projectPublicState(state, 1, "p1");
        const slimVivi = projected.players[0].battlefield.find(
            (c) => c.id === vivi.id
        )!;
        expect(slimVivi.counters).toEqual({ "+1/+1": 2 });

        const projectedBattlefields = projected.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield as unknown as CardInstanceState[],
        }));
        const slimChoices = getEffectiveManaChoices(
            slimVivi as unknown as CardInstanceState,
            "p1",
            projectedBattlefields
        );

        expect(slimChoices).toEqual(fatChoices);
    });
});
