// Archetype Catalogue — the Convex FUNCTION shell (ADR 0167, PRD #8772,
// issue #8892). The pure core — row shape, validation, the seed ∪ DB merge,
// `activeRows` / `colourSignature` — lives in the sibling
// `archetypeCatalogueCore.ts`, which the browser imports; this file owns
// `ctx.db` and the auth gate, which it must never pull into the bundle.
//
// The `archetypeCatalogue` table holds Admin rows only — the eight seed rows
// are the checked-in `data/archetype-catalogue.json` — so it stays small; an
// Admin edit of a seed row is a DB row with the seed row's `id`.
import { v } from "convex/values";
import {
    mutation,
    query,
    type MutationCtx,
    type QueryCtx,
} from "../_generated/server";
import { assertIsAdmin } from "../auth";
import {
    ARCHETYPE_CATALOGUE_SEED,
    archetypeCatalogueWriteErrors,
    mergeArchetypeCatalogue,
    type ArchetypeCatalogueRow,
} from "./archetypeCatalogueCore";

const archetypeRowValidator = v.object({
    id: v.string(),
    description: v.string(),
    gloss: v.object({ when: v.string(), not: v.string() }),
    example: v.string(),
});

/** Bound on the DB rows one read loads. An Archetype is a COARSE plan (ADR
 *  0072): the catalogue is tens of rows, and one past this bound fails
 *  loudly rather than silently truncating the vocabulary. */
const MAX_DB_ARCHETYPE_ROWS = 200;

/** The effective catalogue — seed ∪ DB, a DB row overriding the seed row of
 *  its `id`. The one place the catalogue read touches `ctx.db`: the editor
 *  query below and `setCardArchetypes`'s write boundary both call it. */
export async function loadArchetypeCatalogue(
    ctx: QueryCtx | MutationCtx
): Promise<ArchetypeCatalogueRow[]> {
    const docs = await ctx.db
        .query("archetypeCatalogue")
        .withIndex("by_archetype_id")
        .take(MAX_DB_ARCHETYPE_ROWS + 1);
    if (docs.length > MAX_DB_ARCHETYPE_ROWS) {
        throw new Error(
            `archetypeCatalogue holds more than ${MAX_DB_ARCHETYPE_ROWS} rows — an Archetype is a coarse plan`
        );
    }
    return mergeArchetypeCatalogue(
        ARCHETYPE_CATALOGUE_SEED,
        docs.map((doc) => ({
            id: doc.id,
            description: doc.description,
            gloss: doc.gloss,
            example: doc.example,
        }))
    );
}

/** Admin-only read of the effective catalogue — what the Card Profile
 *  editor's Archetype picker renders, so a row added here shows up there
 *  with no code change. `assertIsAdmin` runs FIRST. */
export const listArchetypeCatalogue = query({
    args: {},
    returns: v.array(archetypeRowValidator),
    handler: async (ctx): Promise<ArchetypeCatalogueRow[]> => {
        await assertIsAdmin(ctx);
        return loadArchetypeCatalogue(ctx);
    },
});

async function writeArchetypeRow(
    ctx: MutationCtx,
    mode: "create" | "edit",
    row: ArchetypeCatalogueRow
): Promise<void> {
    await assertIsAdmin(ctx);
    const errors = archetypeCatalogueWriteErrors(
        mode,
        row,
        await loadArchetypeCatalogue(ctx)
    );
    if (errors.length > 0) {
        throw new Error(`Invalid Archetype row: ${errors.join("; ")}`);
    }
    const existing = await ctx.db
        .query("archetypeCatalogue")
        .withIndex("by_archetype_id", (q) => q.eq("id", row.id))
        .unique();
    if (existing) {
        await ctx.db.patch(existing._id, row);
    } else {
        await ctx.db.insert("archetypeCatalogue", row);
    }
}

/** Admin-only create of a NEW catalogue row — refused when the row has no
 *  `TAG WHEN:` or no `NOT:` clause, a non-kebab-case id, an empty gloss
 *  line, an example that is not a card, or an id already in seed ∪ DB. */
export const createArchetypeRow = mutation({
    args: { row: archetypeRowValidator },
    returns: v.null(),
    handler: async (ctx, { row }) => {
        await writeArchetypeRow(ctx, "create", row);
        return null;
    },
});

/** Admin-only edit of an EXISTING row (seed or DB) by `id` — the same shape
 *  checks as create; the id is the key and never changes, since Card
 *  Archetypes reference it. Editing a seed row writes its DB override. */
export const updateArchetypeRow = mutation({
    args: { row: archetypeRowValidator },
    returns: v.null(),
    handler: async (ctx, { row }) => {
        await writeArchetypeRow(ctx, "edit", row);
        return null;
    },
});
