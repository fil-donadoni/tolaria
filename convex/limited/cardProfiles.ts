// Card Profile layer — the Convex FUNCTION shell (ADR 0072, PRD #1607 slice
// 1, issue #1608). The pure read-path core — `resolveEventCardProfile`,
// `buildDbProfileLookup`, `validateCardProfileFile`, and every type they
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
import { v } from "convex/values";
import { query } from "../_generated/server";
import { getCurrentUserId } from "../auth";
import type { ScopedCardProfile } from "./cardProfilesCore";

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
