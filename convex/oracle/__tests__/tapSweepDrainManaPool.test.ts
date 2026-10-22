// "Tap all <permanents> target player controls and that player loses all
// unspent mana" (CR 701.26a tap, CR 106.4 mana pool): one tap sweep over an
// announced player's permanents, then the `drainManaPool` Op on that same
// player. Goldens, refusals, and the compiled definition run through the real
// interpreter.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards/catalogue";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function instant(oracleText: string) {
    return oracleCard({
        name: "Mana Short",
        manaCost: "{2}{U}",
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

const MANA_SHORT =
    "Tap all lands target player controls and that player loses all unspent mana.";

describe("tap sweep + drain mana pool (CR 701.26a, CR 106.4)", () => {
    it("compiles Mana Short to the tap sweep then the drain, on one announced player", () => {
        const outcome = compileCard(instant(MANA_SHORT));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition.effects)).toEqual(
            sortKeys([
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: { target: 0 },
                        filter: { type: "Land" },
                    },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "tap",
                            target: { ref: "$each" },
                        },
                    ],
                },
                { op: "drainManaPool", player: { target: 0 } },
            ])
        );
        expect(outcome.definition.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });

    it.each([
        [
            "the drain without a tap sweep",
            "That player loses all unspent mana.",
        ],
        [
            "an untap sweep",
            "Untap all lands target player controls and that player loses all unspent mana.",
        ],
        [
            "a sweep over your own permanents",
            "Tap all lands you control and that player loses all unspent mana.",
        ],
        [
            "two controller clauses",
            "Tap all lands you control target player controls and that player loses all unspent mana.",
        ],
        [
            "a different tail",
            "Tap all lands target player controls and that player loses all life.",
        ],
    ])("refuses %s", (_what, text) => {
        expect(compileCard(instant(text)).state).toBe("unparsed");
    });

    it("runs through the interpreter: taps the target's lands and empties their pool, sparing the caster", () => {
        const outcome = compileCard(instant(MANA_SHORT));
        if (outcome.state === "unparsed") throw new Error("unparsed");
        const id = "test-tap-sweep-drain-mana";
        const definition = {
            ...outcome.definition,
            id,
            rarity: "rare",
        } as unknown as CardDefinition;
        withTemporaryDefinition(definition, () => {
            const land = (landId: string, owner: string) =>
                makeInstance(getCardByName("Island").id, {
                    id: landId,
                    controllerId: owner,
                    ownerId: owner,
                });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [land("own-land", "p1")],
                        manaPool: { U: 1 },
                    }),
                    makePlayer("p2", {
                        battlefield: [land("l1", "p2"), land("l2", "p2")],
                        manaPool: { G: 2, R: 1 },
                    }),
                ],
            });
            pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
            resolveTopOfStack(state);
            const [p1, p2] = state.players;
            expect(p2!.battlefield.every((c) => c.isTapped)).toBe(true);
            expect(Object.values(p2!.manaPool).every((n) => n === 0)).toBe(
                true
            );
            expect(p1!.battlefield[0]!.isTapped).toBe(false);
            expect(p1!.manaPool.U).toBe(1);
            // Wire format: the client's view of the drained pool is empty too.
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players.find((p) => p.id === "p2")!;
            expect(Object.values(slim.manaPool).every((n) => n === 0)).toBe(
                true
            );
        });
    });
});
