import { describe, expect, it } from "vitest";
import { getAllCards, getDefinition, tryGetDefinition } from "../index";

// ADR 0046 — single registry seam + hydration-at-entry. These tests pin the
// two invariants the ADR relies on:
//
// 1. `getDefinition`/`tryGetDefinition` are the ONLY definition-resolution
//    path — everything else (a card's raw fields) is reachable only through
//    them, never via a direct `cards/sets/*` import in production code (that
//    half of the guard is enforced statically by the `no-restricted-imports`
//    rule in `eslint.config.js`, checked by `bun run lint`).
// 2. The seam is, and must remain, fully SYNCHRONOUS: it returns a
//    `CardDefinition` directly, never a `Promise`. The GRE relies on this —
//    if the registry ever needs an async fetch (e.g. a future DB-backed
//    projection), the fetch must complete before the mutation entry point
//    hands control to the GRE ("hydration-at-entry"); `getDefinition` itself
//    can never become `async`.
describe("card registry seam (ADR 0046)", () => {
    const knownId = getAllCards()[0]!.id;

    it("getDefinition resolves synchronously — not a Promise", () => {
        const result = getDefinition(knownId);
        expect(result).not.toBeInstanceOf(Promise);
        expect(typeof result).toBe("object");
        expect(result.id).toBe(knownId);
    });

    it("tryGetDefinition resolves synchronously — not a Promise", () => {
        const result = tryGetDefinition(knownId);
        expect(result).not.toBeInstanceOf(Promise);
        expect(result?.id).toBe(knownId);
    });

    it("tryGetDefinition returns null (not a rejected Promise) for an unknown id", () => {
        const result = tryGetDefinition("definitely-not-a-real-card-id");
        expect(result).toBeNull();
    });

    it("getDefinition throws synchronously for an unknown id (no unhandled rejection)", () => {
        expect(() => getDefinition("definitely-not-a-real-card-id")).toThrow(
            /Card not found/
        );
    });

    it("every catalogue definition round-trips through the seam by id", () => {
        // Hydration-at-entry smoke test: the module-level `registry` Map is
        // built once at import time from the statically-imported set
        // modules, so by the time any test (or mutation) runs, every card is
        // already resolvable synchronously — no lazy/async load path exists.
        for (const card of getAllCards()) {
            expect(getDefinition(card.id)).toBe(card);
        }
    });
});
