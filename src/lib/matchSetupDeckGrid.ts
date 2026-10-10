// The setup flow's deck grid (PRD #5334 stories 29–36, issue #5341): which
// decks steps 4 and 5 offer, how a search narrows them, and how they group.
//
// PURE — no React. The grid offers only the decks the Match Format admits
// (`filterDecksAdmittedBy`, the client's mirror of the server's
// `isDeckAdmitted`); a search matches a deck's name or any card name in its
// main deck or sideboard; under Freeform a Format select narrows "every deck"
// to one Format.
import { FORMAT_IDS, type FormatId } from "@convex/formats";
import { filterDecksAdmittedBy, type LobbyDeck } from "./deckTypes";

/** The Freeform grid's Format select: every Format, or one. */
export type DeckGridFormat = "all" | FormatId;

export interface DeckGridEntry {
    deck: LobbyDeck;
    /** The card a search matched, when the deck's own name did not — named
     *  under the tile so the player sees why the deck surfaced (story 13). */
    matchedCard: string | null;
    /** A deck illegal for its own Format is shown, never selectable (story
     *  34): the server refuses a game started on it. */
    selectable: boolean;
}

export interface DeckGrid {
    mine: DeckGridEntry[];
    presets: DeckGridEntry[];
}

/**
 * Does `deck` match `query`? Case-insensitive substring over the deck name,
 * then over every card name in the main deck and sideboard. A blank query
 * matches every deck. Returns `null` on a miss, else the card that matched
 * (`null` card when the name matched — the name is already on the tile).
 */
export function deckSearchHit(
    deck: LobbyDeck,
    query: string
): { matchedCard: string | null } | null {
    const q = query.trim().toLowerCase();
    if (q === "" || deck.name.toLowerCase().includes(q)) {
        return { matchedCard: null };
    }
    const card = [...deck.cards, ...(deck.sideboard ?? [])].find((c) =>
        c.cardName.toLowerCase().includes(q)
    );
    return card ? { matchedCard: card.cardName } : null;
}

/** The Formats a Freeform grid's select offers: those of the decks Freeform
 *  admits, in canonical order — never an option that selects nothing. */
export function freeformFormatOptions(decks: readonly LobbyDeck[]): FormatId[] {
    const present = new Set(
        filterDecksAdmittedBy(decks, "freeform").map((d) => d.format)
    );
    return FORMAT_IDS.filter((f) => present.has(f));
}

/**
 * The grid for one Match Format: admitted decks matching the search, split
 * into the player's own and the presets (story 31). `format` narrows by Deck
 * Format only under a Freeform Match Format — every other Match Format admits
 * a single Format, so a narrower select would have nothing to choose.
 */
export function deckGrid(
    decks: readonly LobbyDeck[],
    matchFormat: FormatId,
    query: string,
    format: DeckGridFormat = "all"
): DeckGrid {
    const grid: DeckGrid = { mine: [], presets: [] };
    for (const deck of filterDecksAdmittedBy(decks, matchFormat)) {
        if (matchFormat === "freeform" && format !== "all") {
            if (deck.format !== format) continue;
        }
        const hit = deckSearchHit(deck, query);
        if (!hit) continue;
        const entry: DeckGridEntry = {
            deck,
            matchedCard: hit.matchedCard,
            selectable: deck.isLegal,
        };
        (deck.kind === "user" ? grid.mine : grid.presets).push(entry);
    }
    return grid;
}
