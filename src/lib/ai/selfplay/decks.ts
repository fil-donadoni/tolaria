// Maps a deck into the `PlayerInput` shape the headless setup consumes. The
// self-play harness seats two decks and plays; no DB / userDecks involved.
//
// TWO SOURCES, one seating. The in-code presets (`PRESET_DECKS`) are what the
// lobby serves and what the ladder pairs by id; a canonical Premodern Tier 1
// list (`data/premodern-tier1-decks.json`, resolved through the card registry
// by `scripts/lib/preset-deck-seed.ts`) is a deck the repo carries as NAMES and
// nothing else. Both arrive here as the same four fields, so the seat colour,
// the `(P1)`/`(P2)` label and the `PlayerInput` shape are stated once rather
// than copied per source — issue #2719's deck-vs-deck smoke seats Tier 1 lists
// exactly the way the ladder seats presets.

import { PRESET_DECKS } from "@convex/deckPresets";
import type { FormatId } from "@convex/formats";
import type { PlayerInput } from "@convex/gre";

/** Bot seat colors — cosmetic only; the harness never renders. */
const SEAT_COLORS = ["#4B5A6C", "#63768D"];

/** All preset deck ids available to the harness (e.g. `"mono-red-burn"`). */
export function availablePresetIds(): string[] {
    return PRESET_DECKS.map((d) => d.presetId);
}

/** The minimum a deck must carry to be seated: an id, a display name, its
 *  Format, and the maindeck expanded ONE ENTRY PER COPY (the shape both
 *  `DeckPreset.cards` and a built preset payload already use). No sideboard —
 *  headless self-play plays game 1 only. */
export interface SeatableDeck {
    readonly id: string;
    readonly name: string;
    readonly format: FormatId;
    readonly cards: readonly {
        readonly cardId: string;
        readonly cardName: string;
    }[];
}

/** Seat a deck. `seat` (0/1) picks the color and feeds the seat label. */
export function deckToPlayerInput(
    deck: SeatableDeck,
    seat: number,
    seatId: string
): PlayerInput {
    return {
        id: seatId,
        name: `${deck.name} (P${seat + 1})`,
        bgColor: SEAT_COLORS[seat % SEAT_COLORS.length],
        deck: {
            id: deck.id,
            name: deck.name,
            format: deck.format,
            cards: deck.cards.map((c) => ({
                cardId: c.cardId,
                cardName: c.cardName,
            })),
        },
    };
}

/** Build a seated `PlayerInput` from a preset id. `seat` (0/1) picks the color
 *  and feeds the seat label. Throws on an unknown preset id. */
export function presetToPlayerInput(
    presetId: string,
    seat: number,
    seatId: string
): PlayerInput {
    const preset = PRESET_DECKS.find((d) => d.presetId === presetId);
    if (!preset) {
        throw new Error(
            `Unknown preset "${presetId}". Available: ${availablePresetIds().join(", ")}`
        );
    }
    return deckToPlayerInput(
        {
            id: preset.presetId,
            name: preset.name,
            format: preset.format,
            cards: preset.cards,
        },
        seat,
        seatId
    );
}
