// The lobby deck list's second-level Limited Origin filter (issue #2818, PRD
// #2812, ADR 0106): derived client-side from the already-subscribed deck list
// — no query, no persisted history of keys — so an Origin whose last deck is
// deleted simply stops being offered.
import { limitedOriginLabel } from "@convex/limited/limitedOrigin";
import type { LobbyDeck } from "~/lib/deckTypes";

/** The origin select's value: every origin, or one Limited Origin key. */
export type DeckOriginFilter = "all" | string;
export const DEFAULT_DECK_ORIGIN_FILTER: DeckOriginFilter = "all";

export interface DeckOriginOption {
    key: string;
    label: string;
}

/** The origins the caller's OWN Limited decks carry, labelled (the label is
 *  derived from the key), sorted by label. A deck with no origin, or a key
 *  that does not parse, contributes no option — it is not an origin. */
export function deckOriginOptions(
    decks: readonly LobbyDeck[]
): DeckOriginOption[] {
    const byKey = new Map<string, string>();
    for (const deck of decks) {
        if (deck.kind !== "user" || deck.format !== "limited") continue;
        if (!deck.limitedOrigin) continue;
        const label = limitedOriginLabel(deck.limitedOrigin);
        if (label !== null) byKey.set(deck.limitedOrigin, label);
    }
    return [...byKey]
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/** The origin a stored choice resolves to: `"all"` when it names an origin no
 *  deck carries any more (the last deck was deleted). */
export function effectiveDeckOrigin(
    stored: DeckOriginFilter,
    options: readonly DeckOriginOption[]
): DeckOriginFilter {
    return options.some((o) => o.key === stored) ? stored : "all";
}

/** Does `deck` pass the origin filter? Only a Limited deck with a recorded
 *  origin can be excluded: a Limited deck with none (its event gone before the
 *  backfill) stays reachable under every origin. */
export function deckPassesOrigin(
    deck: LobbyDeck,
    origin: DeckOriginFilter
): boolean {
    if (origin === "all" || deck.format !== "limited") return true;
    if (!deck.limitedOrigin) return true;
    return deck.limitedOrigin === origin;
}
