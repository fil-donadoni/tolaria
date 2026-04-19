import { getImageUrl } from "./images";

const preloaded = new Set<string>();

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
