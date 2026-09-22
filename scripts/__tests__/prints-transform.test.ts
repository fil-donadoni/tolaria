// The pure sync transform (ADR 0140, issue #4116): every rule that decides
// whether a Scryfall `default_cards` row becomes a `cardPrints` row, and how.

import { describe, expect, it } from "vitest";
import {
    buildCardPrintRow,
    buildCardPrintRows,
    buildDefinitionIndex,
    summarizePrintRows,
    type ScryfallDefaultCardRow,
} from "../lib/prints-transform";
import { resolveRarity, type RarityOverridesFile } from "../lib/prints-rarity";
import {
    diffAgainstHandwritten,
    extractHandwrittenPrints,
} from "../lib/prints-handwritten";

const BIRDS_ORACLE = "0f2126c0-6c14-40b7-b502-8f74dc5b8a70";
const BIRDS_DEF_ID = "leb-birds-of-paradise-id";

const NO_OVERRIDES: RarityOverridesFile = {
    rarityFallback: { special: "rare", bonus: "mythic" },
    printOverrides: {},
};

function row(over: Partial<ScryfallDefaultCardRow>): ScryfallDefaultCardRow {
    return {
        id: "print-id",
        oracle_id: BIRDS_ORACLE,
        set: "4ed",
        rarity: "uncommon",
        digital: false,
        promo: false,
        ...over,
    };
}

describe("buildDefinitionIndex (ADR 0140 §2 — twins never enter the input)", () => {
    it("maps oracle id to Card ID", () => {
        const index = buildDefinitionIndex([
            { oracleId: BIRDS_ORACLE, scryfallId: BIRDS_DEF_ID },
        ]);
        expect(index.get(BIRDS_ORACLE)).toBe(BIRDS_DEF_ID);
    });

    it("drops a card-index row whose id is a registered twin (contains '#')", () => {
        const index = buildDefinitionIndex([
            { oracleId: "room-oracle", scryfallId: "parent-id#left" },
        ]);
        expect(index.has("room-oracle")).toBe(false);
    });
});

