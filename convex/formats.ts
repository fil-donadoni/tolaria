// Deck Formats — typed, immutable construction Formats (PRD #509, ADR 0036).
//
// This is the LEGALITY-PIPELINE slice (issue #512): the validation tracer
// bullet, wiring `validateDeck` end-to-end through the only rules that need no
// new data — maindeck/sideboard SIZE and SET MEMBERSHIP. Later slices plug the
// richer rules (Old School's restricted/banned lists, Alpha 40's rarity /
// category budgets) into the SAME per-format `validate()` seam.
//
// Per ADR 0036 this module is PURE and importable by BOTH the Convex server
// (authoritative gate at game start; legality on the lobby deck list) and the
// frontend (live validation panel). It lives at `convex/formats.ts` — it is
// NOT a `convex/gre/` engine module, so it does not cross the engine boundary.
// Legality is DERIVED, never stored: `validateDeck` is a pure function of the
// deck contents + the code-side rules.

import type { DeckCard } from "./deckPresets";
import { resolveDeckCardMeta, type DeckCardMeta } from "./cards";

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
 * A single legality failure reason: a stable machine `code` plus a precise,
 * human-readable `message`. The lobby list and the live builder panel render
 * `message`; later slices add new `code`s without changing this shape or the
 * `validateDeck` contract.
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
 * Resolves a deck-card id to the construction metadata a validator keys on
 * (set / rarity / Basic). Injected into every `validate()` so the module stays
 * pure and the card-registry lookup is the only impure dependency, threaded in
 * one place by `validateDeck`. `null` for an id absent from the registry, which
 * a set-aware validator treats as out-of-pool.
 */
export type ResolveCard = (cardId: string) => DeckCardMeta | null;

/**
 * Static metadata + the per-format validator. Shared fields (`allowedSets`,
 * `minMain`, `maxSide`) drive the shared helpers (`checkSize`, `checkSets`)
 * that compose into each `validate`; the bespoke parts (later slices) live in
 * each format's own validator.
 */
export interface FormatMeta {
    /** Human-readable name shown in the create-flow select and lobby filter. */
    label: string;
    /** Set codes a card may come from, or `null` for "any set" (Freeform).
     *  Keys on a print's `setCode`. Basic lands are always exempt. */
    allowedSets: string[] | null;
    /** Minimum maindeck size. `0` = no minimum (Freeform). */
    minMain: number;
    /** Maximum sideboard size. `null` = no maximum (Freeform). */
    maxSide: number | null;
    /** Pure legality check. Returns the list of failure reasons (empty = legal),
     *  using `resolve` for any card-level lookup. */
    validate: (deck: ValidatableDeck, resolve: ResolveCard) => Reason[];
}

// --- Shared validation helpers (ADR 0036) ---------------------------------
//
// Small, composable pieces each enforcing one constraint family. A format's
// `validate` is just the sequence of helpers it cares about; later slices add
// more helpers (copy limits, restricted/banned, rarity/category) without
// re-touching the ones below.

/**
 * Maindeck minimum + sideboard maximum (the format's declared bounds). A deck
 * below `minMain` or above `maxSide` yields one precise reason per breach. A
 * `maxSide` of `0` means "no sideboard" — any sideboard card is a breach.
 */
export function checkSize(deck: ValidatableDeck, meta: FormatMeta): Reason[] {
    const reasons: Reason[] = [];
    const mainCount = deck.cards.length;
    const sideCount = deck.sideboard?.length ?? 0;

    if (meta.minMain > 0 && mainCount < meta.minMain) {
        reasons.push({
            code: "size-min",
            message: `Maindeck has ${mainCount} cards, minimum is ${meta.minMain}.`,
        });
    }
    if (meta.maxSide !== null && sideCount > meta.maxSide) {
        reasons.push({
            code: "size-max-side",
            message:
                meta.maxSide === 0
                    ? `Sideboard has ${sideCount} cards; this format allows no sideboard.`
                    : `Sideboard has ${sideCount} cards, maximum is ${meta.maxSide}.`,
        });
    }
    return reasons;
}

/**
 * Set membership (ADR 0036): every non-basic card's print `setCode` must be in
 * `allowedSets`. Basic lands (the `Basic` supertype) are always legal and never
 * checked. `allowedSets === null` (Freeform) accepts every set. An id the
 * registry can't resolve is reported once as unknown (out-of-pool). Reasons are
 * de-duplicated by card name so a 4-of disallowed card yields a single line.
 */
