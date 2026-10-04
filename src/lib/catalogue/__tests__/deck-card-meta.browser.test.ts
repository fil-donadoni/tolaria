import { describe, expect, it } from "vitest";
import {
    bindDeckCardMetaResolver,
    resolveDeckCardMeta,
} from "../deck-card-meta.browser";

// Issue #4854: the browser build's stand-in for `convex/formats.ts`'s default
// `validateDeck` resolver is a late binding. The deck builder falls through to
// that default while its own print resolver loads, so an unbound stub that
// THREW took the whole route down (found in a real browser).
describe("deck-card-meta browser seam", () => {
    it("answers null, never throws, before the catalogue binds it", () => {
        expect(resolveDeckCardMeta("any-card")).toBeNull();
    });

    it("delegates to the resolver the catalogue module binds", () => {
        const meta = {
            cardId: "c1",
            name: "Card",
            setCode: "lea",
            rarity: "common",
            isBasic: false,
        } as const;
        bindDeckCardMetaResolver((id) => (id === "c1" ? meta : null));
        expect(resolveDeckCardMeta("c1")).toEqual(meta);
        expect(resolveDeckCardMeta("nope")).toBeNull();
    });
});
