// The Manual Board's battlefield row classifier (`makeManualRowClassifier`).
//
// Two decisions, both of which the GRE board derives from a hydrated
// `CardDefinition` and a Manual Game cannot: which BAND a permanent sits in
// (creatures forward / everything else back) and, within the back band, which
// COLUMN (the GRE board puts lands flush-left, other noncreatures
// flush-right).
//
// The catalogue type line answers both — when it resolves. It often does not:
// the asset keeps ONE representative printing per card while a Tabletop deck
// may hold any Scryfall printing, so a large share of the ids in play miss it
// and the back row sorted itself half-right, which is what the player sees as
// "these are all lands, why are they in two columns". Hence the precedence
// pinned below: what the PLAYER said (lane, backColumn) always beats the
// guess.
import { describe, expect, it } from "vitest";
import type { ProjectedManualCard } from "@convex/manual";
import type { CardInstance } from "~/types/game";
import type { FullCatalogueRow } from "~/lib/fullCatalogue";
import { makeCatalogueRowLookup } from "~/lib/manual-band";
import { makeManualRowClassifier } from "~/lib/manual-row-classifier";
import { manualCard } from "./manual-test-fixtures";

const BEAR_PRINT = "11111111-1111-1111-1111-111111111111";
const FOREST_PRINT = "22222222-2222-2222-2222-222222222222";
const UNCENSUSED_PRINT = "99999999-9999-9999-9999-999999999999";

function row(overrides: Partial<FullCatalogueRow>): FullCatalogueRow {
    return {
        name: "Grizzly Bears",
        printId: BEAR_PRINT,
        typeLine: "Creature — Bear",
        manaCost: "{1}{G}",
        cmc: 2,
        colourIdentity: "G",
        set: "lea",
        rarity: "common",
        nameFold: "grizzly bears",
        available: true,
        ...overrides,
    };
}

const lookupRow = makeCatalogueRowLookup([
    row({}),
    row({
        name: "Forest",
        printId: FOREST_PRINT,
        typeLine: "Basic Land — Forest",
        manaCost: "",
        cmc: 0,
        nameFold: "forest",
    }),
]);

/** Builds the classifier over one card, and the board-shaped view of it the
 *  shared battlefield actually passes in (`CardInstance`, which names none of
 *  the manual-only fields). */
function classify(card: ProjectedManualCard) {
    const classifier = makeManualRowClassifier(
        new Map([[card.id, card]]),
        lookupRow
    );
    const boardCard = card as unknown as CardInstance;
    return {
        band: classifier.bandOf(boardCard),
        rank: classifier.backRowRank!(boardCard),
    };
}

describe("makeManualRowClassifier", () => {
    it("puts a catalogue-resolvable creature forward and a land in the back row's left column", () => {
        expect(
            classify(manualCard("c", { card: { id: BEAR_PRINT } })).band
        ).toBe("creatures");
        const forest = classify(
            manualCard("f", { card: { id: FOREST_PRINT } })
        );
        expect(forest.band).toBe("back");
        expect(forest.rank).toBe(0);
    });

    it("an explicit backColumn beats the catalogue guess, both ways round", () => {
        // A land the player dragged right stays right…
        expect(
            classify(
                manualCard("f", {
                    card: { id: FOREST_PRINT },
                    backColumn: "right",
                })
            ).rank
        ).toBe(1);
        // …and a non-land dragged left stays left.
        expect(
            classify(
                manualCard("c", {
                    card: { id: BEAR_PRINT },
                    lane: "main",
                    backColumn: "left",
                })
            ).rank
        ).toBe(0);
    });

    it("resolves an un-censused printing by NAME — the case that made the row look arbitrary", () => {
        const uncensused = manualCard("f", {
            card: { id: UNCENSUSED_PRINT },
            name: "Forest",
        });
        expect(classify(uncensused).band).toBe("back");
        expect(classify(uncensused).rank).toBe(0);
    });

    it("a card it cannot resolve at all ranks as 'other' — never masquerading as a land", () => {
        expect(
            classify(manualCard("x", { card: { id: UNCENSUSED_PRINT } })).rank
        ).toBe(1);
    });

    it("an explicit lane still beats every type inference", () => {
        expect(
            classify(
                manualCard("f", { card: { id: FOREST_PRINT }, lane: "combat" })
            ).band
        ).toBe("creatures");
        expect(
            classify(
                manualCard("c", { card: { id: BEAR_PRINT }, lane: "main" })
            ).band
        ).toBe("back");
    });
});
