// The setup flow's deck grid (PRD #5334 stories 29–36, issue #5341): which
// decks steps 4 and 5 offer, how a search narrows them, and how they group.
//
// PURE — no React. The grid offers only the decks the Match Format admits
// (`filterDecksAdmittedBy`, the client's mirror of the server's
// `isDeckAdmitted`); a search matches a deck's name or any card name in its
// main deck or sideboard; under Freeform a Format select narrows "every deck"
// to one Format.
import { FORMAT_IDS, type FormatId } from "@convex/formats";
import { limitedOriginLabel } from "@convex/limited/limitedOrigin";
import { filterDecksAdmittedBy, type LobbyDeck } from "./deckTypes";

/** The Freeform grid's Format select: every Format, or one. */
export type DeckGridFormat = "all" | FormatId;

/** The Limited grid's Origin select: every origin, or one origin key. */
export type DeckGridOrigin = "all" | string;

/** The group of a Limited deck with no Limited Origin (a legacy deck saved
 *  before issue #5393) — shown, never dropped. */
export const UNCLASSIFIED_ORIGIN_LABEL = "Unclassified";

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

/** A deck's Limited Origin label, or `null` when it has none (or a key that
 *  does not parse — the same "unclassified" to the player). */
function originLabelOf(deck: LobbyDeck): string | null {
    return deck.limitedOrigin ? limitedOriginLabel(deck.limitedOrigin) : null;
}

/** The origins a Limited grid's select offers: those of the decks the Match
 *  Format admits, labelled, sorted by label — never an option that selects
 *  nothing. Unclassified decks have no option (they are not an origin). */
export function limitedOriginOptions(
    decks: readonly LobbyDeck[]
): { key: string; label: string }[] {
    const byKey = new Map<string, string>();
    for (const deck of filterDecksAdmittedBy(decks, "limited")) {
        const label = originLabelOf(deck);
        if (label !== null && deck.limitedOrigin) {
            byKey.set(deck.limitedOrigin, label);
        }
    }
    return [...byKey]
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export interface OriginGroup {
    /** The Limited Origin key; `null` for the unclassified group. */
    origin: string | null;
    label: string;
    entries: DeckGridEntry[];
}

/**
 * The player's Limited decks grouped by Limited Origin (issue #5394): one
 * group per origin, sorted by label, the unclassified decks in their own
 * group last. Entry order within a group is preserved; empty groups are
 * never returned.
 */
export function groupByLimitedOrigin(
    entries: readonly DeckGridEntry[]
): OriginGroup[] {
    const groups = new Map<string | null, OriginGroup>();
    for (const entry of entries) {
        const label = originLabelOf(entry.deck);
        const origin =
            label === null ? null : (entry.deck.limitedOrigin ?? null);
        let group = groups.get(origin);
        if (!group) {
            group = {
                origin,
                label: label ?? UNCLASSIFIED_ORIGIN_LABEL,
                entries: [],
            };
            groups.set(origin, group);
        }
        group.entries.push(entry);
    }
    return [...groups.values()].sort((a, b) => {
        if (a.origin === null) return 1;
        if (b.origin === null) return -1;
        return a.label.localeCompare(b.label);
    });
}

/**
 * The grid for one Match Format: admitted decks matching the search, split
 * into the player's own and the presets (story 31). `format` narrows by Deck
 * Format only under a Freeform Match Format (and `origin` under Limited) — every other Match Format admits
 * a single Format, so a narrower select would have nothing to choose.
 */
export function deckGrid(
    decks: readonly LobbyDeck[],
    matchFormat: FormatId,
    query: string,
    format: DeckGridFormat = "all",
    origin: DeckGridOrigin = "all"
): DeckGrid {
    const grid: DeckGrid = { mine: [], presets: [] };
    for (const deck of filterDecksAdmittedBy(decks, matchFormat)) {
        if (matchFormat === "freeform" && format !== "all") {
            if (deck.format !== format) continue;
        }
        // Origin narrows only under Limited, like Format under Freeform; an
        // origin select excludes the unclassified decks (they have none).
        if (matchFormat === "limited" && origin !== "all") {
            if (deck.limitedOrigin !== origin) continue;
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
