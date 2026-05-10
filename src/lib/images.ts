export function getImageUrl(id: string): string {
    return getScryfallImageUrl(id);
}

export function getArtCropImageUrl(scryfallId: string): string {
    return `https://cards.scryfall.io/art_crop/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}

/** Native pixel dimensions of Scryfall art_crop images (landscape).
 *  Use as `aspectRatio: "${ART_CROP_W} / ${ART_CROP_H}"` everywhere art_crop
 *  is rendered so the layout matches the source image exactly. */
export const ART_CROP_W = 563;
export const ART_CROP_H = 451;
export const ART_CROP_RATIO = `${ART_CROP_W} / ${ART_CROP_H}` as const;

function getScryfallImageUrl(scryfallId: string): string {
    return `https://cards.scryfall.io/png/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.png`;
}
