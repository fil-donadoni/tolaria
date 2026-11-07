import { describe, it, expect } from "vitest";
import {
    projectComboCorpus,
    serializeComboCorpus,
    type SpellbookUse,
    type SpellbookVariant,
} from "../lib/combo-corpus";
import { parseImportArgs } from "../combos-import";

/** ADR 0164 § 1, issue #8416: the rules projecting the export onto the catalogue. */

const CATALOGUE = new Set([
    "oracle-a",
    "oracle-b",
    "oracle-c",
    "oracle-d",
    "oracle-e",
]);

function spellbookUse(
    oracleId: string | null,
    over: Partial<SpellbookUse> = {}
): SpellbookUse {
    return {
        card: { name: `Card ${oracleId}`, oracleId },
        zoneLocations: ["B"],
        battlefieldCardState: "",
        exileCardState: "",
        libraryCardState: "",
        graveyardCardState: "",
        mustBeCommander: false,
        quantity: 1,
        usedFace: null,
        ...over,
    };
}

function variant(
    id: string,
    over: Partial<SpellbookVariant> = {}
): SpellbookVariant {
    return {
        id,
        status: "OK",
        uses: [spellbookUse("oracle-a"), spellbookUse("oracle-b")],
        requires: [],
        produces: [{ feature: { name: "Infinite mana" } }],
        identity: "UB",
        manaNeeded: "{2}{U}",
        manaValueNeeded: 3,
        easyPrerequisites: "easy",
        notablePrerequisites: "notable",
        description: "steps",
        popularity: 7,
        ...over,
    };
}

const FIVE_PIECES = [
    "oracle-a",
    "oracle-b",
    "oracle-c",
    "oracle-d",
    "oracle-e",
].map((id) => spellbookUse(id));

describe("projectComboCorpus (ADR 0164 § 1)", () => {
    it("keeps exactly the valid variant and counts each drop under its reason", () => {
        const { combos, counts } = projectComboCorpus(
            [
                variant("template", { requires: [{ template: { id: 1 } }] }),
                variant("five", { uses: FIVE_PIECES }),
                variant("outside", {
                    uses: [spellbookUse("oracle-a"), spellbookUse("oracle-z")],
                }),
                variant("valid"),
            ],
            CATALOGUE
        );
        expect(combos).toEqual([
            {
                id: "valid",
                pieces: [
                    {
                        name: "Card oracle-a",
                        oracleId: "oracle-a",
                        zones: ["B"],
                        quantity: 1,
                    },
                    {
                        name: "Card oracle-b",
                        oracleId: "oracle-b",
                        zones: ["B"],
                        quantity: 1,
                    },
                ],
                produces: ["Infinite mana"],
                manaNeeded: "{2}{U}",
                manaValueNeeded: 3,
                identity: "UB",
                popularity: 7,
                easyPrerequisites: "easy",
                notablePrerequisites: "notable",
                description: "steps",
            },
        ]);
        expect(counts).toEqual({
            upstream: 4,
            kept: 1,
            droppedByStatus: 0,
            droppedByCatalogue: 1,
            droppedByTemplate: 1,
            droppedByPieceCount: 1,
        });
    });

    it("drops a variant whose status is not OK", () => {
        const { combos, counts } = projectComboCorpus(
            [variant("excluded", { status: "E" })],
            CATALOGUE
        );
        expect(combos).toEqual([]);
        expect(counts.droppedByStatus).toBe(1);
    });

    it("drops a piece with no oracle id as outside the catalogue", () => {
        const { counts } = projectComboCorpus(
            [variant("no-id", { uses: [spellbookUse(null)] })],
            CATALOGUE
        );
        expect(counts.droppedByCatalogue).toBe(1);
    });

    it("keeps four pieces and counts copies toward the limit", () => {
        const { combos, counts } = projectComboCorpus(
            [
                variant("four", { uses: FIVE_PIECES.slice(0, 4) }),
                variant("copies", {
                    uses: [
                        spellbookUse("oracle-a", { quantity: 4 }),
                        spellbookUse("oracle-b"),
                    ],
                }),
            ],
            CATALOGUE
        );
        expect(combos.map((c) => c.id)).toEqual(["four"]);
        expect(counts.droppedByPieceCount).toBe(1);
    });

    it("keeps each piece's zones, quantity and required state, omitting the empty ones", () => {
        const { combos } = projectComboCorpus(
            [
                variant("state", {
                    uses: [
                        spellbookUse("oracle-a", {
                            zoneLocations: ["H", "B"],
                            quantity: 2,
                            battlefieldCardState: "tapped",
                            exileCardState: "with a counter",
                            libraryCardState: "on top",
                            graveyardCardState: "only card there",
                            mustBeCommander: true,
                            usedFace: 2,
                        }),
                        spellbookUse("oracle-b", {
                            exileCardState: "foretold",
                        }),
                    ],
                }),
            ],
            CATALOGUE
        );
        expect(combos[0]!.pieces).toEqual([
            {
                name: "Card oracle-a",
                oracleId: "oracle-a",
                zones: ["H", "B"],
                quantity: 2,
                state: {
                    battlefield: "tapped",
                    exile: "with a counter",
                    library: "on top",
                    graveyard: "only card there",
                    mustBeCommander: true,
                    usedFace: 2,
                },
            },
            {
                name: "Card oracle-b",
                oracleId: "oracle-b",
                zones: ["B"],
                quantity: 1,
                state: { exile: "foretold" },
            },
        ]);
    });

    it("sorts by id in code-unit order, whatever the export's order", () => {
        const { combos } = projectComboCorpus(
            [variant("20-3"), variant("100-3"), variant("3-3")],
            CATALOGUE
        );
        expect(combos.map((c) => c.id)).toEqual(["100-3", "20-3", "3-3"]);
    });
});

describe("serializeComboCorpus", () => {
    const source = {
        name: "Commander Spellbook",
        site: "https://site",
        export: "https://export",
        exportTimestamp: "t",
        exportVersion: "v",
    };

    it("writes one combo per line, and the result parses back whole", () => {
        const projection = projectComboCorpus(
            [variant("a"), variant("b")],
            CATALOGUE
        );
        const text = serializeComboCorpus(source, projection);
        const rows = text
            .split("\n")
            .filter((line) => line.startsWith('        {"id"'));
        expect(rows).toHaveLength(2);
        expect(JSON.parse(text)).toEqual({
            source,
            counts: projection.counts,
            combos: projection.combos,
        });
    });
});

describe("parseImportArgs", () => {
    it("downloads by default and reads a local copy by flag", () => {
        expect(parseImportArgs([])).toEqual({ from: null });
        expect(parseImportArgs(["--from", "/tmp/v.json"])).toEqual({
            from: "/tmp/v.json",
        });
    });

    it("refuses anything else", () => {
        expect(() => parseImportArgs(["--from"])).toThrow(/usage/);
        expect(() => parseImportArgs(["--refresh"])).toThrow(/usage/);
    });
});
