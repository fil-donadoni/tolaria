// CR 601.2h / 702.44a — the dominance probe's cast stamps `notedManaSpent`.
//
// `isDominatedNoOpMove` proves a cast futile by applying it to a clone and
// resolving it. A Converge card (`colorsSpentToCast`) reads the colours it was
// paid with; the probe built its stack item without the record, so every
// converge cast read 0 colours, looked like a no-op and was deleted from the
// Bot's legal moves (issue #7246) — the Bot could only pass.

import { describe, expect, it } from "vitest";
import { isDominatedNoOpMove } from "../ai/dominance";
import { enumerateMoves } from "../moves";
import type { GameState } from "../state";
import { getCardByName, registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";

/** The converge removal shape, as a stand-in so the test needs no catalogue
 *  row: "Exile target nonland permanent if its mana value is less than or
 *  equal to the number of colors of mana spent to cast this spell." */
const CONVERGE = "probe-converge-exile";
const convergeSpell: CardDefinition = {
    id: CONVERGE,
    name: CONVERGE,
    rarity: "uncommon",
    manaCost: { X: "X", W: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 1 },
    noteManaSpent: true,
    effects: [
        {
            op: "if",
            predicate: {
                left: { manaValue: { of: { target: 0 } } },
                op: "le",
                right: { colorsSpentToCast: true },
            },
            then: [{ op: "exile", target: { target: 0 } }],
        },
    ],
};
registerTokenDefinition(convergeSpell);

const MV2_ID = "probe-converge-mv2";
registerTokenDefinition({
    id: MV2_ID,
    name: MV2_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});

function board(secondLand: string): GameState {
    const land = (name: string) =>
        makeInstance(getCardByName(name).id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
    const mv2 = makeInstance(MV2_ID, {
        id: "mv2",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(CONVERGE, {
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [land("Plains"), land(secondLand)],
            }),
            makePlayer("p2", { battlefield: [mv2] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function xOneCast(state: GameState) {
    const me = state.players[0];
    const move = enumerateMoves(state, me.id).find(
        (m) => m.kind === "cast-spell" && m.chosenX === 1
    );
    if (!move || move.kind !== "cast-spell") throw new Error("no X=1 cast");
    return { me, move };
}

describe("dominance probe stamps notedManaSpent (CR 601.2h / 702.44a)", () => {
    it("X=1 off two colours exiles an MV-2 target: not a no-op", () => {
        const state = board("Island");
        const { me, move } = xOneCast(state);
        expect(isDominatedNoOpMove(state, me.id, move)).toBe(false);
    });

    it("X=1 off one colour cannot exile an MV-2 target: still a no-op", () => {
        const state = board("Plains");
        const { me, move } = xOneCast(state);
        expect(isDominatedNoOpMove(state, me.id, move)).toBe(true);
    });
});
