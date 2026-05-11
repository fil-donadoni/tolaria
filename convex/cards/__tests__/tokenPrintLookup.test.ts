// Pins the build-time generated token-print mapping (CR 707.1) and the
// helper that reads it. The mapping itself comes from
// `convex/cards/generated/token-prints.json`, refreshed via
// `node scripts/fetch-token-prints.mjs convex/cards/sets/*.ts`. These tests
// guard against:
//   - the generated file accidentally diverging from the helper API
//   - a regression where a card known to produce a token returns undefined
//     (would silently fall back to the placeholder, masking a missing
//     mapping refresh after adding a token producer)

import { describe, it, expect } from "vitest";
import { tokenPrintIdFor } from "../tokenPrintLookup";

describe("tokenPrintIdFor (build-time Scryfall reverse-link)", () => {
    const HIVE_ID = "544a7138-eae8-4ff9-9e17-680bfa717183";

    it("returns the printed Wasp Scryfall id for The Hive", () => {
        const id = tokenPrintIdFor(HIVE_ID, "Wasp");
        expect(id).toBe("09921372-126f-4c81-b6d8-ea50b1d0eb44");
    });

    it("name-omitted lookup returns the first entry (single-token card)", () => {
        const id = tokenPrintIdFor(HIVE_ID);
        expect(id).toBe("09921372-126f-4c81-b6d8-ea50b1d0eb44");
    });

    it("name match is case-insensitive", () => {
        expect(tokenPrintIdFor(HIVE_ID, "wasp")).toBe(
            "09921372-126f-4c81-b6d8-ea50b1d0eb44"
        );
        expect(tokenPrintIdFor(HIVE_ID, "WASP")).toBe(
            "09921372-126f-4c81-b6d8-ea50b1d0eb44"
        );
    });

    it("unknown card returns undefined", () => {
        // Random valid-looking UUID that isn't a token producer in the set.
        expect(
            tokenPrintIdFor("ce2d603a-3231-4a8c-bf39-1617586ea870")
        ).toBeUndefined();
    });

    it("known card with wrong tokenName returns undefined", () => {
        expect(tokenPrintIdFor(HIVE_ID, "Soldier")).toBeUndefined();
    });
});
