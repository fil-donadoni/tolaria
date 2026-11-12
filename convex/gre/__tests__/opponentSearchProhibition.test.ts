// CR 701.23a / CR 101.2 — Ashiok, Dream Render: "Spells and abilities your
// opponents control can't cause their controller to search their library."
// A `player-guard`'s `opponentsCantSearch` clause, consulted by the
// `search-library` `requestChoice` funnel (`isOpponentSearchProhibited`,
// `gre/permanentGuard.ts`). The guard's controller's own searches are
// unaffected. The −1 (mill four, then exile each opponent's graveyard) is
// covered through the same real card.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../state";
import { isOpponentSearchProhibited } from "../permanentGuard";
import { getDefinition, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { ashiokDreamRender } from "../../cards/sets/war/multicolor.cards";
import { projectPublicState } from "../../gameProjections";

const bears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const ashiok = ashiokDreamRender();

const TUTOR: CardDefinition = {
    id: "test-8596-tutor",
    name: "Test Tutor",
    rarity: "common",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    oracleText: "Search your library for a card, put it into your hand.",
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: 1,
            prompt: "Search your library for a card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "hand",
        },
    ],
};

function library(owner: string, ids: string[]) {
    return ids.map((id) =>
        makeInstance(bears.id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );
}

function graveyard(owner: string, ids: string[]) {
    return ids.map((id) =>
        makeInstance(bears.id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "graveyard",
        })
    );
}

/** p1 controls Ashiok (when `withAshiok`); p2 is the opponent. */
function board(withAshiok = true): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                library: library("p1", ["p1-l1", "p1-l2", "p1-l3", "p1-l4"]),
                graveyard: graveyard("p1", ["p1-g1"]),
                battlefield: withAshiok
                    ? [
                          makeInstance(ashiok.id, {
                              id: "ashiok",
                              controllerId: "p1",
                              counters: { loyalty: 5 },
                          }),
                      ]
                    : [],
            }),
            makePlayer("p2", {
                library: library("p2", ["p2-l1", "p2-l2", "p2-l3", "p2-l4"]),
                graveyard: graveyard("p2", ["p2-g1", "p2-g2"]),
            }),
        ],
    });
}

describe("CR 701.23a / 101.2 — opponents can't cause their controller to search", () => {
    it("an opponent's tutor finds nothing: no prompt opens", () =>
        withTemporaryDefinition(TUTOR, () => {
            const state = board();
            pushSpell(state, TUTOR.id, "p2");
            resolveTopOfStack(state);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(state.players[1].hand).toHaveLength(0);
            expect(state.players[1].library).toHaveLength(4);
        }));

    it("without Ashiok the same tutor prompts (the gate is the guard)", () =>
        withTemporaryDefinition(TUTOR, () => {
            const state = board(false);
            pushSpell(state, TUTOR.id, "p2");
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.kind).toBe("search-library");
        }));

    it("Ashiok's controller still searches with their own spells", () =>
        withTemporaryDefinition(TUTOR, () => {
            const state = board();
            pushSpell(state, TUTOR.id, "p1");
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.kind).toBe("search-library");
            expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        }));

    it("survives the wire projection (the client view still reads the guard)", () => {
        const state = board();
        const projected = projectPublicState(state, 1, "p1");
        expect(isOpponentSearchProhibited(state, "p2")).toBe(true);
        expect(isOpponentSearchProhibited(projected, "p2")).toBe(true);
        expect(isOpponentSearchProhibited(projected, "p1")).toBe(false);
    });
});

describe("Ashiok, Dream Render −1 (CR 606.4, CR 701.17a, CR 400.7)", () => {
    it("mills the target player four, then exiles each opponent's graveyard", () => {
        const state = board();
        const source = state.players[0].battlefield[0];
        resolveActivated(state, source, "ashiok-dream-render-minus1", [
            { type: "player", id: "p1" },
        ]);
        // Milled p1 (the controller targeted themself): 4 cards from the library.
        expect(state.players[0].library).toHaveLength(0);
        // p1's own graveyard is kept (4 milled + 1); the opponent's is exiled.
        expect(state.players[0].graveyard).toHaveLength(5);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "p2-g1",
            "p2-g2",
        ]);
    });
});
