import { getArtCropImageUrl, getImageUrl, resolveCardImageId } from "./images";

const preloaded = new Set<string>();
const preloadedArtCrop = new Set<string>();

export function preloadCardImage(cardId: string): void {
    if (preloaded.has(cardId)) return;
    preloaded.add(cardId);
    // Tokens with no printed art (resolveCardImageId → null) skip the
    // network — the renderer uses an in-app placeholder instead.
    const imageId = resolveCardImageId(cardId);
    if (!imageId) return;
    const img = new Image();
    img.decoding = "async";
    img.src = getImageUrl(imageId);
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
    img.src = getArtCropImageUrl(imageId);
}

export function preloadArtCropImages(cardIds: Iterable<string>): void {
    for (const id of cardIds) preloadArtCropImage(id);
}
