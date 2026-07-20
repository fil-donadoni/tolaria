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
import {
    getArtCropImageUrl,
    getArtImageUrl,
    getImageFallbackUrl,
    getImageSrcSet,
    getImageUrl,
    resolveCardImageId,
} from "../images";

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
        // shard directories. Primary rendition is the `grid` WebP (488×680).
        expect(url).toContain("/grid/front/0/9/");
        expect(url).toMatch(/\.webp$/);
        expect(url).toContain(resolved);
    });

    it("getImageFallbackUrl mirrors getImageUrl as the legacy `normal` jpg", () => {
        const id = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        const url = getImageFallbackUrl(id);
        expect(url).toContain("/normal/front/c/e/");
        expect(url).toMatch(/\.jpg$/);
        expect(url).toContain(id);
    });

    it("getImageSrcSet describes the three WebP renditions by width", () => {
        const id = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        const srcSet = getImageSrcSet(id);
        const entries = srcSet.split(", ");
        expect(entries).toHaveLength(3);
        expect(entries[0]).toMatch(/\/thumb\/front\/c\/e\/.*\.webp 146w$/);
        expect(entries[1]).toMatch(/\/grid\/front\/c\/e\/.*\.webp 488w$/);
        expect(entries[2]).toMatch(/\/display\/front\/c\/e\/.*\.webp 672w$/);
    });

    it("getImageSrcSet with includeThumb:false drops the 146w thumb rendition", () => {
        // Mid-slot strategy (hand/stack/battlefield): a 1× screen must resolve
        // `grid` 488w, never the softer `thumb`.
        const id = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        const srcSet = getImageSrcSet(id, { includeThumb: false });
        const entries = srcSet.split(", ");
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatch(/\/grid\/front\/c\/e\/.*\.webp 488w$/);
        expect(entries[1]).toMatch(/\/display\/front\/c\/e\/.*\.webp 672w$/);
        expect(srcSet).not.toContain("/thumb/");
    });

    it("getArtImageUrl targets the `art` WebP rendition", () => {
        const id = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        const url = getArtImageUrl(id);
        expect(url).toContain("/art/front/c/e/");
        expect(url).toMatch(/\.webp$/);
        expect(url).toContain(id);
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
