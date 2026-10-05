import { describe, expect, it } from "vitest";
import {
    getAllSetCodes,
    resolveDeckCardMeta,
    withDefinitionId,
} from "../index";
import { earliestLegalPrintId, printingsWithHome } from "../printingList";
import { indexPrintRows, makeResolveCardFromRows } from "../printRows";

// Lightning Bolt: LEA original + LEB reprint. ids from sets/lea.ts & sets/leb.ts.
const LIGHTNING_BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const LIGHTNING_BOLT_LEB = "b5d3dcab-2260-479d-9ef6-dfb92d4f6061";
// Circle of Protection: Black — Beta-original CardDefinition (home set "leb").
const COP_BLACK_LEB_DEF = "fa47b4cd-8da4-4544-b011-ba92b7009203";
// Forest: one LEA definition, three LEB art variants.
const FOREST_LEA = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

// Card Prints (ADR 0140, issue #5106): the printing list is the `cardPrints`
// table's, composed with the definition's own printing by `printingsWithHome`.
// The rows below are the table's shape for each card (never the definition's
// own printing, which has no row).
const row = (printId: string, set: string) => ({ printId, set });

describe("printingsWithHome (deck builder editions)", () => {
    it("lists the original printing first with its home set code", () => {
        const printings = printingsWithHome(LIGHTNING_BOLT_LEA, [
            row(LIGHTNING_BOLT_LEB, "leb"),
        ]);
        expect(printings[0]).toEqual({
            printId: LIGHTNING_BOLT_LEA,
            setCode: "lea",
        });
    });

    it("includes reprints with their own set code", () => {
        const printings = printingsWithHome(LIGHTNING_BOLT_LEA, [
            row(LIGHTNING_BOLT_LEB, "leb"),
        ]);
        expect(printings).toContainEqual({
            printId: LIGHTNING_BOLT_LEB,
            setCode: "leb",
        });
    });

    it("reports the home set of a Beta-original definition as leb", () => {
        const printings = printingsWithHome(COP_BLACK_LEB_DEF, []);
        expect(printings[0]).toEqual({
            printId: COP_BLACK_LEB_DEF,
            setCode: "leb",
        });
    });

    it("keeps multiple same-set art variants as distinct printings", () => {
        const printings = printingsWithHome(FOREST_LEA, [
            row("forest-leb-1", "leb"),
            row("forest-leb-2", "leb"),
            row("forest-leb-3", "leb"),
        ]);
        const leb = printings.filter((p) => p.setCode === "leb");
        expect(leb.length).toBe(3);
        // Every variant has a unique print id.
        expect(new Set(leb.map((p) => p.printId)).size).toBe(3);
    });

    it("narrows by each printing's OWN set, dropping the home printing when its set is not allowed", () => {
        const printings = printingsWithHome(
            LIGHTNING_BOLT_LEA,
            [row(LIGHTNING_BOLT_LEB, "leb")],
            ["leb"]
        );
        expect(printings.map((p) => p.printId)).toEqual([LIGHTNING_BOLT_LEB]);
    });
});

describe("earliestLegalPrintId (decklist import, issue #5106)", () => {
    const order = ["leb", "lea"]; // leb is the earlier set in this Format

    it("takes the table row when its set ranks before the home set", () => {
        expect(
            earliestLegalPrintId(
                LIGHTNING_BOLT_LEA,
                order,
                row(LIGHTNING_BOLT_LEB, "leb")
            )
        ).toBe(LIGHTNING_BOLT_LEB);
    });

    it("keeps the definition's own printing on a tie or when it ranks first", () => {
        expect(
            earliestLegalPrintId(
                LIGHTNING_BOLT_LEA,
                ["lea", "leb"],
                row(LIGHTNING_BOLT_LEB, "leb")
            )
        ).toBe(LIGHTNING_BOLT_LEA);
        expect(
            earliestLegalPrintId(
                LIGHTNING_BOLT_LEA,
                ["lea"],
                row("same-set-reprint", "lea")
            )
        ).toBe(LIGHTNING_BOLT_LEA);
    });

    it("falls back to the definition's own printing when nothing is in the allowed sets", () => {
        expect(
            earliestLegalPrintId(LIGHTNING_BOLT_LEA, ["rtr"], undefined)
        ).toBe(LIGHTNING_BOLT_LEA);
    });
});

// Deck-construction metadata resolver (ADR 0036, issue #512) — the seam the
// Format validators key on for set membership / rarity / Basic exemption.
const LIGHTNING_BOLT_2ED = "ff1b8fc5-604a-4449-a73d-861e53642a70"; // 2ed reprint
const MOUNTAIN_LEA = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // Basic land
const BLACK_LOTUS_LEA = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // LEA rare

