import { tryGetDefinition } from "@convex/cards";
import type { CardImageFace } from "@convex/cards/types";

export type { CardImageFace };

export function getImageUrl(id: string, face?: CardImageFace): string {
    return getScryfallImageUrl(id, face);
}

/** The printed full card (grid 488w WebP) — the "printed card" surface of the
 *  phase-2 preview toggle. Same rendition the default CardImage fetches. */
export function getPrintedCardImageUrl(
    scryfallId: string,
    face?: CardImageFace
): string {
    return getScryfallImageUrl(scryfallId, face);
}

/** Fallback `sizes` hint for a card slot that could not be MEASURED — a
 *  zero-width box, or a test environment with no layout engine (happy-dom).
 *  Every real browser render derives the hint from the slot itself
 *  ({@link cardSlotFloor}, `useCardSlotFloor`), so this value is the
 *  no-layout escape hatch and never the number a surface relies on.
 *
 *  It is NOT a floor: 140px was the board's upper bound, and ~18 call sites
 *  inheriting it while rendering into a 180–260px slot is exactly the defect
 *  issue #3553 records. A hint below the slot resolves a rendition below the
 *  slot's device-pixel width, which reads as soft/pixelated art until a
 *  resize re-evaluates the candidate. */
export const DEFAULT_CARD_IMAGE_SIZES = "140px";

/** The Scryfall WebP rendition widths {@link getImageSrcSet} offers, by name.
 *  The whole responsive decision is a choice among these three, which is why
 *  {@link cardSlotFloor} can be exact rather than approximate. */
export const CARD_RENDITION_WIDTHS = {
    thumb: 146,
    grid: 488,
    display: 672,
} as const;

/** The step a measured slot width is rounded UP to before it is declared.
 *
 *  UP, always: a declared hint under the real slot is the defect itself, so
 *  rounding can only ever over-declare. The step exists so a drag-resize or a
 *  sub-pixel reflow does not re-render every mounted card for a width change
 *  that cannot move the resolved candidate. */
export const CARD_SLOT_QUANTUM_PX = 16;

/** What a MEASURED card slot asks of the srcset: the `sizes` hint to declare
 *  and whether Scryfall's most compressed rendition may stay a candidate. */
export interface CardSlotFloor {
    sizes: string;
    includeThumb: boolean;
}

/** The minimum image-quality floor for one measured slot (issue #3553).
 *
 *  `slotCssWidth` is the slot's real rendered width in CSS px; `dpr` the
 *  display's `devicePixelRatio`. The browser resolves `sizes × dpr` against
 *  the width-described candidates, so declaring the slot's own (rounded-up)
 *  width makes it pick the smallest candidate at or above the slot's DEVICE
 *  pixel width — which is the floor, stated once, instead of a constant a
 *  human has to remember per call site.
 *
 *  `includeThumb` is the same decision one rendition lower: `thumb` is 146px
 *  of actual pixels, so it stays a candidate only while the slot needs 146
 *  device px or fewer. That keeps genuinely small slots (target chips,
 *  collapsed piles) on the cheap rendition — the change is a FLOOR, not a
 *  blanket upgrade — while a slot that outgrows `thumb` stops being offered
 *  it at all. A `dpr` under 1 (browser zoom-out) is clamped to 1 so the floor
 *  never drops below the CSS width. */
export function cardSlotFloor(
    slotCssWidth: number,
    dpr: number
): CardSlotFloor {
    const declared = Math.max(
        CARD_SLOT_QUANTUM_PX,
        Math.ceil(slotCssWidth / CARD_SLOT_QUANTUM_PX) * CARD_SLOT_QUANTUM_PX
    );
    const deviceWidth = declared * Math.max(1, dpr);
    return {
        sizes: `${declared}px`,
        includeThumb: deviceWidth <= CARD_RENDITION_WIDTHS.thumb,
    };
}

/** Width-described srcset across Scryfall's WebP renditions (grid 488w,
 *  display 672w, plus thumb 146w unless excluded). Paired with a `sizes` hint
 *  it lets the browser fetch the rendition closest to the slot's DEVICE-pixel
 *  width.
 *
 *  The rendition strategy is NOT per surface any more (issue #3553). It was —
 *  a table of "small slots pass `includeThumb: true`, mid slots pass `false`"
 *  that every call site had to look itself up in — and the surfaces that
 *  never did inherited `thumb` 146w into a 180–260px slot. `includeThumb` is
 *  now the output of {@link cardSlotFloor} against the slot's MEASURED width,
 *  so the same rule holds everywhere by construction: `thumb` stays a
 *  candidate exactly while the slot needs 146 device px or fewer.
 *
 *  The `includeThumb` parameter survives for the no-layout fallback path and
 *  for the handful of images whose slot is a fixed px constant in their own
 *  style attribute. */
export function getImageSrcSet(
    scryfallId: string,
    opts?: { includeThumb?: boolean; face?: CardImageFace }
): string {
    const includeThumb = opts?.includeThumb ?? true;
    const face = opts?.face;
    return [
        ...(includeThumb
            ? [`${scryfallUrl("thumb", scryfallId, "webp", face)} 146w`]
            : []),
        `${scryfallUrl("grid", scryfallId, "webp", face)} 488w`,
        `${scryfallUrl("display", scryfallId, "webp", face)} 672w`,
    ].join(", ");
}

/** JPG counterpart of {@link getImageUrl}, same pixel size (488×680).
 *  Used as the `onError` fallback while Scryfall's WebP rollout is in
 *  progress: spoiler-season / lowres printings may lack the `grid` WebP
 *  rendition, and the legacy `normal` JPG always exists. */
