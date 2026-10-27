// "Whenever enchanted land is tapped for mana, its controller adds an
// additional {mana}." — the Aura host's mana-ability tap (CR 605.1b + CR 303.4b)
// whose recipient is the tapped land's controller (`$event.controllerId`).
//
//  1. GOLDENS — real corpus cards compiled whole, `sortKeys` equality.
//  2. REFUSALS — the neighbours the rule must NOT read: a mana amount that is
//     a runtime choice (no Op adds "one mana of any color"), and a subject
//     that is not the Aura's host.

import { describe, expect, it } from "vitest";
import type { CompiledTriggeredAbility } from "../../cards/compiledTriggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const aura = (name: string, manaCost: string, body: string) =>
    oracleCard({
        name,
        manaCost,
        typeLine: "Enchantment — Aura",
        oracleText: `Enchant land\n${body}`,
        power: undefined,
        toughness: undefined,
    });

function abilitiesOf(
    card: ReturnType<typeof oracleCard>
): readonly CompiledTriggeredAbility[] {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition.compiledTriggeredAbilities ?? [];
}

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

const WILD_GROWTH =
    "Whenever enchanted land is tapped for mana, its controller adds an additional {G}.";

describe("tapped-for-mana head — goldens (CR 605.1b)", () => {
    it("Wild Growth: the host's mana tap adds {G} to the tapped land's controller", () => {
        expect(
            sortKeys(abilitiesOf(aura("Wild Growth", "{G}", WILD_GROWTH)))
        ).toEqual(
            sortKeys([
                {
                    id: "wild-growth-trigger",
                    oracleText: WILD_GROWTH,
                    head: { kind: "tapped-for-mana", scope: "host" },
                    effects: [
                        {
                            op: "addMana",
                            mana: { G: 1 },
                            player: { ref: "$event.controllerId" },
                        },
                    ],
                },
            ])
        );
    });

    it("Overgrowth: a two-pip amount keeps both pips", () => {
        const text =
            "Whenever enchanted land is tapped for mana, its controller adds an additional {G}{G}.";
        const [ability] = abilitiesOf(aura("Overgrowth", "{2}{G}", text));
        expect(sortKeys(ability!.effects)).toEqual(
            sortKeys([
                {
                    op: "addMana",
                    mana: { G: 2 },
                    player: { ref: "$event.controllerId" },
                },
            ])
        );
    });
});

describe("tapped-for-mana head — refusals", () => {
    it("refuses 'one mana of any color' (Fertile Ground): no Op adds a chosen colour", () => {
        expect(
            refused(
                aura(
                    "Fertile Ground",
                    "{1}{G}",
                    "Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color."
                )
            )
        ).toBe(true);
    });

    it("refuses 'two mana in any combination of colors' (Dawn's Reflection)", () => {
        expect(
            refused(
                aura(
                    "Dawn's Reflection",
                    "{3}{G}",
                    "Whenever enchanted land is tapped for mana, its controller adds an additional two mana in any combination of colors."
                )
            )
        ).toBe(true);
    });

    it("refuses 'its controller adds' behind a head that names no tapped land", () => {
        expect(
            refused(
                aura(
                    "Probe Aura",
                    "{G}",
                    "At the beginning of your upkeep, its controller adds an additional {G}."
                )
            )
        ).toBe(true);
    });

    it("refuses a tap-for-mana head on a subject that is not the host", () => {
        expect(
            refused(
                aura(
                    "Probe Aura",
                    "{G}",
                    "Whenever a land is tapped for mana, its controller adds an additional {G}."
                )
            )
        ).toBe(true);
    });
});
