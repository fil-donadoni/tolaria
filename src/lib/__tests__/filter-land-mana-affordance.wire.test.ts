// The client's tap affordance for a filter land — CR 605.1a, issue #5444.
//
// "{1}, {T}: Add {W}{U}" is a Mana Ability that consumes {1} from ANOTHER
// source. The client must offer it while an other untapped source exists and
// grey it out when it stands alone (it cannot fund itself), in step with the
// server census. SURFACE test: every assertion runs on the card as it arrives
// through `projectPublicState`, never on a hand-built view.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup.helper";
import { projectPublicState } from "../../../convex/gameProjections";
import { mountain } from "../../../convex/cards/sets/lea/index.cards";
import { registerTokenDefinition } from "../../../convex/cards";
import type { CardDefinition } from "../../../convex/cards/types";
import { canAffordManaAbilityCost } from "../card-utils";
import type { CardInstance, ManaPool } from "../../types/game";

const EMPTY_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

const FILTER_ID = "test:filter-land-wu-wire";
const filterLand: CardDefinition = {
    id: FILTER_ID,
    rarity: "common",
    name: "Filter Land WU wire (test probe)",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "filter-land-wu-wire-mana",
            oracleText: "{1}, {T}: Add {W}{U}.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1, U: 1 }),
            manaProduced: { W: 1, U: 1 },
        },
    ],
};
registerTokenDefinition(filterLand);

function projectedBoard(withFunder: boolean): CardInstance[] {
    const cards = [
        makeInstance(FILTER_ID, {
            id: "filter",
            controllerId: "p1",
            ownerId: "p1",
        }),
        ...(withFunder
            ? [
                  makeInstance(mountain().id, {
                      id: "mountain",
                      controllerId: "p1",
                      ownerId: "p1",
                  }),
              ]
            : []),
    ];
    const state = makeState({
        players: [makePlayer("p1", { battlefield: cards }), makePlayer("p2")],
    });
    return projectPublicState(state, 1, "p1").players[0]!
        .battlefield as unknown as CardInstance[];
}

describe("filter land tap affordance on the client (issue #5444)", () => {
    it("is offered with another untapped source and an empty pool", () => {
        const board = projectedBoard(true);
        const filter = board.find((c) => c.id === "filter")!;
        expect(canAffordManaAbilityCost(filter, EMPTY_POOL, board)).toBe(true);
    });

    it("is greyed out standing alone — it cannot fund itself", () => {
        const board = projectedBoard(false);
        const filter = board.find((c) => c.id === "filter")!;
        expect(canAffordManaAbilityCost(filter, EMPTY_POOL, board)).toBe(false);
    });
});
