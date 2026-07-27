// Card Profile layer — the Convex FUNCTION shell (ADR 0072, PRD #1607 slice
// 1, issue #1608). The pure read-path core — `resolveEventCardProfile`,
// `buildDbProfileLookup`, `validateCardProfileFile`, `buildCardProfileRow`,
// `cardProfileWriteErrors`, `buildScopeCardProfiles`, and every type they
// speak — lives in the sibling `cardProfilesCore.ts` and is imported by both
// this module and the BROWSER-side Draft Lab. This file owns the one thing
// the Lab must never pull into its bundle: `ctx.db` access and the auth gate.
//
// The split is load-bearing, not cosmetic: `../auth` runs `convexAuth({...})`
// at module scope, which reads `process.env` — a single client-side VALUE
// import of a helper that used to live here dragged that into the Vite
// bundle and crashed the app on cold load with "process is not defined".
// `scripts/__tests__/client-bundle-purity.test.ts` guards it. Anything pure
// belongs in `cardProfilesCore.ts`; anything holding `ctx` belongs here.
//
// `listScopeCardProfiles` (issue #1612 fixup) exists so a DISPLAY-only
// consumer — the Draft Lab's `DraftLabProfileBadge` — can read real
// `cardProfiles` rows instead of being permanently wired to a `() => null` DB
// layer; it is a read-only query (no mutation, no write), so it does not
// touch ADR 0074's "the Draft Lab writes nothing" guarantee.
//
// Issue #1614 adds the Admin write boundary at the bottom of this file: the
// `assertIsAdmin`-gated `setCardProfile`/`clearCardProfile` mutations plus
// `listScopeCardProfilesForEditor`, the admin-gated both-layers editor read.
// The checked-in Vintage Cube census itself — the seed layer's first real
// content — is PURE data and lives in `cardProfilesCore.ts`'s
// `CHECKED_IN_CARD_PROFILES`, not here; so do every pure row-shape/validation
// helper the mutations below build on (`buildCardProfileRow`,
// `cardProfileWriteErrors`, `normalizeArchetypes`, `buildScopeCardProfiles`).
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import { assertIsAdmin, getCurrentUserId } from "../auth";
import { listScopeCards } from "./cardRatingsCore";
import {
    buildCardProfileRow,
    buildScopeCardProfiles,
    cardProfileWriteErrors,
    type CardProfile,
    type GetDbProfile,
    type ScopeCardProfile,
    type ScopedCardProfile,
} from "./cardProfilesCore";

const scopedCardProfileValidator = v.object({
    scope: v.string(),
    cardId: v.string(),
    archetypes: v.array(v.string()),
    provides: v.array(v.string()),
    requires: v.array(v.string()),
    comboEdges: v.optional(
        v.array(v.object({ cardId: v.string(), weight: v.number() }))
    ),
    reviewed: v.boolean(),
});

/** Every `cardProfiles` row for a set of scopes — the ONE place the Card
 *  Profile layer touches `ctx.db` directly, mirroring `cardRatings.ts`'s
 *  `listScopeCardRatings`. Unlike that editor query, this is NOT admin-gated
 *  (`getCurrentUserId`, not `assertIsAdmin`): the Draft Lab is a synthetic
 *  developer surface any authenticated user can open (issue #1612), and
 *  reading a Card Profile to render an "unreviewed" badge is informational,
 *  not an Admin-only capability — the SAME "any authenticated user, not
 *  admin-gated" call `listLimitedDraftableSets` already makes for its own
 *  informational read. Read-only: no `insert`/`patch`/`delete` anywhere in
 *  this handler, so it carries no write surface for
 *  `draft-lab-no-mutation.test.ts` to catch.
 *
 *  `scopes` is the caller's distinct pack-source identities (mirrors
 *  `resolveEventCardProfile`'s own `scopes` parameter); normalized to
 *  lowercase here, once. Uses the `by_scope` index per scope — bounded, never
 *  a full-table scan — the same access pattern
 *  `limitedEvents.ts#loadEventPickRating` uses for `cardRatings`. */
export const listScopeCardProfiles = query({
    args: { scopes: v.array(v.string()) },
    returns: v.array(scopedCardProfileValidator),
    handler: async (ctx, { scopes }): Promise<ScopedCardProfile[]> => {
        await getCurrentUserId(ctx);
        const normalizedScopes = Array.from(
            new Set(scopes.map((scope) => scope.toLowerCase()))
        );
        const rows: ScopedCardProfile[] = [];
        for (const scope of normalizedScopes) {
            const scopeRows = await ctx.db
                .query("cardProfiles")
                .withIndex("by_scope", (q) => q.eq("scope", scope))
                .collect();
            for (const row of scopeRows) {
                rows.push({
                    scope: row.scope,
                    cardId: row.cardId,
                    archetypes: row.archetypes,
                    provides: row.provides,
                    requires: row.requires,
                    comboEdges: row.comboEdges,
                    reviewed: row.reviewed,
                });
            }
        }
        return rows;
    },
});

// ─────────────────────────────────────────────────────────────────────────
// Admin write boundary + editor read query (PRD #1607, ADR 0072, issue
// #1614). Mirrors `cardRatings.ts`'s Slice B/C shape exactly: the pure
// row-shape/validation helpers live in `cardProfilesCore.ts` (unit-testable
// with no convex-test harness), the thin `assertIsAdmin`-gated Convex
// functions that own `ctx.db` live here.
// ─────────────────────────────────────────────────────────────────────────

