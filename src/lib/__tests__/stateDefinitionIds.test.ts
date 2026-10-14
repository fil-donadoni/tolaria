import { describe, it, expect } from "vitest";
import type { Player, StackItem } from "~/types/game";
import { stateDefinitionIds } from "../stateDefinitionIds";

/** Every zone a projected state carries a definition in, walked once (issue
 *  #5615): what the board must resolve before it renders. */

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

describe("stateDefinitionIds", () => {
    it("walks every zone of every player and the stack, each id once", () => {
        const ids = stateDefinitionIds({
            players: [
                player({
                    battlefield: [card("bf"), card("dup")],
                    graveyard: [card("gy")],
                    exile: [card("ex")],
                    hand: [card("hd"), null],
                    revealedHand: [card("rh")],
                    library: { count: 9, known: [{ card: card("lk") }] },
                }),
                player({
                    library: [card("lw"), card("dup")],
                }),
            ],
            stack: [card("st") as StackItem],
        });
        expect(ids).toEqual([
            "bf",
            "dup",
            "gy",
            "ex",
            "hd",
            "rh",
            "lk",
            "lw",
            "st",
        ]);
    });

    it("includes the identity a face-down object hides from its owner's view", () => {
        expect(
            stateDefinitionIds({
                players: [
                    player({ battlefield: [card("face-down:2-2-vanilla", "real")] }),
                ],
            })
        ).toEqual(["face-down:2-2-vanilla", "real"]);
    });
});
