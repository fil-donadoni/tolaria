import { getPrintingsForCard, tryGetCardByName } from "@convex/cards/catalogue";
import { FORMAT_RULES, type FormatId } from "@convex/formats";
import type { DeckCard } from "~/types/game";
import type { CatalogueNameResolver } from "./fullCatalogue";

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

/** Pick the deck-card id to import for a resolved card, given the target format.
 *
 * A pasted line carries only a NAME, which resolves to the canonical
 * `CardDefinition` — whose id is the ORIGINAL printing (e.g. Counterspell → LEA).
 * For Alpha 40 and Old School, whose legality genuinely IS built-set membership
 * (`checkSets`), that original set is often out of the target format's pool, so
 * importing the home printing would seed an illegal deck. To keep the import
 * legal by construction, we remap the id to the card's EARLIEST printing that
 * is in the format's `allowedSets` — "earliest" meaning first in that list's
 * order (the format-author-defined precedence).
 *
 * Premodern is the exception (issue #2695): its legality is a NAME join
 * against Scryfall's `legalities.premodern` (`checkOracleLegality`), which
 * does not care which set a card was built in at all — an LEA Counterspell
 * import already validates fine for Premodern without this remap. This
 * function still runs for Premodern (harmless — `allowedSets` here is
 * `PREMODERN_LEGAL_SETS`, kept for exactly this kind of UI preference, see
 * its doc comment in `convex/formats.ts`), but it is now purely COSMETIC for
 * that format: it prefers a Premodern-appropriate printing's art/set code
 * when one of the card's built printings has one, never a legality
 * requirement.
 *
 * Falls back to the home printing (`defId`) when the format is unrestricted
 * (`allowedSets === null`, Freeform) or when no built printing of the card is
 * in `allowedSets` — for Alpha 40/Old School the deck's validator then
 * surfaces the illegality, exactly as before; for Premodern the deck still
 * validates fine regardless, per above. */
function pickPrintingForFormat(defId: string, format: FormatId): string {
    const allowedSets = FORMAT_RULES[format].allowedSets;
    if (!allowedSets) return defId;
    const order = new Map(allowedSets.map((set, i) => [set, i]));

    let bestId = defId;
    let bestRank = Infinity;
    for (const printing of getPrintingsForCard(defId)) {
        const rank = order.get(printing.setCode);
        if (rank !== undefined && rank < bestRank) {
            bestRank = rank;
            bestId = printing.printId;
        }
    }
    return bestId;
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
 * - Card names resolve case-insensitively against the card registry, then —
 *   when a `resolveCatalogueName` is supplied — against the Full Catalogue.
 *   Names neither knows, and any non-blank line that is neither a header nor a
 *   card line, go to `unresolved`.
 * - Blank lines are ignored.
 * - `format` picks the printing per resolved name: the earliest one legal in the
 *   format (see `pickPrintingForFormat`), so the import is legal by construction
 *   instead of always seeding the original (often out-of-pool) printing.
 *
 * `resolveCatalogueName` (`makeCatalogueNameResolver`, `~/lib/fullCatalogue`) is
 * the Tabletop path (ADR 0080): that format's pool is every printed card, so a
 * name the GRE doesn't implement is a legitimate import, not a skipped line.
 * The registry is still tried FIRST, so an implemented card keeps its
 * format-legal printing selection. Omitted, resolution is registry-only —
 * unchanged behaviour for every other format.
 */
export function parseDecklist(
    text: string,
    format: FormatId = "freeform",
    resolveCatalogueName?: CatalogueNameResolver
): ParsedDecklist {
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
        const resolved: DeckCard | null = def
            ? {
                  cardId: pickPrintingForFormat(def.id, format),
                  cardName: def.name,
              }
            : (resolveCatalogueName?.(name) ?? null);
        if (!resolved) {
            unresolved.push(line);
            continue;
        }

        const target = section === "side" ? sideboard : cards;
        for (let i = 0; i < count; i++) {
            target.push({ ...resolved });
        }
    }

    return { cards, sideboard, unresolved };
}

/** A deck shape the exporter understands: the builder's two flat piles, one
 *  `DeckCard` per physical copy (the same shape `parseDecklist` produces). */
export interface ExportableDeck {
    cards: DeckCard[];
    sideboard: DeckCard[];
}

// Collapse a flat pile (one entry per copy) into `<count> <name>` lines,
// grouping by card name and preserving first-appearance order so the output is
// stable across exports.
function pileToLines(pile: DeckCard[]): string[] {
    const counts = new Map<string, number>();
    for (const card of pile) {
        counts.set(card.cardName, (counts.get(card.cardName) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => `${count} ${name}`);
}

/** Serialise a deck to a portable MTGA / Scryfall-style decklist — the inverse
 *  of `parseDecklist`. The text carries only names and counts (never the MTG
 *  format), so it is portable across formats: export here, then re-import into
 *  a deck of any target format. Print-vs-name caveat: a name re-imports to a
 *  default print, which the target format's validator flags if illegal.
 *
 * Output (the `Sideboard` section is emitted only when the sideboard is
 * non-empty):
 *
 *     Deck
 *     2 Black Lotus
 *     4 Counterspell
 *
 *     Sideboard
 *     3 Blue Elemental Blast
 *
 * Round-trips cleanly through `parseDecklist`: the produced text parses back
 * into the same Maindeck and Sideboard piles (counts and sections preserved).
 */
export function deckToText(deck: ExportableDeck): string {
    const sections = [["Deck", ...pileToLines(deck.cards)].join("\n")];
    if (deck.sideboard.length > 0) {
        sections.push(["Sideboard", ...pileToLines(deck.sideboard)].join("\n"));
    }
    return sections.join("\n\n");
}
