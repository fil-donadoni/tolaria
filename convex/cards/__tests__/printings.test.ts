import { describe, expect, it } from "vitest";
import {
    getAllSetCodes,
    getPrintingsForCard,
    getPrintsForCard,
    resolveDeckCardMeta,
} from "../index";

// Lightning Bolt: LEA original + LEB reprint. ids from sets/lea.ts & sets/leb.ts.
const LIGHTNING_BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const LIGHTNING_BOLT_LEB = "b5d3dcab-2260-479d-9ef6-dfb92d4f6061";
// Circle of Protection: Black — Beta-original CardDefinition (home set "leb").
const COP_BLACK_LEB_DEF = "fa47b4cd-8da4-4544-b011-ba92b7009203";
// Forest: one LEA definition, three LEB art variants.
const FOREST_LEA = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

describe("getPrintingsForCard (deck builder editions)", () => {
    it("lists the original printing first with its home set code", () => {
        const printings = getPrintingsForCard(LIGHTNING_BOLT_LEA);
        expect(printings[0]).toEqual({
            printId: LIGHTNING_BOLT_LEA,
            setCode: "lea",
        });
    });

    it("includes reprints with their own set code", () => {
        const printings = getPrintingsForCard(LIGHTNING_BOLT_LEA);
        expect(printings).toContainEqual({
            printId: LIGHTNING_BOLT_LEB,
            setCode: "leb",
        });
    });

    it("reports the home set of a Beta-original definition as leb", () => {
        const printings = getPrintingsForCard(COP_BLACK_LEB_DEF);
        expect(printings[0]).toEqual({
            printId: COP_BLACK_LEB_DEF,
            setCode: "leb",
        });
    });

    it("keeps multiple same-set art variants as distinct printings", () => {
        const leb = getPrintingsForCard(FOREST_LEA).filter(
            (p) => p.setCode === "leb"
        );
        expect(leb.length).toBe(3);
        // Every variant has a unique print id.
        expect(new Set(leb.map((p) => p.printId)).size).toBe(3);
    });
});

describe("getPrintsForCard", () => {
    it("returns the print ids, original first", () => {
        const ids = getPrintsForCard(LIGHTNING_BOLT_LEA);
        expect(ids[0]).toBe(LIGHTNING_BOLT_LEA);
        expect(ids).toContain(LIGHTNING_BOLT_LEB);
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
            setCode: "lea",
            rarity: "common",
            isBasic: false,
        });
    });

    it("resolves a reprint print id to THAT printing's set (not the home set)", () => {
        const leb = resolveDeckCardMeta(LIGHTNING_BOLT_LEB);
        expect(leb?.setCode).toBe("leb");
        const reprint2ed = resolveDeckCardMeta(LIGHTNING_BOLT_2ED);
        expect(reprint2ed?.setCode).toBe("2ed");
    });

    it("maps every printing of a card to the SAME canonical Card ID (ADR 0036, copy-count budget)", () => {
        // The original and its LEB reprint differ in set but share one budget.
        const original = resolveDeckCardMeta(LIGHTNING_BOLT_LEA);
        const reprint = resolveDeckCardMeta(LIGHTNING_BOLT_LEB);
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
