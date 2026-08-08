// BIG — black card behavior tests (ADR 0043 colour split).
//
// Harvester of Misery is the first shipped card that is BOTH a TARGETED
// activated ability AND `activateFromHand` (its "{1}{B}, Discard this card:
// Target creature gets -2/-2" ability). That combination detours through the
// pendingTarget → `finalizeTargetSelection` path, which — before issue-fix —
// only ever looked for the ability's source on the battlefield and never paid
// a `discardThis` cost. Activating the ability therefore threw
// "Ability source not on battlefield". These tests lock the from-hand targeted
// activation end to end (both the immediate and the deferred commit paths).
import { describe, it, expect } from "vitest";
import { harvesterOfMisery } from "../black";
import { getCardByName } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { type GameState, resolveTopOfStack } from "../../../../gre/state";
import type { TargetSelection } from "../../../types";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { finalizeTargetSelection } from "../../../../game";

const DISCARD_ABILITY_ID = "harvester-of-misery-discard";

/** Build the `kind:"ability"` PendingTarget exactly as `activateAbility` does
 *  for a targeted ability, with the Craw Wurm already chosen, then drive the
 *  real `finalizeTargetSelection` commit path. */
function activateDiscardAbilityTargeting(
    state: GameState,
    harvesterId: string,
    targetId: string
): void {
    state.pendingTarget = {
        playerId: "p1",
        cardInstanceId: harvesterId,
        targetType: "Creature",
        count: 1,
        selected: [{ type: "permanent", id: targetId }] as TargetSelection[],
        kind: "ability",
        abilityId: DISCARD_ABILITY_ID,
    };
    finalizeTargetSelection(state, state.pendingTarget, "p1");
}

describe("Harvester of Misery — targeted from-hand discard ability (CR 113.6 / 702.29a / 602.2b)", () => {
    it("immediate commit (mana in pool): locates the source in HAND, discards it, and the target gets -2/-2", () => {
        const harvester = makeInstance(harvesterOfMisery.id, {
            id: "harvester",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        // Craw Wurm 6/4 — survives the -2/-2 (→ 4/2), so the pump is observable
        // without an SBA death muddying the assertion.
        const target = makeInstance(getCardByName("Craw Wurm").id, {
            id: "wurm",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [harvester],
                    manaPool: { W: 0, U: 0, B: 2, R: 0, G: 0, C: 0 }, // covers {1}{B}
                }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });

        // The regression: this used to throw "Ability source not on battlefield".
        expect(() =>
            activateDiscardAbilityTargeting(state, "harvester", "wurm")
        ).not.toThrow();

        // CR 702.29a — the discard-this cost moved the source hand → graveyard.
        expect(state.players[0].hand).toHaveLength(0);
        expect(
            state.players[0].graveyard.some((c) => c.id === "harvester")
        ).toBe(true);

        // The ability (not the card) is on the stack, carrying the chosen target.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0]?.abilityId).toBe(DISCARD_ABILITY_ID);
        expect(state.stack[0]?.targets).toEqual([
            { type: "permanent", id: "wurm" },
        ]);
        // Mana was paid.
        expect(state.players[0].manaPool.B).toBe(0);

        // Resolve → Craw Wurm gets -2/-2 (6/4 → 4/2).
        resolveTopOfStack(state);
        const wurm = state.players[1].battlefield.find((c) => c.id === "wurm")!;
        expect(getEffectivePower(state, wurm)).toBe(4);
        expect(getEffectiveToughness(state, wurm)).toBe(2);
    });

    it("deferred commit (mana NOT in pool): parks a pendingActivation flagged fromHand + discardThisSource so the source is re-located in hand and discarded at payment", () => {
        const harvester = makeInstance(harvesterOfMisery.id, {
            id: "harvester",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const target = makeInstance(getCardByName("Craw Wurm").id, {
            id: "wurm",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [harvester] }), // empty pool → mana uncovered
                makePlayer("p2", { battlefield: [target] }),
            ],
        });

        activateDiscardAbilityTargeting(state, "harvester", "wurm");

        // Mana uncovered → deferred payment. The source is still in hand (the
        // discard happens at commit, not now) and the parked activation carries
        // the flags the deferred commit needs to find + discard it.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(1);
        const pa = state.pendingActivation;
        expect(pa?.cardInstanceId).toBe("harvester");
        expect(pa?.fromHand).toBe(true);
        expect(pa?.discardThisSource).toBe(true);
        expect(pa?.targets).toEqual([{ type: "permanent", id: "wurm" }]);
    });
});
