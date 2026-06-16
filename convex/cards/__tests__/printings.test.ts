import { describe, expect, it } from "vitest";
import {
    getAllSetCodes,
    getPrintingsForCard,
    getPrintsForCard,
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

describe("getAllSetCodes", () => {
    it("returns the catalogue's set codes, sorted", () => {
        const codes = getAllSetCodes();
        expect(codes).toContain("lea");
        expect(codes).toContain("leb");
        expect([...codes]).toEqual([...codes].sort());
    });
});
