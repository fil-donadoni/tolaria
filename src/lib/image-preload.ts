import { getArtCropImageUrl, getImageUrl } from "./images";

const preloaded = new Set<string>();
const preloadedArtCrop = new Set<string>();

export function preloadCardImage(cardId: string): void {
    if (preloaded.has(cardId)) return;
    preloaded.add(cardId);
    const img = new Image();
    img.decoding = "async";
    img.src = getImageUrl(cardId);
}

export function preloadCardImages(cardIds: Iterable<string>): void {
    for (const id of cardIds) preloadCardImage(id);
}

export function preloadArtCropImage(cardId: string): void {
    if (preloadedArtCrop.has(cardId)) return;
    preloadedArtCrop.add(cardId);
    const img = new Image();
    img.decoding = "async";
    img.src = getArtCropImageUrl(cardId);
}

export function preloadArtCropImages(cardIds: Iterable<string>): void {
    for (const id of cardIds) preloadArtCropImage(id);
}
