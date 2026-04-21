import { query } from "./_generated/server";
import { PRESET_DECKS } from "./deckPresets";

// Lobby deck list is sourced directly from `PRESET_DECKS`. Keeping the list
// in code (rather than a seeded DB table) means new/edited presets appear
// the moment they're added to `convex/deckPresets.ts` — no migration, no
// reseed, no stale rows when a preset's cards change.
export const list = query({
    args: {},
    handler: async () => {
        return [...PRESET_DECKS].sort((a, b) =>
            a.presetId.localeCompare(b.presetId)
        );
    },
});
