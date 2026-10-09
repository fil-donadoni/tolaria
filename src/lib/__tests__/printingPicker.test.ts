// The printing picker's pure half (issue #4122): kind classification, the
// catalogue + table merge, and the Set text filter that restricts the
// `cardPrints` query.
import { describe, expect, it } from "vitest";
import {
    countByKind,
    filterByKind,
    inSets,
    matchSetCodes,
    mergePrintings,
    printingKind,
    restrictSets,
} from "../printingPicker";

const NAMES = new Map([
    ["ody", "Odyssey"],
    ["lea", "Limited Edition Alpha"],
    ["leb", "Limited Edition Beta"],
    ["2ed", "Unlimited Edition"],
    ["ice", "Ice Age"],
    ["plst", "The List"],
]);

describe("printingKind", () => {
    it("reads digital over promo, and a flagless printing as paper", () => {
        expect(printingKind({ printId: "a", setCode: "x" })).toBe("paper");
        expect(printingKind({ printId: "a", setCode: "x", promo: true })).toBe(
            "promo"
        );
        expect(
            printingKind({
                printId: "a",
                setCode: "x",
                promo: true,
                digital: true,
            })
        ).toBe("digital");
    });

    it("counts and filters by kind", () => {
        const prints = [
            { printId: "p", setCode: "lea" },
            { printId: "q", setCode: "plst", promo: true },
            { printId: "d", setCode: "prm", digital: true },
            { printId: "r", setCode: "leb" },
        ];
        expect(countByKind(prints)).toEqual({
            all: 4,
            paper: 2,
            promo: 1,
            digital: 1,
        });
        expect(filterByKind(prints, "paper").map((p) => p.printId)).toEqual([
            "p",
            "r",
        ]);
        expect(filterByKind(prints, "all")).toHaveLength(4);
    });
});

describe("mergePrintings", () => {
    it("keeps the catalogue printings first, appends unseen table rows, dedupes by id", () => {
        const merged = mergePrintings(
            [
                { printId: "def", setCode: "lea" },
                { printId: "b", setCode: "leb" },
            ],
            [
                { printId: "b", setCode: "leb", promo: false, digital: false },
                { printId: "c", setCode: "ody", promo: true, digital: false },
                { printId: "c", setCode: "ody", promo: true, digital: false },
            ]
        );
        expect(merged.map((p) => p.printId)).toEqual(["def", "b", "c"]);
        // The table's flags win for a printing both sides know.
        expect(merged[1].digital).toBe(false);
        expect(merged[2].promo).toBe(true);
    });
});

describe("matchSetCodes", () => {
    it("is null for a blank query — no restriction", () => {
        expect(matchSetCodes("  ", NAMES)).toBeNull();
    });

    it("matches a Set by a fragment of its full name, case-insensitively", () => {
        expect(matchSetCodes("odyssey", NAMES)).toEqual(["ody"]);
        expect(matchSetCodes("ODYS", NAMES)).toEqual(["ody"]);
        expect(matchSetCodes("edition", NAMES)).toEqual(["lea", "leb", "2ed"]);
    });

    it("matches a code exactly, never by prefix", () => {
        expect(matchSetCodes("leb", NAMES)).toEqual(["leb"]);
        expect(matchSetCodes("le", NAMES)).toEqual([]);
    });

    it("matches a name only from MIN_SET_NAME_QUERY characters — a code always", () => {
        expect(matchSetCodes("od", NAMES)).toEqual([]);
        expect(matchSetCodes("ody", NAMES)).toEqual(["ody"]);
        expect(matchSetCodes("ice", NAMES)).toEqual(["ice"]);
        expect(matchSetCodes("age", NAMES)).toEqual(["ice"]);
    });

    it("matches a code the name table does not know yet", () => {
        expect(matchSetCodes("STH", NAMES, ["STH"])).toEqual(["sth"]);
    });

    it("folds accents", () => {
        expect(
            matchSetCodes("pokemon", new Map([["pkm", "Pokémon Promo"]]))
        ).toEqual(["pkm"]);
    });
});

describe("restrictSets", () => {
    it("is the Format's allowed Sets when no text is typed", () => {
        expect(restrictSets(null, null)).toBeNull();
        expect(restrictSets(["lea", "leb"], null)).toEqual(["lea", "leb"]);
    });

    it("is the text matches when the Format allows every Set", () => {
        expect(restrictSets(null, ["ody"])).toEqual(["ody"]);
    });

    it("intersects the two, so a filter never widens Old School / Alpha 40", () => {
        expect(restrictSets(["lea", "leb"], ["leb", "ody"])).toEqual(["leb"]);
        expect(restrictSets(["lea", "leb"], ["ody"])).toEqual([]);
        expect(restrictSets(["LEA"], null)).toEqual(["lea"]);
    });

    it("inSets applies the restriction to a catalogue printing, case-insensitively", () => {
        expect(inSets({ printId: "x", setCode: "LEB" }, ["leb"])).toBe(true);
        expect(inSets({ printId: "x", setCode: "ody" }, ["leb"])).toBe(false);
        expect(inSets({ printId: "x", setCode: "ody" }, null)).toBe(true);
    });
});
