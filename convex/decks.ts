import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertIsAdmin } from "./auth";
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

// Validator for the editable fields of a preset. The `slug` is intentionally
// absent: it is the stable identity and is read-only after creation (ADR 0033).
const presetPatchValidator = v.object({
    name: v.optional(v.string()),
    format: v.optional(v.string()),
    colors: v.optional(v.array(v.string())),
    cards: v.optional(v.array(deckCardValidator)),
    sideboard: v.optional(v.array(deckCardValidator)),
    description: v.optional(v.string()),
});

/** The editable subset of a preset, mirroring `presetPatchValidator`. */
export interface PresetPatchInput {
    name?: string;
    format?: string;
    colors?: string[];
    cards?: DeckCard[];
    sideboard?: DeckCard[];
    description?: string;
}

/**
 * Pure patch-builder for `updatePreset` (ADR 0033). Maps the requested edits
 * to the row patch, applying the same name fallback as user decks. The `slug`
 * is structurally excluded — renaming `name` NEVER changes `slug`, so a
 * preset's identity (and every external reference to it) survives edits.
 * Pure and exported so slug-immutability is unit-tested without a Convex
 * harness.
 */
export function buildPresetPatch(
    input: PresetPatchInput
): Partial<Omit<Doc<"presetDecks">, "_id" | "_creationTime" | "slug">> {
    const patch: Partial<
        Omit<Doc<"presetDecks">, "_id" | "_creationTime" | "slug">
    > = {};
    if (input.name !== undefined) {
        patch.name = input.name.trim() || "Untitled preset";
    }
    if (input.format !== undefined) patch.format = input.format;
    if (input.colors !== undefined) patch.colors = input.colors;
    if (input.cards !== undefined) patch.cards = input.cards;
    if (input.sideboard !== undefined) patch.sideboard = input.sideboard;
    if (input.description !== undefined) patch.description = input.description;
    return patch;
}

/** The full editable payload an Admin submits to create a new preset. */
export interface PresetCreateInput {
    name?: string;
    format?: string;
    colors?: string[];
    cards?: DeckCard[];
    sideboard?: DeckCard[];
    description?: string;
}

/**
 * Pure builder for a brand-new preset row (PRD #466, ADR 0033, issue #469).
 * Auto-derives the stable `slug` from the name via `slugify` — the slug is the
 * preset's immutable identity. Applies the same blank-name fallback as
 * `buildPresetPatch`. Returns the row ready to insert (minus Convex system
 * fields). Pure and exported so slug generation is unit-tested without a Convex
 * harness (the project has no convex-test harness).
 */
export function buildNewPresetRow(input: PresetCreateInput): PresetInsert {
    const name = (input.name ?? "").trim() || "Untitled preset";
    return {
        slug: slugify(name),
        name,
        format: input.format ?? "Freeform",
        description: input.description,
        colors: input.colors ?? [],
        cards: input.cards ?? [],
        sideboard: input.sideboard,
    };
}

// Validator for the full create payload of a preset. The `slug` is intentionally
// absent: it is derived from the name server-side and immutable (ADR 0033).
const presetCreateValidator = v.object({
    name: v.optional(v.string()),
    format: v.optional(v.string()),
    colors: v.optional(v.array(v.string())),
    cards: v.optional(v.array(deckCardValidator)),
    sideboard: v.optional(v.array(deckCardValidator)),
    description: v.optional(v.string()),
});

// Single preset by slug, backing the editor's preset edit mode (ADR 0033).
// Returns null for a missing slug so the route can render a not-found state.
export const getPreset = query({
    args: { slug: v.string() },
    returns: v.union(lobbyPresetValidator, v.null()),
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query("presetDecks")
            .withIndex("by_slug", (q) => q.eq("slug", args.slug))
            .unique();
        return row ? presetRowToLobby(row) : null;
    },
});

// Admin-only edit of an existing preset (ADR 0033). `assertIsAdmin` runs FIRST
// — non-admins are rejected server-side, not just hidden in the UI. The slug is
// read-only: it locates the row but is never patched, so external references
// (lobby selection, debug scenarios, wire payloads) survive a rename.
export const updatePreset = mutation({
    args: { slug: v.string(), patch: presetPatchValidator },
    returns: v.null(),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const row = await ctx.db
            .query("presetDecks")
            .withIndex("by_slug", (q) => q.eq("slug", args.slug))
            .unique();
        if (!row) throw new Error("Preset not found");
        const patch = buildPresetPatch(args.patch);
        if (Object.keys(patch).length === 0) return null;
        await ctx.db.patch(row._id, patch);
        return null;
    },
});

// Admin-only creation of a brand-new preset (ADR 0033, issue #469).
// `assertIsAdmin` runs FIRST — non-admins are rejected server-side, not just
// hidden in the UI. The slug is auto-derived from the name and must be unique:
// a collision with an existing preset throws, so two presets can never share an
// identity. The inserted row matches exactly what `list` projects to the lobby.
export const createPreset = mutation({
    args: { input: presetCreateValidator },
    returns: v.object({ slug: v.string() }),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const row = buildNewPresetRow(args.input);
        const existing = await ctx.db
            .query("presetDecks")
            .withIndex("by_slug", (q) => q.eq("slug", row.slug))
            .unique();
        if (existing) {
            throw new Error(`A preset with slug "${row.slug}" already exists`);
        }
        await ctx.db.insert("presetDecks", row);
        return { slug: row.slug };
    },
});

// Admin-only deletion of a preset (PRD #466, ADR 0033, issue #470).
// `assertIsAdmin` runs FIRST — non-admins are rejected server-side, not just
// hidden in the UI. Located by slug; a missing preset is a no-op (idempotent —
// a double-click or a stale client can't error). Other clients' lobbies drop
// the preset reactively via `list`.
export const deletePreset = mutation({
    args: { slug: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const row = await ctx.db
            .query("presetDecks")
            .withIndex("by_slug", (q) => q.eq("slug", args.slug))
            .unique();
        if (row) await ctx.db.delete(row._id);
        return null;
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
