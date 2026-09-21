// "Search your library for a basic land card, reveal it, put it into your
// hand, then shuffle." (CR 701.23a, CR 701.20a, CR 701.24a, issue #4305).
//
// Three layers:
//
//  1. The GOLDEN fixture — the one accepted form, compiled whole off a real
//     corpus card (Lay of the Land, the enforced-Target card the gap held)
//     and compared against the entire Compiled Definition. The same card is a
//     `GOLDEN_FIXTURES` row: the clause's three card-dependent smoke skips (a
//     runtime-sized choice, a reveal reading a binding, a zone change the
//     canned generator does not model) are what withheld it from `ready`, and
//     that row is what clears them for every corpus card printing this form.
//  2. REFUSALS — the neighbours this rule does not read: the battlefield
//     route, the "reveal that card" wording, the disjunctive description, and
//     the may-gated search. Each is its own gap, and stays one.
//  3. The lowering invariants: the reveal happens while the card is still in
//     the library, the find is optional (CR 701.23b), and the shuffle is last.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./fixtures";

const CLAUSE =
    "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.";

const LAY_OF_THE_LAND = oracleCard({
    name: "Lay of the Land",
    manaCost: "{G}",
    typeLine: "Sorcery",
    oracleText: CLAUSE,
});

/** The effects the clause lowers to, with the binding named `bind`. */
function tutorEffects(bind: string) {
    return [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Land", supertype: "Basic" },
            count: { min: 0, max: 1 },
            prompt: "Search your library for a basic land card.",
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

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

describe("Search library, reveal, to hand — golden fixture (CR 701.23a, CR 701.20a, CR 701.24a)", () => {
    it("spell slot: Lay of the Land", () => {
        expect(sortKeys(compiledDefinition(LAY_OF_THE_LAND))).toEqual(
            sortKeys({
                name: "Lay of the Land",
                types: ["Sorcery"],
                manaCost: { G: 1 },
                oracleText: CLAUSE,
                effects: tutorEffects("$found1"),
            })
        );
    });

    it("the same card is the GOLDEN_FIXTURES row that clears the form", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (row) => row.card.name === "Lay of the Land"
        );
        expect(fixture?.expected.effects).toEqual(tutorEffects("$found1"));
    });

    it("reaches ready — the fixture clears every card-dependent skip", () => {
        expect(compileCard(LAY_OF_THE_LAND).state).toBe("ready");
    });
});

describe("Search library, reveal, to hand — refusals (fail-closed)", () => {
    const refused = (oracleText: string) =>
        compileCard(
            oracleCard({
                name: "Lay of the Land",
                manaCost: "{G}",
                typeLine: "Sorcery",
                oracleText,
            })
        ).state;

    it("the battlefield route is not the hand route", () => {
        expect(
            refused(
                "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."
            )
        ).toBe("unparsed");
    });

    it('"reveal that card" is a wording this rule does not read', () => {
        expect(
            refused(
                "Search your library for a basic land card, reveal that card, put it into your hand, then shuffle."
            )
        ).toBe("unparsed");
    });

    it("a description outside the closed vocabulary searches nothing", () => {
        expect(
            refused(
                "Search your library for a basic land card or Gate card, reveal it, put it into your hand, then shuffle."
            )
        ).toBe("unparsed");
        expect(
            refused(
                "Search your library for a creature card, reveal it, put it into your hand, then shuffle."
            )
        ).toBe("unparsed");
    });

    it("a may-gated search is a different sentence", () => {
        expect(
            refused(
                "You may search your library for a basic land card, reveal it, put it into your hand, then shuffle."
            )
        ).toBe("unparsed");
    });
});

describe("Search library, reveal, to hand — lowering invariants", () => {
    it("reveals before the move and shuffles last (CR 701.20a, CR 701.24a)", () => {
        const effects = compiledDefinition(LAY_OF_THE_LAND).effects;
        expect(effects?.map((effect) => effect.op)).toEqual([
            "choice",
            "reveal",
            "moveZone",
            "libraryLook",
        ]);
    });

    it("the find is optional — CR 701.23b", () => {
        const [choice] = compiledDefinition(LAY_OF_THE_LAND).effects ?? [];
        expect((choice as { count: unknown }).count).toEqual({
            min: 0,
            max: 1,
        });
    });

    it("every Op reads the binding the search wrote", () => {
        const effects = compiledDefinition(LAY_OF_THE_LAND).effects ?? [];
        const bind = (effects[0] as { bind: string }).bind;
        expect((effects[1] as { cards: { ref: string } }).cards.ref).toBe(bind);
        expect((effects[2] as { cards: { ref: string } }).cards.ref).toBe(bind);
    });
});
