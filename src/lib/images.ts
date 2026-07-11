import { tryGetDefinition } from "@convex/cards";

export function getImageUrl(id: string): string {
    return getScryfallImageUrl(id);
}

/** Width-described srcset across Scryfall's WebP renditions (thumb 146w,
 *  grid 488w, display 672w). Paired with a `sizes` hint it lets the browser
 *  fetch the rendition closest to the slot's DEVICE-pixel width: a ~120px CSS
 *  card on a 1× screen gets `thumb` — Scryfall's own offline downscale, visibly
 *  cleaner than the GPU downsampling `grid` 4:1 on a composited layer — while
 *  a 2× screen still gets `grid` and larger surfaces get `display`. */
/** Default `sizes` hint matching the shared card surfaces: board cards render
 *  76–140px CSS wide (portrait hand → battlefield). The browser multiplies it
 *  by devicePixelRatio to pick a srcset candidate: 1× screens resolve `thumb`
 *  (146w), 2× screens `grid` (488w). Surfaces that render cards substantially
 *  larger pass their real width instead. */
export const DEFAULT_CARD_IMAGE_SIZES = "140px";

export function getImageSrcSet(scryfallId: string): string {
    return [
        `${scryfallUrl("thumb", scryfallId, "webp")} 146w`,
        `${scryfallUrl("grid", scryfallId, "webp")} 488w`,
        `${scryfallUrl("display", scryfallId, "webp")} 672w`,
    ].join(", ");
}

/** JPG counterpart of {@link getImageUrl}, same pixel size (488×680).
 *  Used as the `onError` fallback while Scryfall's WebP rollout is in
 *  progress: spoiler-season / lowres printings may lack the `grid` WebP
 *  rendition, and the legacy `normal` JPG always exists. */
export function getImageFallbackUrl(scryfallId: string): string {
    return scryfallUrl("normal", scryfallId, "jpg");
}

// art_crop stays JPG deliberately: the WebP replacement (`art`, 626×457) is
// only rendered for recent printings — a July 2026 probe of the catalogue
// (pre-modern-heavy: LEA/ARN/ATQ/DRK/ICE…) found 0% coverage, so WebP-first
// here would cost a 404 round-trip on virtually every card.
export function getArtCropImageUrl(scryfallId: string): string {
    return scryfallUrl("art_crop", scryfallId, "jpg");
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
    const def = tryGetDefinition(cardId);
    return def?.imagePrintId ?? null;
}

/** Native pixel dimensions of Scryfall art_crop images (landscape).
 *  Use as `aspectRatio: "${ART_CROP_W} / ${ART_CROP_H}"` everywhere art_crop
 *  is rendered so the layout matches the source image exactly. */
export const ART_CROP_W = 563;
export const ART_CROP_H = 451;
export const ART_CROP_RATIO = `${ART_CROP_W} / ${ART_CROP_H}` as const;

// Scryfall variants by size — WebP renditions (2026 rollout): thumb (146×204,
// replaces small), grid (488×680, replaces normal), display (672×936, replaces
// large), plus legacy jpg/png. Card faces render at ~76–140px wide on the
// battlefield and ~256px in the zoom panel — `grid` matches `normal`'s pixels
// at roughly half the bytes (~40–75KB webp vs ~70–130KB jpg). A July 2026
// probe found `grid` rendered for 40/40 sampled catalogue cards; consumers
// still fall back to `normal` jpg via getImageFallbackUrl for the stragglers
// (fresh spoilers, lowres scans).
function getScryfallImageUrl(scryfallId: string): string {
    return scryfallUrl("grid", scryfallId, "webp");
}

function scryfallUrl(variant: string, scryfallId: string, ext: string): string {
    return `https://cards.scryfall.io/${variant}/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.${ext}`;
}
