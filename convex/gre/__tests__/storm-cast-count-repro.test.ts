// REPRO: does the REAL cast-commit path (finalizeTargetSelection kind="cast",
// the branch selectTarget invokes) increment spellsCastThisTurn exactly once
// for a targeted spell? A 2x here would explain storm making double copies.
import { describe, it, expect } from "vitest";
import { makeState, makePlayer, makeInstance } from "../../cards/__tests__/setup";
import { finalizeTargetSelection } from "../../game";
import { lightningBolt } from "../../cards/sets/lea";
import type { GameState, PendingTarget } from "../state";

describe("Cast-commit count (real finalizeTargetSelection path)", () => {
    it("a targeted spell increments spellsCastThisTurn by exactly 1", () => {
        const boltInHand = makeInstance(lightningBolt.id, {
            id: "bolt-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [boltInHand],
                    manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        // Mimic announceCast having entered target selection for the cast.
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "bolt-1",
            targetType: "player",
            count: 1,
            selected: [{ type: "player", id: "p2" }],
        };
        state.pendingTarget = pt;

        finalizeTargetSelection(state, pt, "p1");

        expect(state.spellsCastThisTurn).toBe(1);
        // The spell reached the stack once.
        expect(state.stack.filter((s) => !s.isCopy).length).toBe(1);
    });
});
