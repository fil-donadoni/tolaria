// Bot reachability of `cost.exileTopOfLibrary` — "Exile the top card of your
// library" (CR 118.1 / 701.13a). Two seams, the two the `COST_LEG_CLAIMS` row
// names:
//
//   1. `enumerateAbilityMoves` offers the activation only while the library
//      holds a card (CR 118.3), the same answer the server's announcement gives.
//   2. `applyMoveInSearch` PAYS the leg — the top card leaves the library in
//      the search tree — and stamps the exiled card's CR 608.2h snapshot onto
//      the pushed stack item, so the tree resolves "X is the exiled card's mana
//      value" with the number live play would. Unpaid, the leaf keeps the
//      payoff AND the card.
//
// No shipped card carries the leg yet, so the source is a synthetic
// definition served through `withTemporaryDefinition` (the bot project runs
// `isolate: false`; a preloaded definition would leak into every later file).

import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { applyMoveInSearch } from "../search";
import { activateAbilityOnState } from "../../game";
import { enumerateMoves, type Move } from "../moves";
import { cloneGameState } from "../clone";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { GameState } from "../state";

const BOT = "p2";
const OPP = "p1";
const SOURCE_ID = "00000000-0000-4000-8000-000064890011";
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id; // mana value 2
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id; // mana value 1

const BURNER: CardDefinition = {
    id: SOURCE_ID,
    name: "Synthetic Library Burner",
    rarity: "rare",
    manaCost: { generic: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "burn-top",
            oracleText:
                "Exile the top card of your library: You gain X life, where X is the exiled card's mana value.",
            cost: { exileTopOfLibrary: true },
            useStack: true,
            effects: [
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { sacrificed: { read: "manaValue" } },
                },
            ],
        },
    ],
} as CardDefinition;

function board(librarySize: number): GameState {
    const lib = (cardId: string, id: string) =>
        makeInstance(cardId, {
            id,
            controllerId: BOT,
            ownerId: BOT,
            zone: "library",
        });
    return makeState({
        players: [
            makePlayer(OPP),
            makePlayer(BOT, {
                battlefield: [
                    makeInstance(SOURCE_ID, {
                        id: "src",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "battlefield",
                    }),
                ],
                library: [
                    lib(GRIZZLY_BEARS, "top"),
                    lib(LIGHTNING_BOLT, "second"),
                ].slice(0, librarySize),
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "PRECOMBAT_MAIN",
    });
}

function activationOf(state: GameState) {
    return enumerateMoves(state, BOT).find(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" && m.cardInstanceId === "src"
    );
}

const botOf = (state: GameState) => state.players.find((p) => p.id === BOT)!;

describe("cost.exileTopOfLibrary — Bot reachability (CR 118.3 / 701.13a)", () => {
    it("does not offer the activation with an EMPTY library, as the server refuses it", () => {
        withTemporaryDefinition(BURNER, () => {
            const state = board(0);
            expect(activationOf(state)).toBeUndefined();
            expect(() =>
                activateAbilityOnState(cloneGameState(state), {
                    playerId: BOT,
                    cardInstanceId: "src",
                    abilityId: "burn-top",
                })
            ).toThrow(/No card in library to exile/);
        });
    });

    it("offers it with a single card in the library", () => {
        withTemporaryDefinition(BURNER, () => {
            expect(activationOf(board(1))).toBeDefined();
        });
    });

    it("pays the leg in the search tree and stamps the exiled card's snapshot (CR 608.2h)", () => {
        withTemporaryDefinition(BURNER, () => {
            const state = board(2);
            const move = activationOf(state);
            expect(move).toBeDefined();

            const tree = cloneGameState(state);
            applyMoveInSearch(tree, BOT, move!);

            expect(botOf(tree).library.map((c) => c.id)).toEqual(["second"]);
            expect(botOf(tree).exile.map((c) => c.id)).toEqual(["top"]);
            const item = tree.stack[tree.stack.length - 1];
            expect(item.additionalSacrificeSnapshot).toMatchObject({
                cardInstanceId: "top",
                mv: 2,
            });
        });
    });
});
