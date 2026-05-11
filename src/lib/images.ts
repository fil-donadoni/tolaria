import { tryGetCardById } from "@convex/cards";

export function getImageUrl(id: string): string {
    return getScryfallImageUrl(id);
}

export function getArtCropImageUrl(scryfallId: string): string {
    return `https://cards.scryfall.io/art_crop/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}

/** Resolves the Scryfall id to use for fetching art for a given card id.
 *
 *  For printed cards: returns the same id (each printing has its own
 *  Scryfall id). For tokens (CR 111, 707.1) — whose id is the synthetic
 *  `token:Name|...` form — returns the def's `imagePrintId` when one is
 *  declared (e.g. The Hive's Wasp from 10E) and `null` otherwise so the
 *  caller can fall back to an in-app placeholder. Never returns the
 *  synthetic `token:` id itself: Scryfall would 404 on it. */
export function resolveCardImageId(cardId: string): string | null {
    if (!cardId.startsWith("token:")) return cardId;
    const def = tryGetCardById(cardId);
    return def?.imagePrintId ?? null;
}

/** Native pixel dimensions of Scryfall art_crop images (landscape).
 *  Use as `aspectRatio: "${ART_CROP_W} / ${ART_CROP_H}"` everywhere art_crop
 *  is rendered so the layout matches the source image exactly. */
export const ART_CROP_W = 563;
export const ART_CROP_H = 451;
export const ART_CROP_RATIO = `${ART_CROP_W} / ${ART_CROP_H}` as const;

// Scryfall variants by size: png (~700KB+, transparent), large (~210KB jpg),
// normal (~70KB jpg), small (~30KB jpg). Card faces render at ~100–140px wide
// on the battlefield and ~256px in the zoom panel — `normal` (488×680 jpg) is
// sharp enough at that size at ~1/3 the bytes of `large`, saving roughly 140KB
// per card visible on a typical board.
function getScryfallImageUrl(scryfallId: string): string {
    return `https://cards.scryfall.io/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}
