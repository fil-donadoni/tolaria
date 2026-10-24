// The Bot's search slice pays `cost.exileFromGraveyard.destination:
// "library-bottom"` (CR 401.4, 118.3) to the same place the live mutation does
// (`graveyardCostLibraryBottom.test.ts`), so a tree that scores the activation
// sees the cards on the library's bottom, not in exile.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { enumerateMoves } from "../moves";
import { applyMoveForSearch } from "../applyMove";

const ABILITY_ID = "bottom-cost-ability";

function variant(): CardDefinition {
    const base = getCardByName("Grim Lavamancer");
    return {
        ...base,
        activatedAbilities: [
            {
                id: ABILITY_ID,
                oracleText:
                    "Put two cards from your graveyard on the bottom of your library: This creature gets +3/+3 until end of turn.",
                cost: {
                    exileFromGraveyard: {
                        count: 2,
                        owner: "you",
                        destination: "library-bottom",
                    },
                },
                useStack: true,
                effects: [
                    {
                        op: "pump",
                        target: { ref: "$source" },
                        power: 3,
                        toughness: 3,
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ],
    };
}

describe("library-bottom graveyard cost — search slice (CR 401.4)", () => {
    it("moves the picked cards graveyard → library bottom, never to exile", () => {
        withTemporaryDefinition(variant(), () => {
            const bears = getCardByName("Grizzly Bears").id;
            const card = (id: string, zone: "graveyard" | "library") =>
                makeInstance(bears, {
                    id,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone,
                });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(getCardByName("Grim Lavamancer").id, {
                                id: "src",
                                controllerId: "p1",
                                ownerId: "p1",
                                isSummoningSick: false,
                            }),
                        ],
                        graveyard: [
                            card("g1", "graveyard"),
                            card("g2", "graveyard"),
                            card("g3", "graveyard"),
                        ],
                        library: [card("l1", "library")],
                    }),
                    makePlayer("p2"),
                ],
            });
            const move = enumerateMoves(state, "p1").find(
                (m) => m.kind === "activate-ability"
            );
            expect(move).toBeDefined();
            const after = applyMoveForSearch(state, "p1", move!);
            const me = after.players[0]!;
            expect(me.graveyard).toHaveLength(1);
            expect(me.exile).toHaveLength(0);
            expect(me.library).toHaveLength(3);
        });
    });
});
