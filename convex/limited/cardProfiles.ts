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
    archetypesWriteErrors,
    buildArchetypesRow,
    buildCapabilitiesRow,
    capabilitiesOf,
    buildDbProfileLayers,
    buildScopeCardProfiles,
    capabilitiesWriteErrors,
    type CardCapabilitiesRow,
    type ProfileLayerRows,
    type ScopeCardProfile,
    type ScopedCardArchetypes,
} from "./cardProfilesCore";

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
// #1614). One tab per layer (issue #8904): each save and each clear touches
// ONE layer, with that layer's own review flag (ADR 0167). The Capability row
// is scope-free, so an edit made from any tab holds in every scope (§1).
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

/** Admin-only save of ONE card's Capability layer: its scope-free
 *  `cardCapabilities` row, upserted (identity/`_id` preserved on a patch).
 *  `assertIsAdmin` runs FIRST. Every `provides`/`requires` string must be a
 *  `CAPABILITY_REGISTRY` row, the cardId a real card
 *  (`capabilitiesWriteErrors`). `reviewed` is an explicit argument: flipping
 *  an LLM-seeded row to reviewed IS the human review act (ADR 0072), and it
 *  reviews THIS layer only. */
export const setCardCapabilities = mutation({
    args: {
        cardId: v.string(),
        provides: v.array(v.string()),
        requires: v.array(v.string()),
        comboEdges: comboEdgesValidator,
        reviewed: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx, { cardId, ...write }) => {
        await assertIsAdmin(ctx);
        const errors = capabilitiesWriteErrors(cardId, write);
        if (errors.length > 0) {
            throw new Error(`Invalid Card Capabilities: ${errors.join("; ")}`);
        }
        await upsertCapabilities(ctx, buildCapabilitiesRow(cardId, write));
        return null;
    },
});

/** Admin-only save of ONE card's Archetype layer in `scope`: its
 *  `(scope, cardId)` `cardArchetypes` row, upserted. `assertIsAdmin` runs
 *  FIRST. Every archetype must be a row of the effective Archetype Catalogue
 *  (seed ∪ DB, ADR 0167), the cardId a real card (`archetypesWriteErrors`).
 *  `reviewed` reviews THIS layer only. */
export const setCardArchetypes = mutation({
    args: {
        scope: v.string(),
        cardId: v.string(),
        archetypes: v.array(v.string()),
        reviewed: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx, { scope, cardId, ...write }) => {
        await assertIsAdmin(ctx);
        const errors = archetypesWriteErrors(
            cardId,
            write,
            catalogueIds(await loadArchetypeCatalogue(ctx))
        );
        if (errors.length > 0) {
            throw new Error(`Invalid Card Archetypes: ${errors.join("; ")}`);
        }
        await upsertArchetypes(ctx, buildArchetypesRow(scope, cardId, write));
        return null;
    },
});

/** Admin-only revert of ONE card's Capability layer to its checked-in census:
 *  deletes the override (scope-free — every scope falls back to the seed).
 *  `assertIsAdmin` runs FIRST. Idempotent: clearing an absent row is a
 *  no-op, never an error. */
export const clearCardCapabilities = mutation({
    args: { cardId: v.string() },
    returns: v.null(),
    handler: async (ctx, { cardId }) => {
        await assertIsAdmin(ctx);
        const capabilities = await loadCapabilitiesDoc(ctx, cardId);
        if (capabilities) await ctx.db.delete(capabilities._id);
        return null;
    },
});

/** Admin-only revert of ONE card's Archetype layer in `scope` to its
 *  checked-in census. `assertIsAdmin` runs FIRST. Idempotent. */
export const clearCardArchetypes = mutation({
    args: { scope: v.string(), cardId: v.string() },
    returns: v.null(),
    handler: async (ctx, { scope, cardId }) => {
        await assertIsAdmin(ctx);
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
    capabilitiesReviewed: v.union(v.boolean(), v.null()),
    archetypesReviewed: v.union(v.boolean(), v.null()),
    capabilitiesRationale: v.optional(v.string()),
    archetypesRationale: v.optional(v.string()),
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
