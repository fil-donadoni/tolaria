// The setup flow's strict decklist import (PRD #5334 stories 41–48, issue
// #5343): unlike the deck builder's partial import (`parseDecklist` keeps what
// it understood), the setup flow refuses the whole paste on the first problem
// and lists EVERY problem — every unsupported line, or every legality reason —
// so the player fixes the list once rather than discovering a deck that is
// not the one they pasted.
//
// No React, no Convex client; the one network it touches is the catalogue's
// own loader, for the pasted deck's definitions. The server re-validates at
// game start (ADR 0074); this is the client's pre-flight, never its
// authority.
import { FORMAT_RULES, validateDeck, type FormatId } from "@convex/formats";
import { catalogueIdByName } from "@convex/cards/catalogue";
import type { UserLobbyDeck } from "./deckTypes";
import {
    decklistCardNames,
    parseDecklist,
    type EarliestPrintRows,
} from "./deckImport";
import { installShards, shardsNeededFor } from "./catalogue/definitionShards";
import { computeDeckColors } from "./deckColors";
import type { DeckCard } from "~/types/game";

/** What `userDecks.create` takes — the deck the import saves. */
export interface ImportedDeckPayload {
    name: string;
    format: FormatId;
    colors: string[];
    cards: DeckCard[];
    sideboard: DeckCard[];
}

export type StrictImportResult =
    | { ok: true; payload: ImportedDeckPayload }
    | { ok: false; errors: string[] };

// The Format choices live in the catalogue-free `./matchSetupImportFormats`
// (issue #5584); re-exported so this module stays the import's one surface.
export {
    IMPORT_EXCLUDED_FORMATS,
    IMPORT_FORMAT_CHOICES,
    importFormat,
} from "./matchSetupImportFormats";

/**
 * Parse `text` strictly into a deck of `format`. Refused — with every reason —
 * when the name is blank, any line is unsupported, the list is empty, or the
 * deck is inadmissible to its Format. `earliestRows` is the `cardPrints` fetch
 * `parseDecklist` picks printings from (empty ⇒ home printings).
 */
export function strictImportDeck(
    name: string,
    text: string,
    format: FormatId,
    earliestRows?: EarliestPrintRows
): StrictImportResult {
    const parsed = parseDecklist(text, format, undefined, earliestRows);
    const errors: string[] = [];
    if (name.trim() === "") errors.push("Name the deck.");
    for (const line of parsed.unresolved) {
        errors.push(`Unsupported line: ${line}`);
    }
    if (parsed.unresolved.length === 0) {
        if (parsed.cards.length === 0) errors.push("The decklist is empty.");
        else {
            const { reasons } = validateDeck(parsed, format);
            for (const reason of reasons) errors.push(reason.message);
        }
    }
    if (errors.length > 0) return { ok: false, errors };
    return {
        ok: true,
        payload: {
            name: name.trim(),
            format,
            colors: computeDeckColors(parsed.cards),
            cards: parsed.cards,
            sideboard: parsed.sideboard,
        },
    };
}

/** Fetches the earliest `cardPrints` row per Card ID inside `allowedSets`
 *  (`useEarliestPrintFetcher`, issue #5106). */
export type FetchEarliestPrints = (
    cardIds: string[],
    allowedSets: readonly string[]
) => Promise<EarliestPrintRows>;

/**
 * Make the definitions of every card `text` names resident (issue #5616):
 * the names resolve through the Definition Index — its compiled section is
 * loaded with this module (`./strictImportLoader`) — and only the shards of
 * THOSE cards are installed, never the catalogue. A name the index does not
 * know stays unknown, and `parseDecklist` reports its line.
 */
export async function makeDecklistResident(text: string): Promise<void> {
    const ids = decklistCardNames(text).flatMap(
        (name) => catalogueIdByName(name) ?? []
    );
    await installShards(shardsNeededFor(ids));
}

/**
 * The Import deck dialog's whole import: make the pasted cards' definitions
 * resident, parse once for the Card IDs, fetch the earliest legal printing of
 * each when the Format restricts its Sets (issue #5106), then import
 * strictly. Here, not in the dialog, so the dialog imports nothing that reads
 * the catalogue: it loads this module on demand (`./strictImportLoader`,
 * issue #5584).
 */
export async function strictImportWithPrintings(
    name: string,
    text: string,
    format: FormatId,
    fetchEarliest: FetchEarliestPrints
): Promise<StrictImportResult> {
    await makeDecklistResident(text);
    const allowedSets = FORMAT_RULES[format].allowedSets;
    const first = parseDecklist(text, format);
    const earliest = allowedSets
        ? await fetchEarliest(
              [...first.cards, ...first.sideboard].map((c) => c.cardId),
              allowedSets
          )
        : undefined;
    return strictImportDeck(name, text, format, earliest);
}

/**
 * The lobby deck an import just saved, built from its payload so the setup can
 * select it before the reactive `userDecks.listMine` row arrives. It stands in
 * for admission only (`applyChange` reads its Format and legality); the grid
 * renders the real row once the query delivers it.
 */
export function importedLobbyDeck(
    id: string,
    payload: ImportedDeckPayload
): UserLobbyDeck {
    const stored = (cards: DeckCard[]) =>
        cards.map((c) => ({ ...c, definitionId: c.cardId }));
    return {
        kind: "user",
        userDeckId: id as UserLobbyDeck["userDeckId"],
        presetId: id,
        name: payload.name,
        format: payload.format,
        colors: payload.colors,
        cards: stored(payload.cards),
        sideboard: stored(payload.sideboard),
        featuredCardId: payload.cards[0]?.cardId ?? null,
        isLegal: true,
        reasons: [],
    };
}