export function getImageFallbackUrl(
    scryfallId: string,
    face?: CardImageFace
): string {
    return scryfallUrl("normal", scryfallId, "jpg", face);
}

/** Preview art primary: the `art` WebP rendition (626×457) — sharper and less
 *  compressed than art_crop. Only rendered for recent printings (a July 2026
 *  probe of the catalogue, pre-modern-heavy: LEA/ARN/ATQ/DRK/ICE…, found 0%
 *  coverage), so callers MUST onError-fall back to {@link getArtCropImageUrl}
 *  (see card-preview-face). Never mix the two in one srcset — their aspect
 *  ratios differ. */
export function getArtImageUrl(
    scryfallId: string,
    face?: CardImageFace
): string {
    return scryfallUrl("art", scryfallId, "webp", face);
}

// art_crop stays JPG deliberately: it is the always-present fallback for the
// `art` WebP rendition above (old printings lack `art`, per the probe note on
// getArtImageUrl), so the fallback path must not 404 a second time.
export function getArtCropImageUrl(
    scryfallId: string,
    face?: CardImageFace
): string {
    return scryfallUrl("art_crop", scryfallId, "jpg", face);
}

/** Every id shape this engine SYNTHESIZES rather than taking from a printing.
 *  None of them is a Scryfall id, so none may ever reach a Scryfall URL.
 *
 *   - `token:Name|…` — a token's content-derived id (CR 111, 707.1).
 *   - an id containing `#` — an inset spell's twin (ADR 0120, `${printId}#kind`)
 *     and any future `${parent}#suffix` derivation. `#` is the URL FRAGMENT
 *     delimiter, so such an id does not merely 404: it truncates the URL,
 *     taking the file extension with it, and the request that leaves the
 *     browser is a directory path (issue #3321).
 *
 *  Matched by SHAPE, not by an enumerated list of prefixes, so the next
 *  synthetic id is covered on the day it is minted rather than on the day
 *  someone notices its art is missing. */
function isSyntheticCardId(cardId: string): boolean {
    return cardId.startsWith("token:") || cardId.includes("#");
}

/** Resolves the Scryfall id to use for fetching art for a given card id.
 *
 *  For printed cards: returns the same id (each printing has its own
 *  Scryfall id). For a SYNTHETIC id ({@link isSyntheticCardId}) — a token
 *  (CR 111, 707.1), an inset spell's twin (CR 715.2c) — returns the def's
 *  `imagePrintId` when one is declared (The Hive's Wasp from 10E; an
 *  adventurer card's own printing) and `null` otherwise so the caller can fall
 *  back to an in-app placeholder.
 *
 *  **Never returns a synthetic id itself.** That was already this function's
 *  stated contract, written against the `token:` form alone; the twin ids
 *  added by ADR 0120 are a second class, and the id-shaped test is what keeps
 *  the contract true for the third (issue #3321). */
export function resolveCardImageId(cardId: string): string | null {
    if (!isSyntheticCardId(cardId)) return cardId;
    const def = tryGetDefinition(cardId);
    const printId = def?.imagePrintId;
    // Fail closed: a definition whose own `imagePrintId` is itself synthetic
    // (a token whose art was pinned to another token) yields the placeholder
    // rather than a URL that cannot resolve.
    return printId && !isSyntheticCardId(printId) ? printId : null;
}

/** The Scryfall id whose `back/` CDN path serves the BACK face art of the
 *  double-faced card `frontId` (CR 712, issue #3552), for a preview of a card
 *  that has NOT turned that face up.
 *
 *  Never the modal twin's id: `${parentId}#back` is synthetic, and a real
 *  double-faced printing shares ONE Scryfall id across both faces, each served
 *  under its own `front/`/`back/` path. So this is the back face's own
 *  declared `imagePrintId` when it is a real id, else the front face's print
 *  id — the same precedence `modalBackTwinDefinition` (`cards/modalDfc.ts`)
 *  and `backFaceAsTokenSpec` (`cards/backFaceSpec.ts`) register the turned-up
 *  face with, so the preview and the transformed permanent show one art.
 *  Callers pair it with face `"back"`. */
export function resolveBackFaceImageId(frontId: string): string | null {
    const backPrintId = tryGetDefinition(frontId)?.backFace?.imagePrintId;
    if (backPrintId && !isSyntheticCardId(backPrintId)) return backPrintId;
    return resolveCardImageId(frontId);
}

/** Resolves which face's URL segment to request for `cardId` (issue #1595,
 *  CR 712). A transformed permanent's `card.card.id` is swapped by
 *  `transformPermanent` (`gre/transform.ts`) to a synthesized `CardDefinition`
 *  registered by `registerBackFaceDefinition`, which stamps
 *  `imagePrintFace: "back"` on it — so this is a pure lookup on the SAME
 *  `cardId` every `resolveCardImageId` caller already has, no
 *  `CardInstanceState` needed. Every other def (including one that simply
 *  hasn't transformed yet) has no `imagePrintFace` and resolves to the
 *  default `"front"`. */
export function resolveCardImageFace(cardId: string): CardImageFace {
    return tryGetDefinition(cardId)?.imagePrintFace ?? "front";
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
function getScryfallImageUrl(scryfallId: string, face?: CardImageFace): string {
    return scryfallUrl("grid", scryfallId, "webp", face);
}

// `face` defaults to "front" — the segment every non-transformed card (the
// overwhelming majority) renders; a transformed permanent's caller resolves
// its own face via `resolveCardImageFace` and passes it explicitly (issue
// #1595).
function scryfallUrl(
    variant: string,
    scryfallId: string,
    ext: string,
    face: CardImageFace = "front"
): string {
    return `https://cards.scryfall.io/${variant}/${face}/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.${ext}`;
}
