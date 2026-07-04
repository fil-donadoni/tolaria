// ema (Eternal Masters) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { manaCrypt } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyRandomRevealAck } from "../../../../gre/pendingChoiceSubmit";

/** Push a triggered ability onto the stack and resolve it (mirrors the
 *  fem/__tests__/helpers.ts `resolveTrigger` shape). */
function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: source.controllerId,
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Acknowledges a suspended `coinFlip` random-reveal choice to completion. */
function ackCoinFlip(state: GameState): void {
    const head = state.pendingChoices?.[0];
    if (!head || head.kind !== "random-reveal") return;
    applyRandomRevealAck(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        choiceId: head.choiceId,
    });
}

describe("Mana Crypt (upkeep coin flip, CR 603.6a / 705.2)", () => {
    it("is a {0} Artifact with a fixed {C}{C} mana ability", () => {
        expect(manaCrypt.types).toEqual(["Artifact"]);
        expect(manaCrypt.manaCost).toEqual({});
        const mana = manaCrypt.activatedAbilities![0];
        expect(mana.useStack).toBe(false);
        expect(mana.manaProduced).toEqual({ C: 2 });
    });

    it("the upkeep trigger fires exactly one coin flip, either dealing 3 damage or nothing", () => {
        const crypt = makeInstance(manaCrypt.id, {
            id: "crypt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            rngSeed: 1,
            players: [
                makePlayer("p1", { life: 20, battlefield: [crypt] }),
                makePlayer("p2"),
            ],
        });

        resolveTrigger(state, crypt, "mana-crypt-upkeep-flip");
        // The reveal suspends resolution on a random-reveal pending choice
        // BEFORE applying either branch's consequence.
        expect(state.players[0].life).toBe(20);
        ackCoinFlip(state);

        // Whichever face the seeded flip landed on, life is either untouched
        // (win) or down exactly 3 (loss) — never anything else.
        const win = state.players[0].life === 20;
        const loss = state.players[0].life === 17;
        expect(win || loss).toBe(true);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});
