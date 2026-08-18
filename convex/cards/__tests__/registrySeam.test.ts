import { describe, expect, it } from "vitest";
import {
    FACE_DOWN_CARD_ID,
    getAllCards,
    getDefinition,
    registeredDefinitions,
    tryGetCardByName,
    tryGetDefinition,
} from "../index";

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

// `registeredDefinitions` is the registry-side enumeration seam (#2530). It
// exists so a consumer that only needs "some registered card" can get it from
// `convex/cards/client.ts` — the client entry the Vite alias points
// `@convex/cards` at — instead of importing `catalogue.ts`, which that entry
// deliberately omits. It is therefore only useful if it agrees with
// `getAllCards()`, and these tests pin exactly that agreement.
describe("registeredDefinitions — the client-safe enumeration seam (#2530)", () => {
    it("yields the SAME objects the by-id seam returns (expanded, ADR 0054)", () => {
        // Not `toEqual`: an unexpanded raw registry value is deep-equal to the
        // expanded one for most cards, so identity is the only assertion that
        // catches a seam that forgot to expand.
        for (const def of registeredDefinitions()) {
            expect(getDefinition(def.id)).toBe(def);
        }
    });

    it("yields each definition ONCE — print aliases do not duplicate a reprint", () => {
        const ids = [...registeredDefinitions()].map((d) => d.id);
        expect(ids).toEqual([...new Set(ids)]);
    });

    it("covers the whole catalogue, in catalogue order", () => {
        // The bot's `name-card` fallback takes the FIRST match, so order is
        // load-bearing: it is what makes the answer deterministic across the
        // re-walks of the escalation ladder (ADR 0047).
        const registered = [...registeredDefinitions()].map((d) => d.id);
        const catalogue = getAllCards().map((d) => d.id);
        expect(registered.filter((id) => catalogue.includes(id))).toEqual(
            catalogue
        );
    });

    it("also carries registry-only synthetics the catalogue has no row for", () => {
        // The face-down sentinel (CR 708.2) is registered but is not a set
        // export. Callers that need *printed card names* must filter — which
        // `isLegalNamedCard` does for them, via the catalogue's name registry.
        const ids = new Set([...registeredDefinitions()].map((d) => d.id));
        expect(ids.has(FACE_DOWN_CARD_ID)).toBe(true);
        expect(getAllCards().some((d) => d.id === FACE_DOWN_CARD_ID)).toBe(
            false
        );
        expect(tryGetCardByName("Face-down creature")).toBeNull();
    });
});