describe("resolveDeckCardMeta (deck legality metadata, ADR 0036)", () => {
    it("resolves an original definition id to its HOME set + definition rarity + canonical id", () => {
        const meta = resolveDeckCardMeta(LIGHTNING_BOLT_LEA);
        expect(meta).toEqual({
            cardId: LIGHTNING_BOLT_LEA,
            name: "Lightning Bolt", // issue #2695: the name-keyed legality join
            setCode: "lea",
            rarity: "common",
            isBasic: false,
        });
    });

    it("resolves a reprint print id to THAT printing's set and rarity (not the home set) through its table row (issue #5106)", () => {
        const resolve = makeResolveCardFromRows(
            indexPrintRows([
                {
                    printId: LIGHTNING_BOLT_LEB,
                    cardId: LIGHTNING_BOLT_LEA,
                    set: "leb",
                    rarity: "uncommon",
                },
                {
                    printId: LIGHTNING_BOLT_2ED,
                    cardId: LIGHTNING_BOLT_LEA,
                    set: "2ed",
                    rarity: "rare",
                },
            ])
        );
        expect(resolve(LIGHTNING_BOLT_LEB)).toMatchObject({
            setCode: "leb",
            rarity: "uncommon",
        });
        expect(resolve(LIGHTNING_BOLT_2ED)).toMatchObject({
            setCode: "2ed",
            rarity: "rare",
        });
    });

    it("maps every printing of a card to the SAME canonical Card ID (ADR 0036, copy-count budget)", () => {
        // The original and its LEB reprint differ in set but share one budget.
        const resolve = makeResolveCardFromRows(
            indexPrintRows([
                {
                    printId: LIGHTNING_BOLT_LEB,
                    cardId: LIGHTNING_BOLT_LEA,
                    set: "leb",
                    rarity: "common",
                },
            ])
        );
        const original = resolveDeckCardMeta(LIGHTNING_BOLT_LEA);
        const reprint = resolve(LIGHTNING_BOLT_LEB);
        expect(original?.cardId).toBe(LIGHTNING_BOLT_LEA);
        expect(reprint?.cardId).toBe(LIGHTNING_BOLT_LEA);
        expect(reprint?.cardId).toBe(original?.cardId);
    });

    it("flags a Basic land via the supertype, regardless of set", () => {
        const meta = resolveDeckCardMeta(MOUNTAIN_LEA);
        expect(meta?.isBasic).toBe(true);
    });

    it("carries the printed rarity for a rare", () => {
        expect(resolveDeckCardMeta(BLACK_LOTUS_LEA)?.rarity).toBe("rare");
    });

    it("returns null for an id absent from the registry", () => {
        expect(resolveDeckCardMeta("not-a-real-card-id")).toBeNull();
    });
});

describe("getAllSetCodes", () => {
    it("returns the catalogue's set codes, sorted", () => {
        const codes = getAllSetCodes();
        expect(codes).toContain("lea");
        expect(codes).toContain("leb");
        expect([...codes]).toEqual([...codes].sort());
    });
});

// Card Prints (ADR 0140, issue #4117) — `withDefinitionId` is what every
// `userDecks`/`presetDecks` write runs a deck card entry through so
// `definitionId` is never actually absent at rest.
describe("withDefinitionId (deck entry Card Prints split, issue #4117)", () => {
    it("resolves a reprint's cardId (chosen printing) to its home definitionId", () => {
        expect(
            withDefinitionId({ cardId: LIGHTNING_BOLT_LEB, cardName: "Bolt" })
        ).toEqual({
            cardId: LIGHTNING_BOLT_LEB,
            cardName: "Bolt",
            definitionId: LIGHTNING_BOLT_LEA,
        });
    });

    it("resolves the definition's own printing to itself", () => {
        expect(
            withDefinitionId({ cardId: LIGHTNING_BOLT_LEA, cardName: "Bolt" })
        ).toEqual({
            cardId: LIGHTNING_BOLT_LEA,
            cardName: "Bolt",
            definitionId: LIGHTNING_BOLT_LEA,
        });
    });

    it("falls back to the cardId itself when the registry cannot resolve it (never drops the card)", () => {
        expect(
            withDefinitionId({ cardId: "withdrawn-print", cardName: "Ghost" })
        ).toEqual({
            cardId: "withdrawn-print",
            cardName: "Ghost",
            definitionId: "withdrawn-print",
        });
    });

    it("is idempotent — an entry that already carries definitionId is left untouched", () => {
        const card = {
            cardId: LIGHTNING_BOLT_LEB,
            cardName: "Bolt",
            definitionId: "already-set",
        };
        expect(withDefinitionId(card)).toEqual(card);
    });
});
