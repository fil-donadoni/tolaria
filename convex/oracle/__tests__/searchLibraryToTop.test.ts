// "Search your library for <what>, reveal it, then shuffle and put <the|that>
// card on top." (CR 701.23a, CR 701.20a, CR 701.24a, issue #4554).
//
// Three layers:
//
//  1. GOLDEN fixtures — the accepted forms, compiled whole off real corpus
//     cards (Worldly Tutor, Enlightened Tutor) and compared against the entire
//     Compiled Definition.
//  2. REFUSALS — the neighbours this rule does not read: the to-hand route,
//     a description or pronoun with no printed row, and the unshuffled
//     placement.
//  3. The lowering invariants: the reveal happens while the card is still in
//     the library, the find is optional (CR 701.23b), and the shuffle comes
//     BEFORE the placement (a shuffle after it would bury the card).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const WORLDLY_CLAUSE =
    "Search your library for a creature card, reveal it, then shuffle and put the card on top.";
const ENLIGHTENED_CLAUSE =
    "Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.";

const WORLDLY_TUTOR = oracleCard({
    name: "Worldly Tutor",
    manaCost: "{G}",
    typeLine: "Instant",
    oracleText: WORLDLY_CLAUSE,
});

const ENLIGHTENED_TUTOR = oracleCard({
    name: "Enlightened Tutor",
    manaCost: "{W}",
    typeLine: "Instant",
    oracleText: ENLIGHTENED_CLAUSE,
});

/** The effects the clause lowers to, with the binding named `bind`. */
function tutorToTopEffects(
    bind: string,
    filter: Record<string, unknown>,
    phrase: string
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
        { op: "reveal", player: "controller", cards: { ref: bind } },
        { op: "libraryLook", action: "shuffle", player: "controller" },
        {
            op: "moveZone",
            cards: { ref: bind },
            player: "controller",
            from: "library",
            to: "library-top",
        },
    ];
}

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

describe("Search library, reveal, shuffle, put on top — golden fixtures (CR 701.23a, CR 701.20a, CR 701.24a)", () => {
    it("spell slot, one type: Worldly Tutor", () => {
        expect(sortKeys(compiledDefinition(WORLDLY_TUTOR))).toEqual(
            sortKeys({
                name: "Worldly Tutor",
                types: ["Instant"],
                manaCost: { G: 1 },
                oracleText: WORLDLY_CLAUSE,
                effects: tutorToTopEffects(
                    "$found1",
                    { type: "Creature" },
                    "a creature card"
                ),
            })
        );
    });

    it("spell slot, two types: Enlightened Tutor", () => {
        expect(sortKeys(compiledDefinition(ENLIGHTENED_TUTOR))).toEqual(
            sortKeys({
                name: "Enlightened Tutor",
                types: ["Instant"],
                manaCost: { W: 1 },
                oracleText: ENLIGHTENED_CLAUSE,
                effects: tutorToTopEffects(
                    "$found1",
                    { type: ["Artifact", "Enchantment"] },
                    "an artifact or enchantment card"
                ),
            })
        );
    });

    it("activated slot: the clause behind a mana + sacrifice cost", () => {
        const clause =
            "Search your library for an enchantment card, reveal it, then shuffle and put that card on top.";
        const definition = compiledDefinition(
            oracleCard({
                name: "Sterling Grove",
                manaCost: "{G}{W}",
                typeLine: "Enchantment",
                oracleText: `{1}, Sacrifice this enchantment: ${clause}`,
            })
        );
        expect(definition.activatedAbilities?.[0]?.effects).toEqual(
            tutorToTopEffects(
                "$found1",
                { type: "Enchantment" },
                "an enchantment card"
            )
        );
    });

    it("reaches ready — no card-dependent smoke skip withholds it", () => {
        expect(compileCard(WORLDLY_TUTOR).state).toBe("ready");
        expect(compileCard(ENLIGHTENED_TUTOR).state).toBe("ready");
    });
});

describe("Search library, reveal, shuffle, put on top — refusals (fail-closed)", () => {
    const refused = (oracleText: string) =>
        compileCard(
            oracleCard({
                name: "Worldly Tutor",
                manaCost: "{G}",
                typeLine: "Instant",
                oracleText,
            })
        ).state;

    it("the to-hand route is not the to-top route", () => {
        expect(
            refused(
                "Search your library for a creature card, reveal it, put it into your hand, then shuffle."
            )
        ).toBe("unparsed");
    });

    it("a description outside the closed table searches nothing", () => {
        expect(
            refused(
                "Search your library for a land card, reveal it, then shuffle and put that card on top."
            )
        ).toBe("unparsed");
    });

    it("a pronoun no card prints with the description has no row", () => {
        expect(
            refused(
                "Search your library for a creature card, reveal it, then shuffle and put that card on top."
            )
        ).toBe("unparsed");
    });

    it("put on top WITHOUT the shuffle is a different clause", () => {
        expect(
            refused(
                "Search your library for a creature card, reveal it, then put the card on top."
            )
        ).toBe("unparsed");
    });
});

describe("Search library, reveal, shuffle, put on top — lowering invariants", () => {
    const ops = () =>
        (compiledDefinition(WORLDLY_TUTOR).effects ?? []).map(
            (effect) => effect.op
        );

    it("reveals while the card is still in the library, shuffles BEFORE placing", () => {
        expect(ops()).toEqual(["choice", "reveal", "libraryLook", "moveZone"]);
    });

    it("the find is optional (CR 701.23b)", () => {
        const choice = compiledDefinition(WORLDLY_TUTOR).effects?.[0] as {
            count: { min: number; max: number };
        };
        expect(choice.count).toEqual({ min: 0, max: 1 });
    });
});
