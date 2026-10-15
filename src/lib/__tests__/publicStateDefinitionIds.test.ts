import { describe, it, expect } from "vitest";
import type { Player, StackItem } from "~/types/game";
import { publicStateDefinitionIds } from "../publicStateDefinitionIds";

/** Every place a projected state carries a definition id, walked once (issue
 *  #5615): what the board must resolve before it shows a snapshot. */

const card = (id: string, knownCardId?: string) =>
    ({ card: { id }, knownCardId }) as never;

function player(zones: Partial<Record<string, unknown>>): Player {
    return {
        id: "p",
        battlefield: [],
        graveyard: [],
        exile: [],
        hand: [],
        library: { count: 0, known: [] },
        ...zones,
    } as unknown as Player;
}

describe("publicStateDefinitionIds", () => {
    it("walks every zone of every player, the companion, the stack and the off-stack bundles, each id once", () => {
        const ids = publicStateDefinitionIds({
            players: [
                player({
                    battlefield: [card("bf"), card("dup")],
                    graveyard: [card("gy")],
                    exile: [card("ex")],
                    hand: [card("hd"), null],
                    revealedHand: [card("rh")],
                    library: { count: 9, known: [{ card: card("lk") }] },
                    companion: { instance: card("cp"), used: false },
                }),
                player({
                    library: [card("lw"), card("dup")],
                }),
            ],
            stack: [card("st") as StackItem],
            phasedOut: [{ cards: [card("po")] }],
            pendingTriggerBatch: [card("tb")],
        });
        expect(ids).toEqual([
            "bf",
            "dup",
            "gy",
            "ex",
            "hd",
            "rh",
            "lk",
            "cp",
            "lw",
            "st",
            "po",
            "tb",
        ]);
    });

    it("includes the identity a face-down object hides from its owner's view, and the granting card of a granted ability", () => {
        expect(
            publicStateDefinitionIds({
                players: [
                    player({
                        battlefield: [
                            {
                                card: { id: "face-down:2-2-vanilla" },
                                knownCardId: "real",
                                grantedActivatedAbilities: [
                                    { sourceCardId: "lord", abilityId: "a" },
                                ],
                            } as never,
                        ],
                    }),
                ],
            })
        ).toEqual(["face-down:2-2-vanilla", "real", "lord"]);
    });
});
