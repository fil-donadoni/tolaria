import { describe, expect, it } from "vitest";
import { colorRank, compareEntries } from "../cardSort";
import type { CardIndexEntry } from "../useCardSearch";

/** Minimal `CardIndexEntry` fixture — only the fields the comparators read
 *  matter (name, colors, manaValue, types, prints); the rest are filled with
 *  inert defaults. */
function mk(
    partial: Partial<CardIndexEntry> & { name: string }
): CardIndexEntry {
    return {
        cardId: partial.name,
        name: partial.name,
        nameLower: partial.name.toLowerCase(),
        nameFold: partial.name.toLowerCase(),
        types: partial.types ?? ["Creature"],
        subtypes: [],
        supertypes: [],
        colors: partial.colors ?? [],
        manaValue: partial.manaValue ?? 0,
        oracleText: "",
        oracleFold: "",
        prints: partial.prints ?? [{ printId: partial.name, setCode: "lea" }],
    };
}

/** Sort by a key and return the resulting names, for terse assertions. */
function sortedNames(
    entries: CardIndexEntry[],
    key: Parameters<typeof compareEntries>[0]
): string[] {
    return [...entries].sort(compareEntries(key)).map((e) => e.name);
}

describe("cardSort — color ordering (WUBRG combinatorial)", () => {
    it("ranks mono colors in WUBRG order", () => {
        expect(colorRank(mk({ name: "w", colors: ["W"] }))).toBeLessThan(
            colorRank(mk({ name: "u", colors: ["U"] }))
        );
        expect(colorRank(mk({ name: "u", colors: ["U"] }))).toBeLessThan(
            colorRank(mk({ name: "b", colors: ["B"] }))
        );
        expect(colorRank(mk({ name: "b", colors: ["B"] }))).toBeLessThan(
            colorRank(mk({ name: "r", colors: ["R"] }))
        );
        expect(colorRank(mk({ name: "r", colors: ["R"] }))).toBeLessThan(
            colorRank(mk({ name: "g", colors: ["G"] }))
        );
    });

    it("ranks every mono color before any two-color card", () => {
        const monoG = colorRank(mk({ name: "g", colors: ["G"] }));
        const azorius = colorRank(mk({ name: "wu", colors: ["W", "U"] }));
        expect(monoG).toBeLessThan(azorius);
    });

    it("orders two-color guilds combinatorially (WU WB WR WG UB ...)", () => {
        const bi = [
            mk({ name: "GB", colors: ["B", "G"] }),
            mk({ name: "WU", colors: ["W", "U"] }),
            mk({ name: "UR", colors: ["U", "R"] }),
            mk({ name: "WG", colors: ["W", "G"] }),
            mk({ name: "WB", colors: ["W", "B"] }),
        ];
        expect(sortedNames(bi, "color")).toEqual([
            "WU",
            "WB",
            "WG",
            "UR",
            "GB",
        ]);
    });

    it("orders three-color cards after two-color, combinatorially", () => {
        const tri = colorRank(mk({ name: "wub", colors: ["W", "U", "B"] }));
        const bi = colorRank(mk({ name: "rg", colors: ["R", "G"] }));
        expect(bi).toBeLessThan(tri);
    });

    it("places colorless non-lands after every colored card", () => {
        const fiveColor = colorRank(
            mk({ name: "5c", colors: ["W", "U", "B", "R", "G"] })
        );
        const colorless = colorRank(
            mk({ name: "artifact", colors: [], types: ["Artifact"] })
        );
        expect(fiveColor).toBeLessThan(colorless);
    });

    it("places lands last, even a land that produces colored mana", () => {
        const plains = mk({ name: "Plains", colors: ["W"], types: ["Land"] });
        const colorlessArtifact = mk({
            name: "Sol Ring",
            colors: [],
            types: ["Artifact"],
        });
        const whiteSpell = mk({ name: "Ancestor", colors: ["W"] });
        expect(colorRank(colorlessArtifact)).toBeLessThan(colorRank(plains));
        expect(colorRank(whiteSpell)).toBeLessThan(colorRank(plains));
    });

    it("full ordering: mono -> colorless non-land -> land", () => {
        const entries = [
            mk({ name: "Forest", colors: ["G"], types: ["Land"] }),
            mk({ name: "Ornithopter", colors: [], types: ["Artifact"] }),
            mk({ name: "Grizzly Bears", colors: ["G"] }),
            mk({ name: "Savannah Lions", colors: ["W"] }),
        ];
        expect(sortedNames(entries, "color")).toEqual([
            "Savannah Lions",
            "Grizzly Bears",
            "Ornithopter",
            "Forest",
        ]);
    });

    it("breaks color ties by name", () => {
        const entries = [
            mk({ name: "Zzz", colors: ["W"] }),
            mk({ name: "Aaa", colors: ["W"] }),
        ];
        expect(sortedNames(entries, "color")).toEqual(["Aaa", "Zzz"]);
    });
});

describe("cardSort — other keys", () => {
    it("sorts by mana value, then name", () => {
        const entries = [
            mk({ name: "Bear", manaValue: 2 }),
            mk({ name: "Bolt", manaValue: 1 }),
            mk({ name: "Ancestral", manaValue: 1 }),
        ];
        expect(sortedNames(entries, "manaValue")).toEqual([
            "Ancestral",
            "Bolt",
            "Bear",
        ]);
    });

    it("sorts by name alphabetically", () => {
        const entries = [
            mk({ name: "Counterspell" }),
            mk({ name: "Ancestral Recall" }),
            mk({ name: "Black Lotus" }),
        ];
        expect(sortedNames(entries, "name")).toEqual([
            "Ancestral Recall",
            "Black Lotus",
            "Counterspell",
        ]);
    });

    it("sorts by original-printing set, then name", () => {
        const entries = [
            mk({ name: "B", prints: [{ printId: "b", setCode: "leb" }] }),
            mk({ name: "A", prints: [{ printId: "a", setCode: "lea" }] }),
            mk({ name: "C", prints: [{ printId: "c", setCode: "lea" }] }),
        ];
        // lea (A, C) before leb (B); within lea, name order.
        expect(sortedNames(entries, "set")).toEqual(["A", "C", "B"]);
    });
});
