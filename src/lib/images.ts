export function getImageUrl(id: string): string {
    return getScryfallImageUrl(id);
}

function getScryfallImageUrl(scryfallId: string): string {
    return `https://cards.scryfall.io/png/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.png`;
}
