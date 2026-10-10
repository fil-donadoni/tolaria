// Format identity and Match Format admission (ADR 0153).
//
// CARD-FREE by construction: no import at all, so `gameReads.ts`,
// `gameManual.ts` and `gameSeats.ts` can enforce and expose admission without
// reaching the card registry (`scripts/__tests__/convex-card-free-seam.test.ts`).
// `./formats` re-exports every name here — it stays the Formats module callers
// import from; only a card-free module imports this file directly.

/**
 * The three shipped Formats (ADR 0036). A row's `format` field is one of these
 * three literals — the schema types it as a `v.union` of exactly these values,
 * so a non-conforming string is rejected at the DB boundary.
 */
export type FormatId =
    | "freeform"
    | "alpha-40"
    | "old-school"
    | "premodern"
    | "limited"
    | "manual";

/** Every valid `FormatId`, in display order. The single source of truth the
 *  schema union, the create-flow select, and the validators all key off. */
export const FORMAT_IDS: readonly FormatId[] = [
    "freeform",
    "alpha-40",
    "old-school",
    "premodern",
    "limited",
    "manual",
] as const;

/** Type guard: is an arbitrary string a known `FormatId`? Used by the schema
 *  validator boundary and the migration to reject/normalize legacy values. */
export function isFormatId(value: string): value is FormatId {
    return (FORMAT_IDS as readonly string[]).includes(value);
}

/** Each Format's display name. `FORMAT_RULES[f].label` reads from here, so
 *  the admission refusal and the deck builder can never name a Format apart. */
export const FORMAT_LABELS: Record<FormatId, string> = {
    freeform: "Freeform",
    "alpha-40": "Alpha 40",
    "old-school": "Old School (93/94)",
    premodern: "Premodern",
    limited: "Limited",
    manual: "Tabletop",
};

/** A stored or wire Format string resolved to a `FormatId`. An unrecognised
 *  string falls back to `freeform`, the same fallback `assertDeckLegal` uses. */
export function toFormatId(raw: string): FormatId {
    return isFormatId(raw) ? raw : "freeform";
}

/**
 * Match Format admission (ADR 0153): may a Deck of Format `deckFormat` sit at a
 * Match whose Match Format is `matchFormat`? A Deck is admitted when its Format
 * equals the Match Format; a Freeform Match Format admits every playable Deck
 * (never Manual — the engine cannot play it). The single authority — every
 * create and join mutation enforces it and the lobby filters by it. Limited's
 * same-Event scoping is a separate check (`assertSameEventDeck`).
 */
export function isDeckAdmitted(
    deckFormat: FormatId,
    matchFormat: FormatId
): boolean {
    if (matchFormat === "freeform") return deckFormat !== "manual";
    return deckFormat === matchFormat;
}

/** The refusal a create or join mutation throws for a Deck its Match Format
 *  does not admit, or `null` when the Deck is admitted. Unknown Format strings
 *  read as `freeform` (`toFormatId`). */
export function admissionRefusal(
    deckFormat: string,
    matchFormat: FormatId
): string | null {
    const deck = toFormatId(deckFormat);
    if (isDeckAdmitted(deck, matchFormat)) return null;
    return `This Match's Format is ${FORMAT_LABELS[matchFormat]}; ${FORMAT_LABELS[deck]} decks cannot sit at it.`;
}

/** A Match's Match Format, tolerant of Matches created before ADR 0153: a row
 *  with no stored Match Format derives it from its host's (first seat's) Deck
 *  Format. The ONE reader of the stored field — every consumer goes through
 *  here. `null` only for a legacy row with no seat at all. */
export function resolveMatchFormat(
    stored: FormatId | undefined,
    hostDeckFormat: string | undefined
): FormatId | null {
    if (stored !== undefined) return stored;
    return hostDeckFormat === undefined ? null : toFormatId(hostDeckFormat);
}