/** Point lookup on the table's natural primary key — the shared read used by
 *  both `setCardProfile` (patch vs. insert) and `clearCardProfile` (is there
 *  anything to delete). `scope` must already be normalized by the caller.
 *  Mirrors `cardRatings.ts`'s `loadCardRating`. */
async function loadCardProfile(
    ctx: MutationCtx,
    scope: string,
    cardId: string
) {
    return ctx.db
        .query("cardProfiles")
        .withIndex("by_scope_card", (q) =>
            q.eq("scope", scope).eq("cardId", cardId)
        )
        .unique();
}

const comboEdgesValidator = v.optional(
    v.array(v.object({ cardId: v.string(), weight: v.number() }))
);

/** Admin-only upsert of ONE `(scope, cardId)` Card Profile (issue #1614).
 *  `assertIsAdmin` runs FIRST — the same "gate before anything else"
 *  convention as `setCardRating`/`clearCardRating` and every admin mutation
 *  in `convex/decks.ts`/`convex/cubes.ts`. Rejects any `provides`/`requires`
 *  string outside `CAPABILITY_REGISTRY` and any `cardId` that doesn't
 *  resolve to a real card (`cardProfileWriteErrors`), so the database layer
 *  is held to EXACTLY the vocabulary bound the checked-in seed layer's guard
 *  test enforces — an Admin cannot type a Capability name into existence any
 *  more than a seed file can. `reviewed` is an explicit argument, not
 *  inferred: flipping an LLM-seeded row to reviewed IS the human review act
 *  (ADR 0072), so it is always a deliberate write. Patches the existing row
 *  when `(scope, cardId)` already has one (identity/`_id` preserved), else
 *  inserts — mirrors `setCardRating`/`cubes.ts#upsertCube`. */
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
        const errors = cardProfileWriteErrors(cardId, profile);
        if (errors.length > 0) {
            throw new Error(`Invalid Card Profile: ${errors.join("; ")}`);
        }
        const row = buildCardProfileRow(scope, cardId, profile);
        const existing = await loadCardProfile(ctx, row.scope, row.cardId);
        if (existing) {
            await ctx.db.patch(existing._id, {
                archetypes: row.archetypes,
                provides: row.provides,
                requires: row.requires,
                comboEdges: row.comboEdges,
                reviewed: row.reviewed,
            });
        } else {
            await ctx.db.insert("cardProfiles", row);
        }
        return null;
    },
});

/** Admin-only delete of ONE `(scope, cardId)` Card Profile (issue #1614) —
 *  the card falls back to its checked-in seed profile (or to no profile at
 *  all) on the very next read, no separate "revert" step needed:
 *  `resolveEventCardProfile`'s layering already treats an absent database
 *  row as "fall through to the seed layer". `assertIsAdmin` runs FIRST.
 *  Idempotent: clearing an already-absent pair is a no-op, not an error —
 *  mirrors `clearCardRating` exactly. */
export const clearCardProfile = mutation({
    args: { scope: v.string(), cardId: v.string() },
    returns: v.null(),
    handler: async (ctx, { scope, cardId }) => {
        await assertIsAdmin(ctx);
        const existing = await loadCardProfile(
            ctx,
            scope.toLowerCase(),
            cardId
        );
        if (existing) {
            await ctx.db.delete(existing._id);
        }
        return null;
    },
});

const cardProfileValidator = v.object({
    archetypes: v.array(v.string()),
    provides: v.array(v.string()),
    requires: v.array(v.string()),
    comboEdges: comboEdgesValidator,
    reviewed: v.boolean(),
});

/** Admin-only editor read query (issue #1614): for a chosen `scope` (a
 *  Draftable Set code, or the Vintage Cube's `vintage-cube` key), every card
 *  of that scope with both profile layers, sorted by name for a stable
 *  listing. `assertIsAdmin` runs FIRST — unlike `listScopeCardProfiles`
 *  above, which is the Draft Lab's informational read and deliberately
 *  ungated, this one exposes the seed layer alongside the database layer for
 *  EDITING, exactly the split `cardRatings.ts` draws between
 *  `listScopeCardRatings` (admin editor) and `listScopeCardRatingsForReplay`
 *  (informational). Loads the scope's rows through the `by_scope` index —
 *  bounded, never a full-table scan. */
export const listScopeCardProfilesForEditor = query({
    args: { scope: v.string() },
    returns: v.array(
        v.object({
            cardId: v.string(),
            name: v.string(),
            dbProfile: v.union(cardProfileValidator, v.null()),
            seedProfile: v.union(cardProfileValidator, v.null()),
        })
    ),
    handler: async (ctx, { scope }): Promise<ScopeCardProfile[]> => {
        await assertIsAdmin(ctx);
        const normalizedScope = scope.toLowerCase();
        const cards = listScopeCards(normalizedScope);

        const rows = await ctx.db
            .query("cardProfiles")
            .withIndex("by_scope", (q) => q.eq("scope", normalizedScope))
            .collect();
        const byCardId = new Map<string, CardProfile>(
            rows.map((row) => [
                row.cardId,
                {
                    archetypes: row.archetypes,
                    provides: row.provides,
                    requires: row.requires,
                    comboEdges: row.comboEdges,
                    reviewed: row.reviewed,
                },
            ])
        );
        const getDbProfile: GetDbProfile = (_scope, cardId) =>
            byCardId.get(cardId) ?? null;

        return buildScopeCardProfiles(
            normalizedScope,
            cards,
            getDbProfile
        ).sort((a, b) => a.name.localeCompare(b.name));
    },
});
