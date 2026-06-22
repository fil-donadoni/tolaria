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

// --- Card-ID copy counting (ADR 0036) -------------------------------------
//
// All copy-bounded rules (the 4-copy limit, the Restricted one-copy list)
// count "by Card ID across printings": two different `printId`s of the same
// card share ONE budget. `resolveDeckCardMeta` already collapses every printing
// to its canonical `cardId` (the `CardDefinition.id`); these helpers group on
// THAT key, never the raw deck-card id. Basic lands are always exempt (CONTEXT
// "Restricted Card"; ADR 0036) — they are excluded before any count is taken.

/** A counted, named card group: its canonical Card ID, a display name (the
 *  first occurrence's `cardName`), and how many copies sit across both zones. */
interface CardCount {
    cardId: string;
    cardName: string;
    count: number;
}

/**
 * Group a deck's non-basic cards by canonical Card ID across maindeck +
 * sideboard, returning one `CardCount` per distinct card. Basics and registry-
 * unknown ids are skipped: basics are exempt from every copy/list rule, and an
 * unknown id is already reported by `checkSets`, so the copy rules stay silent
 * on it rather than double-reporting. Insertion order follows first appearance.
 */
function countByCardId(
    deck: ValidatableDeck,
    resolve: ResolveCard
): CardCount[] {
    const counts = new Map<string, CardCount>();
    const all = [...deck.cards, ...(deck.sideboard ?? [])];
    for (const card of all) {
        const meta = resolve(card.cardId);
        if (meta === null) continue; // unknown id — checkSets owns this reason
        if (meta.isBasic) continue; // basics are unlimited (ADR 0036)
        const existing = counts.get(meta.cardId);
        if (existing) {
            existing.count += 1;
        } else {
            counts.set(meta.cardId, {
                cardId: meta.cardId,
                cardName: card.cardName,
                count: 1,
            });
        }
    }
    return [...counts.values()];
}

// --- Old School Restricted + Banned lists (ADR 0036) ----------------------
//
// Eternal Central Old School (93/94) policy + the Swedish (n00bcon) dexterity
// ban, INTERSECTED with the implemented card pool: a card that isn't built yet
// simply never appears here, so each list is implicitly EC∩pool / Swedish∩pool.
// Keyed by canonical `CardDefinition.id` (the value `resolveDeckCardMeta`
// reports), so a reprint print id is covered too. Adding a card later tightens
// existing decks retroactively, correctly, via derivation (no migration).

/**
 * Old School RESTRICTED list — Eternal Central. Each listed card is capped at
 * ONE copy across the whole deck (main + sideboard), counted by Card ID. Only
 * the EC restricted cards that are implemented in the pool are listed; the rest
 * are no-ops until they ship. Ids are canonical `CardDefinition.id`s from the
 * set modules (lea/leb/arn/atq/leg/drk).
 */
export const OLD_SCHOOL_RESTRICTED: ReadonlySet<string> = new Set([
    "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b", // Ancestral Recall (lea)
    "6f9ea46a-411f-40ce-a873-a905180093f4", // Balance (lea)
    "b0faa7f2-b547-42c4-a810-839da50dadfe", // Black Lotus (lea)
    "62b19a12-6914-430e-81ce-dcfca47884df", // Braingeyser (lea)
    "711d4d54-5520-4de8-9b93-79902ed8e562", // Demonic Tutor (lea)
    "ee266113-34ce-4189-84e7-ee2c86a2722c", // Library of Alexandria (arn)
    "eee9e106-a248-49d2-b8c8-6bbcd56ce739", // Mind Twist (lea)
    "135de5c7-6ac9-4b68-8f1a-97f120a4b125", // Mishra's Workshop (atq)
    "b0e1427c-05cd-465b-be59-97ed6e39f7ba", // Mox Emerald (lea)
    "92bcd1ce-19b1-4d78-8b09-95242ca08d76", // Mox Jet (lea)
    "8ebe4be7-e12a-4596-a899-fbd5b152e879", // Mox Pearl (lea)
    "8945585f-4773-493d-a0fe-d707db910b38", // Mox Ruby (lea)
    "82da0972-b17b-4600-9efd-e9430a0db04b", // Mox Sapphire (lea)
    "33296718-0625-4422-a65c-b21cf99c52ec", // Recall (leg)
    "badc73ec-3728-4246-90c7-5f4eb7051ed5", // Regrowth (lea)
    "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", // Sol Ring (lea)
    "e7880157-7f27-4f1b-9cdc-ab36a6252376", // Strip Mine (atq)
    "86a27d68-3e58-4ade-976d-36381beed451", // The Abyss (leg)
    "902441dc-c976-4c92-b897-6376eaa0fe38", // Time Vault (lea)
    "e0139f60-d48e-46fb-9f5a-1e3d7558c834", // Time Walk (lea)
    "9a49dc44-616e-4bdd-8220-0bb71eccc512", // Timetwister (lea)
]);

