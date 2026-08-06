import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    type DeckCard,
    type DeckPreset,
    resolveFeaturedCardId,
} from "@convex/deckPresets";
import {
    type BanlistOverride,
    type FormatId,
    type Reason,
    validateDeck,
} from "@convex/formats";
import type { StoredDeckColumnLayout } from "@convex/deckLayout";

export interface LobbyDeckBase {
    presetId: string;
    name: string;
    format: FormatId;
    description?: string;
    colors: string[];
    // Maindeck — the cards that build the starting Library.
    cards: DeckCard[];
    // Sideboard — 0–15 cards held aside (issue #391). Absent === empty for
    // legacy decks saved before sideboarding existed.
    sideboard?: DeckCard[];
    // Resolved Featured Card ID (PRD #589, issue #593) — the Card ID whose art
    // represents the deck in the lobby. Override-or-default via the shared pure
    // `resolveFeaturedCardId`; `null` for an empty deck. Not part of legality.
    featuredCardId: string | null;
    // Derived deck legality for the deck's Format (ADR 0036, issue #512).
    // Computed from contents via the shared pure `validateDeck` — never stored,
    // so the lobby and the live builder panel never disagree with the server.
    isLegal: boolean;
    reasons: Reason[];
    // Limited Event + Seat reference (ADR 0054/0055, issue #1109/#1111). Set
    // only on a `format: "limited"` user deck — a preset never carries these.
    // Absent on every other deck.
    limitedEventId?: string;
    limitedSeatId?: string;
    // Persisted Column Layout (ADR 0075 §4, PRD #1617, issue #1626) — the
    // deckbuilder workspace the player built ON THIS DECK: manual Columns,
    // deleted Columns and Card Pins. Absent for a deck saved before this
    // slice, and for a Preset (only `userDecks` stores a layout today), which
    // the builder rehydrates as the empty default.
    layout?: StoredDeckColumnLayout;
}

export interface PresetLobbyDeck extends LobbyDeckBase {
    kind: "preset";
}

export interface UserLobbyDeck extends LobbyDeckBase {
    kind: "user";
    userDeckId: Id<"userDecks">;
}

export type LobbyDeck = PresetLobbyDeck | UserLobbyDeck;

// The preset row the lobby query returns may already carry derived legality
// (`convex/decks.ts`); accept either that shape or the bare in-code preset.
type PresetSource = DeckPreset & {
    isLegal?: boolean;
    reasons?: Reason[];
    // The lobby query resolves and surfaces this server-side; bare in-code
    // presets omit it and it's resolved client-side below.
    featuredCardId?: string | null;
};

export function toPresetLobbyDeck(
    d: PresetSource,
    banlist?: BanlistOverride
): PresetLobbyDeck {
    // Prefer the server-derived legality when present (the lobby query already
    // resolved it against the DB banlist — `convex/decks.ts`, issue #1144);
    // otherwise derive it here via the same pure `validateDeck`, threading the
    // injected `banlist` (PRD #1138) — `undefined` falls back to the code
    // const inside `validateDeck` itself, so a caller with no banlist query
    // result yet regresses to today's behavior, never to a wrong or thrown
    // legality.
    const legality =
        d.isLegal !== undefined && d.reasons !== undefined
            ? { isLegal: d.isLegal, reasons: d.reasons }
            : validateDeck(d, d.format, undefined, banlist);
    // Prefer the server-resolved Featured Card when present (the lobby query
    // resolves it); otherwise resolve here via the same pure resolver (PRD
    // #589, issue #593).
    // In this branch the override is absent, so resolution reduces to the
    // first-card default — pass only `cards` (the source type allows `null`
    // for `featuredCardId`, which the resolver's input doesn't).
    const featuredCardId =
        d.featuredCardId !== undefined
            ? d.featuredCardId
            : resolveFeaturedCardId({ cards: d.cards });
    return {
        kind: "preset",
        presetId: d.presetId,
        name: d.name,
        format: d.format,
        description: d.description,
        colors: d.colors,
        cards: d.cards,
        sideboard: d.sideboard ?? [],
        featuredCardId,
        isLegal: legality.isLegal,
        reasons: legality.reasons,
    };
}

