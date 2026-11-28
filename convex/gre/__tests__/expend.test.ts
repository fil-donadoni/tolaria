// Expend (CR 700.14): "A player expends N if they pay a cost to cast a spell
// and the amount of mana that player spent this turn to cast spells prior to
// paying that cost was less than N and became at least N after paying that
// cost."
//
// Driven through the REAL cast commit (`tryAutoCommitPendingCast`, the path
// every `game.ts` cast takes), the real trigger scan and the real stack: the
// tally lives on `PlayerState.manaSpentOnSpellsThisTurn`, the payment emits
// `MANA_EXPENDED`, and a compiled "whenever you expend N" head (the descriptor
// the Oracle compiler emits) rebuilds into the ability that reads it.

import { describe, expect, it } from "vitest";
import { tryAutoCommitPendingCast } from "../../game";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { advancePhase } from "../phases";
import { compactState, expandState } from "../serialize";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
} from "../state";

/** "Whenever you expend 4, you gain 3 life." — the compiled head. */
const WATCHER_ID = "test-10354-expend-watcher";
registerTokenDefinition({
    id: WATCHER_ID,
    name: "Test Expend Watcher",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Raccoon"],
    power: 1,
    toughness: 1,
    compiledTriggeredAbilities: [
        {
            id: "test-10354-expend-watcher-trigger",
            oracleText: "Whenever you expend 4, you gain 3 life.",
            head: { kind: "expend", scope: "you", amount: 4 },
            effects: [{ op: "gainLife", player: "controller", amount: 3 }],
        },
    ],
} satisfies CardDefinition);

/** An instant with no body: the thing that is CAST (an instant, so a second
 *  cast can follow while the first is still on the stack). */
const SPELL_ID = "test-10354-expend-spell";
registerTokenDefinition({
    id: SPELL_ID,
    name: "Test Expend Spell",
    rarity: "common",
    manaCost: { X: 2, R: 1 },
    types: ["Instant"],
    effects: [],
} satisfies CardDefinition);

function board(): GameState {
    const watcher = makeInstance(WATCHER_ID, {
        id: "watcher",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [watcher] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    state.turn = 3;
    return state;
}

/** Cast one copy of the probe sorcery for `manaCost`, paid from the pool. */
function cast(
    state: GameState,
    id: string,
    manaCost: Record<string, number>,
    playerId = "p1"
): void {
    const player = state.players.find((p) => p.id === playerId)!;
    player.hand.push(
        makeInstance(SPELL_ID, {
            id,
            controllerId: playerId,
            ownerId: playerId,
            zone: "hand",
        })
    );
    player.manaPool.R = (player.manaPool.R ?? 0) + 10;
    // CR 117.3c — the caster holds priority to cast again.
    state.priorityPlayerId = playerId;
    state.pendingCast = {
        playerId,
        cardInstanceId: id,
        manaCost,
        tappedLandIds: [],
    };
    const committed = tryAutoCommitPendingCast(state, playerId);
    expect(committed).not.toBeNull();
    // CR 603.3 — the trigger scan `game.ts` runs after the commit.
    processPendingActionTriggers(state);
}

/** CR 500.1 — from the end step into the next turn's upkeep, the real way. */
function nextTurn(state: GameState): void {
    state.stack = [];
    state.phase = "END_STEP";
    advancePhase(state);
    expect(state.turn).toBe(4);
}

function expendTriggersOnStack(state: GameState): number {
    return state.stack.filter(
        (s) => s.triggeredAbilityId === "test-10354-expend-watcher-trigger"
    ).length;
}

describe("Expend — the per-turn mana tally (CR 700.14)", () => {
    it("advances by the mana each cast paid", () => {
        const state = board();
        cast(state, "s1", { X: 2, R: 1 });
        expect(state.players[0].manaSpentOnSpellsThisTurn).toBe(3);
        cast(state, "s2", { X: 1, R: 1 });
        expect(state.players[0].manaSpentOnSpellsThisTurn).toBe(5);
        // The opponent's tally is their own.
        expect(state.players[1].manaSpentOnSpellsThisTurn ?? 0).toBe(0);
    });

    it("a cast that spent no mana neither advances it nor emits the event", () => {
        const state = board();
        cast(state, "s1", {});
        expect(state.players[0].manaSpentOnSpellsThisTurn ?? 0).toBe(0);
        expect(expendTriggersOnStack(state)).toBe(0);
    });

    it("resets at the start of the next turn", () => {
        const state = board();
        cast(state, "s1", { X: 2, R: 1 });
        nextTurn(state);
        expect(state.players[0].manaSpentOnSpellsThisTurn).toBe(0);
    });

    it("survives a save inside the turn (serialize round trip)", () => {
        const state = board();
        cast(state, "s1", { X: 2, R: 1 });
        const back = expandState(compactState(state));
        expect(back.players[0].manaSpentOnSpellsThisTurn).toBe(3);
    });
});

describe("Expend — 'whenever you expend N' (CR 700.14)", () => {
    it("does not trigger while the tally stays below N", () => {
        const state = board();
        cast(state, "s1", { X: 2, R: 1 });
        expect(expendTriggersOnStack(state)).toBe(0);
    });

    it("triggers on the cost that takes the tally from below N to at least N", () => {
        const state = board();
        cast(state, "s1", { X: 2, R: 1 });
        cast(state, "s2", { X: 2, R: 1 });
        expect(expendTriggersOnStack(state)).toBe(1);
        // The trigger is above the spell that paid for it, and resolves.
        const lifeBefore = state.players[0].life;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(lifeBefore + 3);
    });

    it("a single cost that jumps past N still crosses it once", () => {
        const state = board();
        cast(state, "s1", { X: 5, R: 1 });
        expect(expendTriggersOnStack(state)).toBe(1);
    });

    it("never triggers a second time in the same turn once N is passed", () => {
        const state = board();
        cast(state, "s1", { X: 3, R: 1 });
        expect(expendTriggersOnStack(state)).toBe(1);
        cast(state, "s2", { X: 3, R: 1 });
        expect(expendTriggersOnStack(state)).toBe(1);
    });

    it("an opponent's casts never expend for you", () => {
        const state = board();
        cast(state, "s1", { X: 5, R: 1 }, "p2");
        expect(state.players[1].manaSpentOnSpellsThisTurn).toBe(6);
        expect(expendTriggersOnStack(state)).toBe(0);
    });

    it("triggers again on a later turn, from a fresh tally", () => {
        const state = board();
        cast(state, "s1", { X: 3, R: 1 });
        nextTurn(state);
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "PRECOMBAT_MAIN";
        cast(state, "s2", { X: 3, R: 1 });
        expect(expendTriggersOnStack(state)).toBe(1);
    });
});
