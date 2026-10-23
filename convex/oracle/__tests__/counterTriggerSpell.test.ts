// "Counter it" behind a spell-cast head (CR 603.2 + CR 608.2h + CR 701.6a,
// issue #5220): the trigger announces no target, so the counter reads the
// `$event.spell` ref the head's event names.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function enchantment(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{3}{W}",
        oracleText,
        typeLine: "Enchantment",
        power: undefined,
        toughness: undefined,
    });
}

describe("counter it — the spell a cast head fired on", () => {
    it("compiles Presence of the Master whole", () => {
        const outcome = compileCard(
            enchantment(
                "Presence of the Master",
                "Whenever a player casts an enchantment spell, counter it."
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Presence of the Master",
                types: ["Enchantment"],
                manaCost: { X: 3, W: 1 },
                oracleText:
                    "Whenever a player casts an enchantment spell, counter it.",
                compiledTriggeredAbilities: [
                    {
                        id: "presence-of-the-master-trigger",
                        oracleText:
                            "Whenever a player casts an enchantment spell, counter it.",
                        head: {
                            kind: "spell-cast",
                            scope: "any",
                            filter: { types: ["Enchantment"] },
                        },
                        effects: [
                            { op: "counter", target: { ref: "$event.spell" } },
                        ],
                    },
                ],
            })
        );
    });

    it("refuses 'counter it' behind a head that cast no spell", () => {
        const outcome = compileCard(
            enchantment(
                "Fixture Counter",
                "Whenever a creature enters, counter it."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses a taxed pronoun counter — no fixture behind it", () => {
        const outcome = compileCard(
            enchantment(
                "Fixture Tax",
                "Whenever a player casts a spell, counter it unless its controller pays {1}."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
