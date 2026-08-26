import { describe, it, expect } from "vitest";
import { isPollutionEntry } from "../lib/card-index-pollution";

/**
 * Unit test for the predicate `check-card-index.ts` uses to classify a
 * `data/card-index.json` row as "extra / pollution" (issue #2702, ADR 0108).
 *
 * Proof-of-failure (recorded per gre-development.md § Proof-of-failure):
 * temporarily reverted `isPollutionEntry` to `!registryIds.has(entry.scryfallId)`
 * (dropping the `source !== "compiled"` guard) — the second test below
 * ("does NOT flag a compiled-sourced row") went red, as expected, since a
 * compiled row's scryfallId is never in the hand-written `registryIds` set.
 * Reverted after confirming the failure.
 */
describe("isPollutionEntry (check-card-index.ts guard, issue #2702)", () => {
    const registryIds = new Set(["hand-written-1", "hand-written-2"]);

    it("flags a hand-written-shaped row whose id is NOT in the registry", () => {
        expect(isPollutionEntry({ scryfallId: "leaked-id" }, registryIds)).toBe(
            true
        );
    });

    it("does NOT flag a row whose id IS in the registry", () => {
        expect(
            isPollutionEntry({ scryfallId: "hand-written-1" }, registryIds)
        ).toBe(false);
    });

    it("does NOT flag a compiled-sourced row, even though its id is absent from the hand-written registry", () => {
        expect(
            isPollutionEntry(
                { scryfallId: "compiled-only-id", source: "compiled" },
                registryIds
            )
        ).toBe(false);
    });
});
