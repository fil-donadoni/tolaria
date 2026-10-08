// "Search your library for <what>, put it onto the battlefield[ tapped], then
// shuffle." (CR 701.23a, CR 110.5a, CR 701.24a, issue #4552).
//
//  1. GOLDEN — each accepted form compiled whole off a real corpus card and
//     compared against the entire Compiled Definition: the dual-land fetch
//     (Windswept Heath), the basic-land fetch tapped on an activated ability
//     (Sakura-Tribe Elder) and behind a trigger's may-gate (Quirion Trailblazer).
//     The five dual-land descriptions share one row builder, each pinned by its
//     own printed card.
//  2. REFUSALS — neighbours the rule does not read.
//  3. Lowering invariants: the find is optional, no reveal, shuffle last.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function fetchEffects(
    bind: string,
    phrase: string,
    filter: object,
    tapped: boolean
) {
    return [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter,
            count: { min: 0, max: 1 },
            prompt: `Search your library for ${phrase}.`,
            bind,
        },
        {
            op: "moveZone",
            cards: { ref: bind },
            player: "controller",
            from: "library",
            to: "battlefield",
            ...(tapped ? { tapped: true } : {}),
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ];
}

const DUAL_CLAUSE = (what: string) =>
    `{T}, Pay 1 life, Sacrifice this land: Search your library for ${what} card, put it onto the battlefield, then shuffle.`;

const BASIC_CLAUSE =
    "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.";

describe("Search library onto the battlefield — golden fixtures (CR 701.23a, CR 110.5a)", () => {
    it("activated slot, dual-land description: Windswept Heath", () => {
        const text = DUAL_CLAUSE("a Forest or Plains");
        expect(
            sortKeys(
                compiledDefinition(
                    oracleCard({
                        name: "Windswept Heath",
                        typeLine: "Land",
                        manaCost: "",
                        oracleText: text,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Windswept Heath",
                types: ["Land"],
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "windswept-heath-ability",
                        oracleText: text,
                        cost: { tap: true, life: 1, sacrifice: true },
                        useStack: true,
                        effects: fetchEffects(
                            "$found1",
                            "a Forest or Plains card",
                            { subtype: ["Forest", "Plains"] },
                            false
                        ),
                    },
                ],
            })
        );
    });

    it.each([
        ["Wooded Foothills", "a Mountain or Forest", ["Mountain", "Forest"]],
        ["Flooded Strand", "a Plains or Island", ["Plains", "Island"]],
        ["Bloodstained Mire", "a Swamp or Mountain", ["Swamp", "Mountain"]],
        ["Polluted Delta", "an Island or Swamp", ["Island", "Swamp"]],
    ])("the dual-land description of %s", (name, what, subtype) => {
        const [first, second] = subtype;
        const definition = compiledDefinition(
            oracleCard({
                name,
                typeLine: "Land",
                manaCost: "",
                oracleText: DUAL_CLAUSE(what!),
            })
        );
        expect(definition.activatedAbilities?.[0]?.effects).toEqual(
            fetchEffects(
                "$found1",
                `${what} card`,
                { subtype: [first, second] },
                false
            )
        );
    });

    it("activated slot, basic land tapped: Sakura-Tribe Elder", () => {
        const text = `Sacrifice this creature: ${BASIC_CLAUSE}`;
        const definition = compiledDefinition(
            oracleCard({
                name: "Sakura-Tribe Elder",
                manaCost: "{1}{G}",
                typeLine: "Creature — Snake Shaman",
                oracleText: text,
                power: "1",
                toughness: "1",
            })
        );
        expect(definition.activatedAbilities?.[0]?.effects).toEqual(
            fetchEffects(
                "$found1",
                "a basic land card",
                { type: "Land", supertype: "Basic" },
                true
            )
        );
    });

    it("triggered slot, behind a may-gate: Quirion Trailblazer", () => {
        const text = `When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.`;
        const definition = compiledDefinition(
            oracleCard({
                name: "Quirion Trailblazer",
                manaCost: "{2}{G}",
                typeLine: "Creature — Elf Scout",
                oracleText: text,
                power: "1",
                toughness: "2",
            })
        );
        expect(
            sortKeys(definition.compiledTriggeredAbilities?.[0]?.effects)
        ).toEqual(
            sortKeys([
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: `${BASIC_CLAUSE.replace(/\.$/, "")}?`,
                    bind: "$may2",
                },
                {
                    op: "if",
                    predicate: { binding: "$may2" },
                    then: fetchEffects(
                        "$found1",
                        "a basic land card",
                        { type: "Land", supertype: "Basic" },
                        true
                    ),
                },
            ])
        );
    });
});

describe("Search library onto the battlefield — refusals (fail-closed)", () => {
    const refused = (oracleText: string) =>
        compileCard(
            oracleCard({
                name: "Sakura-Tribe Elder",
                manaCost: "{1}{G}",
                typeLine: "Creature — Snake Shaman",
                oracleText: `Sacrifice this creature: ${oracleText}`,
                power: "1",
                toughness: "1",
            })
        ).state;

    it("a pronoun/tapped pairing no card prints has no row", () => {
        expect(
            refused(
                "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."
            )
        ).toBe("unparsed");
        expect(
            refused(
                "Search your library for a Forest or Plains card, put it onto the battlefield tapped, then shuffle."
            )
        ).toBe("unparsed");
    });

    it("a description outside the closed table searches nothing", () => {
        expect(
            refused(
                "Search your library for a creature card, put it onto the battlefield, then shuffle."
            )
        ).toBe("unparsed");
    });

    it("a clause glued after the shuffle is not dropped", () => {
        expect(
            refused(`${BASIC_CLAUSE.replace(/\.$/, "")} and draw a card.`)
        ).toBe("unparsed");
    });
});

describe("Search library onto the battlefield — lowering invariants", () => {
    const effects = (name: string, text: string) =>
        compiledDefinition(
            oracleCard({
                name,
                typeLine: "Land",
                manaCost: "",
                oracleText: text,
            })
        ).activatedAbilities?.[0]?.effects ?? [];

    it("the find is optional, there is no reveal, the shuffle is last", () => {
        const ops = effects(
            "Windswept Heath",
            DUAL_CLAUSE("a Forest or Plains")
        );
        expect(ops.map((effect) => effect.op)).toEqual([
            "choice",
            "moveZone",
            "libraryLook",
        ]);
        expect((ops[0] as { count: unknown }).count).toEqual({
            min: 0,
            max: 1,
        });
    });

    it("enters tapped only when the line says so (CR 110.5a)", () => {
        const untapped = effects(
            "Windswept Heath",
            DUAL_CLAUSE("a Forest or Plains")
        );
        expect(untapped[1]).not.toHaveProperty("tapped");
    });
});
