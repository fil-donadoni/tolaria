// Card Profile layer — the Convex FUNCTION shell (ADR 0072, PRD #1607; two
// layers since ADR 0167, issue #8890). The pure core — the layer types,
// `resolveEventCardProfile`, `buildDbProfileLayers`, the seed validators,
// the editor row builders — lives in the sibling
// `cardProfilesCore.ts` and is imported by both this module and the
// BROWSER-side Draft Lab. This file owns the one thing the Lab must never
// pull into its bundle: `ctx.db` access and the auth gate.
//
// The split is load-bearing, not cosmetic: `../auth` runs `convexAuth({...})`
// at module scope, which reads `process.env` — a single client-side VALUE
// import of a helper that used to live here dragged that into the Vite
// bundle and crashed the app on cold load with "process is not defined".
// `scripts/__tests__/client-bundle-purity.test.ts` guards it.
//
// Two tables (`convex/schema.ts`): `cardCapabilities` keyed by `cardId`,
// `cardArchetypes` keyed `(scope, cardId)`.
import { v } from "convex/values";
import {
    mutation,
    query,
    type MutationCtx,
    type QueryCtx,
} from "../_generated/server";
import { assertIsAdmin } from "../auth";
import { listScopeCards } from "./cardRatingsCore";
import { loadArchetypeCatalogue } from "./archetypeCatalogue";
import { catalogueIds } from "./archetypeCatalogueCore";
import {
    archetypesOf,
    buildCardProfileRows,
    capabilitiesOf,
    buildDbProfileLayers,
    buildScopeCardProfiles,
    cardProfileWriteErrors,
    type CardCapabilitiesRow,
    type ProfileLayerRows,
    type ScopeCardProfile,
    type ScopedCardArchetypes,
    getCardArchetypeFile,
    getCardCapabilityFile,
} from "./cardProfilesCore";
import {
    buildArchetypeExportFile,
    buildCapabilityExportFile,
    seedFileName,
    serializeSeedFile,
    type CardProfileSeedFile,
} from "./cardProfileSeedFiles";

const comboEdgesValidator = v.optional(
    v.array(v.object({ cardId: v.string(), weight: v.number() }))
);

const capabilitiesRowValidator = v.object({
    cardId: v.string(),
    provides: v.array(v.string()),
    requires: v.array(v.string()),
    comboEdges: comboEdgesValidator,
    reviewed: v.boolean(),
    rationale: v.optional(v.string()),
});

const archetypesRowValidator = v.object({
    scope: v.string(),
    cardId: v.string(),
    archetypes: v.array(v.string()),
    reviewed: v.boolean(),
    rationale: v.optional(v.string()),
});

/** Bound on the `cardCapabilities` rows one read loads. The table holds
 *  Admin OVERRIDES only — the census itself is the checked-in seed — so it
 *  stays far below this; the bound is the guideline's "never an unbounded
 *  collect", and a table that ever outgrows it fails loudly here rather
 *  than silently truncating the layer. */
const MAX_DB_CAPABILITY_ROWS = 4000;

function capabilitiesFromDoc(row: {
    cardId: string;
    provides: string[];
    requires: string[];
    comboEdges?: { cardId: string; weight: number }[];
    reviewed: boolean;
    rationale?: string;
}): CardCapabilitiesRow {
    return {
        cardId: row.cardId,
        provides: row.provides,
        requires: row.requires,
        ...(row.comboEdges === undefined ? {} : { comboEdges: row.comboEdges }),
        reviewed: row.reviewed,
        ...(row.rationale === undefined ? {} : { rationale: row.rationale }),
    };
}

function archetypesFromDoc(row: {
    scope: string;
    cardId: string;
    archetypes: string[];
    reviewed: boolean;
    rationale?: string;
}): ScopedCardArchetypes {
    return {
        scope: row.scope,
        cardId: row.cardId,
        archetypes: row.archetypes,
        reviewed: row.reviewed,
        ...(row.rationale === undefined ? {} : { rationale: row.rationale }),
    };
}

/** Both layers' DB rows an event (or the Draft Lab) needs for `scopes`: every
 *  Capability override (scope-free, ADR 0167 §1) and every Archetype row of
 *  each DISTINCT scope (the `by_scope` index — never a full scan). The one
 *  place the Card Profile read path touches `ctx.db`; `limitedEvents.ts`'s
 *  `loadEventCardProfile` and `listScopeCardProfiles` below both call it. */
