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
export type FormatId =
    | "freeform"
    | "alpha-40"
    | "old-school"
    | "premodern"
    | "limited";

/** Every valid `FormatId`, in display order. The single source of truth the
 *  schema union, the create-flow select, and the validators all key off. */
export const FORMAT_IDS: readonly FormatId[] = [
    "freeform",
    "alpha-40",
    "old-school",
    "premodern",
    "limited",
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
    /** Limited Event + Seat reference (ADR 0054/0055, issue #1109): the deck's
     *  whole Pool was generated (Sealed) or drafted at this Seat. Only the
     *  `limited` format's validator reads these two fields (through an
     *  injected `ResolvePool`) — every other format ignores them entirely.
     *  Absent ⇒ no resolvable Pool ⇒ illegal for `limited` (never a silent
     *  pass). Optional so every existing `ValidatableDeck` caller (builder
     *  working deck, `userDecks`/`presetDecks` rows, `matches.ts` Match deck
     *  copy) keeps satisfying this interface unchanged. */
    limitedEventId?: string;
    limitedSeatId?: string;
}

/**
 * Resolves a deck-card id to the construction metadata a validator keys on
 * (set / rarity / Basic). Injected into every `validate()` so the module stays
 * pure and the card-registry lookup is the only impure dependency, threaded in
 * one place by `validateDeck`. `null` for an id absent from the registry, which
 * a set-aware validator treats as out-of-pool.
 */
export type ResolveCard = (cardId: string) => DeckCardMeta | null;

// --- Limited: pool-scoped legality (ADR 0054/0055, issue #1109) -----------
//
// A Limited seat's authoritative Pool is the whole set of non-basic cards it
// was granted — every opened Sealed booster or every drafted Pick, flattened
// to a multiset by canonical Card ID. Basic lands are NEVER stored in a Pool:
// the format lets a builder add unlimited basics regardless of the Pool
// (mirroring `checkSets`'s basic exemption), so a Pool only needs to carry
// what it actually constrains. The Pool itself is produced upstream (the
// event/seat tables land in issue #1110); this module stays pure by taking
// it through the SAME injection pattern as `resolve`/`banlist` — a
// `ResolvePool` callback, never a direct DB read.

/** A single counted card entry in a Limited seat's Pool: canonical Card ID,
 *  display name (for human-readable reasons), and how many copies the seat
 *  holds. */
export interface PoolCard {
    cardId: string;
    cardName: string;
    count: number;
}

/** A Limited seat's authoritative Pool (ADR 0054/0055): every non-basic card
 *  granted to the seat, as a multiset by canonical Card ID. */
export interface Pool {
    cards: readonly PoolCard[];
}

/**
 * Resolves a Limited deck (via its `limitedEventId`/`limitedSeatId`) to its
 * authoritative Pool, or `null` when it can't be resolved — no event/seat
 * reference on the deck, an unknown id, or a seat whose Pool hasn't been
 * generated yet. Injected exactly like `ResolveCard`/`BanlistOverride` (ADR
 * 0036) so this module stays pure; the real seat-table lookup (issue #1110)
 * lives above it, in the caller. `null` is a HARD failure for `limitedValidate`
 * — "no resolvable Pool" is illegal, never a silent pass (issue #1109 AC).
 */
export type ResolvePool = (deck: ValidatableDeck) => Pool | null;

/**
 * Build a Pool from a flat list of cards — a Sealed pool's opened boosters
 * flattened, or a Draft's accumulated Picks. This is the shape the (future)
 * event/seat storage (issue #1110) can call once a seat's real Pool is
 * generated, and it doubles as the fixture builder for this module's own
 * tests. Canonicalizes each card to its `resolve`d Card ID — exactly like
 * `countByCardId` below — so two printings of the same card collapse into one
 * multiset entry, and drops basics (a Pool never stores them; see the basic
 * exemption above).
 */
