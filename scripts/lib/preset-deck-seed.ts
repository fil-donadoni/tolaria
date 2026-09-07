/**
 * Turning a canonical Tier 1 list into a Preset Deck payload (issue #3168).
 *
 * The seeding tool #2719 assumed existed and did not. Preset Decks are rows in
 * the `presetDecks` table (ADR 0033 / PRD #466), and until now the only writer
 * was `createPreset`, driven by a human in the Admin deck editor —
 * `convex/decks.ts`'s own comment points at a `seedPresets` migration that
 * appears in two comments and no code. Six 75-card lists is not a thing to
 * retype.
 *
 * Everything here is PURE and offline: names in, a `PresetCreateInput` (or a
 * list of problems) out. The deployment write lives in `seed-preset-deck.ts`,
 * so this half is unit-testable without a Convex harness — the same split
 * `scripts/lib/seed-scenario-run.ts` draws for debug scenarios.
 *
 * Fail-closed. A list that does not resolve, or a deck the Format rejects,
 * yields PROBLEMS and no payload; the caller never gets a half-built preset to
 * send anyway. The mutation re-checks legality server-side against the live DB
 * banlist, which this side cannot see (PRD #1138) — that is the authority, and
 * this is the early, offline, better-worded copy.
 */

import type { CardDefinition } from "../../convex/cards/types";
import type { DeckCard } from "../../convex/deckPresets";
import type { FormatId } from "../../convex/formats";
import { validateDeck } from "../../convex/formats";
import { getCardColorIdentity } from "../../convex/cards/colors";
import type { Tier1Deck, Tier1DeckEntry } from "./tier1-decks";

/** The subset of `PresetCreateInput` this builder fills. */
export interface PresetPayload {
    readonly name: string;
    readonly format: FormatId;
    readonly description: string;
    readonly colors: string[];
    readonly cards: DeckCard[];
    readonly sideboard: DeckCard[];
}

/** How a card name is turned into a definition. Injected so the builder is
 *  testable against a fixture registry rather than the real 4,300-card one. */
export type ResolveByName = (name: string) => CardDefinition | null;

/** Expand `{ count, name }` rows into one `DeckCard` per copy, in list order.
 *  Unresolved names are collected rather than thrown on, so ONE run names
 *  every missing card instead of the first. */
function expand(
    rows: readonly Tier1DeckEntry[],
    resolve: ResolveByName
): { cards: DeckCard[]; unresolved: string[] } {
    const cards: DeckCard[] = [];
    const unresolved: string[] = [];
    for (const row of rows) {
        const def = resolve(row.name);
        if (!def) {
            unresolved.push(row.name);
            continue;
        }
        for (let i = 0; i < row.count; i++) {
            cards.push({ cardId: def.id, cardName: def.name });
        }
    }
    return { cards, unresolved };
}

/**
 * The deck's colours, as the lobby renders them: the union of the colour
 * IDENTITY of every card in the 75 (CR 202.2 / 903.4 — identity, not the cast
 * cost's colours, so a card whose only coloured pip is in an activation cost
 * still counts). Derived rather than declared: a hand-kept colour list on
 * canonical data is a second thing to update when the list changes.
 *
 * Ordered WUBRG, the order the rest of the app renders pips in, so re-seeding
 * an unchanged list produces an identical row.
 */
const WUBRG = ["W", "U", "B", "R", "G"] as const;

export function deckColors(defs: readonly CardDefinition[]): string[] {
    const seen = new Set<string>();
    for (const def of defs) {
        for (const c of getCardColorIdentity(def)) seen.add(c);
    }
    return WUBRG.filter((c) => seen.has(c));
}

export interface BuildResult {
    /** Present only when there are no problems. */
    readonly payload?: PresetPayload;
    /** Human-readable, one per distinct failure. Empty ⇒ `payload` is set. */
    readonly problems: string[];
}

/**
 * Build the payload for one canonical list, or say why it cannot be built.
 *
 * `description` is derived from the supply date rather than invented, so the
 * lobby says where the list came from and two seeds of the same file produce
 * the same row.
 */
export function buildPresetPayload(
    deck: Tier1Deck,
    format: FormatId,
    suppliedOn: string,
    resolve: ResolveByName
): BuildResult {
    const main = expand(deck.main, resolve);
    const side = expand(deck.sideboard, resolve);
    const unresolved = [...new Set([...main.unresolved, ...side.unresolved])];
    if (unresolved.length > 0) {
        return {
            problems: [
                `unknown card name(s): ${unresolved.join(", ")}`,
                // The registry is the join, so an unknown name is either a
                // typo in the canonical list or a card nobody has built — two
                // very different fixes, and the caller cannot tell them apart
                // from the name alone.
                `each is either a typo in the canonical list or a card with no definition yet`,
            ],
        };
    }

    const defs = [...deck.main, ...deck.sideboard]
        .map((r) => resolve(r.name))
        .filter((d): d is CardDefinition => d !== null);

    const payload: PresetPayload = {
        name: deck.name,
        format,
        description: `Premodern Tier 1 — list supplied ${suppliedOn}.`,
        colors: deckColors(defs),
        cards: main.cards,
        sideboard: side.cards,
    };

    // Offline legality, without the DB banlist the mutation will apply. A
    // failure here is always a real failure; a pass here is not yet a promise.
    const legality = validateDeck(
        { cards: payload.cards, sideboard: payload.sideboard },
        format
    );
    if (!legality.isLegal) {
        return {
            problems: legality.reasons.map(
                (r) => `not legal in ${format}: ${r.message}`
            ),
        };
    }
    return { payload, problems: [] };
}
