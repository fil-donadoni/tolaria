/**
 * Full-path integration: a loyalty ability, GRE → the public mutation's core →
 * the resulting choice chain (issue #2491, CR 606).
 *
 * The bot now enumerates loyalty abilities, and its executor replays the chosen
 * Move as the same mutation sequence a human's clicks make:
 * `activateAbility → selectTargets → …`. Two pieces passing individually and
 * failing together is a shipped bug, so this walks Liliana of the Veil's `-2`
 * end to end — activation, CR 606.4 payment, target commit, resolution, and the
 * opponent's sacrifice choice — through the SAME functions the mutations call.
 *
 * (`convex/game.ts`'s mutations are pure I/O wrappers over these; the project
 * has no Convex mutation harness — see `activateAbilityOnState.test.ts` for the
 * same convention.)
 */

import { describe, expect, it } from "vitest";
import {
    activateAbilityOnState,
    applyOneTargetSelection,
    assertLoyaltyActivationLegal,
} from "../game";
import { buildStateFromScenario } from "../gre/scenarioBuilder";
import { createInitialGameState, type PlayerInput } from "../gre/setup";
import { resolveTopOfStack } from "../gre/state";
import { applyPendingChoiceSubmit } from "../gre/pendingChoiceSubmit";
import { getCardByName } from "../cards";
import type { CardInstanceState, GameState } from "../gre/state";
import type { ScenarioSpec } from "../debugScenarioSpec";

const LILIANA = "Liliana of the Veil";
const MINUS_TWO = "liliana-veil-minus2";

function player(id: string): PlayerInput {
    const filler = getCardByName("Forest");
    return {
        id,
        name: id,
        bgColor: "#000000",
        deck: {
            id: `deck-${id}`,
            name: "test",
            format: "freeform",
            cards: Array.from({ length: 60 }, () => ({
                cardId: filler.id,
                cardName: filler.name,
            })),
        },
    };
}

const SPEC: ScenarioSpec = {
    cards: [
        { name: LILIANA, owner: "me", zone: "battlefield" },
        {
            name: "Grizzly Bears",
            owner: "opp",
            zone: "battlefield",
            summoningSick: false,
        },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    landCount: 3,
    libraryCount: 20,
};

function build(): GameState {
    return buildStateFromScenario(
        createInitialGameState([player("p1"), player("p2")], 0x2491),
        SPEC
    );
}

function walker(state: GameState): CardInstanceState {
    const def = getCardByName(LILIANA);
    return state.players[0].battlefield.find(
        (c) => (c.card as { id?: string }).id === def.id
    )!;
}

describe("Liliana of the Veil's -2, end to end (CR 606)", () => {
    it("activates, pays the loyalty, targets, resolves and the opponent sacrifices", () => {
        const state = build();
        const [me, opp] = state.players;
        const liliana = walker(state);
        // CR 306.5b — the walker entered on its printed starting loyalty.
        expect(liliana.counters?.loyalty).toBe(3);

        // 1. `activateAbility` — a TARGETED ability opens `pendingTarget`
        //    (CR 602.2b), costs deferred to the commit.
        activateAbilityOnState(state, {
            playerId: me.id,
            cardInstanceId: liliana.id,
            abilityId: MINUS_TWO,
        });
        expect(state.pendingTarget?.cardInstanceId).toBe(liliana.id);
        expect(state.stack).toHaveLength(0);
        expect(walker(state).counters?.loyalty).toBe(3);

        // 2. `selectTargets` — the target commit finalizes the activation.
        applyOneTargetSelection(state, me.id, {
            targetType: "player",
            targetId: opp.id,
        });

        // CR 606.4 — the loyalty leg is paid as the ability goes on the stack…
        expect(walker(state).counters?.loyalty).toBe(1);
        // …and CR 606.3's per-permanent lock is set, so the SAME walker cannot
        // fire again this turn — asserted through the server's own gate.
        expect(walker(state).loyaltyActivatedThisTurn).toBe(true);
        expect(() =>
            assertLoyaltyActivationLegal(
                state,
                walker(state),
                getCardByName(LILIANA).activatedAbilities!.find(
                    (a) => a.id === "liliana-veil-plus1"
                )!
            )
        ).toThrow(/already been activated this turn/);

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe(MINUS_TWO);

        // 3. Resolution opens the TARGET PLAYER's sacrifice choice (CR 701.21).
        resolveTopOfStack(state);
        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("sacrifice-permanents");
        expect(choice?.playerId).toBe(opp.id);

        // 4. The opponent submits it, and the creature is really gone.
        const bears = state.players[1].battlefield.find(
            (c) =>
                (c.card as { id?: string }).id ===
                getCardByName("Grizzly Bears").id
        )!;
        applyPendingChoiceSubmit(state, {
            playerId: opp.id,
            stackItemId: choice!.stackItemId,
            step: choice!.step,
            choiceId: choice!.choiceId,
            cardInstanceIds: [bears.id],
        });

        expect(
            state.players[1].battlefield.some((c) => c.id === bears.id)
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === bears.id)).toBe(
            true
        );
    });

    it("the mutation rejects a `-6` the walker cannot pay (CR 606.6)", () => {
        const state = build();
        const liliana = walker(state);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: state.players[0].id,
                cardInstanceId: liliana.id,
                abilityId: "liliana-veil-minus6",
            })
        ).toThrow(/Not enough loyalty/);
        expect(state.stack).toHaveLength(0);
        expect(walker(state).counters?.loyalty).toBe(3);
    });
});