describe("buildCardPrintRow — inclusion", () => {
    const definitionByOracleId = buildDefinitionIndex([
        { oracleId: BIRDS_ORACLE, scryfallId: BIRDS_DEF_ID },
    ]);

    it("includes a printing of an implemented oracle id", () => {
        const built = buildCardPrintRow(
            row({ id: "4ed-print-id" }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(built).toEqual({
            printId: "4ed-print-id",
            cardId: BIRDS_DEF_ID,
            set: "4ed",
            rarity: "uncommon",
            digital: false,
            promo: false,
            tokenPrints: [],
        });
    });

    it("excludes a printing with no oracle id at all", () => {
        const built = buildCardPrintRow(
            row({ id: "no-oracle", oracle_id: undefined }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(built).toBeNull();
    });

    it("excludes a printing whose oracle id has no Card Definition", () => {
        const built = buildCardPrintRow(
            row({ id: "unimplemented", oracle_id: "not-in-our-catalogue" }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(built).toBeNull();
    });

    it("excludes an oversized card", () => {
        const built = buildCardPrintRow(
            row({ id: "big-furry-monster", oversized: true }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(built).toBeNull();
    });

    it("skips the printing whose id IS the Card ID — that is the definition, not a print of it", () => {
        const built = buildCardPrintRow(
            row({ id: BIRDS_DEF_ID }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(built).toBeNull();
    });
});

describe("buildCardPrintRow — flags", () => {
    const definitionByOracleId = buildDefinitionIndex([
        { oracleId: BIRDS_ORACLE, scryfallId: BIRDS_DEF_ID },
    ]);

    it("carries digital and promo through as booleans, defaulting absent to false", () => {
        const digitalPromo = buildCardPrintRow(
            row({ id: "p1", digital: true, promo: true }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(digitalPromo).toMatchObject({ digital: true, promo: true });

        const bare = buildCardPrintRow(
            row({ id: "p2", digital: undefined, promo: undefined }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(bare).toMatchObject({ digital: false, promo: false });
    });
});

describe("buildCardPrintRow — token link + fallback", () => {
    const definitionByOracleId = buildDefinitionIndex([
        { oracleId: BIRDS_ORACLE, scryfallId: BIRDS_DEF_ID },
    ]);

    it("takes only 'token'-component all_parts entries, as {name, tokenPrintId}", () => {
        const built = buildCardPrintRow(
            row({
                id: "p1",
                all_parts: [
                    {
                        id: "self-id",
                        name: "Birds of Paradise",
                        component: "self",
                    },
                    { id: "token-id", name: "Elemental", component: "token" },
                    {
                        id: "combo-id",
                        name: "The Monarch",
                        component: "combo_piece",
                    },
                ],
            }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(built?.tokenPrints).toEqual([
            { name: "Elemental", tokenPrintId: "token-id" },
        ]);
    });

    it("carries whichever token Scryfall paired THIS printing with — a foreign-edition fallback is not recomputed here", () => {
        // M14 -> a same-set token; a hypothetical reprint with no own-set
        // token gets whatever Scryfall's `all_parts` names for THAT row —
        // the transform trusts the row, it does not choose between editions.
        const built = buildCardPrintRow(
            row({
                id: "p1",
                all_parts: [
                    {
                        id: "foreign-token-id",
                        name: "Wasp",
                        component: "token",
                    },
                ],
            }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(built?.tokenPrints).toEqual([
            { name: "Wasp", tokenPrintId: "foreign-token-id" },
        ]);
    });

    it("is empty when all_parts is absent", () => {
        const built = buildCardPrintRow(
            row({ id: "p1", all_parts: undefined }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(built?.tokenPrints).toEqual([]);
    });
});

describe("resolveRarity — override", () => {
    it("passes a modelled rarity through unchanged", () => {
        expect(resolveRarity("p1", "rare", NO_OVERRIDES)).toBe("rare");
    });

    it("maps an unmodelled Scryfall rarity via the reviewed rarityFallback rule", () => {
        expect(resolveRarity("p1", "special", NO_OVERRIDES)).toBe("rare");
        expect(resolveRarity("p1", "bonus", NO_OVERRIDES)).toBe("mythic");
    });

    it("throws on an unmodelled rarity with no fallback entry — never guesses", () => {
        const empty: RarityOverridesFile = {
            rarityFallback: {},
            printOverrides: {},
        };
        expect(() => resolveRarity("p1", "special", empty)).toThrow(/p1/);
    });

    it("a printOverrides entry wins over both the raw value and the fallback rule", () => {
        const overridden: RarityOverridesFile = {
            rarityFallback: { special: "rare" },
            printOverrides: { "print-x": "mythic" },
        };
        expect(resolveRarity("print-x", "common", overridden)).toBe("mythic");
        expect(resolveRarity("print-x", "special", overridden)).toBe("mythic");
    });
});

describe("buildCardPrintRows — batch", () => {
    it("keeps only the rows that pass every inclusion rule", () => {
        const definitionByOracleId = buildDefinitionIndex([
            { oracleId: BIRDS_ORACLE, scryfallId: BIRDS_DEF_ID },
        ]);
        const rows = buildCardPrintRows(
            [
                row({ id: "p1" }),
                row({ id: "unimplemented", oracle_id: "unknown" }),
                row({ id: BIRDS_DEF_ID }),
                row({ id: "oversized", oversized: true }),
            ],
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(rows.map((r) => r.printId)).toEqual(["p1"]);
    });
});

describe("summarizePrintRows", () => {
    it("counts rows, token links across all rows, and total serialized bytes", () => {
        const definitionByOracleId = buildDefinitionIndex([
            { oracleId: BIRDS_ORACLE, scryfallId: BIRDS_DEF_ID },
        ]);
        const rows = buildCardPrintRows(
            [
                row({
                    id: "p1",
                    all_parts: [
                        { id: "t1", name: "Elemental", component: "token" },
                        { id: "t2", name: "Elemental", component: "token" },
                    ],
                }),
                row({ id: "p2" }),
            ],
            definitionByOracleId,
            NO_OVERRIDES
        );
        const summary = summarizePrintRows(rows);
        expect(summary.rowCount).toBe(2);
        expect(summary.tokenLinkCount).toBe(2);
        expect(summary.totalBytes).toBe(
            Buffer.byteLength(JSON.stringify(rows[0]), "utf8") +
                Buffer.byteLength(JSON.stringify(rows[1]), "utf8")
        );
    });
});

describe("extractHandwrittenPrints", () => {
    it("reads printId/definitionId/setCode/rarity regardless of field order", () => {
        const source = `
import type { CardPrint } from "../../types";

export const birdsOfParadise4ed: CardPrint = {
    printId: "e5cfaefb-764c-4c56-bdb3-5f0375168597",
    definitionId: "${BIRDS_DEF_ID}",
    setCode: "4ed",
    rarity: "uncommon",
};

export const reordered: CardPrint = {
    rarity: "rare",
    setCode: "leb",
    definitionId: "${BIRDS_DEF_ID}",
    printId: "reordered-print-id",
};
`;
        const found = extractHandwrittenPrints(source, "fixture.ts");
        expect(found).toEqual([
            {
                printId: "e5cfaefb-764c-4c56-bdb3-5f0375168597",
                definitionId: BIRDS_DEF_ID,
                setCode: "4ed",
                rarity: "uncommon",
                file: "fixture.ts",
            },
            {
                printId: "reordered-print-id",
                definitionId: BIRDS_DEF_ID,
                setCode: "leb",
                rarity: "rare",
                file: "fixture.ts",
            },
        ]);
    });

    it("resolves a Unicode const name (Arabian Nights: elHajjâj, junúnEfreet)", () => {
        const source = `
export const elHajjâj3ed: CardPrint = {
    printId: "unicode-print-id",
    definitionId: "${BIRDS_DEF_ID}",
    setCode: "3ed",
    rarity: "rare",
};
`;
        expect(extractHandwrittenPrints(source, "fixture.ts")).toEqual([
            {
                printId: "unicode-print-id",
                definitionId: BIRDS_DEF_ID,
                setCode: "3ed",
                rarity: "rare",
                file: "fixture.ts",
            },
        ]);
    });

    it("never reads a commented-out stub as a live record (ADR 0010 ante exclusions)", () => {
        const source = `
// Out of scope — see ADR 0010 (ante; game mode not modelled).
// export const contractFromBelowLeb: CardPrint = {
//     printId: "62f96e43-aebd-4de2-969a-37cd1d62f127",
//     definitionId: "9853b0ce-4763-4877-9741-f9145a3659c6",
//     setCode: "leb",
// };

export const cursedLandLeb: CardPrint = {
    printId: "live-print-id",
    definitionId: "${BIRDS_DEF_ID}",
    setCode: "leb",
    rarity: "uncommon",
};
`;
        const found = extractHandwrittenPrints(source, "fixture.ts");
        expect(found).toHaveLength(1);
        expect(found[0].printId).toBe("live-print-id");
    });

    it("resolves definitionId through a multi-art reference chain: `otherCard.id` -> a hoisted `const FOO_ID` (FEM b/c/d prints)", () => {
        const source = `
const INITIATES_EBON_HAND_ID = "5be87527-3b8f-4529-afdb-a61ad4e787e1";

export const initiatesOfTheEbonHand: CardDefinition = {
    id: INITIATES_EBON_HAND_ID,
    rarity: "common",
    name: "Initiates of the Ebon Hand",
    activatedAbilities: [
        {
            id: "initiates-ebon-hand-mana",
            oracleText: "irrelevant",
        },
    ],
};

export const initiatesOfTheEbonHandFemB: CardPrint = {
    printId: "fem-b-print-id",
    definitionId: initiatesOfTheEbonHand.id,
    setCode: "fem",
    rarity: "common",
};
`;
        const found = extractHandwrittenPrints(source, "fixture.ts");
        expect(found).toEqual([
            {
                printId: "fem-b-print-id",
                definitionId: "5be87527-3b8f-4529-afdb-a61ad4e787e1",
                setCode: "fem",
                rarity: "common",
                file: "fixture.ts",
            },
        ]);
    });
});

describe("diffAgainstHandwritten — equivalence", () => {
    it("reports no differences when hand-written and generated agree", () => {
        const handwritten = [
            {
                printId: "p1",
                definitionId: "def-1",
                setCode: "4ed",
                rarity: "uncommon",
                file: "f.ts",
            },
        ];
        const generated = new Map([
            ["p1", { cardId: "def-1", set: "4ed", rarity: "uncommon" }],
        ]);
        expect(
            diffAgainstHandwritten(handwritten, generated, new Set())
        ).toEqual([]);
    });

    it("reports a cardId/set mismatch even when a rarity override exists for that printId", () => {
        const handwritten = [
            {
                printId: "p1",
                definitionId: "def-1",
                setCode: "4ed",
                rarity: "uncommon",
                file: "f.ts",
            },
        ];
        const generated = new Map([
            ["p1", { cardId: "def-WRONG", set: "leb", rarity: "uncommon" }],
        ]);
        const diffs = diffAgainstHandwritten(
            handwritten,
            generated,
            new Set(["p1"])
        );
        expect(diffs.map((d) => d.field).sort()).toEqual(["cardId", "set"]);
    });

    it("reports an uncovered rarity mismatch", () => {
        const handwritten = [
            {
                printId: "p1",
                definitionId: "def-1",
                setCode: "4ed",
                rarity: "uncommon",
                file: "f.ts",
            },
        ];
        const generated = new Map([
            ["p1", { cardId: "def-1", set: "4ed", rarity: "rare" }],
        ]);
        const diffs = diffAgainstHandwritten(handwritten, generated, new Set());
        expect(diffs).toEqual([
            {
                printId: "p1",
                field: "rarity",
                file: "f.ts",
                handwritten: "uncommon",
                generated: "rare",
            },
        ]);
    });

    it("does NOT report a rarity mismatch the override file covers for that printId", () => {
        const handwritten = [
            {
                printId: "p1",
                definitionId: "def-1",
                setCode: "4ed",
                rarity: "uncommon",
                file: "f.ts",
            },
        ];
        const generated = new Map([
            ["p1", { cardId: "def-1", set: "4ed", rarity: "rare" }],
        ]);
        const diffs = diffAgainstHandwritten(
            handwritten,
            generated,
            new Set(["p1"])
        );
        expect(diffs).toEqual([]);
    });

    it("reports a hand-written record with no generated row at all", () => {
        const handwritten = [
            {
                printId: "p1",
                definitionId: "def-1",
                setCode: "4ed",
                rarity: "uncommon",
                file: "f.ts",
            },
        ];
        const diffs = diffAgainstHandwritten(handwritten, new Map(), new Set());
        expect(diffs).toEqual([
            {
                printId: "p1",
                field: "missing",
                file: "f.ts",
                handwritten: "def-1",
            },
        ]);
    });
});