/**
 * Old School BANNED list — the Swedish (n00bcon) dexterity ban of Chaos Orb and
 * Falling Star, plus the ante/Shahrazad cards. Every entry is unimplementable
 * (manual-dexterity, CR 712; ante & subgames, ADR 0010), so this is a
 * DOCUMENTATION GUARD: it carries the id of the Chaos Orb stub (currently
 * commented out in sets/lea.ts) so that, the moment that stub is uncommented,
 * the card is rejected from Old School rather than silently becoming legal.
 * Falling Star and Shahrazad have no id in the pool yet; they are part of the
 * Swedish∩pool / ADR-0010∩pool intersection (empty) and gain a guard when their
 * stubs land.
 */
export const OLD_SCHOOL_BANNED: ReadonlySet<string> = new Set([
    "92274971-7c4a-4326-b0fe-75e2d124f718", // Chaos Orb (lea stub — out of scope, ADR 0010)
]);

/**
 * Restricted-list check (ADR 0036): each card on `restricted` is capped at one
 * copy across the whole deck (counted by Card ID). A 2nd copy of a restricted
 * card yields one precise reason; basics are already excluded by
 * `countByCardId`.
 */
export function checkRestricted(
    deck: ValidatableDeck,
    restricted: ReadonlySet<string>,
    resolve: ResolveCard
): Reason[] {
    const reasons: Reason[] = [];
    for (const { cardId, cardName, count } of countByCardId(deck, resolve)) {
        if (restricted.has(cardId) && count > 1) {
            reasons.push({
                code: "restricted",
                message: `${cardName}: ${count} copies, restricted to 1.`,
            });
        }
    }
    return reasons;
}

/**
 * Banned-list check (ADR 0036): any presence of a banned card is illegal (zero
 * copies allowed). Counted by Card ID so a reprint of a banned card is caught
 * too. In practice the banned cards are unimplementable guards (see
 * `OLD_SCHOOL_BANNED`), so this fires only if such a stub is ever shipped.
 */
export function checkBanned(
    deck: ValidatableDeck,
    banned: ReadonlySet<string>,
    resolve: ResolveCard
): Reason[] {
    const reasons: Reason[] = [];
    for (const { cardId, cardName, count } of countByCardId(deck, resolve)) {
        if (banned.has(cardId) && count > 0) {
            reasons.push({
                code: "banned",
                message: `${cardName}: banned in this format.`,
            });
        }
    }
    return reasons;
}

/**
 * Copy-limit check (ADR 0036): no non-basic card may appear more than `limit`
 * times across the whole deck, counted by Card ID. The standard constructed
 * 4-copy rule for Old School. Basics are exempt (excluded by `countByCardId`).
 * A card that is ALSO restricted is reported by `checkRestricted` at its
 * tighter one-copy bound; this check still fires independently if it somehow
 * exceeds `limit`, but the two reasons are complementary, not contradictory.
 */
export function checkCopyLimit(
    deck: ValidatableDeck,
    limit: number,
    resolve: ResolveCard
): Reason[] {
    const reasons: Reason[] = [];
    for (const { cardName, count } of countByCardId(deck, resolve)) {
        if (count > limit) {
            reasons.push({
                code: "copy-limit",
                message: `${cardName}: ${count} copies, maximum is ${limit}.`,
            });
        }
    }
    return reasons;
}

/** Standard constructed copy ceiling for non-basic cards in Old School. */
const OLD_SCHOOL_COPY_LIMIT = 4;

/**
 * The full Old School (93/94) validator (ADR 0036): size + set membership +
 * the 4-copy limit + the Eternal Central Restricted list + the (guard) Banned
 * list. Composed from the shared helpers; each violation surfaces its own
 * precise `Reason`. Counting for the copy/restricted/banned rules is by Card ID
 * across printings, with basics exempt.
 */
function oldSchoolValidate(
    deck: ValidatableDeck,
    resolve: ResolveCard
): Reason[] {
    const meta = FORMAT_RULES["old-school"];
    return [
        ...checkSize(deck, meta),
        ...checkSets(deck, meta, resolve),
        ...checkCopyLimit(deck, OLD_SCHOOL_COPY_LIMIT, resolve),
        ...checkRestricted(deck, OLD_SCHOOL_RESTRICTED, resolve),
        ...checkBanned(deck, OLD_SCHOOL_BANNED, resolve),
    ];
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
        // Full legality (issue #516): size + sets + 4-copy limit + EC Restricted
        // (1-copy) + Banned (0, guard) — see oldSchoolValidate.
        validate: oldSchoolValidate,
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
