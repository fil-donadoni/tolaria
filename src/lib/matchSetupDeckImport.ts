// The setup flow's strict decklist import (PRD #5334 stories 41–48, issue
// #5343): unlike the deck builder's partial import (`parseDecklist` keeps what
// it understood), the setup flow refuses the whole paste on the first problem
// and lists EVERY problem — every unsupported line, or every legality reason —
// so the player fixes the list once rather than discovering a deck that is
// not the one they pasted.
//
// PURE — no React, no Convex client. The server re-validates at game start
// (ADR 0074); this is the client's pre-flight, never its authority.
import { FORMAT_IDS, validateDeck, type FormatId } from "@convex/formats";
import type { UserLobbyDeck } from "./deckTypes";
import { parseDecklist, type EarliestPrintRows } from "./deckImport";
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

/** Formats a pasted list cannot be: Limited is bound to an Event, and Tabletop
 *  (`manual`) resolves names through the Full Catalogue, which this strict
 *  import does not load — it would refuse every card the GRE lacks. */
export const IMPORT_EXCLUDED_FORMATS: readonly FormatId[] = [
    "limited",
    "manual",
];

/** The Formats a Freeform Match Format lets the player import into. */
export const IMPORT_FORMAT_CHOICES: readonly FormatId[] = FORMAT_IDS.filter(
    (f) => !IMPORT_EXCLUDED_FORMATS.includes(f)
);

/** The imported deck's Format: the Match Format itself, except under Freeform,
 *  where the player's select decides (story 46). */
export function importFormat(
    matchFormat: FormatId,
    chosen: FormatId
): FormatId {
    return matchFormat === "freeform" ? chosen : matchFormat;
}

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
