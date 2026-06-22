// Deck Formats — typed, immutable construction Formats (PRD #509, ADR 0036).
//
// This is the FOUNDATION slice (issue #510): the `format` field becomes a
// typed, immutable choice made at deck creation, but no legality rules are
// wired yet — every deck is treated as legal. Each format's `validate()` is a
// seam that returns no reasons for now; later slices fill in Old School's
// restricted/banned lists and Alpha 40's rarity/category budgets.
//
// Per ADR 0036 this module is PURE and importable by BOTH the Convex server
// (authoritative gate at game start; legality on the lobby deck list) and the
// frontend (live validation panel). It lives at `convex/formats.ts` — it is
// NOT a `convex/gre/` engine module, so it does not cross the engine boundary.
// Legality is DERIVED, never stored: `validateDeck` is a pure function of the
// deck contents + the code-side rules.

import type { DeckCard } from "./deckPresets";

/**
 * The three shipped Formats (ADR 0036). A row's `format` field is one of these
 * three literals — the schema types it as a `v.union` of exactly these values,
 * so a non-conforming string is rejected at the DB boundary.
 */
export type FormatId = "freeform" | "alpha-40" | "old-school";

/** Every valid `FormatId`, in display order. The single source of truth the
 *  schema union, the create-flow select, and the validators all key off. */
export const FORMAT_IDS: readonly FormatId[] = [
    "freeform",
    "alpha-40",
    "old-school",
] as const;

/** Type guard: is an arbitrary string a known `FormatId`? Used by the schema
 *  validator boundary and the migration to reject/normalize legacy values. */
export function isFormatId(value: string): value is FormatId {
    return (FORMAT_IDS as readonly string[]).includes(value);
}

/**
 * A single legality failure reason. In this slice no validator produces any;
 * the shape is fixed up front so later slices add reasons without changing the
 * `validateDeck` contract or its consumers (the lobby list, the live panel).
 */
export interface Reason {
    /** A short, stable machine code for the kind of failure (e.g. `"size"`). */
    code: string;
    /** A human-readable, English explanation shown in the builder/lobby. */
    message: string;
}

/** The deck shape a validator inspects — maindeck + optional sideboard. The
 *  builder's working deck, a `userDecks` row, and a `presetDecks` row all
 *  structurally satisfy this. */
export interface ValidatableDeck {
    cards: DeckCard[];
    sideboard?: DeckCard[];
}

/**
 * Static metadata + the per-format validator. Shared fields (`allowedSets`,
 * `minMain`, `maxSide`) are carried so later slices' shared helpers
 * (`checkSize`, `checkSets`) can compose them; `validate` is the bespoke seam.
 */
export interface FormatMeta {
    /** Human-readable name shown in the create-flow select and lobby filter. */
    label: string;
    /** Set codes a card may come from, or `null` for "any set" (Freeform).
     *  Keys on a print's `setCode`. Not enforced yet in this slice. */
    allowedSets: string[] | null;
    /** Minimum maindeck size. `0` = no minimum (Freeform). */
    minMain: number;
    /** Maximum sideboard size. `null` = no maximum (Freeform). */
    maxSide: number | null;
    /** Pure legality check. Returns the list of failure reasons (empty = legal).
     *  Every format returns `[]` in this foundation slice. */
    validate: (deck: ValidatableDeck) => Reason[];
}

// Freeform behaviour for all three: no reasons, ever. The non-trivial formats
// keep their size/set metadata (informational for now) so the later validation
// slices have the bounds to enforce without re-touching this registry's shape.
const noReasons = (): Reason[] => [];

/**
 * The code-side Format registry (ADR 0036): `FormatId → FormatMeta`. The only
 * place format policy lives — a ruleset change is a code release, never a DB
 * migration. Frozen so a consumer can't mutate the shared metadata.
 */
export const FORMAT_RULES: Record<FormatId, FormatMeta> = {
    freeform: {
        label: "Freeform",
        allowedSets: null,
        minMain: 0,
        maxSide: null,
        validate: noReasons,
    },
    "alpha-40": {
        label: "Alpha 40",
        // Alpha/Beta only (lea/leb). Not enforced until the validation slice.
        allowedSets: ["lea", "leb"],
        minMain: 40,
        maxSide: 0,
        validate: noReasons,
    },
    "old-school": {
        label: "Old School (93/94)",
        // The six implemented eternal sets. Not enforced until the validation slice.
        allowedSets: ["lea", "leb", "arn", "atq", "leg", "drk"],
        minMain: 60,
        maxSide: 15,
        validate: noReasons,
    },
};

/** The outcome of validating a deck against a format: legal iff no reasons. */
export interface DeckLegality {
    isLegal: boolean;
    reasons: Reason[];
}

/**
 * Validate a deck against a Format (ADR 0036). PURE — the single seam shared by
 * the server gate, the lobby list, and the live builder panel, so they never
 * disagree. An unknown `format` is treated as Freeform (legal) defensively;
 * the schema union already prevents a non-conforming value from being stored.
 *
 * In this foundation slice every format returns no reasons, so every deck is
 * reported legal. Later slices flesh out the non-trivial validators.
 */
export function validateDeck(
    deck: ValidatableDeck,
    format: FormatId
): DeckLegality {
    const meta = FORMAT_RULES[format] ?? FORMAT_RULES.freeform;
    const reasons = meta.validate(deck);
    return { isLegal: reasons.length === 0, reasons };
}
