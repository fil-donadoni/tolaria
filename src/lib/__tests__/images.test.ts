// Regression guard for token image URL resolution.
//
// Background: tokens (CR 111, 707.1) have synthetic ids of the form
// `token:Name|...|<imagePrintId>` and live outside the Scryfall registry.
// Naively passing this id to `getImageUrl` produced URLs like
//   https://cards.scryfall.io/large/front/t/o/token:Wasp|...|ce98....jpg
// that 404'd in production. `resolveCardImageId` is the single chokepoint
// every image consumer must go through: it returns the def's printed
// `imagePrintId` for tokens that have one, and `null` for tokens that
// don't (so the caller skips the network and renders a placeholder).

import { describe, it, expect } from "vitest";
import { getArtCropImageUrl, getImageUrl, resolveCardImageId } from "../images";

describe("resolveCardImageId", () => {
    it("printed cards (no `token:` prefix) resolve to their own id", () => {
        const printedId = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        expect(resolveCardImageId(printedId)).toBe(printedId);
    });

    it("token with imagePrintId resolves to the printed token's Scryfall id", () => {
        // The Hive's Wasp encodes imagePrintId in the trailing segment; the
        // lazy synthesizer in `convex/cards/index.ts` decodes it.
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44";
        expect(resolveCardImageId(id)).toBe(
            "09921372-126f-4c81-b6d8-ea50b1d0eb44"
        );
    });

    it("token without imagePrintId returns null (placeholder path)", () => {
        const id = "token:Phantom|Creature|Spirit||2|2||";
        expect(resolveCardImageId(id)).toBeNull();
    });

    it("getImageUrl built from a resolved token id targets the printed token", () => {
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44";
        const resolved = resolveCardImageId(id)!;
        const url = getImageUrl(resolved);
        // The dangerous regression URL contained the literal `token:` prefix
        // and pipe characters; the resolved URL must not.
        expect(url).not.toContain("token:");
        expect(url).not.toContain("|");
        // Scryfall path layout: first two chars of the Scryfall id make the
        // shard directories.
        expect(url).toContain("/normal/front/0/9/");
        expect(url).toContain(resolved);
    });

    it("getArtCropImageUrl built from a resolved token id targets the printed token", () => {
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44";
        const resolved = resolveCardImageId(id)!;
        const url = getArtCropImageUrl(resolved);
        expect(url).not.toContain("token:");
        expect(url).toContain("/art_crop/front/0/9/");
    });
});
