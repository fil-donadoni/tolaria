import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertIsAdmin } from "./auth";
import { loadBanlistOverrides } from "./banlists";
import {
    type DeckCard,
    type DeckPreset,
    resolveFeaturedCardId,
} from "./deckPresets";
import {
    type BanlistOverride,
    type FormatId,
    type Reason,
    validateDeck,
} from "./formats";

// Typed deck Format (ADR 0036). An Admin chooses it when authoring a preset.
const formatValidator = v.union(
    v.literal("freeform"),
    v.literal("alpha-40"),
    v.literal("old-school"),
    v.literal("premodern")
);

// Preset Decks now live in the `presetDecks` DB table (PRD #466, ADR 0033).
// `convex/deckPresets.ts` is retained ONLY as the seed source for the
// `seedPresets` migration below — it is no longer read at runtime by `list`.
// Do not "clean it up": deleting it would break the seed.

// Validators mirroring the `presetDecks` row shape, used for `returns:`.
const deckCardValidator = v.object({
    cardId: v.string(),
    cardName: v.string(),
});

// A single legality failure reason mirroring `formats.Reason` (ADR 0036).
const reasonValidator = v.object({
    code: v.string(),
    message: v.string(),
});

const lobbyPresetValidator = v.object({
    presetId: v.string(),
    name: v.string(),
    format: formatValidator,
    description: v.string(),
    colors: v.array(v.string()),
    cards: v.array(deckCardValidator),
    sideboard: v.optional(v.array(deckCardValidator)),
    // Featured Card (PRD #589, issue #593). The resolved Card ID representing
    // the deck's art in the lobby (override-or-default, via
    // `resolveFeaturedCardId`). `null` for an empty deck. Resolved server-side
    // on every read so the wire is self-describing — the client never has to
    // re-run the resolver.
    featuredCardId: v.union(v.string(), v.null()),
    // Derived legality (ADR 0036), never stored — recomputed every read so a
    // ruleset/card-pool change reclassifies every preset with no migration.
    isLegal: v.boolean(),
    reasons: v.array(reasonValidator),
});

// The shape `list` returns to the lobby. Kept identical to the old in-code
// `DeckPreset` (notably the public id field is `presetId` === the slug), so
// the wire format and every frontend consumer are unchanged.
export interface LobbyPreset {
    presetId: string;
    name: string;
    format: FormatId;
    description: string;
    colors: string[];
    cards: DeckCard[];
    sideboard?: DeckCard[];
    // Resolved Featured Card ID (PRD #589, issue #593) — override-or-default,
    // `null` for an empty deck. Resolved server-side so the lobby renders deck
    // art without re-running the resolver.
    featuredCardId: string | null;
    // Derived legality (ADR 0036), recomputed on every read — never stored.
    isLegal: boolean;
    reasons: Reason[];
}

