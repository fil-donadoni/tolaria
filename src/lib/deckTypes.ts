import type { Doc, Id } from "@convex/_generated/dataModel";
import type { DeckCard, DeckPreset } from "@convex/deckPresets";
import { type FormatId, type Reason, validateDeck } from "@convex/formats";

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
    // Derived deck legality for the deck's Format (ADR 0036, issue #512).
    // Computed from contents via the shared pure `validateDeck` — never stored,
    // so the lobby and the live builder panel never disagree with the server.
    isLegal: boolean;
    reasons: Reason[];
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
type PresetSource = DeckPreset & { isLegal?: boolean; reasons?: Reason[] };

export function toPresetLobbyDeck(d: PresetSource): PresetLobbyDeck {
    // Prefer the server-derived legality when present (the lobby query computes
    // it); otherwise derive it here via the same pure `validateDeck`.
    const legality =
        d.isLegal !== undefined && d.reasons !== undefined
            ? { isLegal: d.isLegal, reasons: d.reasons }
            : validateDeck(d, d.format);
    return {
        kind: "preset",
        presetId: d.presetId,
        name: d.name,
        format: d.format,
        description: d.description,
        colors: d.colors,
        cards: d.cards,
        sideboard: d.sideboard ?? [],
        isLegal: legality.isLegal,
        reasons: legality.reasons,
    };
}

export function toUserLobbyDeck(d: Doc<"userDecks">): UserLobbyDeck {
    // User decks aren't validated server-side on list; derive legality from
    // contents via the shared pure validator (ADR 0036).
    const { isLegal, reasons } = validateDeck(d, d.format);
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
        isLegal,
        reasons,
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

export function deckPayload(d: LobbyDeck): {
    id: string;
    name: string;
    format: FormatId;
    cards: DeckCard[];
    sideboard: DeckCard[];
} {
    return {
        id: d.presetId,
        name: d.name,
        format: d.format,
        cards: d.cards,
        // Snapshotted into the Match deck copy (PRD #387). Empty for legacy
        // decks; the Match owns this list for sideboarding.
        sideboard: d.sideboard ?? [],
    };
}