// A `userDecks.listMine` row may already carry server-resolved legality for a
// `limited`-format deck (`convex/userDecks.ts`, issue #1111): its Pool lives
// on the Limited Event Seat, not the deck row, so the client has no way to
// derive a `ResolvePool` on its own — without the server attaching these, a
// bare client-side `validateDeck` call would always read "pool-unresolved"
// and block Limited decks everywhere except the pool-scoped builder. Mirrors
// `PresetSource`'s same optional-override shape in `toPresetLobbyDeck` above.
type UserDeckSource = Doc<"userDecks"> & {
    isLegal?: boolean;
    reasons?: Reason[];
};

export function toUserLobbyDeck(
    d: UserDeckSource,
    banlist?: BanlistOverride
): UserLobbyDeck {
    // Prefer the server-derived legality when present (limited decks,
    // `userDecks.listMine`); otherwise derive it here via the shared pure
    // validator (ADR 0036), threading the injected DB banlist override (PRD
    // #1138, issue #1144) — `undefined` falls back to the code const inside
    // `validateDeck`. Every non-limited deck takes this branch unchanged.
    const legality =
        d.isLegal !== undefined && d.reasons !== undefined
            ? { isLegal: d.isLegal, reasons: d.reasons }
            : validateDeck(d, d.format, undefined, banlist);
    return {
        kind: "user",
        userDeckId: d._id,
        presetId: d._id as string,
        name: d.name,
        format: d.format,
        description: d.description,
        colors: d.colors,
        cards: d.cards,
        sideboard: d.sideboard ?? [],
        // Resolve the stored Featured Card override against the deck contents
        // (PRD #589, issue #593) — user-deck rows aren't projected server-side,
        // so resolution happens here via the shared pure resolver.
        featuredCardId: resolveFeaturedCardId(d),
        isLegal: legality.isLegal,
        reasons: legality.reasons,
        limitedEventId: d.limitedEventId,
        limitedSeatId: d.limitedSeatId,
        // Persisted Column Layout (ADR 0075 §4, issue #1626). Passed through
        // verbatim — the Column Layout engine is its only interpreter, and a
        // row saved before this slice simply has none.
        layout: d.layout,
    };
}

/**
 * Resolve a stored lobby selection (`tolaria:selectedDeckId`, a preset slug or
 * user-deck id) against the currently available decks (issue #470). Returns the
 * matching deck, or `null` when the id is absent — e.g. an admin deleted the
 * preset it pointed at, or the saved user deck was removed. Null-safe by
 * construction: a stale id never throws, it falls back to no selection. Pure
 * and unit-tested so the fallback can't silently regress.
 */
export function selectPreset(
    decks: readonly LobbyDeck[],
    selectedId: string | null
): LobbyDeck | null {
    if (selectedId === null) return null;
    return decks.find((d) => d.presetId === selectedId) ?? null;
}

/**
 * Narrow a deck list to a single Format (PRD #509, ADR 0036, issue #513).
 * `"all"` is the identity — it returns the list unchanged. Otherwise it keeps
 * only decks whose `format` matches. Pure and unit-tested so the lobby filter
 * and any future deck surface share one navigation rule. Navigation only — it
 * never affects legality or play.
 */
export function filterDecksByFormat<T extends { format: FormatId }>(
    decks: readonly T[],
    filter: "all" | FormatId
): T[] {
    if (filter === "all") return [...decks];
    return decks.filter((d) => d.format === filter);
}

export function deckPayload(d: LobbyDeck): {
    id: string;
    name: string;
    format: FormatId;
    cards: DeckCard[];
    sideboard: DeckCard[];
    limitedEventId?: string;
    limitedSeatId?: string;
} {
    return {
        id: d.presetId,
        name: d.name,
        format: d.format,
        cards: d.cards,
        // Snapshotted into the Match deck copy (PRD #387). Empty for legacy
        // decks; the Match owns this list for sideboarding.
        sideboard: d.sideboard ?? [],
        // Limited Event + Seat reference (ADR 0054/0055, issue #1109/#1111) —
        // `assertDeckLegal`'s injected `ResolvePool` reads these two at game
        // start. Absent on every non-Limited deck (a preset never carries
        // them either).
        limitedEventId: d.limitedEventId,
        limitedSeatId: d.limitedSeatId,
    };
}
