// The bot's move enumerator scanned, for activated abilities, exactly three
// places — the acting player's battlefield, the acting player's own graveyard
// (CR 113.6 / 602.5b, issue #2339), and the opponent's battlefield filtered to
// "any player may activate" (CR 113.3c). Each reads `getEffectiveActivatedAbilities`
// off a CARD INSTANCE. A PLAYER-level grant (CR 113.1b — Channel's "Pay 1 life:
// Add {C}." until end of turn) hangs off `PlayerState.grantedAbilities` and has
// no instance, so it was invisible to search (issue #2903).
//
// This file guards the two new seams:
//   1. `enumerateGrantedAbilityMoves` (moves.ts) emits the `activate-granted-ability`
//      move when the acting player holds an affordable grant, and not when
//      `life < cost.life` (CR 119.4) or the grant has been purged (cleanup).
//   2. `applyMoveInSearch` (search.ts) debits the life and credits the mana
//      pool, mirroring the `activatePlayerAbility` mutation, so the produced
//      mana is visible to the cast planner on the next ply.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { enumerateMoves } from "../moves";
import { applyMoveInSearch } from "../search";
import { resolveTopOfStack } from "../state";
import { makeState, pushSpell } from "../../cards/__tests__/setup";
import type { GameState } from "../state";
import type { Move } from "../moves";

const CHANNEL = getCardByName("Channel");

function grantState(life = 20): GameState {
    const state = makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    pushSpell(state, CHANNEL.id, "p1");
    resolveTopOfStack(state);
    // `resolveTopOfStack` hands priority to the active player's window; pin it
    // back to p1 so `enumerateMoves` sees a decision owed.
    state.priorityPlayerId = "p1";
    state.players[0].life = life;
    return state;
}

function grantMove(state: GameState): Move | undefined {
    return enumerateMoves(state, "p1").find(
        (m) => m.kind === "activate-granted-ability"
    );
}

describe("enumerateMoves — player-level granted abilities (CR 113.1b / 119.4, issue #2903)", () => {
    it("emits the activation move when the player holds an affordable grant", () => {
        const state = grantState(20);
        const move = grantMove(state);
        expect(move).toBeDefined();
        expect(move).toMatchObject({
            kind: "activate-granted-ability",
            abilityId: "channel-mana",
            sourceCardId: CHANNEL.id,
        });
        expect(
            (move as { grantedAbilityInstanceId: string })
                .grantedAbilityInstanceId
        ).toMatch(/^grant-\d+$/);
    });

    it("does NOT emit when life < cost.life (CR 119.4)", () => {
        // Channel's cost is {life: 1}; at 0 life the grant is held but
        // unpayable, so no move may be offered (the server throws "Not enough
        // life" on the same comparison).
        const state = grantState(0);
        expect(grantMove(state)).toBeUndefined();
    });

    it("does NOT emit once the grant has been purged (grantedAbilities empty)", () => {
        // CLEANUP clears an end-of-turn grant; `grantedAbilities` becomes
        // undefined and the enumerator must offer nothing stale.
        const state = grantState(20);
        state.players[0].grantedAbilities = undefined;
        expect(grantMove(state)).toBeUndefined();
    });
});

describe("applyMoveInSearch — player-level granted ability (issue #2903)", () => {
    it("debits life and credits the mana pool, matching the server mutation", () => {
        const state = grantState(20);
        const move = grantMove(state)!;
        applyMoveInSearch(state, "p1", move);
        expect(state.players[0].life).toBe(19);
        expect(state.players[0].manaPool.C).toBe(1);
    });
});
