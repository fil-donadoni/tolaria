// The kicked library search (issue #4591) — CR 702.33e + CR 701.23a: "Search
// your library for <a card>, put it <somewhere>, then shuffle. If this spell
// was kicked, instead search your library for <more cards>, put them <there>,
// then shuffle." The leading "instead" is the same replacement as the trailing
// one, read at the spell site for a search of the controller's own library
// alone; the pair folds into one `replace-if-kicked`, lowered to an `if` whose
// kicked branch runs the larger search and whose `else` runs the base.
//
// Two layers: GOLDENS, one per printed card of the form (Primal Growth is the
// `GOLDEN_FIXTURES` row that clears the kicker-count `if`/`else` smoke skip,
// asserted here to reach `ready`), and REFUSALS, one per neighbour the rule
// must not read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const GROW_FROM_THE_ASHES_TEXT =
    "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nSearch your library for a basic land card, put it onto the battlefield, then shuffle. If this spell was kicked, instead search your library for two basic land cards, put them onto the battlefield, then shuffle.";

const GROW_FROM_THE_ASHES: OracleCard = {
    oracleId: "645ab3c7-ee1d-4dd0-811f-2dc7f7c7e792",
    name: "Grow from the Ashes",
    manaCost: "{2}{G}",
    typeLine: "Sorcery",
    oracleText: GROW_FROM_THE_ASHES_TEXT,
    layout: "normal",
};

const BASIC_LAND = { type: "Land", supertype: "Basic" } as const;

/** The three Ops of "search your library for <phrase>, put <it> onto the
 *  battlefield, then shuffle". */
function searchOntoBattlefield(phrase: string, max: number, bind: string) {
    return [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: BASIC_LAND,
            count: { min: 0, max },
            prompt: `Search your library for ${phrase}.`,
            bind,
        },
        {
            op: "moveZone",
            cards: { ref: bind },
            player: "controller",
            from: "library",
            to: "battlefield",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ];
}

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** A probe whose Oracle text is exactly `oracleText` — a neighbour form, so
 *  the refusal is pinned by a synthetic line. */
function probe(oracleText: string) {
    return oracleCard({
        name: "Refusal Probe",
        manaCost: "{2}{G}",
        typeLine: "Sorcery",
        oracleText,
    });
}

describe("kicked library search — goldens (CR 702.33e, CR 701.23a)", () => {
    it("Grow from the Ashes: a mana kicker swaps one basic land for two", () => {
        expect(sortKeys(compiled(GROW_FROM_THE_ASHES))).toEqual(
            sortKeys({
                name: "Grow from the Ashes",
                types: ["Sorcery"],
                manaCost: { X: 2, G: 1 },
                oracleText: GROW_FROM_THE_ASHES_TEXT,
                kickers: [
                    {
                        id: "kicker",
                        description: "Kicker {2}",
                        mana: { X: 2 },
                    },
                ],
                effects: [
                    {
                        op: "if",
                        predicate: {
                            left: { kickerCount: true },
                            op: "ge",
                            right: 1,
                        },
                        then: searchOntoBattlefield(
                            "two basic land cards",
                            2,
                            "$found2"
                        ),
                        else: searchOntoBattlefield(
                            "a basic land card",
                            1,
                            "$found1"
                        ),
                    },
                ],
            })
        );
        expect(compileCard(GROW_FROM_THE_ASHES).state).toBe("ready");
    });

    it("Primal Growth (GOLDEN_FIXTURES): a sacrifice kicker, 'up to two', reaches ready", () => {
        const row = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Primal Growth"
        );
        if (row === undefined)
            throw new Error("no golden fixture for Primal Growth");
        expect(row.rule).toBe("kicked instead");
        expect(sortKeys(compiled(row.card))).toEqual(sortKeys(row.expected));
        expect(compileCard(row.card).state).toBe("ready");
    });
});

describe("kicked library search — refusals stay fail-closed", () => {
    const refused: readonly [string, string][] = [
        [
            "a leading 'instead' is read for a library search only",
            "Kicker {2}\nDestroy all artifacts. If this spell was kicked, instead destroy all creatures.",
        ],
        [
            "another player's library is not the controller's own search (Sadistic Sacrament)",
            "Kicker {7}\nSearch target player's library for up to three cards, exile them, then that player shuffles. If this spell was kicked, instead search that player's library for up to fifteen cards, exile them, then that player shuffles.",
        ],
        [
            "the kicked find put into a different zone is another form",
            "Kicker {2}\nSearch your library for a basic land card, put it onto the battlefield, then shuffle. If this spell was kicked, instead search your library for two basic land cards, put them into your hand, then shuffle.",
        ],
        [
            "the kicked find put onto the battlefield tapped is another form",
            "Kicker {2}\nSearch your library for a basic land card, put it onto the battlefield, then shuffle. If this spell was kicked, instead search your library for two basic land cards, put them onto the battlefield tapped, then shuffle.",
        ],
        [
            "a search the kicked sentence does not finish is not a replacement (Aang's Journey)",
            "Kicker {2}\nSearch your library for a basic land card. If this spell was kicked, instead search your library for a basic land card and a Shrine card. Reveal those cards, put them into your hand, then shuffle.\nYou gain 2 life.",
        ],
    ];
    for (const [why, text] of refused) {
        it(why, () => {
            expect(compileCard(probe(text)).state).toBe("unparsed");
        });
    }
});
