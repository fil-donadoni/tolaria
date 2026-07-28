// Per-card behavior tests for blue cards in `convex/cards/sets/mom/blue.ts`
// (March of the Machine, split by colour per ADR 0043). Fixtures stay in
// `convex/cards/__tests__/setup.ts` — do not duplicate them here.

import { describe, it, expect } from "vitest";
import { faerieMastermind } from "../blue";
import { getCardByName } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    drawCard,
    emitCardDrawn,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";

// ---------------------------------------------------------------------------
// Faerie Mastermind — {1}{U} Creature — Faerie Rogue, 2/1. "Flash. Flying.
// Whenever an opponent draws their second card each turn, you draw a card.
// {3}{U}: Each player draws a card." (issue #781, PRD #620 Vintage Cube
// worklist.) The triggered ability is the FIRST catalogue card exercising
// `nthDrawThisTurn` (`cards/abilities/triggers/drawTrigger.ts`) — the
// draw-side twin of Ledger Shredder's `nthSpellThisTurn` (issue #1343). This
// describe block proves the ordinal-stamping + trigger-condition wiring end
// to end through the REAL choke point (`drawCard` + `emitCardDrawn`), not a
// hand-built `drawIndexThisTurn` literal.
// ---------------------------------------------------------------------------
describe("Faerie Mastermind (CR 121.1 Nth-draw trigger, issue #781)", () => {
    function makeMastermind(controllerId: string): CardInstanceState {
        return makeInstance(faerieMastermind.id, {
            id: "mastermind",
            controllerId,
            ownerId: controllerId,
        });
    }

    function libraryCards(n: number, ownerId: string, prefix: string) {
        return Array.from({ length: n }, (_, i) =>
            makeInstance(getCardByName("Squire").id, {
                id: `${prefix}-${i}`,
                controllerId: ownerId,
                ownerId,
                zone: "library",
            })
        );
    }

    /** Simulates a real draw (library -> hand) through the engine's real
     *  CARD_DRAWN choke point (`drawCard` + `emitCardDrawn`), exactly like the
     *  turn-based draw step / effect-driven draws do — so
     *  `drawIndexThisTurn` is stamped for real, never hand-built. */
    function simulateDraw(state: GameState, drawingPlayerId: string) {
        const player = state.players.find((p) => p.id === drawingPlayerId)!;
        if (drawCard(player) !== null) {
            emitCardDrawn(state, drawingPlayerId, 1);
        }
        processPendingActionTriggers(state);
    }

    it("pins the card shape: flash, flying, the draw trigger, and the each-player-draws activated ability", () => {
        expect(faerieMastermind.staticAbilities).toEqual(["flash", "flying"]);
        expect(faerieMastermind.manaCost).toEqual({ X: 1, U: 1 });
        expect(faerieMastermind.power).toBe(2);
        expect(faerieMastermind.toughness).toBe(1);
        expect(
            faerieMastermind.triggeredAbilities?.some(
                (t) => t.id === "faerie-mastermind-opponent-second-draw"
            )
        ).toBe(true);
        const ability = faerieMastermind.activatedAbilities?.find(
            (a) => a.id === "faerie-mastermind-each-draws"
        );
        expect(ability?.cost.mana).toEqual({ X: 3, U: 1 });
        expect(ability?.useStack).toBe(true);
    });

    it("fires exactly on an opponent's SECOND draw this turn, not their first or third (CR 121.1)", () => {
        const mastermind = makeMastermind("p1");
        const p1 = makePlayer("p1", {
            battlefield: [mastermind],
            library: libraryCards(1, "p1", "p1supply"),
        });
        const p2 = makePlayer("p2", { library: libraryCards(3, "p2", "lib") });
        const state = makeState({ players: [p1, p2] });

        simulateDraw(state, "p2"); // opponent's 1st draw this turn
        expect(state.stack).toHaveLength(0);

        simulateDraw(state, "p2"); // opponent's 2nd draw this turn -> fires
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId ===
                    "faerie-mastermind-opponent-second-draw"
            )
        ).toBe(true);
        resolveTopOfStack(state);
        expect(p1.hand).toHaveLength(1); // Faerie Mastermind's controller drew
        expect(state.stack).toHaveLength(0);

        simulateDraw(state, "p2"); // opponent's 3rd draw this turn -> does NOT fire again
        expect(state.stack).toHaveLength(0);
        expect(p1.hand).toHaveLength(1); // unchanged

        // Wire format — the controller's hand size is client-visible.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p1")!.hand).toHaveLength(
            1
        );
    });

    it("does NOT fire on the controller's own second draw (CR 121.1 — 'an opponent draws')", () => {
        const mastermind = makeMastermind("p1");
        const p1 = makePlayer("p1", {
            battlefield: [mastermind],
            library: libraryCards(2, "p1", "own"),
        });
        const p2 = makePlayer("p2");
        const state = makeState({ players: [p1, p2] });

        simulateDraw(state, "p1");
        simulateDraw(state, "p1");
        expect(state.stack).toHaveLength(0);
    });

    it("{3}{U}: each player draws a card", () => {
        const mastermind = makeMastermind("p1");
        const p1 = makePlayer("p1", {
            battlefield: [mastermind],
            library: libraryCards(1, "p1", "p1lib"),
        });
        const p2 = makePlayer("p2", {
            library: libraryCards(1, "p2", "p2lib"),
        });
        const state = makeState({ players: [p1, p2] });

        const item: StackItem = {
            ...mastermind,
            zone: "stack",
            castById: "p1",
            abilityId: "faerie-mastermind-each-draws",
            targets: [],
        };
        state.stack.push(item);
        resolveTopOfStack(state);

        expect(p1.hand).toHaveLength(1);
        expect(p2.hand).toHaveLength(1);

        // Wire format — both players' hand sizes are client-visible (counts
        // at minimum — the opponent's hand contents are slimmed to `null[]`).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p1")!.hand).toHaveLength(
            1
        );
        expect(projected.players.find((p) => p.id === "p2")!.hand).toHaveLength(
            1
        );
    });
});
