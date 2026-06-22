import { v } from "convex/values";
import { query } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { PRESET_DECKS, type DeckCard, type DeckPreset } from "./deckPresets";

// Preset Decks now live in the `presetDecks` DB table (PRD #466, ADR 0033).
// `convex/deckPresets.ts` is retained ONLY as the seed source for the
// `seedPresets` migration below — it is no longer read at runtime by `list`.
// Do not "clean it up": deleting it would break the seed.

// Validators mirroring the `presetDecks` row shape, used for `returns:`.
const deckCardValidator = v.object({
    cardId: v.string(),
    cardName: v.string(),
});

const lobbyPresetValidator = v.object({
    presetId: v.string(),
    name: v.string(),
    format: v.string(),
    description: v.string(),
    colors: v.array(v.string()),
    cards: v.array(deckCardValidator),
    sideboard: v.optional(v.array(deckCardValidator)),
});

// The shape `list` returns to the lobby. Kept identical to the old in-code
// `DeckPreset` (notably the public id field is `presetId` === the slug), so
// the wire format and every frontend consumer are unchanged.
export interface LobbyPreset {
    presetId: string;
    name: string;
    format: string;
    description: string;
    colors: string[];
    cards: DeckCard[];
    sideboard?: DeckCard[];
}

/**
 * Derive a stable, human-readable slug from a preset name: lowercase, spaces
 * collapsed to single hyphens, all non-alphanumeric characters stripped.
 * Pure and exported so it can be unit-tested directly and reused by the
 * Admin create-preset flow (PRD #466). The slug is immutable once assigned.
 */
export function slugify(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "") // strip non-alphanumerics (keep spaces/hyphens)
        .replace(/[\s-]+/g, "-") // collapse runs of spaces/hyphens to one hyphen
        .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
}

/**
 * Map a stored `presetDecks` row to the lobby wire shape. The public id is the
 * slug (returned as `presetId`), preserving the pre-DB wire format.
 */
export function presetRowToLobby(row: Doc<"presetDecks">): LobbyPreset {
    return {
        presetId: row.slug,
        name: row.name,
        format: row.format,
        description: row.description ?? "",
        colors: row.colors,
        cards: row.cards,
        sideboard: row.sideboard,
    };
}

/** A `presetDecks` row, minus the Convex system fields, ready to insert. */
export type PresetInsert = Omit<Doc<"presetDecks">, "_id" | "_creationTime">;

/**
 * Translate an in-code `DeckPreset` into the row we insert when seeding. The
 * preset's stable id (`presetId`) becomes the slug verbatim — the existing
 * presets already use slug-shaped ids (`mono-red-burn`), so seeding preserves
 * every external reference.
 */
export function presetToInsert(preset: DeckPreset): PresetInsert {
    return {
        slug: preset.presetId,
        name: preset.name,
        format: preset.format,
        description: preset.description,
        colors: preset.colors,
        cards: preset.cards,
        sideboard: preset.sideboard,
    };
}

/**
 * Pure insert-if-absent decision for the idempotent seed. Given the slugs that
 * already exist in the table and the full preset list, return only the rows
 * for slugs not yet present. Re-running with the same existing set yields an
 * empty list, so the seed never overwrites an Admin's edits. Tested directly
 * without a Convex harness (the project has no convex-test harness).
 */
export function presetsToSeed(
    presets: DeckPreset[],
    existingSlugs: ReadonlySet<string>
): PresetInsert[] {
    return presets
        .filter((p) => !existingSlugs.has(p.presetId))
        .map(presetToInsert);
}

/** Sort lobby presets by slug for a stable, reactive ordering. */
export function sortLobbyPresets(presets: LobbyPreset[]): LobbyPreset[] {
    return [...presets].sort((a, b) => a.presetId.localeCompare(b.presetId));
}

// Lobby deck list, now sourced from the `presetDecks` DB table (ADR 0033).
// Reactive: an Admin's edit to a preset propagates to every client's lobby
// without a redeploy. Sorted by slug for stable ordering.
export const list = query({
    args: {},
    returns: v.array(lobbyPresetValidator),
    handler: async (ctx) => {
        const rows = await ctx.db.query("presetDecks").collect();
        return sortLobbyPresets(rows.map(presetRowToLobby));
    },
});

// Idempotent migration: insert each preset whose slug is not already present,
// skip the rest. Never overwrites — safe to re-run. Run once via the Convex
// dashboard / `mcp run` after this slice deploys to populate the table.
export const seedPresets = internalMutation({
    args: {},
    returns: v.object({ inserted: v.number(), skipped: v.number() }),
    handler: async (ctx) => {
        const existing = await ctx.db.query("presetDecks").collect();
        const existingSlugs = new Set(existing.map((r) => r.slug));
        const toInsert = presetsToSeed(PRESET_DECKS, existingSlugs);
        for (const row of toInsert) {
            await ctx.db.insert("presetDecks", row);
        }
        return { inserted: toInsert.length, skipped: existingSlugs.size };
    },
});
