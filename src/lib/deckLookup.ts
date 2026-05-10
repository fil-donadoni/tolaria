import type { DeckPreset } from "@convex/deckPresets";
import type { UserDeck } from "./userDecks";

export function findDeckBySlug(
    slug: string,
    presetDecks: DeckPreset[] | undefined,
    userDecks: UserDeck[]
): DeckPreset | null {
    const fromUser = userDecks.find((d) => d.presetId === slug);
    if (fromUser) return fromUser;
    return presetDecks?.find((d) => d.presetId === slug) ?? null;
}
