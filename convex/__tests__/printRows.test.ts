// Card Prints (ADR 0140, issue #4118): format validation and Limited metadata
// resolve a printing through `cardPrints` TABLE ROWS, not the hand-written
// print alias. Every print id below is synthetic — unknown to the alias — so a
// verdict that follows the row can only have come from the injected resolver.
// Rarity is a printed characteristic (CR 206.2): the row, not the definition,
// is the authority on the CHOSEN printing's Set and Rarity.
import { describe, expect, it } from "vitest";
import {
    checkAlpha40CopyCaps,
    checkSets,
    FORMAT_RULES,
    validateDeck,
} from "../formats";
import { tryGetCardByName } from "../cards";
import {
    indexPrintRows,
    makeResolveCardFromRows,
    makeResolveCardMetaFromRows,
    type PrintRow,
} from "../cards/printRows";
import { loadDeckPrintRows } from "../cardPrintRows";

const angel = tryGetCardByName("Serra Angel")!;
const bolt = tryGetCardByName("Lightning Bolt")!;

function row(
    printId: string,
    cardId: string,
    set: string,
    rarity: PrintRow["rarity"]
): PrintRow {
    return { printId, cardId, set, rarity };
}

function resolverOf(...rows: PrintRow[]) {
    return makeResolveCardFromRows(indexPrintRows(rows));
}

const deckOf = (printId: string, name: string, copies = 1) => ({
    cards: Array.from({ length: copies }, () => ({
        cardId: printId,
        cardName: name,
    })),
});

describe("Old School judges the chosen printing's Set (issue #4118)", () => {
    const meta = FORMAT_RULES["old-school"];

    it("accepts a printing whose row is in an allowed Set", () => {
        const resolve = resolverOf(row("p-ok", angel.id, "lea", "rare"));
        expect(checkSets(deckOf("p-ok", angel.name), meta, resolve)).toEqual(
            []
        );
    });

    it("rejects a printing whose row is in a non-allowed Set", () => {
        const resolve = resolverOf(row("p-bad", angel.id, "zzz", "rare"));
        const reasons = checkSets(deckOf("p-bad", angel.name), meta, resolve);
        expect(reasons.map((r) => r.code)).not.toEqual([]);
    });
});

describe("Alpha 40 caps copies by the chosen printing's Rarity (issue #4118)", () => {
    it("4 copies of a rare-row printing break the cap; the same card as a common-row printing does not", () => {
        const deck = deckOf("p-x", angel.name, 4);
        const asRare = resolverOf(row("p-x", angel.id, "lea", "rare"));
        const asCommon = resolverOf(row("p-x", angel.id, "lea", "common"));
        expect(checkAlpha40CopyCaps(deck, asRare).map((r) => r.code)).toEqual([
            "rarity-cap",
        ]);
        expect(checkAlpha40CopyCaps(deck, asCommon)).toEqual([]);
    });
});

describe("Premodern and Freeform ignore the printing (issue #4118)", () => {
    it("the verdict is the same for a row in any Set", () => {
        const deck = {
            ...deckOf("p-y", bolt.name, 1),
        };
        for (const format of ["premodern", "freeform"] as const) {
            const inSet = validateDeck(
                deck,
                format,
                resolverOf(row("p-y", bolt.id, "lea", "common"))
            );
            const outOfSet = validateDeck(
                deck,
                format,
                resolverOf(row("p-y", bolt.id, "zzz", "mythic"))
            );
            expect(outOfSet.reasons.map((r) => r.code).sort()).toEqual(
                inSet.reasons.map((r) => r.code).sort()
            );
        }
    });
});

describe("the resolver from rows (issue #4118)", () => {
    it("maps a print id to its definition with the row's Set and Rarity", () => {
        const meta = resolverOf(row("p-z", angel.id, "zzz", "mythic"))("p-z");
        expect(meta).toMatchObject({
            cardId: angel.id,
            name: angel.name,
            setCode: "zzz",
            rarity: "mythic",
        });
    });

    it("is null for a row whose Card Definition is gone", () => {
        expect(
            resolverOf(row("p-gone", "no-such-card", "lea", "rare"))("p-gone")
        ).toBeNull();
    });

    it("feeds the Limited engine's ResolveCardMeta from the same rows", () => {
        const resolveMeta = makeResolveCardMetaFromRows(
            indexPrintRows([row("p-l", angel.id, "lea", "rare")])
        );
        expect(resolveMeta("p-l")).toEqual({
            cardId: angel.id,
            cardName: angel.name,
        });
        expect(resolveMeta("unknown-id")).toBeNull();
    });
});

describe("loadDeckPrintRows reads by point lookup, skipping Card IDs (issue #4118)", () => {
    it("queries only non-definition ids, once each, via by_printId", async () => {
        const seen: string[] = [];
        const ctx = {
            db: {
                query: () => ({
                    withIndex: (
                        index: string,
                        build: (q: {
                            eq: (f: string, v: string) => string;
                        }) => string
                    ) => {
                        expect(index).toBe("by_printId");
                        const printId = build({ eq: (_f, v) => v });
                        seen.push(printId);
                        return {
                            unique: async () =>
                                printId === "p-db"
                                    ? {
                                          printId,
                                          cardId: angel.id,
                                          set: "lea",
                                          rarity: "rare",
                                      }
                                    : null,
                        };
                    },
                }),
            },
        };
        const index = await loadDeckPrintRows(ctx as never, {
            cards: [
                { cardId: angel.id },
                { cardId: "p-db" },
                { cardId: "p-db" },
            ],
            sideboard: [{ cardId: "p-missing" }],
        });
        expect(seen.sort()).toEqual(["p-db", "p-missing"]);
        expect(index.get("p-db")?.set).toBe("lea");
        expect(index.has("p-missing")).toBe(false);
    });
});
