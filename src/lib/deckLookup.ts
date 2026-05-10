import type { LobbyDeck } from "./deckTypes";

export function findDeckBySlug(
    slug: string,
    decks: LobbyDeck[]
): LobbyDeck | null {
    return decks.find((d) => d.presetId === slug) ?? null;
}
