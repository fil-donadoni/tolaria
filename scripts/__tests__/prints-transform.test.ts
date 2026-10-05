// The pure sync transform (ADR 0140, issue #4116): every rule that decides
// whether a Scryfall `default_cards` row becomes a `cardPrints` row, and how.

import { describe, expect, it } from "vitest";
import {
    buildCardPrintRow,
    buildCardPrintRows,
    buildDefinitionIndex,
    buildDefinitionTokenRow,
    summarizePrintRows,
    type ScryfallDefaultCardRow,
} from "../lib/prints-transform";
import { resolveRarity, type RarityOverridesFile } from "../lib/prints-rarity";

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

    it("takes 'token'-component all_parts entries, as {name, tokenPrintId}, and ignores other components", () => {
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
                        name: "Some Other Piece",
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

    // CR 725 — the Monarch is a token-layout card Scryfall tags `combo_piece`.
    // A card that grants it carries its set-themed marker like a token does
    // (issue #1305), so the name-gated designation markers are kept.
    it("keeps a state-designation marker (The Monarch) tagged combo_piece", () => {
        const built = buildCardPrintRow(
            row({
                id: "p1",
                all_parts: [
                    {
                        id: "monarch-marker-id",
                        name: "The Monarch",
                        component: "combo_piece",
                    },
                ],
            }),
            definitionByOracleId,
            NO_OVERRIDES
        );
        expect(built?.tokenPrints).toEqual([
            { name: "The Monarch", tokenPrintId: "monarch-marker-id" },
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

describe("buildDefinitionTokenRow — the definition printing's Token Prints (issue #4120)", () => {
    const definitionByOracleId = buildDefinitionIndex([
        { oracleId: BIRDS_ORACLE, scryfallId: BIRDS_DEF_ID },
    ]);
    const wasp = [{ id: "wasp-id", name: "Wasp", component: "token" }];

    it("takes the printing whose id IS the Card ID when it links a token", () => {
        expect(
            buildDefinitionTokenRow(
                row({ id: BIRDS_DEF_ID, all_parts: wasp }),
                definitionByOracleId
            )
        ).toEqual({
            cardId: BIRDS_DEF_ID,
            tokenPrints: [{ name: "Wasp", tokenPrintId: "wasp-id" }],
        });
    });

    it("is null for any other printing — those are `cardPrints` rows", () => {
        expect(
            buildDefinitionTokenRow(
                row({ id: "reprint-id", all_parts: wasp }),
                definitionByOracleId
            )
        ).toBeNull();
    });

    it("is null when the definition printing links no token", () => {
        expect(
            buildDefinitionTokenRow(
                row({ id: BIRDS_DEF_ID, all_parts: undefined }),
                definitionByOracleId
            )
        ).toBeNull();
    });

    it("is null for an oversized card, an unknown oracle id or no oracle id", () => {
        expect(
            buildDefinitionTokenRow(
                row({ id: BIRDS_DEF_ID, all_parts: wasp, oversized: true }),
                definitionByOracleId
            )
        ).toBeNull();
        expect(
            buildDefinitionTokenRow(
                row({ id: BIRDS_DEF_ID, all_parts: wasp, oracle_id: "nope" }),
                definitionByOracleId
            )
        ).toBeNull();
        expect(
            buildDefinitionTokenRow(
                row({
                    id: BIRDS_DEF_ID,
                    all_parts: wasp,
                    oracle_id: undefined,
                }),
                definitionByOracleId
            )
        ).toBeNull();
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