export function buildPool(cards: DeckCard[], resolve: ResolveCard): Pool {
    const counts = new Map<string, PoolCard>();
    for (const card of cards) {
        const meta = resolve(card.cardId);
        if (meta === null || meta.isBasic) continue; // unknown / basic — never pooled
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
    return { cards: [...counts.values()] };
}

/** Deck-side counting used specifically for pool-membership. Unlike
 *  `countByCardId` (below), an unresolvable id is NOT silently dropped —
 *  `limited` has no companion `checkSets` to own that reason (pool matching
 *  IS its set-membership check), so an unknown id must still surface as
 *  "not in Pool" rather than vanish. Basics remain exempt on both sides. */
interface PoolCheckCount {
    cardId: string;
    cardName: string;
    count: number;
}
function countForPoolCheck(
    deck: ValidatableDeck,
    resolve: ResolveCard
): PoolCheckCount[] {
    const counts = new Map<string, PoolCheckCount>();
    const all = [...deck.cards, ...(deck.sideboard ?? [])];
    for (const card of all) {
        const meta = resolve(card.cardId);
        if (meta?.isBasic) continue; // basics exempt from Pool matching
        // Unresolved ids fall back to the raw deck-card id — a real Pool
        // never contains one, so it surfaces below as "not granted".
        const cardId = meta?.cardId ?? card.cardId;
        const existing = counts.get(cardId);
        if (existing) {
            existing.count += 1;
        } else {
            counts.set(cardId, { cardId, cardName: card.cardName, count: 1 });
        }
    }
    return [...counts.values()];
}

/**
 * Pool-membership check (ADR 0054/0055, issue #1109): every non-basic card
 * across BOTH zones must be accounted for by the seat's Pool, card-for-card —
 * the deck's non-basic multiset (by canonical Card ID) must equal the Pool's
 * multiset exactly. Two independent violations surface: a card the deck
 * plays that the Pool never granted (the tamper case — a client fabricating a
 * card, issue #1109 AC3) or more copies than granted, and a Pool card the
 * deck doesn't place in either zone — "the whole Pool travels with the deck"
 * (ADR 0055, MTGO model: maindeck + sideboard together ARE the Pool). Basics
 * are exempt on both sides.
 */
export function checkPoolMembership(
    deck: ValidatableDeck,
    pool: Pool,
    resolve: ResolveCard
): Reason[] {
    const reasons: Reason[] = [];
    const deckCounts = countForPoolCheck(deck, resolve);
    const deckByCardId = new Map(deckCounts.map((c) => [c.cardId, c]));
    const poolByCardId = new Map(pool.cards.map((c) => [c.cardId, c]));

    for (const { cardId, cardName, count } of deckCounts) {
        const granted = poolByCardId.get(cardId)?.count ?? 0;
        if (granted === 0) {
            reasons.push({
                code: "pool-not-granted",
                message: `${cardName}: not in this seat's Pool.`,
            });
        } else if (count > granted) {
            reasons.push({
                code: "pool-excess-copies",
                message: `${cardName}: ${count} copies played, Pool grants only ${granted}.`,
            });
        }
    }

    for (const { cardId, cardName, count: granted } of pool.cards) {
        const inDeck = deckByCardId.get(cardId)?.count ?? 0;
        if (inDeck < granted) {
            const missing = granted - inDeck;
            reasons.push({
                code: "pool-card-unplaced",
                message: `${cardName}: ${missing} cop${missing === 1 ? "y" : "ies"} from the Pool not placed in the Maindeck or Sideboard.`,
            });
        }
    }

    return reasons;
}

/**
 * An injected banlist override (PRD #1138, issue #1140): banned/restricted
 * card ids for a single format, sourced from the DB (name→id resolved live at
 * read time by the caller) rather than the code-side constants below. Mirrors
 * the existing injected `resolve` dependency (ADR 0036) so `validateDeck` /
 * `assertDeckLegal` stay pure — the DB read happens above this module, never
 * inside it. When omitted, each format's own code constants
 * (`PREMODERN_BANNED`, `OLD_SCHOOL_BANNED`, `OLD_SCHOOL_RESTRICTED`) are used
 * as the seed/fallback, so existing callers and tests are unaffected.
 */
export interface BanlistOverride {
    banned: ReadonlySet<string>;
    restricted: ReadonlySet<string>;
}

/** The two formats a DB-backed banlist exists for (PRD #1138). Narrower than
 *  `FormatId`: Alpha 40 keeps its bespoke Eternal Central lists fully
 *  code-managed and Freeform has no banlist, so neither is DB-backed. Kept in
 *  sync with the `formatBanlists.format` union in `convex/schema.ts`. */
export type BanlistFormatId = "premodern" | "old-school";

/** Type guard: is an arbitrary `FormatId` (or raw string) one of the two
 *  DB-backed banlist Formats? Mirrors `isFormatId`'s role for `FormatId` —
 *  the single authority both the server helper (`loadBanlistOverrides`,
 *  `convex/banlists.ts`) and any client call site key off, so the
 *  premodern/old-school literal pair is never repeated ad hoc (issue #1144). */
export function isBanlistFormatId(value: string): value is BanlistFormatId {
    return value === "premodern" || value === "old-school";
}

/** A single official banlist entry by oracle NAME (never an id — the DB row
 *  shape minus `source`/`syncedAt`, which only the sync/admin surface cares
 *  about). Shared by the DB-row projection and the code-side seed below. */
export interface BanlistEntry {
    cardName: string;
    status: "banned" | "restricted";
    /** Scryfall card id, captured at sync time (PRD #1138 follow-up). Lets the
     *  admin banlist dialog show a card's Scryfall image even when the name has
     *  no `CardDefinition` in our engine (e.g. Amulet of Quoz — a banlist card
     *  we will never build). Absent on code-seed rows (the pre-sync fallback)
     *  and on rows synced before this field existed. */
    scryfallId?: string;
}

/**
 * Resolves a card NAME to its built `CardDefinition.id` (or `null` if no
 * card by that name is registered yet). Structurally satisfied by
 * `tryGetCardByName` (`convex/cards/index.ts`, the `nameRegistry` authority);
 * injected here (rather than imported) so this module stays free of the
 * `convex/cards/index.ts` card-catalogue import, mirroring `ResolveCard`.
 */
export type ResolveCardByName = (cardName: string) => { id: string } | null;

/**
 * Maps a format's full banlist `entries` (by name — DB rows or the seed
 * fallback) to enforcement `BanlistOverride` cardId sets (PRD #1138, issue
 * #1141). PURE: `resolve` is the only impure dependency, injected by the
 * caller (`convex/banlists.ts`) exactly like `ResolveCard` elsewhere in this
 * module. A name with no built card is DROPPED from enforcement (the
 * silent-legal window stays closed the other way: an unbuilt card can't be
 * illegally "in" a deck) while it remains visible in the `entries` list the
 * caller also serves for display — the two lists diverge on purpose.
 */
export function resolveBanlistEnforcement(
    entries: readonly BanlistEntry[],
    resolve: ResolveCardByName
): BanlistOverride {
    const banned = new Set<string>();
    const restricted = new Set<string>();
    for (const entry of entries) {
        const card = resolve(entry.cardName);
        if (!card) continue; // unbuilt name — enforcement can't gate it yet
        if (entry.status === "banned") banned.add(card.id);
        else restricted.add(card.id);
    }
    return { banned, restricted };
}

/** Source tag stamped on every code-side seed row (`convex/banlists.ts`),
 *  distinguishing it from a Scryfall-synced row once the sync action ships. */
export const BANLIST_SEED_SOURCE = "code-seed";

/**
 * Premodern BANLIST SEED (issue #1141) — the DB fallback used while
 * `formatBanlists` has no Premodern rows yet (pre-first-sync). Derived from
 * `PREMODERN_BANNED`'s own cards (by name, so the built ones round-trip back
 * to the SAME ids through `resolveBanlistEnforcement`) plus officially
 * banned names with no `CardDefinition` yet — the exact gap this feature
 * closes (Parallax Tide is the canonical example from the PRD). Not
 * exhaustive of the real-world Premodern banlist; the admin Scryfall sync
 * (a later slice) replaces this with the authoritative list.
 */
export const PREMODERN_BANLIST_SEED: readonly BanlistEntry[] = [
    { cardName: "Balance", status: "banned" },
    { cardName: "Brainstorm", status: "banned" },
    { cardName: "Channel", status: "banned" },
    { cardName: "Demonic Consultation", status: "banned" },
    { cardName: "Demonic Tutor", status: "banned" },
    { cardName: "Entomb", status: "banned" },
    { cardName: "Grim Monolith", status: "banned" },
    { cardName: "Mana Vault", status: "banned" },
    { cardName: "Memory Jar", status: "banned" },
    { cardName: "Mind Twist", status: "banned" },
    { cardName: "Necropotence", status: "banned" },
    { cardName: "Strip Mine", status: "banned" },
    { cardName: "Tolarian Academy", status: "banned" },
    // Officially banned, no CardDefinition yet (dropped from enforcement,
    // still shown in the display list — the point of this feature):
    { cardName: "Amulet of Quoz", status: "banned" },
    { cardName: "Mystical Tutor", status: "banned" },
    { cardName: "Vampiric Tutor", status: "banned" },
    { cardName: "Parallax Tide", status: "banned" },
];

/**
 * Old School BANLIST SEED (issue #1141) — mirrors `OLD_SCHOOL_RESTRICTED` /
 * `OLD_SCHOOL_BANNED` by name (same rationale as the Premodern seed above),
 * plus the two ante/dexterity-ban names those constants document but don't
 * yet carry an id for (Falling Star, Shahrazad — ADR 0010 / CR 712).
 */
export const OLD_SCHOOL_BANLIST_SEED: readonly BanlistEntry[] = [
    { cardName: "Ancestral Recall", status: "restricted" },
    { cardName: "Balance", status: "restricted" },
    { cardName: "Black Lotus", status: "restricted" },
    { cardName: "Braingeyser", status: "restricted" },
    { cardName: "Demonic Tutor", status: "restricted" },
    { cardName: "Library of Alexandria", status: "restricted" },
    { cardName: "Mind Twist", status: "restricted" },
    { cardName: "Mishra's Workshop", status: "restricted" },
    { cardName: "Mox Emerald", status: "restricted" },
    { cardName: "Mox Jet", status: "restricted" },
    { cardName: "Mox Pearl", status: "restricted" },
    { cardName: "Mox Ruby", status: "restricted" },
    { cardName: "Mox Sapphire", status: "restricted" },
    { cardName: "Recall", status: "restricted" },
    { cardName: "Regrowth", status: "restricted" },
    { cardName: "Sol Ring", status: "restricted" },
    { cardName: "Strip Mine", status: "restricted" },
    { cardName: "The Abyss", status: "restricted" },
    { cardName: "Time Vault", status: "restricted" },
    { cardName: "Time Walk", status: "restricted" },
    { cardName: "Timetwister", status: "restricted" },
    { cardName: "Chaos Orb", status: "banned" },
    { cardName: "Falling Star", status: "banned" },
    { cardName: "Shahrazad", status: "banned" },
];

/** `BanlistFormatId → BanlistEntry[]` seed registry, keyed the same way as
 *  `formatBanlists.format`. The single lookup `convex/banlists.ts` uses when
 *  a format's DB rows are empty. */
export const BANLIST_SEEDS: Record<BanlistFormatId, readonly BanlistEntry[]> = {
    premodern: PREMODERN_BANLIST_SEED,
    "old-school": OLD_SCHOOL_BANLIST_SEED,
};

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
     *  using `resolve` for any card-level lookup. `banlist`, when present, is an
     *  injected banned/restricted override (issue #1140) — a format whose
     *  banlist is not DB-backed (Alpha 40, Freeform) simply ignores it.
     *  `resolvePool`, when present, is the injected Pool resolver (issue
     *  #1109) — only `limited`'s validator reads it; every other format's
     *  `validate` keeps its existing 2/3-argument signature unchanged (a
     *  function with fewer params structurally satisfies this type, so no
     *  existing format needed to be touched). */
    validate: (
        deck: ValidatableDeck,
        resolve: ResolveCard,
        banlist?: BanlistOverride,
        resolvePool?: ResolvePool
    ) => Reason[];
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

// --- Card-ID copy counting (ADR 0036) -------------------------------------
//
// All copy-bounded rules (the 4-copy limit, the Restricted one-copy list)
// count "by Card ID across printings": two different `printId`s of the same
// card share ONE budget. `resolveDeckCardMeta` already collapses every printing
// to its canonical `cardId` (the `CardDefinition.id`); these helpers group on
// THAT key, never the raw deck-card id. Basic lands are always exempt (CONTEXT
// "Restricted Card"; ADR 0036) — they are excluded before any count is taken.

/** A counted, named card group: its canonical Card ID, a display name (the
 *  first occurrence's `cardName`), the printed `rarity` of the first occurrence
 *  (Alpha 40's rarity caps read this), and how many copies sit across both
 *  zones. */
interface CardCount {
    cardId: string;
    cardName: string;
    rarity: DeckCardMeta["rarity"];
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
                rarity: meta.rarity,
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
 * across printings, with basics exempt. When `banlist` is injected (issue
 * #1140), its `banned`/`restricted` sets override the code constants; absent,
 * `OLD_SCHOOL_BANNED`/`OLD_SCHOOL_RESTRICTED` are the seed/fallback.
 */
function oldSchoolValidate(
    deck: ValidatableDeck,
    resolve: ResolveCard,
    banlist?: BanlistOverride
): Reason[] {
    const meta = FORMAT_RULES["old-school"];
    return [
        ...checkSize(deck, meta),
        ...checkSets(deck, meta, resolve),
        ...checkCopyLimit(deck, OLD_SCHOOL_COPY_LIMIT, resolve),
        ...checkRestricted(
            deck,
            banlist?.restricted ?? OLD_SCHOOL_RESTRICTED,
            resolve
        ),
        ...checkBanned(deck, banlist?.banned ?? OLD_SCHOOL_BANNED, resolve),
    ];
}

// --- Alpha 40 legality lists (ADR 0036) -----------------------------------
//
// Eternal Central's bespoke Alpha 40 ruleset, INTERSECTED with the implemented
// lea/leb pool (allowedSets ["lea","leb"]), keyed by canonical
// `CardDefinition.id`. Alpha 40 is a "time capsule" of 1993 deckbuilding, but
// the cards PLAY on our modern engine: these lists are pure DECK-CONSTRUCTION
// policy and carry none of EC's 1993 rules errata (old mana costs, interrupt
// timing, manual dexterity). Unimplemented or out-of-scope cards (Chaos Orb —
// dexterity, CR 712; ante cards — ADR 0010) simply never appear here, so each
// list is implicitly EC∩pool and a card added later tightens decks retroactively
// via derivation (no migration). The per-card rarity caps are DERIVED from each
// card's `rarity` field, not a list.

/**
 * Alpha 40 BANNED list — zero copies allowed. EC bans ante/draft-manipulation
 * cards (Contract from Below, Dark Pact, Demonic Attorney) and Mind Twist. Only
 * Mind Twist is implemented today; the ante cards are out of scope (ADR 0010)
 * and remain documentation guards until/if their stubs ship.
 */
const ALPHA40_BANNED: ReadonlySet<string> = new Set([
    "eee9e106-a248-49d2-b8c8-6bbcd56ce739", // Mind Twist (lea, rare)
]);

/**
 * Alpha 40 RESTRICTED list — one copy each (EC "Limit 1"). Dual lands and a
 * handful of high-power cards. Counted by Card ID; tighter than any rarity cap.
 */
const ALPHA40_RESTRICTED: ReadonlySet<string> = new Set([
    "717f6d10-9144-4ade-9ac6-a481cc66b875", // Badlands (lea, rare)
    "412ceddd-2b9a-4551-a6bf-ae2830a2010a", // Bayou (lea, rare)
    "c1862c47-71cc-45a3-8805-a5ddc62e55ea", // Channel (lea, uncommon)
    "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063", // Copy Artifact (lea, rare)
    "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9", // Disrupting Scepter (lea, rare)
    "e68ac362-6cdc-48a6-bdd3-4f8ea32add64", // Earthquake (lea, rare)
    "a575a9af-e1de-4a1d-91d8-440585377e4f", // Fastbond (lea, rare)
    "e6b43916-fe2d-417a-a550-d7c795023297", // Fork (lea, rare)
    "51f8f6e1-a451-4262-90d3-5107caf54175", // Howling Mine (lea, rare)
    "73e3e0b3-5284-464f-8c62-0f7801c966f5", // Mana Short (lea, rare)
    "6eafa00b-c628-40f6-86eb-88e1361fc7a0", // Plateau (lea, rare)
    "94f7e24c-2546-41b6-81ad-5e920b07e64e", // Savannah (lea, rare)
    "bebe39d4-21fb-46a4-a1ec-b97102e46c15", // Scrubland (lea, rare)
    "b6cef408-5b4b-49f6-9531-be544815b93f", // Stasis (lea, rare)
    "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be", // Taiga (lea, rare)
    "a9c6c759-aabf-44e7-ba8c-33c5df232b56", // Tropical Island (lea, rare)
    "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", // Tundra (lea, rare)
    "ff76ac86-8a8a-47fe-9388-8950ca3e26c3", // Underground Sea (lea, rare)
    "a80582b1-09db-45f8-b362-0e5207a5a8e6", // Volcanic Eruption (lea, rare)
    "9359f60c-9a27-4e53-b35b-964a121a6fba", // Winter Orb (lea, rare)
    "a2788d69-6a3a-42f0-8736-cc6b57755ecd", // Wrath of God (lea, rare)
]);

/**
 * Alpha 40 MODERATED list — three copies each, regardless of rarity (EC "Limit
 * 3"). Strong commons/uncommons (Lightning Bolt, Counterspell, Swords to
 * Plowshares, …) that their rarity cap (∞ / 6) would otherwise leave too loose.
 * Overridden by the restricted/category constraints when a card sits on both.
 */
const ALPHA40_MODERATED: ReadonlySet<string> = new Set([
    "76ac72f8-5b1e-4d67-a796-ef69cde27424", // Black Vise (lea, uncommon)
    "30935e4a-013e-4c46-ad05-304df8e5dfa4", // Copper Tablet (lea, uncommon)
    "0df55e3f-14de-46ef-b6b1-616618724d9e", // Counterspell (lea, uncommon)
    "b43b900f-2d9b-442b-9699-058483604ec9", // Hypnotic Specter (lea, uncommon)
    "9914836e-2fa6-4390-94b2-431427848a54", // Ice Storm (lea, uncommon)
    "29dc1596-a2e7-4d60-9f99-89babaef8a06", // Icy Manipulator (lea, uncommon)
    "dcd6a291-5282-4f49-8203-d9b416083c48", // Juggernaut (lea, uncommon)
    "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", // Lightning Bolt (lea, common)
    "a6a86e6e-bfff-46af-9d36-c912901fea92", // Psionic Blast (lea, uncommon)
    "04b31611-9053-4eaf-b392-21bb644fef5f", // Sinkhole (lea, common)
    "57ff74cb-a2ed-4123-ac42-f72f9820049e", // Stone Rain (lea, common)
    "386ea9eb-abc1-4862-aa2d-8fb808d79490", // Swords to Plowshares (lea, uncommon)
]);

/** A named Category Budget: at most ONE card TOTAL may be taken from `cards`
 *  (across both zones, counted by Card ID). A card in two categories consumes
 *  BOTH budgets (Ancestral Recall is Power AND Draw). */
interface CategoryBudget {
    name: string;
    cards: ReadonlySet<string>;
}

/**
 * Alpha 40 CATEGORY BUDGETS — five lists, each allowing ONE card total from the
 * whole list (not one of each). Membership overlaps deliberately: Ancestral
 * Recall sits in both Power and Draw, so playing it bars every other Power and
 * Draw card. The strictest constraint a card has wins (a category-listed card is
 * never additionally checked against the moderated/rarity caps).
 */
const ALPHA40_CATEGORIES: readonly CategoryBudget[] = [
    {
        name: "Fast Mana",
        cards: new Set([
            "b0faa7f2-b547-42c4-a810-839da50dadfe", // Black Lotus (lea, rare)
            "19499cb7-eccb-4e69-af32-6002d447a160", // Mana Vault (lea, rare)
            "b0e1427c-05cd-465b-be59-97ed6e39f7ba", // Mox Emerald (lea, rare)
            "92bcd1ce-19b1-4d78-8b09-95242ca08d76", // Mox Jet (lea, rare)
            "8ebe4be7-e12a-4596-a899-fbd5b152e879", // Mox Pearl (lea, rare)
            "8945585f-4773-493d-a0fe-d707db910b38", // Mox Ruby (lea, rare)
            "82da0972-b17b-4600-9efd-e9430a0db04b", // Mox Sapphire (lea, rare)
            "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", // Sol Ring (lea, uncommon)
        ]),
    },
    {
        name: "Power",
        cards: new Set([
            "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b", // Ancestral Recall (lea, rare)
            "902441dc-c976-4c92-b897-6376eaa0fe38", // Time Vault (lea, rare)
            "e0139f60-d48e-46fb-9f5a-1e3d7558c834", // Time Walk (lea, rare)
            "9a49dc44-616e-4bdd-8220-0bb71eccc512", // Timetwister (lea, rare)
            "67b369c4-faa8-45c8-a1b9-98f228b69682", // Wheel of Fortune (lea, rare)
        ]),
    },
    {
        name: "Draw",
        cards: new Set([
            "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b", // Ancestral Recall (lea, rare)
            "62b19a12-6914-430e-81ce-dcfca47884df", // Braingeyser (lea, rare)
            "711d4d54-5520-4de8-9b93-79902ed8e562", // Demonic Tutor (lea, uncommon)
            "cac8c421-5b92-481d-b2de-560c0231ab58", // Jayemdae Tome (lea, rare)
            "badc73ec-3728-4246-90c7-5f4eb7051ed5", // Regrowth (lea, uncommon)
        ]),
    },
    {
        name: "Destruction",
        cards: new Set([
            "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb", // Armageddon (lea, rare)
            "6f9ea46a-411f-40ce-a873-a905180093f4", // Balance (lea, rare)
            "12926dc8-8e6f-4a47-a12b-4d674189615a", // Nevinyrral's Disk (lea, rare)
        ]),
    },
    {
        name: "Charms",
        cards: new Set([
            "76693233-7961-4b7e-80f2-ed90e494c4aa", // Crystal Rod (lea, uncommon)
            "5786de12-cade-43c2-a6b0-0c5b294b9d0e", // Iron Star (lea, uncommon)
            "9964d8d8-dc97-4e5f-9f52-173f7e2c37fd", // Ivory Cup (lea, uncommon)
            "2b814198-814b-4619-a158-327af675f8f2", // Soul Net (lea, uncommon)
            "a2931ae0-7836-4000-b9ec-f2029ebf5d96", // Throne of Bone (lea, uncommon)
            "bcae01a2-171b-47cd-87be-f1e4e5314326", // Wooden Sphere (lea, uncommon)
        ]),
    },
];

/** Union of every category-listed Card ID — those cards are governed solely by
 *  the category budgets and skip the moderated/rarity per-card caps (precedence:
 *  a category budget is stricter than either). */
const ALPHA40_CATEGORY_CARDS: ReadonlySet<string> = new Set(
    ALPHA40_CATEGORIES.flatMap((cat) => [...cat.cards])
);

/** Alpha 40 per-rarity copy caps (CR 206 rarity): commons unlimited, uncommons
 *  ≤6, rares ≤3. Returns `null` for "no cap" (commons + basics). */
const ALPHA40_UNCOMMON_CAP = 6;
const ALPHA40_RARE_CAP = 3;
function alpha40RarityCap(rarity: DeckCardMeta["rarity"]): number | null {
    if (rarity === "uncommon") return ALPHA40_UNCOMMON_CAP;
    if (rarity === "rare") return ALPHA40_RARE_CAP;
    return null; // common — unlimited
}

/** Three copies for any Moderated card, regardless of rarity (EC override). */
const ALPHA40_MODERATED_CAP = 3;

/**
 * Category-budget check (ADR 0036): for each of the five lists, the TOTAL copies
 * of cards on that list (across both zones, by Card ID) may not exceed one. A
 * card on two lists is summed into both, so it bars every other member of each.
 * Basics are excluded by `countByCardId`.
 */
export function checkCategoryBudgets(
    deck: ValidatableDeck,
    categories: readonly CategoryBudget[],
    resolve: ResolveCard
): Reason[] {
    const reasons: Reason[] = [];
    const counts = countByCardId(deck, resolve);
    for (const category of categories) {
        let total = 0;
        const members: string[] = [];
        for (const { cardId, cardName, count } of counts) {
            if (category.cards.has(cardId)) {
                total += count;
                members.push(count > 1 ? `${cardName} x${count}` : cardName);
            }
        }
        if (total > 1) {
            reasons.push({
                code: "category-budget",
                message: `${category.name}: ${total} cards (${members.join(", ")}), only 1 allowed from this group.`,
            });
        }
    }
    return reasons;
}

/**
 * Alpha 40 per-card copy caps (ADR 0036): the Moderated 3-copy override, else
 * the rarity cap (uncommon ≤6, rare ≤3, common unlimited). Cards owned by a
 * stricter constraint — banned (0), restricted (1), or a category budget (1
 * total) — are skipped here so each violation surfaces exactly one, most-precise
 * reason (precedence: banned/category/restricted > moderated > rarity). Basics
 * are exempt (excluded by `countByCardId`).
 */
export function checkAlpha40CopyCaps(
    deck: ValidatableDeck,
    resolve: ResolveCard
): Reason[] {
    const reasons: Reason[] = [];
    for (const { cardId, cardName, rarity, count } of countByCardId(
        deck,
        resolve
    )) {
        // A stricter constraint already owns these — avoid a second reason.
        if (
            ALPHA40_BANNED.has(cardId) ||
            ALPHA40_RESTRICTED.has(cardId) ||
            ALPHA40_CATEGORY_CARDS.has(cardId)
        ) {
            continue;
        }
        const moderated = ALPHA40_MODERATED.has(cardId);
        const cap = moderated
            ? ALPHA40_MODERATED_CAP
            : alpha40RarityCap(rarity);
        if (cap !== null && count > cap) {
            const label = moderated ? "moderated to" : "maximum";
            reasons.push({
                code: moderated ? "moderated" : "rarity-cap",
                message: `${cardName}: ${count} copies, ${label} ${cap}.`,
            });
        }
    }
    return reasons;
}

/**
 * The full Alpha 40 validator (ADR 0036): size (≥40 main, empty sideboard) +
 * set membership (lea/leb) + the bespoke copy rules — Banned (0), Restricted
 * (1), Category Budgets (1 per group), and the Moderated/rarity per-card caps.
 * Each rule contributes its own precise `Reason`; counting is by Card ID across
 * printings, with basics exempt.
 */
function alpha40Validate(
    deck: ValidatableDeck,
    resolve: ResolveCard
): Reason[] {
    const meta = FORMAT_RULES["alpha-40"];
    return [
        ...checkSize(deck, meta),
        ...checkSets(deck, meta, resolve),
        ...checkBanned(deck, ALPHA40_BANNED, resolve),
        ...checkRestricted(deck, ALPHA40_RESTRICTED, resolve),
        ...checkCategoryBudgets(deck, ALPHA40_CATEGORIES, resolve),
        ...checkAlpha40CopyCaps(deck, resolve),
    ];
}

// --- Premodern legality (ADR 0036) ----------------------------------------
//
// Premodern is the community eternal format for cards printed from 4th Edition
// (1995) through Scourge (2003), plus the Portal sets — 60-card constructed,
// 15-card sideboard, 4-copy limit, a single Banned list and NO restricted list.
// As with the other formats, both the legal-set pool and the banlist are
// INTERSECTED with the implemented card pool: a Premodern-legal set or a banned
// card that isn't built yet simply never appears here.

/**
 * Premodern LEGAL SETS — the official pool (4th Edition → Scourge + Portal),
 * intersected with the sets Tolaria actually implements. A card whose only
 * built printing is in a non-Premodern set (e.g. an Alpha-only Counterspell)
 * is out-of-pool until a Premodern-legal printing ships. Kept as a named const
 * so the intent is documented and the intersection is auditable at a glance.
 */
export const PREMODERN_LEGAL_SETS: readonly string[] = [
    // Core sets
    "4ed", // Fourth Edition (earliest Premodern-legal set)
    "5ed", // Fifth Edition
    "6ed", // Classic Sixth Edition
    "7ed", // Seventh Edition
    // Expansions (Ice Age block → Scourge)
    "ice", // Ice Age
    "chr", // Chronicles
    "hml", // Homelands
    "all", // Alliances
    "mir", // Mirage
    "vis", // Visions
    "wth", // Weatherlight
    "tmp", // Tempest
    "sth", // Stronghold
    "exo", // Exodus
    "usg", // Urza's Saga
    "ulg", // Urza's Legacy
    "uds", // Urza's Destiny
    "mmq", // Mercadian Masques
    "nem", // Nemesis
    "pcy", // Prophecy
    "inv", // Invasion
    "pls", // Planeshift
    "apc", // Apocalypse
    "ody", // Odyssey
    "tor", // Torment
    "jud", // Judgment
    "ons", // Onslaught
    "lgn", // Legions
    "scg", // Scourge
    // Portal / Starter / box sets (Premodern-legal supplemental printings)
    "por", // Portal
    "p02", // Portal Second Age
    "ptk", // Portal Three Kingdoms
    "s99", // Starter 1999
    "s00", // Starter 2000
    "brb", // Battle Royale Box Set
    "ath", // Anthologies
    "dkm", // Deckmasters
    "btd", // Beatdown Box Set
];

/**
 * Premodern BANNED list — the official banlist INTERSECTED with the implemented
 * pool, keyed by canonical `CardDefinition.id` so every printing (including a
 * reprint into a Premodern-legal set) is caught. Cards whose only built printing
 * is already out-of-pool by set (e.g. Balance, lea) are still banned by id, so
 * they stay illegal even if a legal-set printing is added later. Officially
 * banned cards not yet built (Force of Will, Windfall, Yawgmoth's Will, …) are
 * no-ops until they ship; the three currently-stubbed guards below become active
 * the moment their stub is uncommented.
 */
export const PREMODERN_BANNED: ReadonlySet<string> = new Set([
    "6f9ea46a-411f-40ce-a873-a905180093f4", // Balance (lea)
    "8d42d7aa-7f53-4cfc-842a-086aab2448d1", // Brainstorm (ice) — legal-set printing, real guard
    "c1862c47-71cc-45a3-8805-a5ddc62e55ea", // Channel (lea)
    "8d727b9b-6114-414d-9172-16b6e1db41cc", // Demonic Consultation (ice) — legal-set printing
    "711d4d54-5520-4de8-9b93-79902ed8e562", // Demonic Tutor (lea)
    "f60a2091-fb97-4f04-911b-fce9b6351044", // Entomb (ody) — legal-set printing
    "9ddc9fe1-17c8-4e1d-aeb8-c4214e881280", // Grim Monolith (ulg) — legal-set printing
    "19499cb7-eccb-4e69-af32-6002d447a160", // Mana Vault (lea)
    "a15d33d6-7213-4482-a1be-ac0a73644af6", // Memory Jar (ulg) — legal-set printing
    "eee9e106-a248-49d2-b8c8-6bbcd56ce739", // Mind Twist (lea)
    "54d7a0c1-efb4-4a8d-ad92-a96d43835052", // Necropotence (ice) — legal-set printing
    "e7880157-7f27-4f1b-9cdc-ab36a6252376", // Strip Mine (atq)
    "ad7ac9a5-340f-4509-826c-7b9416d47887", // Tolarian Academy (usg) — legal-set printing
    // Stubbed guards (add the id when the stub is uncommented):
    // Amulet of Quoz (ice/colorless.ts), Mystical Tutor (mir/blue.ts),
    // Vampiric Tutor (vis/black.ts).
]);

/** Standard constructed copy ceiling for non-basic cards in Premodern. */
const PREMODERN_COPY_LIMIT = 4;

/**
 * The full Premodern validator (ADR 0036): size (≥60 main, ≤15 side) + set
 * membership (the 4th-Edition→Scourge + Portal pool) + the 4-copy limit + the
 * Banned list. Premodern has NO restricted list, so none is applied. Composed
 * from the shared helpers; counting for copy/banned is by Card ID across
 * printings, with basics exempt. When `banlist` is injected (issue #1140),
 * its `banned` set overrides `PREMODERN_BANNED`; absent, the code constant is
 * the seed/fallback.
 */
function premodernValidate(
    deck: ValidatableDeck,
    resolve: ResolveCard,
    banlist?: BanlistOverride
): Reason[] {
    const meta = FORMAT_RULES["premodern"];
    return [
        ...checkSize(deck, meta),
        ...checkSets(deck, meta, resolve),
        ...checkCopyLimit(deck, PREMODERN_COPY_LIMIT, resolve),
        ...checkBanned(deck, banlist?.banned ?? PREMODERN_BANNED, resolve),
    ];
}

// Freeform: no constraints, ever (ADR 0036).
const noReasons = (): Reason[] => [];

/**
 * The Limited (Sealed/Draft) validator (ADR 0054/0055, issue #1109): Maindeck
 * ≥ 40 (unlimited basics added freely), no Sideboard cap — the deck's whole
 * Pool travels with it (MTGO model, `FORMAT_RULES.limited.maxSide === null`)
 * — and every non-basic card in EITHER zone must be accounted for by the
 * seat's authoritative Pool, exactly (`checkPoolMembership`). Unlike every
 * other format, legality here is NOT set-membership (`checkSets` is not
 * called; `allowedSets: null`) — the Pool itself is the whole legality
 * surface, a stronger constraint than any set list. `resolvePool` is injected
 * exactly like `resolve`/`banlist` (ADR 0036) so this module stays pure; the
 * real seat-table lookup (event skeleton, issue #1110) lives above it, in the
 * caller. An absent/unresolvable Pool is a HARD failure — a deck can't be
 * validated as `limited` without one (issue #1109 AC4), never a silent pass.
 */
function limitedValidate(
    deck: ValidatableDeck,
    resolve: ResolveCard,
    _banlist?: BanlistOverride,
    resolvePool?: ResolvePool
): Reason[] {
    const meta = FORMAT_RULES.limited;
    const reasons = checkSize(deck, meta);

    const pool = resolvePool ? resolvePool(deck) : null;
    if (pool === null) {
        return [
            ...reasons,
            {
                code: "pool-unresolved",
                message:
                    "Deck has no resolvable Limited Pool — it must reference a valid Limited Event Seat.",
            },
        ];
    }
    return [...reasons, ...checkPoolMembership(deck, pool, resolve)];
}

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
        // Full legality (issue #517): size + sets + Banned (0) + Restricted (1)
        // + Category Budgets (1 per group) + Moderated/rarity caps — see
        // alpha40Validate.
        validate: alpha40Validate,
    },
    "old-school": {
        label: "Old School (93/94)",
        // The implemented eternal sets, >=60 maindeck, <=15 sideboard.
        // Unlimited (2ed) reprints the Beta list and is Old-School-legal (#560).
        // Revised (3ed) is a 100% reprint of the eternal pool — also legal (#561).
        allowedSets: ["lea", "leb", "2ed", "3ed", "arn", "atq", "leg", "drk"],
        minMain: 60,
        maxSide: 15,
        // Full legality (issue #516): size + sets + 4-copy limit + EC Restricted
        // (1-copy) + Banned (0, guard) — see oldSchoolValidate.
        validate: oldSchoolValidate,
    },
    premodern: {
        label: "Premodern",
        // 4th Edition → Scourge + Portal, intersected with the built pool,
        // >=60 maindeck, <=15 sideboard. See PREMODERN_LEGAL_SETS.
        allowedSets: [...PREMODERN_LEGAL_SETS],
        minMain: 60,
        maxSide: 15,
        // Full legality: size + sets + 4-copy limit + Banned (0), no restricted
        // list — see premodernValidate.
        validate: premodernValidate,
    },
    limited: {
        label: "Limited",
        // Pool-scoped, not set-scoped (ADR 0054/0055) — checkSets is never
        // called; checkPoolMembership is the whole legality surface.
        allowedSets: null,
        minMain: 40,
        // No 15-card cap: every unplayed Pool card lives in the Sideboard
        // (ADR 0054/0055, MTGO model).
        maxSide: null,
        // Maindeck ≥ 40 + Pool-multiset match (both directions) — see
        // limitedValidate.
        validate: limitedValidate,
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
 *
 * `banlist` (issue #1140, PRD #1138) is an optional injected banned/restricted
 * override, mirroring `resolve` — mandatory purity, no DB access inside this
 * module. Absent, each format's `validate` falls back to its own code
 * constants (`PREMODERN_BANNED`, `OLD_SCHOOL_BANNED`, `OLD_SCHOOL_RESTRICTED`),
 * so existing callers and tests are unaffected. Formats without a DB-backed
 * banlist (Alpha 40, Freeform) ignore the argument.
 *
 * `resolvePool` (issue #1109) is an optional injected Limited Pool resolver,
 * mirroring `banlist` — only `limited`'s validator reads it; every other
 * format ignores the argument. Absent, a `limited` deck has no resolvable
 * Pool and is illegal (fail-closed, not a silent pass) — the real seat-table
 * lookup (issue #1110) is wired in by the caller once it exists.
 */
export function validateDeck(
    deck: ValidatableDeck,
    format: FormatId,
    resolve: ResolveCard = resolveDeckCardMeta,
    banlist?: BanlistOverride,
    resolvePool?: ResolvePool
): DeckLegality {
    const meta = FORMAT_RULES[format] ?? FORMAT_RULES.freeform;
    const reasons = meta.validate(deck, resolve, banlist, resolvePool);
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
 *
 * `banlist` (issue #1140) is threaded straight through to `validateDeck` —
 * optional injected override, code constants as fallback when absent.
 *
 * `resolvePool` (issue #1109) is threaded straight through to `validateDeck`
 * — optional injected Limited Pool resolver. Every EXISTING call site
 * (`createGame`/`joinGame`/`createSoloGame` in `convex/game.ts`) omits it, so
 * a `limited`-format deck submitted there is rejected as having no
 * resolvable Pool until the seat-table lookup (issue #1110) is wired in
 * above this gate — fail-closed by construction, never silently legal.
 */
export function assertDeckLegal(
    deck: GateDeck,
    resolve: ResolveCard = resolveDeckCardMeta,
    banlist?: BanlistOverride,
    resolvePool?: ResolvePool
): void {
    const format: FormatId = isFormatId(deck.format) ? deck.format : "freeform";
    const { isLegal, reasons } = validateDeck(
        deck,
        format,
        resolve,
        banlist,
        resolvePool
    );
    if (isLegal) return;
    const label = deck.name ? `"${deck.name}"` : "Deck";
    throw new Error(
        `${label} is not legal for ${FORMAT_RULES[format].label}: ${reasons
            .map((r) => r.message)
            .join(" ")}`
    );
}
