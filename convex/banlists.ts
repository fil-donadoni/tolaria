// Format banlist queries (PRD #1138, ADR 0057, issue #1141). This is the
// CONVEX-FUNCTION sibling of the pure banlist logic in `convex/formats.ts`
// (`BanlistEntry`, `resolveBanlistEnforcement`, `BANLIST_SEEDS`). Kept in a
// separate file so `convex/formats.ts` stays free of `_generated/server` —
// it is imported directly by the frontend (`@convex/formats`) for its pure
// helpers/types, and pulling `query`/`mutation` builders into that bundle
// would be the wrong boundary (mirrors why `game.ts`/`decks.ts` are never
// imported directly by the client, only via `api.*`).
//
// Every query here is a THIN WRAPPER over a pure core (`resolveBanlistDisplay`
// / `resolveBanlistEnforcementForFormat`), per the project's no-convex-test-
// harness testing convention (`convex/__tests__/decks.test.ts` and friends) —
// the cores are what `convex/__tests__/banlists.test.ts` exercises directly.

import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { tryGetCardByName } from "./cards";
import {
    BANLIST_SEEDS,
    resolveBanlistEnforcement,
    type BanlistEntry,
    type BanlistFormatId,
    type BanlistOverride,
    type ResolveCardByName,
} from "./formats";

const banlistFormatValidator = v.union(
    v.literal("premodern"),
    v.literal("old-school")
);

const banlistEntryValidator = v.object({
    cardName: v.string(),
    status: v.union(v.literal("banned"), v.literal("restricted")),
});

/**
 * Full display list for a format (PRD #1138 User Story 2): DB rows for
 * `format` when any exist, else the code-side seed (`BANLIST_SEEDS`) so the
 * list is never empty pre-sync. PURE — the `getBanlist` query's entire body,
 * extracted so it's directly unit-testable without a convex-test harness.
 */
export function resolveBanlistDisplay(
    format: BanlistFormatId,
    rows: readonly BanlistEntry[]
): BanlistEntry[] {
    const entries = rows.length > 0 ? rows : BANLIST_SEEDS[format];
    return entries.map((e) => ({ cardName: e.cardName, status: e.status }));
}

/**
 * Enforcement cardId sets for a format (PRD #1138 User Story 4): the same
 * DB-rows-or-seed selection as `resolveBanlistDisplay`, then resolved through
 * `resolveBanlistEnforcement` — a name with no built `CardDefinition` is
 * dropped from these sets while it stays present in the display list above.
 * PURE aside from the injected `resolve`; the `getBanlistEnforcement` query's
 * entire body.
 */
export function resolveBanlistEnforcementForFormat(
    format: BanlistFormatId,
    rows: readonly BanlistEntry[],
    resolve: ResolveCardByName
): BanlistOverride {
    return resolveBanlistEnforcement(
        resolveBanlistDisplay(format, rows),
        resolve
    );
}

async function loadRows(
    ctx: QueryCtx,
    format: BanlistFormatId
): Promise<BanlistEntry[]> {
    const rows = await ctx.db
        .query("formatBanlists")
        .withIndex("by_format", (q) => q.eq("format", format))
        .collect();
    return rows.map((r) => ({ cardName: r.cardName, status: r.status }));
}

/**
 * The full official banlist for `format`, for display (PRD #1138 User Story
 * 2 — every player, not just admins). Includes cards with no built
 * `CardDefinition` yet (e.g. Parallax Tide for Premodern) — this is the
 * point of the feature: the displayed list finally reads as complete, unlike
 * the old code-const lists which were implicitly intersected with the built
 * pool.
 */
export const getBanlist = query({
    args: { format: banlistFormatValidator },
    returns: v.array(banlistEntryValidator),
    handler: async (ctx, { format }) => {
        const rows = await loadRows(ctx, format);
        return resolveBanlistDisplay(format, rows);
    },
});

/**
 * Enforcement cardId sets for `format` (PRD #1138 User Story 4): names are
 * resolved to `CardDefinition.id` LIVE on every read via `tryGetCardByName`
 * (the `nameRegistry` authority, `convex/cards/index.ts`), so a card banned
 * on a prior sync starts being enforced the instant it ships — no migration,
 * no stale window. Consumed by the client's `validateDeck` call sites and by
 * the server-side game-start gate (both inject the result as `BanlistOverride`
 * into `validateDeck`/`assertDeckLegal`, mirroring the existing `resolve`
 * dependency, issue #1140).
 */
export const getBanlistEnforcement = query({
    args: { format: banlistFormatValidator },
    returns: v.object({
        banned: v.array(v.string()),
        restricted: v.array(v.string()),
    }),
    handler: async (ctx, { format }) => {
        const rows = await loadRows(ctx, format);
        const { banned, restricted } = resolveBanlistEnforcementForFormat(
            format,
            rows,
            tryGetCardByName
        );
        return { banned: [...banned], restricted: [...restricted] };
    },
});
