import {
    DEFAULT_CARD_IMAGE_SIZES,
    getArtCropImageUrl,
    getImageSrcSet,
    getImageUrl,
    resolveCardImageFace,
    resolveCardImageId,
} from "./images";

const preloaded = new Set<string>();
const preloadedArtCrop = new Set<string>();

export function preloadCardImage(cardId: string): void {
    if (preloaded.has(cardId)) return;
    preloaded.add(cardId);
    // Tokens with no printed art (resolveCardImageId → null) skip the
    // network — the renderer uses an in-app placeholder instead.
    const imageId = resolveCardImageId(cardId);
    if (!imageId) return;
    // A transformed permanent's `cardId` is its back-face def id (CR 712);
    // preload the SAME face `<img>` will actually request (issue #1595) —
    // otherwise a front-face preload is wasted bytes while the render fetches
    // `back/` uncached.
    const face = resolveCardImageFace(cardId);
    const img = new Image();
    img.decoding = "async";
    // Mirror CardImage's responsive attributes so the browser resolves the
    // SAME srcset candidate it will render later — a bare `src` preload would
    // warm `grid` while a 1× screen then fetches `thumb` (double download).
    // Board surfaces (hand/battlefield/stack) exclude `thumb` from their
    // srcset, so the preload does too — warming a candidate nobody fetches
    // is wasted bytes.
    img.srcset = getImageSrcSet(imageId, { includeThumb: false, face });
    img.sizes = DEFAULT_CARD_IMAGE_SIZES;
    img.src = getImageUrl(imageId, face);
}

export function preloadCardImages(cardIds: Iterable<string>): void {
    for (const id of cardIds) preloadCardImage(id);
}

export function preloadArtCropImage(cardId: string): void {
    if (preloadedArtCrop.has(cardId)) return;
    preloadedArtCrop.add(cardId);
    const imageId = resolveCardImageId(cardId);
    if (!imageId) return;
    const img = new Image();
    img.decoding = "async";
    img.src = getArtCropImageUrl(imageId, resolveCardImageFace(cardId));
}

export function preloadArtCropImages(cardIds: Iterable<string>): void {
    for (const id of cardIds) preloadArtCropImage(id);
}