export function checkSets(
    deck: ValidatableDeck,
    meta: FormatMeta,
    resolve: ResolveCard
): Reason[] {
    if (meta.allowedSets === null) return [];
    const allowed = new Set(meta.allowedSets);
    const reasons: Reason[] = [];
    const seen = new Set<string>();

    // Both zones are constructed cards subject to the set list.
    const all = [...deck.cards, ...(deck.sideboard ?? [])];
    for (const card of all) {
        if (seen.has(card.cardId)) continue;
        seen.add(card.cardId);
        const cardMeta = resolve(card.cardId);
        if (cardMeta === null) {
            reasons.push({
                code: "set-unknown",
                message: `${card.cardName}: card is not in the playable pool.`,
            });
            continue;
        }
        if (cardMeta.isBasic) continue; // basics always set-legal (ADR 0036)
        if (!allowed.has(cardMeta.setCode)) {
            reasons.push({
                code: "set-not-allowed",
                message: `${card.cardName}: set "${cardMeta.setCode}" is not allowed in this format.`,
            });
        }
    }
    return reasons;
}

/**
 * The size + set-membership validator shared by both non-trivial Formats in
 * this slice. Old School and Alpha 40 differ only in their bounds and set list
 * (carried in `meta`); the legality SHAPE is identical here. Later slices append
 * each format's bespoke rules to its own `validate`.
 */
function sizeAndSets(
    deck: ValidatableDeck,
    meta: FormatMeta,
    resolve: ResolveCard
): Reason[] {
    return [...checkSize(deck, meta), ...checkSets(deck, meta, resolve)];
}

// Freeform: no constraints, ever (ADR 0036).
const noReasons = (): Reason[] => [];

/**
 * The code-side Format registry (ADR 0036): `FormatId → FormatMeta`. The only
 * place format policy lives — a ruleset change is a code release, never a DB
 * migration.
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
        // Alpha/Beta only (lea/leb), >=40 maindeck, no sideboard.
        allowedSets: ["lea", "leb"],
        minMain: 40,
        maxSide: 0,
        validate: (deck, resolve) =>
            sizeAndSets(deck, FORMAT_RULES["alpha-40"], resolve),
    },
    "old-school": {
        label: "Old School (93/94)",
        // The six implemented eternal sets, >=60 maindeck, <=15 sideboard.
        allowedSets: ["lea", "leb", "arn", "atq", "leg", "drk"],
        minMain: 60,
        maxSide: 15,
        validate: (deck, resolve) =>
            sizeAndSets(deck, FORMAT_RULES["old-school"], resolve),
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
 * disagree. The card-registry lookup is threaded in here as the `resolve`
 * dependency (overridable in tests). An unknown `format` is treated as Freeform
 * (legal) defensively; the schema union already prevents a non-conforming value
 * from being stored.
 */
export function validateDeck(
    deck: ValidatableDeck,
    format: FormatId,
    resolve: ResolveCard = resolveDeckCardMeta
): DeckLegality {
    const meta = FORMAT_RULES[format] ?? FORMAT_RULES.freeform;
    const reasons = meta.validate(deck, resolve);
    return { isLegal: reasons.length === 0, reasons };
}

/** The deck shape the game-start gate accepts: contents plus a raw `format`
 *  string (the mutation arg, not yet narrowed to a `FormatId`). */
export interface GateDeck extends ValidatableDeck {
    name?: string;
    format: string;
}

/**
 * Authoritative game-start gate (ADR 0036, "gate-at-play"). Throws if `deck` is
 * illegal for its declared format; a legal deck passes silently. PURE and
 * exported so the game-start mutations (`createGame`, `joinGame`,
 * `createSoloGame`) re-validate every deck server-side — the client legality
 * panel is advisory, this is the source of truth — and so the gate is unit-
 * tested directly (the project has no convex-test harness). A raw `format`
 * string is normalized: an unknown value falls back to Freeform (always legal),
 * mirroring `validateDeck`. The thrown message lists every failure reason.
 */
export function assertDeckLegal(
    deck: GateDeck,
    resolve: ResolveCard = resolveDeckCardMeta
): void {
    const format: FormatId = isFormatId(deck.format) ? deck.format : "freeform";
    const { isLegal, reasons } = validateDeck(deck, format, resolve);
    if (isLegal) return;
    const label = deck.name ? `"${deck.name}"` : "Deck";
    throw new Error(
        `${label} is not legal for ${FORMAT_RULES[format].label}: ${reasons
            .map((r) => r.message)
            .join(" ")}`
    );
}
