// The opening hand is not "drawn this turn" (CR 103.5, issue #1714).
//
// Opening hands are dealt through `drawCard`, which appends to the per-turn
// draw tally (`drawnThisTurn`, CR 121.1) that every per-turn draw ordinal is
// read from. The mulligan exits to UPKEEP of turn 1 through `advancePhase`,
// never `advanceTurn`, so without a reset at that seam turn 1's first real
// draw was stamped index 7. These tests run the REAL game start
// (`createInitialGameState` → declarations → `finalizeMulligan`) and the real
// draw seams (`drawCard` + `emitCardDrawn`, `buildDrawEvent`), never a
// hand-built tally. The loaded-scenario path is `scenarioBuilder.test.ts`'s
// (issue #3240).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { nthDrawThisTurn } from "../../cards/abilities/triggers/drawTrigger";
import { leovoldEmissaryOfTrest } from "../../cards/sets/cn2/multicolor";
import type { CardDrawnEvent } from "../../cards/types";
import { applyMulliganBottomChoice, recordDeclaration } from "../mulligan";
import { createInitialGameState, type PlayerInput } from "../setup";
import {
    buildDrawEvent,
    drawCard,
    emitCardDrawn,
    getPlayer,
    type GameState,
} from "../state";

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

function freshGame(): GameState {
    return createInitialGameState([player("p1"), player("p2")], 0x1714);
}

/** One real single draw: the tally append, then the CARD_DRAWN emit. */
function drawOne(state: GameState, playerId: string): CardDrawnEvent {
    drawCard(getPlayer(state, playerId));
    emitCardDrawn(state, playerId, 1, false);
    const events = state.pendingEvents ?? [];
    return events[events.length - 1] as CardDrawnEvent;
}

describe("opening hand vs the per-turn draw tally (CR 103.5 / CR 121.1, issue #1714)", () => {
    it("both keep: turn 1 starts with an empty tally and the first real draw is index 0", () => {
        const state = freshGame();
        recordDeclaration(state, "p1", "keep");
        recordDeclaration(state, "p2", "keep");
        expect(state.phase).toBe("UPKEEP");
        expect(state.turn).toBe(1);

        for (const p of state.players) {
            expect(p.hand).toHaveLength(7);
            expect(p.drawnThisTurn).toBeUndefined();
            expect(p.lastDrawnCardId).toBeUndefined();
        }

        const first = drawOne(state, "p1");
        const second = drawOne(state, "p1");
        expect(first.drawIndexThisTurn).toBe(0);
        expect(second.drawIndexThisTurn).toBe(1);
        expect(getPlayer(state, "p1").drawnThisTurn).toHaveLength(2);
    });

    it("nthDrawThisTurn(2) matches the 2nd real draw of turn 1, not the 1st", () => {
        const state = freshGame();
        recordDeclaration(state, "p1", "keep");
        recordDeclaration(state, "p2", "keep");

        const second = nthDrawThisTurn(2);
        const firstEvent = drawOne(state, "p1");
        const secondEvent = drawOne(state, "p1");
        const self = {} as Parameters<typeof second>[1];
        expect(second(firstEvent, self)).toBe(false);
        expect(second(secondEvent, self)).toBe(true);
    });

    it("a Leovold-style 'more than one card each turn' replacement lets the opponent's first turn-1 draw through", () => {
        const state = freshGame();
        recordDeclaration(state, "p1", "keep");
        recordDeclaration(state, "p2", "keep");

        const applies = leovoldEmissaryOfTrest.drawReplacement!.applies;
        const leovold = { controllerId: "p1" } as Parameters<typeof applies>[1];
        // Leovold's predicate reads only the event and its source.
        const view = {} as Parameters<typeof applies>[2];

        const firstDraw = buildDrawEvent(state, "p2", 1, false);
        expect(firstDraw.drawIndexThisTurn).toBe(0);
        expect(applies(firstDraw, leovold, view)).toBe(false);

        drawCard(getPlayer(state, "p2"));
        const secondDraw = buildDrawEvent(state, "p2", 1, false);
        expect(secondDraw.drawIndexThisTurn).toBe(1);
        expect(applies(secondDraw, leovold, view)).toBe(true);
    });

    it("after a mulligan the tally names neither the shuffled-away hand nor the redraw", () => {
        const state = freshGame();
        recordDeclaration(state, "p1", "keep");
        recordDeclaration(state, "p2", "mull");
        recordDeclaration(state, "p2", "keep");
        const p2 = getPlayer(state, "p2");
        applyMulliganBottomChoice(state, [p2.hand[0].id]);

        expect(state.mulligan).toBeUndefined();
        expect(state.phase).toBe("UPKEEP");
        expect(p2.hand).toHaveLength(6);
        expect(p2.drawnThisTurn).toBeUndefined();
        expect(p2.lastDrawnCardId).toBeUndefined();

        const first = drawOne(state, "p2");
        expect(first.drawIndexThisTurn).toBe(0);
        expect(p2.drawnThisTurn).toEqual([p2.lastDrawnCardId]);
    });
});