export async function loadProfileLayerRows(
    ctx: QueryCtx | MutationCtx,
    scopes: readonly string[]
): Promise<ProfileLayerRows> {
    const capabilityDocs = await ctx.db
        .query("cardCapabilities")
        .withIndex("by_cardId")
        .take(MAX_DB_CAPABILITY_ROWS + 1);
    if (capabilityDocs.length > MAX_DB_CAPABILITY_ROWS) {
        throw new Error(
            `cardCapabilities holds more than ${MAX_DB_CAPABILITY_ROWS} override rows — promote them into the seed`
        );
    }
    const archetypes: ScopedCardArchetypes[] = [];
    const normalizedScopes = Array.from(
        new Set(scopes.map((scope) => scope.toLowerCase()))
    );
    for (const scope of normalizedScopes) {
        const rows = await ctx.db
            .query("cardArchetypes")
            .withIndex("by_scope", (q) => q.eq("scope", scope))
            .collect();
        for (const row of rows) archetypes.push(archetypesFromDoc(row));
    }
    return {
        capabilities: capabilityDocs.map(capabilitiesFromDoc),
        archetypes,
    };
}

/** Both layers' DB rows for a set of scopes — the read the Draft Lab folds
 *  through `buildDbProfileLayers` into `resolveEventCardProfile`.
 *  Admin-gated (`assertIsAdmin`): its only consumer is the Draft Lab, and
 *  the WHOLE `/draft-lab` route is admin-only (`src/routes/draft-lab.route.tsx`);
 *  an open query would make that route gate cosmetic. Read-only: no
 *  `insert`/`patch`/`delete` in this handler, so it carries no write surface
 *  for `draft-lab-no-mutation.test.ts` to catch. */
export const listScopeCardProfiles = query({
    args: { scopes: v.array(v.string()) },
    returns: v.object({
        capabilities: v.array(capabilitiesRowValidator),
        archetypes: v.array(archetypesRowValidator),
    }),
    handler: async (ctx, { scopes }): Promise<ProfileLayerRows> => {
        await assertIsAdmin(ctx);
        return loadProfileLayerRows(ctx, scopes);
    },
});

// ─────────────────────────────────────────────────────────────────────────
// Admin write boundary + editor read query (PRD #1607, ADR 0072, issue
// #1614). The current editor keeps its one-profile-per-card shape: a save
// writes BOTH layers (the Capability row is scope-free, so an edit made from
// one scope's editor holds in every scope — ADR 0167 §1).
// ─────────────────────────────────────────────────────────────────────────

async function loadCapabilitiesDoc(ctx: MutationCtx, cardId: string) {
    return ctx.db
        .query("cardCapabilities")
        .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
        .unique();
}

async function loadArchetypesDoc(
    ctx: MutationCtx,
    scope: string,
    cardId: string
) {
    return ctx.db
        .query("cardArchetypes")
        .withIndex("by_scope_and_cardId", (q) =>
            q.eq("scope", scope).eq("cardId", cardId)
        )
        .unique();
}

/** Upserts one card's Capability row. A save is the WHOLE edge list:
 *  `comboEdges` absent clears the stored ones (an `undefined` patch field
 *  removes it). `rationale` is the census's, which the editor never sends,
 *  so it is left as stored. */
async function upsertCapabilities(
    ctx: MutationCtx,
    row: CardCapabilitiesRow
): Promise<void> {
    const existing = await loadCapabilitiesDoc(ctx, row.cardId);
    if (existing) {
        await ctx.db.patch(existing._id, {
            ...capabilitiesOf(row),
            comboEdges: row.comboEdges,
        });
    } else {
        await ctx.db.insert("cardCapabilities", row);
    }
}

async function upsertArchetypes(
    ctx: MutationCtx,
    row: ScopedCardArchetypes
): Promise<void> {
    const existing = await loadArchetypesDoc(ctx, row.scope, row.cardId);
    if (existing) {
        await ctx.db.patch(existing._id, archetypesOf(row));
    } else {
        await ctx.db.insert("cardArchetypes", row);
    }
}

/** Admin-only save of ONE card's profile from a scope's editor: the card's
 *  Capability row and its `(scope, cardId)` Archetype row, both upserted
 *  (identity/`_id` preserved on a patch). `assertIsAdmin` runs FIRST. Every
 *  `provides`/`requires` string must be a `CAPABILITY_REGISTRY` row, every
 *  archetype a row of the effective Archetype Catalogue (seed ∪ DB, ADR
 *  0167), every cardId a real card (`cardProfileWriteErrors`). `reviewed` is an explicit
 *  argument: flipping an LLM-seeded row to reviewed IS the human review act
 *  (ADR 0072), and one act reviews both layers. */
