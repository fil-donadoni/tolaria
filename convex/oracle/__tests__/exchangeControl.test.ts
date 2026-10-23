// "Exchange control of this creature and up to one target creature an opponent
// controls" with its two riders (CR 701.12a, CR 701.21a, CR 608.2b).
//
//  1. GOLDEN — Gilded Drake compiled whole: one ability, the exchange gated on
//     the source in play and the announced slot filled, the fallback sacrifice
//     on the other branch, and the ability-level opt-out of the fizzle.
//  2. REFUSALS — each neighbour form the rule must NOT read, pinned to where
//     the compiler gave up.
//
// The engine half (the fizzle gate, all-or-nothing) is
// `gre/__tests__/exchangeControlTrigger.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const EXCHANGE =
    "exchange control of this creature and up to one target creature an opponent controls.";
const FALLBACK =
    " If you don't or can't make an exchange, sacrifice this creature.";
const RESOLVES = " This ability still resolves if its target becomes illegal.";

function drake(body: string, head = "When this creature enters, ") {
    return oracleCard({
        name: "Gilded Drake",
        manaCost: "{1}{U}",
        typeLine: "Creature — Drake",
        power: "3",
        toughness: "3",
        oracleText: `Flying\n${head}${body}`,
    });
}

/** WHERE the compiler gave up on a card it refuses. */
function refusedAt(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} parsed, but should not have`);
    expect(outcome.gaps).toHaveLength(1);
    const gap = outcome.gaps[0]!;
    return gap.attribution === undefined
        ? gap.reason
        : `${gap.attribution.path.join(" > ")}: ${gap.attribution.span}`;
}

describe("exchange control of this creature and an optional target (CR 701.12a)", () => {
    it("Gilded Drake compiles to one gated exchange with a sacrifice fallback", () => {
        const outcome = compileCard(drake(`${EXCHANGE}${FALLBACK}${RESOLVES}`));
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        const [ability] = outcome.definition.compiledTriggeredAbilities!;
        expect(ability).toMatchObject({
            head: { kind: "entered", scope: "self" },
            resolvesIfTargetsIllegal: true,
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: 1 },
                controller: "opponent",
            },
        });
        expect(ability!.effects).toEqual([
            {
                op: "if",
                predicate: {
                    objectMatchesFilter: { ref: "$source" },
                    filter: {},
                },
                then: [
                    {
                        op: "if",
                        predicate: { targetIsAnother: { target: 0 } },
                        then: [
                            {
                                op: "gainControl",
                                target: { ref: "$source" },
                                controller: { controllerOf: { target: 0 } },
                            },
                            {
                                op: "gainControl",
                                target: { target: 0 },
                                controller: "controller",
                            },
                        ],
                        else: [{ op: "sacrifice", target: { ref: "$source" } }],
                    },
                ],
            },
        ]);
    });

    it("refuses the exchange without its sacrifice fallback", () => {
        expect(refusedAt(drake(`${EXCHANGE}${RESOLVES}`))).toContain(
            "sacrifice fallback"
        );
    });

    it("refuses the exchange without the resolves-if-illegal rider", () => {
        expect(refusedAt(drake(`${EXCHANGE}${FALLBACK}`))).toContain(
            "resolves-if-illegal"
        );
    });

    it("refuses a fallback or rider with no exchange in front of it", () => {
        expect(refusedAt(drake(`draw a card.${FALLBACK}`))).toMatch(
            /^sentence assembly:/
        );
        expect(refusedAt(drake(`draw a card.${RESOLVES}`))).toMatch(
            /^sentence assembly:/
        );
    });

    it("refuses a mandatory target (no 'up to one')", () => {
        expect(
            refusedAt(
                drake(
                    `exchange control of this creature and target creature an opponent controls.${FALLBACK}${RESOLVES}`
                )
            )
        ).toBeTruthy();
    });

    it("refuses an exchange that does not move the source", () => {
        expect(
            refusedAt(
                drake(
                    `exchange control of target creature you control and up to one target creature an opponent controls.${FALLBACK}${RESOLVES}`
                )
            )
        ).toBeTruthy();
    });

    it("refuses a fallback that sacrifices something other than the source", () => {
        expect(
            refusedAt(
                drake(
                    `${EXCHANGE} If you don't or can't make an exchange, sacrifice a creature.${RESOLVES}`
                )
            )
        ).toBeTruthy();
    });

    it("refuses the rider behind a head that is not 'this creature enters' (CR 608.2b)", () => {
        expect(
            refusedAt(
                drake(
                    `${EXCHANGE}${FALLBACK}${RESOLVES}`,
                    "Whenever this creature attacks, "
                )
            )
        ).toBeTruthy();
    });
});
