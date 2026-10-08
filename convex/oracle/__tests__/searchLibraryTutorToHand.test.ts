// "Search your library for <what>, reveal <it|that card>, put it into your
// hand, then shuffle." beyond the basic-land form, and the Elf permanent fetch
// onto the battlefield (CR 701.23a, CR 701.20a, CR 701.24a, issue #4553).
//
//  1. GOLDEN — each accepted form compiled whole off a real corpus card:
//     land (Weathered Wayfarer), creature (Survival of the Fittest), Goblin
//     (Goblin Matron), Elf permanent to the battlefield (Skyshroud Poacher).
//     Land Grant's Forest clause is pinned on its own line: the card's
//     alternative cost is a separate gap, so the whole card stays unparsed.
//  2. REFUSALS — a pronoun/description pairing no card prints.

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

function toHand(bind: string, phrase: string, filter: object) {
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
        { op: "reveal", player: "controller", cards: { ref: bind } },
        {
            op: "moveZone",
            cards: { ref: bind },
            player: "controller",
            from: "library",
            to: "hand",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ];
}

const WAYFARER_TEXT =
    "{W}, {T}: Search your library for a land card, reveal it, put it into your hand, then shuffle. Activate only if an opponent controls more lands than you.";

describe("Tutor to hand — golden fixtures", () => {
    it("land card, plain activated cost: Expedition Map", () => {
        const text =
            "{2}, {T}, Sacrifice this artifact: Search your library for a land card, reveal it, put it into your hand, then shuffle.";
        const def = compiledDefinition(
            oracleCard({
                name: "Expedition Map",
                manaCost: "{1}",
                typeLine: "Artifact",
                oracleText: text,
            })
        );
        expect(def.activatedAbilities?.[0]?.effects).toEqual(
            toHand("$found1", "a land card", { type: "Land" })
        );
    });

    it("land card behind an activation restriction: Weathered Wayfarer", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Weathered Wayfarer",
                manaCost: "{W}",
                typeLine: "Creature — Human Nomad Cleric",
                oracleText: WAYFARER_TEXT,
                power: "1",
                toughness: "1",
            })
        );
        // The activation restriction is its own rule; this form must not be
        // what refuses the line.
        expect(JSON.stringify(outcome)).not.toContain(
            "not a library search description"
        );
    });

    it("creature card, reveal that card: Survival of the Fittest", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Survival of the Fittest",
                manaCost: "{1}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
            })
        );
        expect(def.activatedAbilities?.[0]?.effects).toEqual(
            toHand("$found1", "a creature card", { type: "Creature" })
        );
    });

    it("Goblin card behind a may-gate: Goblin Matron", () => {
        const text =
            "When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.";
        const def = compiledDefinition(
            oracleCard({
                name: "Goblin Matron",
                manaCost: "{2}{R}",
                typeLine: "Creature — Goblin",
                oracleText: text,
                power: "1",
                toughness: "1",
            })
        );
        expect(sortKeys(def.compiledTriggeredAbilities?.[0]?.effects)).toEqual(
            sortKeys([
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Search your library for a Goblin card, reveal that card, put it into your hand, then shuffle?",
                    bind: "$may2",
                },
                {
                    op: "if",
                    predicate: { binding: "$may2" },
                    then: toHand("$found1", "a Goblin card", {
                        subtype: "Goblin",
                    }),
                },
            ])
        );
    });

    it("Forest card on a spell line: Land Grant's clause", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Land Grant",
                manaCost: "{1}{G}",
                typeLine: "Sorcery",
                oracleText:
                    "Search your library for a Forest card, reveal that card, put it into your hand, then shuffle.",
            })
        );
        expect(def.effects).toEqual(
            toHand("$found1", "a Forest card", { subtype: "Forest" })
        );
    });

    it("Elf permanent card onto the battlefield: Skyshroud Poacher", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Skyshroud Poacher",
                manaCost: "{2}{G}{G}",
                typeLine: "Creature — Human Rebel",
                oracleText:
                    "{3}, {T}: Search your library for an Elf permanent card, put it onto the battlefield, then shuffle.",
                power: "3",
                toughness: "3",
            })
        );
        expect(def.activatedAbilities?.[0]?.effects).toEqual([
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: {
                    type: [
                        "Artifact",
                        "Battle",
                        "Creature",
                        "Enchantment",
                        "Land",
                        "Planeswalker",
                    ],
                    subtype: "Elf",
                },
                count: { min: 0, max: 1 },
                prompt: "Search your library for an Elf permanent card.",
                bind: "$found1",
            },
            {
                op: "moveZone",
                cards: { ref: "$found1" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ]);
    });
});

describe("Tutor to hand — refusals (fail-closed)", () => {
    const refused = (oracleText: string) =>
        compileCard(
            oracleCard({
                name: "Land Grant",
                manaCost: "{1}{G}",
                typeLine: "Sorcery",
                oracleText,
            })
        ).state;

    it("a pronoun no card prints with that description", () => {
        expect(
            refused(
                "Search your library for a Forest card, reveal it, put it into your hand, then shuffle."
            )
        ).toBe("unparsed");
        expect(
            refused(
                "Search your library for a land card, reveal that card, put it into your hand, then shuffle."
            )
        ).toBe("unparsed");
    });

    it("an Elf permanent fetch tapped, or an Elf card to hand, is not read", () => {
        expect(
            refused(
                "Search your library for an Elf permanent card, put it onto the battlefield tapped, then shuffle."
            )
        ).toBe("unparsed");
        expect(
            refused(
                "Search your library for an Elf card, reveal that card, put it into your hand, then shuffle."
            )
        ).toBe("unparsed");
    });
});
