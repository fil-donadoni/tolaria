import { describe, expect, it } from "vitest";
import { foldAccents } from "@convex/cards/textNormalize";
import { tokenizeQuery } from "../useCardSearch";

// The text query is lower-cased and accent-folded before tokenising, in both
// the Search Index and Full Catalogue paths (they share `tokenizeQuery`).
function tokens(query: string): string[] {
    return tokenizeQuery(foldAccents(query.toLowerCase()));
}

// A card matches when every token is a substring of its folded name, which is
// what `matchesText` does for the name field.
function findsName(query: string, name: string): boolean {
    const fold = foldAccents(name.toLowerCase());
    return tokens(query).every((t) => fold.includes(t));
}

describe("tokenizeQuery", () => {
    const narset = "Narset, Parter of Veils";

    it.each(["narset", "narset,", "narset, parter", "narset,parter"])(
        "unquoted %j finds a comma-bearing name (a comma separates tokens)",
        (q) => {
            expect(findsName(q, narset)).toBe(true);
        }
    );

    it("a double-quoted phrase is matched literally, comma included", () => {
        expect(tokens('"narset, parter"')).toEqual(["narset, parter"]);
        expect(findsName('"narset, parter"', narset)).toBe(true);
    });

    it("a comma never survives into an unquoted token", () => {
        expect(tokens("narset, parter")).toEqual(["narset", "parter"]);
        expect(tokens("narset,parter")).toEqual(["narset", "parter"]);
        expect(tokens("narset,")).toEqual(["narset"]);
    });

    it("curly apostrophes fold to straight ones", () => {
        expect(findsName("urza’s", "Urza's Saga")).toBe(true);
    });

    it("curly double quotes delimit a phrase", () => {
        expect(tokens("“narset, parter”")).toEqual(["narset, parter"]);
    });

    it("a double-quoted phrase may contain an apostrophe", () => {
        expect(tokens('"urza\'s saga"')).toEqual(["urza's saga"]);
        expect(findsName('"urza’s saga"', "Urza's Saga")).toBe(true);
    });

    it("a single-quoted phrase still groups words", () => {
        expect(tokens("'urza saga'")).toEqual(["urza saga"]);
    });

    it("an inner apostrophe does not open a phrase", () => {
        expect(tokens("urza's saga")).toEqual(["urza's", "saga"]);
    });
});
