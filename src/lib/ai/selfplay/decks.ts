// Maps a preset deck (the in-code catalog served to the lobby) into the
// `PlayerInput` shape the headless setup consumes. The self-play harness picks
// two presets by id and seats them; no DB / userDecks involved.

import { PRESET_DECKS } from "@convex/deckPresets";
import type { PlayerInput } from "@convex/gre";

/** Bot seat colors — cosmetic only; the harness never renders. */
const SEAT_COLORS = ["#4B5A6C", "#63768D"];

/** All preset deck ids available to the harness (e.g. `"mono-red-burn"`). */
export function availablePresetIds(): string[] {
    return PRESET_DECKS.map((d) => d.presetId);
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
    return {
        id: seatId,
        name: `${preset.name} (P${seat + 1})`,
        bgColor: SEAT_COLORS[seat % SEAT_COLORS.length],
        deck: {
            id: preset.presetId,
            name: preset.name,
            format: preset.format,
            cards: preset.cards.map((c) => ({
                cardId: c.cardId,
                cardName: c.cardName,
            })),
        },
    };
}
