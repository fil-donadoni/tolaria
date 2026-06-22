import { tryGetCardByName } from "@convex/cards";
import type { DeckCard } from "~/types/game";

/** Result of parsing a pasted decklist. `cards`/`sideboard` are flat lists with
 *  one entry per physical copy (a `4 Counterspell` line expands to four
 *  `DeckCard`s), matching the deck builder's `WorkingDeck` shape. `unresolved`
 *  collects every line that could not be turned into cards — unknown card names
 *  and malformed lines — so the importer can report them without aborting
 *  (import is partial by design). */
export interface ParsedDecklist {
    cards: DeckCard[];
    sideboard: DeckCard[];
    unresolved: string[];
}

// `<count> <name>` — e.g. "4 Counterspell", "1 Circle of Protection: Red".
// Leading/trailing whitespace is trimmed before matching.
const CARD_LINE = /^(\d+)x?\s+(.+)$/i;

type Section = "main" | "side";

function isSectionHeader(line: string): Section | null {
    const lower = line.toLowerCase();
    // Tolerate trailing punctuation/counts MTGA-style exporters sometimes add
    // (e.g. "Sideboard (15)"). A header never starts with a digit — that's a
    // card line.
    if (/^sideboard\b/.test(lower)) return "side";
    if (/^(deck|maindeck|commander)\b/.test(lower)) return "main";
    return null;
}

/** Parse a pasted decklist into Maindeck and Sideboard piles.
 *
 * Format (MTGA / Scryfall style):
 *
 *     Deck
 *     1 Black Lotus
 *     4 Counterspell
 *
 *     Sideboard
 *     2 Blue Elemental Blast
 *
 * Rules:
 * - Lines are read top-to-bottom; the current section starts as Maindeck.
 * - A line of just "Deck"/"Maindeck" or "Sideboard" switches the section.
 * - A `<count> <name>` line adds `count` copies to the current section.
 * - Card names resolve case-insensitively against the card registry; names not
 *   in the registry (unknown or not-yet-implemented) and any non-blank line
 *   that is neither a header nor a card line go to `unresolved`.
 * - Blank lines are ignored.
 */
export function parseDecklist(text: string): ParsedDecklist {
    const cards: DeckCard[] = [];
    const sideboard: DeckCard[] = [];
    const unresolved: string[] = [];
    let section: Section = "main";

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "") continue;

        const header = isSectionHeader(line);
        if (header) {
            section = header;
            continue;
        }

        const match = CARD_LINE.exec(line);
        if (!match) {
            unresolved.push(line);
            continue;
        }

        const count = Number(match[1]);
        const name = match[2].trim();
        const def = tryGetCardByName(name);
        if (!def) {
            unresolved.push(line);
            continue;
        }

        const target = section === "side" ? sideboard : cards;
        for (let i = 0; i < count; i++) {
            target.push({ cardId: def.id, cardName: def.name });
        }
    }

    return { cards, sideboard, unresolved };
}
