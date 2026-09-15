// The CLIENT half of issue #3630 (CR 605.3a).
//
// A sacrifice land ("{T}: Add {G}." beside "{T}, Sacrifice this land: Add
// {G}{G}.") used to read on the board as a single-option source: a click tapped
// it for {G} with no picker, so its second ability had no affordance at all.
// The engine now appends the sacrifice option to the manual tap list, and the
// board's picker gate (`getManaChoices`) reads that same list — so the picker
// opens, and `getManaChoiceSacrificeFlags` tells it which row gives up the land.
//
// Driven through `projectPublicState`: the client only ever sees the projection.

import { describe, it, expect } from "vitest";
import {
    getManaChoices,
    getManaChoiceSacrificeFlags,
    hasManaAbility,
} from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";

function projectedBoard(cardName: string) {
    const instance = makeInstance(getCardByName(cardName).id, {
        id: "wire-source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [instance] }),
            makePlayer("p2"),
        ],
    });
    const wire = projectPublicState(state, 1, "p1");
    const players = wire.players.map((p) => ({
        id: p.id,
        battlefield: p.battlefield as unknown as CardInstance[],
    }));
    const source = players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "wire-source")!;
    return { players, source };
}

describe("sacrifice-land mana choices on the client (CR 605.3a, issue #3630)", () => {
    it("the picker offers both abilities, the sacrifice one last", () => {
        const { players, source } = projectedBoard("Havenwood Battleground");
        expect(hasManaAbility(source, undefined, players)).toBe(true);
        expect(getManaChoices(source, players)).toEqual([{ G: 1 }, { G: 2 }]);
        expect(getManaChoiceSacrificeFlags(source, players)).toEqual([
            false,
            true,
        ]);
    });

    it("a two-colour sacrifice output is its own row (Invasion shape)", () => {
        const { players, source } = projectedBoard("Ancient Spring");
        expect(getManaChoices(source, players)).toEqual([
            { U: 1 },
            { W: 1, B: 1 },
        ]);
        expect(getManaChoiceSacrificeFlags(source, players)).toEqual([
            false,
            true,
        ]);
    });

    it("a plain single-ability land still taps with no picker", () => {
        const { players, source } = projectedBoard("Llanowar Elves");
        expect(getManaChoices(source, players)).toBeNull();
    });
});
