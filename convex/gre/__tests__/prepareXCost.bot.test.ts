// Bot reachability for a prepare spell with an {X}{X} cost (CR 722.3c, CR 107.3,
// issue #3690): Oracle's Gift, cast from the exiled copy, is enumerated with
// every X the pool can pay for twice, and X = 0 included.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { insetSpellDefinitionId } from "../../cards/insetSpell";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { enumerateMoves } from "../moves";

const JADZI = getCardByName("Jadzi, Steward of Fate").id;
const GIFT = insetSpellDefinitionId(JADZI, "prepare");
const ISLAND = getCardByName("Island").id;

describe("Oracle's Gift {X}{X}{U} from exile (CR 722.3c / CR 107.3)", () => {
    it("the Bot enumerates the cast for each affordable X", () => {
        const lands = Array.from({ length: 5 }, (_, i) =>
            makeInstance(ISLAND, {
                id: `island-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(JADZI, {
                            id: "jadzi",
                            controllerId: "p1",
                            ownerId: "p1",
                            prepared: true,
                        }),
                        ...lands,
                    ],
                    exile: [
                        makeInstance(GIFT, {
                            id: "gift",
                            controllerId: "p1",
                            ownerId: "p1",
                            castableFromExileBy: "p1",
                            preparedCopyOf: "jadzi",
                        }),
                    ],
                }),
                makePlayer("p2", {}),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        const xs = enumerateMoves(state, "p1")
            .filter(
                (m) => m.kind === "cast-spell" && m.cardInstanceId === "gift"
            )
            .map((m) => (m as { chosenX?: number }).chosenX ?? 0)
            .sort((a, b) => a - b);
        expect(xs).toEqual([0, 1, 2]);
    });
});