export const setCardProfile = mutation({
    args: {
        scope: v.string(),
        cardId: v.string(),
        archetypes: v.array(v.string()),
        provides: v.array(v.string()),
        requires: v.array(v.string()),
        comboEdges: comboEdgesValidator,
        reviewed: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx, { scope, cardId, ...profile }) => {
        await assertIsAdmin(ctx);
        const errors = cardProfileWriteErrors(
            cardId,
            profile,
            catalogueIds(await loadArchetypeCatalogue(ctx))
        );
        if (errors.length > 0) {
            throw new Error(`Invalid Card Profile: ${errors.join("; ")}`);
        }
        const rows = buildCardProfileRows(scope, cardId, profile);
        await upsertCapabilities(ctx, rows.capabilities);
        await upsertArchetypes(ctx, rows.archetypes);
        return null;
    },
});

/** Admin-only revert of ONE card to its checked-in census: deletes its
 *  Capability override (scope-free — every scope falls back to the seed) and
 *  its Archetype override for `scope`. `assertIsAdmin` runs FIRST.
 *  Idempotent: clearing an absent pair is a no-op, never an error. */
export const clearCardProfile = mutation({
    args: { scope: v.string(), cardId: v.string() },
    returns: v.null(),
    handler: async (ctx, { scope, cardId }) => {
        await assertIsAdmin(ctx);
        const capabilities = await loadCapabilitiesDoc(ctx, cardId);
        if (capabilities) await ctx.db.delete(capabilities._id);
        const archetypes = await loadArchetypesDoc(
            ctx,
            scope.toLowerCase(),
            cardId
        );
        if (archetypes) await ctx.db.delete(archetypes._id);
        return null;
    },
});

const editorCardProfileValidator = v.object({
    archetypes: v.array(v.string()),
    provides: v.array(v.string()),
    requires: v.array(v.string()),
    comboEdges: comboEdgesValidator,
    reviewed: v.boolean(),
});

/** Admin-only editor read (issue #1614): for a chosen `scope` (a Draftable
 *  Set code, or `vintage-cube`), every card of that scope with its DB
 *  override (either layer) and its census seed, sorted by name for a stable
 *  listing. `assertIsAdmin` runs FIRST. */
export const listScopeCardProfilesForEditor = query({
    args: { scope: v.string() },
    returns: v.array(
        v.object({
            cardId: v.string(),
            name: v.string(),
            colours: v.array(v.string()),
            dbProfile: v.union(editorCardProfileValidator, v.null()),
            seedProfile: v.union(editorCardProfileValidator, v.null()),
        })
    ),
    handler: async (ctx, { scope }): Promise<ScopeCardProfile[]> => {
        await assertIsAdmin(ctx);
        const normalizedScope = scope.toLowerCase();
        const cards = listScopeCards(normalizedScope);
        const db = buildDbProfileLayers(
            await loadProfileLayerRows(ctx, [normalizedScope])
        );
        return buildScopeCardProfiles(normalizedScope, cards, db).sort((a, b) =>
            a.name.localeCompare(b.name)
        );
    },
});

/** Admin-only export of ONE layer's effective rows (DB over seed) in its
 *  seed-file format (PRD #8772, issue #8907): `capabilities` → the
 *  catalogue-wide `capabilities.json`, `archetypes` → `scope`'s
 *  `archetypes/<scope>.json`, review flags and rationales included. Returns
 *  the file's name and text; `bun run profiles:promote <file>` takes the
 *  download back into the repo. `assertIsAdmin` runs FIRST. Read-only. */
export const exportCardProfileSeedFile = query({
    args: {
        layer: v.union(v.literal("capabilities"), v.literal("archetypes")),
        /** The Archetype layer's scope; the Capability layer has none. */
        scope: v.optional(v.string()),
    },
    returns: v.object({ fileName: v.string(), text: v.string() }),
    handler: async (ctx, { layer, scope }) => {
        await assertIsAdmin(ctx);
        if (layer === "archetypes" && scope === undefined) {
            throw new Error("An Archetype export needs a scope");
        }
        const normalizedScope = (scope ?? "").toLowerCase();
        const rows = await loadProfileLayerRows(
            ctx,
            layer === "archetypes" ? [normalizedScope] : []
        );
        const seed: CardProfileSeedFile =
            layer === "capabilities"
                ? {
                      layer,
                      file: buildCapabilityExportFile(
                          getCardCapabilityFile(),
                          rows.capabilities
                      ),
                  }
                : {
                      layer,
                      file: buildArchetypeExportFile(
                          normalizedScope,
                          getCardArchetypeFile(normalizedScope),
                          rows.archetypes
                      ),
                  };
        return { fileName: seedFileName(seed), text: serializeSeedFile(seed) };
    },
});