// Re-export the pure Featured Card resolver (PRD #589, issue #593) so existing
// `../decks` importers keep working. It lives in the server-free
// `deckPresets.ts` module so the frontend can share it without importing server
// runtime; the builders below fold it into the wire projection.
export { resolveFeaturedCardId };

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
 * slug (returned as `presetId`), preserving the pre-DB wire format. `banlist`
 * (PRD #1138, issue #1144) is the row's Format's DB banlist override, threaded
 * straight through to `validateDeck`; absent, `validateDeck` falls back to the
 * code-side constant for a DB-backed Format, or is a no-op for Alpha 40/
 * Freeform. Callers load it via `loadBanlistOverrides` (`list`/`getPreset`
 * below) so a DB-banned, built card is reflected here — the "deck-save
 * legality" surface — the instant it's synced, not just at game start.
 */
export function presetRowToLobby(
    row: Doc<"presetDecks">,
    banlist?: BanlistOverride
): LobbyPreset {
    // Legality is derived here, on every read (ADR 0036) — never persisted on
    // the row, so a banlist/card-pool change reclassifies presets automatically.
    const { isLegal, reasons } = validateDeck(row, row.format, undefined, banlist);
    return {
        presetId: row.slug,
        name: row.name,
        format: row.format,
        description: row.description ?? "",
        colors: row.colors,
        cards: row.cards,
        sideboard: row.sideboard,
        // Resolve the Featured Card on every read (PRD #589, issue #593): the
        // stored override-or-absent collapses to a single Card ID (or null),
        // so an override left dangling by a later card removal self-heals.
        featuredCardId: resolveFeaturedCardId(row),
        isLegal,
        reasons,
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

/**
 * Preload the DB banlist override for BOTH DB-backed Formats (PRD #1138,
 * issue #1144) in two queries total, regardless of how many preset rows
 * `list` maps over — avoids an N+1 `loadBanlistOverrides` call per row for a
 * loop that only ever touches two possible Formats. A row whose Format isn't
 * DB-backed (Alpha 40, Freeform) simply looks up `undefined` here, which
 * `presetRowToLobby`/`validateDeck` already treat as "use the code fallback".
 */
async function loadBanlistOverridesByFormat(
    ctx: QueryCtx
): Promise<Partial<Record<FormatId, BanlistOverride>>> {
    const [premodern, oldSchool] = await Promise.all([
        loadBanlistOverrides(ctx, "premodern"),
        loadBanlistOverrides(ctx, "old-school"),
    ]);
    return { premodern, "old-school": oldSchool };
}

// Lobby deck list, now sourced from the `presetDecks` DB table (ADR 0033).
// Reactive: an Admin's edit to a preset propagates to every client's lobby
// without a redeploy. Sorted by slug for stable ordering. Also reactive to a
// DB banlist sync (PRD #1138, issue #1144): a preset carrying a card newly
// banned in `formatBanlists` flips to illegal on the next read, no redeploy.
export const list = query({
    args: {},
    returns: v.array(lobbyPresetValidator),
    handler: async (ctx) => {
        const rows = await ctx.db.query("presetDecks").collect();
        const overridesByFormat = await loadBanlistOverridesByFormat(ctx);
        return sortLobbyPresets(
            rows.map((row) =>
                presetRowToLobby(row, overridesByFormat[row.format])
            )
        );
    },
});

// Validator for the editable fields of a preset. The `slug` is intentionally
// absent: it is the stable identity and is read-only after creation (ADR 0033).
const presetPatchValidator = v.object({
    name: v.optional(v.string()),
    // `format` is intentionally absent: it is immutable after creation (ADR
    // 0036), so a preset edit can never change it.
    colors: v.optional(v.array(v.string())),
    cards: v.optional(v.array(deckCardValidator)),
    sideboard: v.optional(v.array(deckCardValidator)),
    description: v.optional(v.string()),
    // Featured Card override (PRD #589, issue #593). The stored Card ID — NOT
    // the resolved one. An admin can set or clear it; clearing reverts to the
    // first-card default on the next read.
    featuredCardId: v.optional(v.string()),
});

/** The editable subset of a preset, mirroring `presetPatchValidator`. */
export interface PresetPatchInput {
    name?: string;
    colors?: string[];
    cards?: DeckCard[];
    sideboard?: DeckCard[];
    description?: string;
    featuredCardId?: string;
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
    if (input.colors !== undefined) patch.colors = input.colors;
    if (input.cards !== undefined) patch.cards = input.cards;
    if (input.sideboard !== undefined) patch.sideboard = input.sideboard;
    if (input.description !== undefined) patch.description = input.description;
    if (input.featuredCardId !== undefined)
        patch.featuredCardId = input.featuredCardId;
    return patch;
}

/** The full editable payload an Admin submits to create a new preset. */
export interface PresetCreateInput {
    name?: string;
    format?: FormatId;
    colors?: string[];
    cards?: DeckCard[];
    sideboard?: DeckCard[];
    description?: string;
    featuredCardId?: string;
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
        format: input.format ?? "freeform",
        description: input.description,
        colors: input.colors ?? [],
        cards: input.cards ?? [],
        sideboard: input.sideboard,
        // Featured Card override (PRD #589, issue #593). Stored verbatim; absent
        // ⇒ the resolver defaults to the first Maindeck card on read.
        featuredCardId: input.featuredCardId,
    };
}

// Validator for the full create payload of a preset. The `slug` is intentionally
// absent: it is derived from the name server-side and immutable (ADR 0033).
const presetCreateValidator = v.object({
    name: v.optional(v.string()),
    // Typed Format chosen by the Admin at creation (ADR 0036). Optional in the
    // payload; `buildNewPresetRow` defaults a missing value to `"freeform"`.
    format: v.optional(formatValidator),
    colors: v.optional(v.array(v.string())),
    cards: v.optional(v.array(deckCardValidator)),
    sideboard: v.optional(v.array(deckCardValidator)),
    description: v.optional(v.string()),
    // Featured Card override (PRD #589, issue #593). Optional at creation;
    // absent ⇒ first-card default on read.
    featuredCardId: v.optional(v.string()),
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
        if (!row) return null;
        // DB banlist override (PRD #1138, issue #1144) — mirrors `list` above.
        const banlist = await loadBanlistOverrides(ctx, row.format);
        return presetRowToLobby(row, banlist);
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

// Admin-only hard delete of a preset by slug (PRD #466, ADR 0033, issue #470).
// `assertIsAdmin` runs FIRST — non-admins are rejected server-side, not just
// hidden in the UI. The slug locates the row; the delete removes it from
// `presetDecks`, so the preset disappears from `api.decks.list` (reactive) for
// every client. In-flight games are unaffected — the deck is snapshotted into
// game state at creation, never read back from this table. A stored lobby
// selection pointing at the deleted slug resolves to no selection on the client
// (the list lookup is null-safe; see `selectPreset`). Deleting an absent slug
// is a no-op (idempotent).
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

// Preset wipe (PRD #509, ADR 0036). With typed Formats, the legacy preset rows
// (all `format: "Freeform"`) are deleted rather than migrated — an Admin
// recreates them with proper typed Formats out of band. The in-code seed is
// emptied too (`presetsToSeed` over an empty list never inserts), so a stray
// `seedPresets`-style call can't bring the old presets back. Idempotent: a
// second run finds an empty table and deletes nothing. Run once via the Convex
// dashboard / `mcp run` after this slice deploys.
export const wipePresets = internalMutation({
    args: {},
    returns: v.object({ deleted: v.number() }),
    handler: async (ctx) => {
        const rows = await ctx.db.query("presetDecks").collect();
        for (const row of rows) {
            await ctx.db.delete(row._id);
        }
        return { deleted: rows.length };
    },
});
