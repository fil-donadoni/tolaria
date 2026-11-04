// The token a copied permanent spell becomes renders the original card's art
// (issue #3658, CR 707.10f), through the real resolution, the board projection
// and the client's resolver chain, never a token-art placeholder.
import { describe, expect, it } from "vitest";
import { preloadDefinitions } from "@convex/cards";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { sageOfTheSkies } from "@convex/cards/sets/tdm/white.cards";
import { projectPublicState } from "@convex/gameProjections";
import { emitSpellCastEvent, resolveTopOfStack } from "@convex/gre/state";
import { EMPTY_TOKEN_PRINT_INDEX, resolveArtPrintId } from "../tokenArt";

// Base-owned `data/catalogue` (ADR 0157) lacks a card this PR ships.
preloadDefinitions([sageOfTheSkies()]);

describe("a copied permanent spell's token art", () => {
    it("is the original card's printing", () => {
        const sageId = sageOfTheSkies().id;
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.players[0].spellsCastThisTurn = 1;
        emitSpellCastEvent(state, pushSpell(state, sageId, "p1"));
        resolveTopOfStack(state);
        resolveTopOfStack(state);

        const view = projectPublicState(state, 1, "p1");
        const token = view.players[0].battlefield.find((c) => c.isToken)!;
        const defId = (token.card as { id: string }).id;

        expect(defId).toBe(sageId);
        expect(resolveArtPrintId(defId, token, EMPTY_TOKEN_PRINT_INDEX)).toBe(
            sageId
        );
    });
});
