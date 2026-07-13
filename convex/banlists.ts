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
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { tryGetCardByName } from "./cards";
import {
    BANLIST_SEEDS,
    isBanlistFormatId,
    resolveBanlistEnforcement,
    type BanlistEntry,
    type BanlistFormatId,
    type BanlistOverride,
    type ResolveCardByName,
} from "./formats";

/** Either a Convex query or mutation ctx — `loadRows`/`loadBanlistOverrides`
 *  below are read-only and callable from both (the game-start gates in
 *  `game.ts` and the preset-legality queries in `decks.ts`). */
type ReadCtx = QueryCtx | MutationCtx;

// Exported (not just module-local) so `convex/banlistSync.ts` — the admin
// sync action/mutation sibling (issue #1143) — shares the exact same
// validator shapes rather than duplicating the literal unions.
export const banlistFormatValidator = v.union(
    v.literal("premodern"),
    v.literal("old-school")
);

export const banlistEntryValidator = v.object({
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
    ctx: ReadCtx,
    format: BanlistFormatId
): Promise<BanlistEntry[]> {
    const rows = await ctx.db
        .query("formatBanlists")
        .withIndex("by_format", (q) => q.eq("format", format))
        .collect();
    return rows.map((r) => ({ cardName: r.cardName, status: r.status }));
}

/** One `formatBanlists` row's sync provenance — the `source`/`syncedAt`
 *  fields `resolveBanlistDisplay` deliberately drops for the display shape
 *  (see `BanlistEntry`'s doc comment), needed here for the admin meta read. */
export interface BanlistSyncRow {
    source: string;
    syncedAt: number;
}

/** Per-format sync metadata for the admin panel (PRD #1138 User Story 7,
 *  issue #1146): `syncedAt`/`source` of the format's most recent sync, or
 *  `null` when the format has no DB rows yet (pre-first-sync — `getBanlist`
 *  is still serving the code-side seed, `resolveBanlistDisplay`). */
export interface BanlistMeta {
    syncedAt: number | null;
    source: string | null;
}

export const banlistMetaValidator = v.object({
    syncedAt: v.union(v.number(), v.null()),
    source: v.union(v.string(), v.null()),
});

/**
 * Resolves `BanlistMeta` from a format's raw DB rows (PRD #1138 User Story 7,
 * issue #1146): every row of a single sync shares the same `syncedAt`/`source`
 * (`replaceBanlist` stamps them uniformly across the whole batch), so the
 * first row's provenance is authoritative — this still takes the max
 * `syncedAt` defensively rather than assuming uniformity. PURE — the
 * `getBanlistMeta` query's entire body, extracted so it's directly
 * unit-testable without a convex-test harness (mirrors
 * `resolveBanlistDisplay` / `resolveBanlistEnforcementForFormat` above).
 */
export function resolveBanlistMeta(
    rows: readonly BanlistSyncRow[]
): BanlistMeta {
    if (rows.length === 0) return { syncedAt: null, source: null };
    return rows.reduce<BanlistMeta>(
        (latest, row) =>
            latest.syncedAt === null || row.syncedAt > latest.syncedAt
                ? { syncedAt: row.syncedAt, source: row.source }
                : latest,
        { syncedAt: null, source: null }
    );
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

/**
 * Server-side enforcement helper (PRD #1138, issue #1144) — the authoritative
 * counterpart to `getBanlistEnforcement` above, callable from a mutation
 * context (not just a query) so the game-start gates (`game.ts`) and deck
 * legality (`decks.ts`) can load a format's DB banlist override BEFORE
 * calling `assertDeckLegal` / `validateDeck`. Reuses the SAME pure cores
 * (`loadRows`, `resolveBanlistEnforcementForFormat`) the client query does —
 * the two are never allowed to diverge, since that would let the advisory
 * client and the authoritative server gate disagree.
 *
 * Returns `undefined` for a `format` with no DB-backed banlist (Alpha 40,
 * Freeform, or an unrecognized raw string) — those formats' validators
 * ignore an injected `banlist` argument anyway (`formats.ts`), so `undefined`
 * and "ignored" are equivalent and the caller never needs to special-case it.
 * Takes a raw `string` (not `BanlistFormatId`) so callers can pass a deck's
 * `format` field directly without pre-narrowing it themselves.
 */
export async function loadBanlistOverrides(
    ctx: ReadCtx,
    format: string
): Promise<BanlistOverride | undefined> {
    if (!isBanlistFormatId(format)) return undefined;
    const rows = await loadRows(ctx, format);
    return resolveBanlistEnforcementForFormat(format, rows, tryGetCardByName);
}

/**
 * Per-format sync metadata for the admin panel (PRD #1138 User Story 7, issue
 * #1146 `BanlistAdminPanel`): when the format was last Scryfall-synced (or
 * `null` pre-first-sync, when `getBanlist` is still serving the code-side
 * seed). Public — the admin UI check is cosmetic client-side gating only
 * (`canEditPresets`), same as every other read query in this file; the
 * mutating `syncBanlist` action is what actually enforces admin server-side.
 */
export const getBanlistMeta = query({
    args: { format: banlistFormatValidator },
    returns: banlistMetaValidator,
    handler: async (ctx, { format }) => {
        const rows = await ctx.db
            .query("formatBanlists")
            .withIndex("by_format", (q) => q.eq("format", format))
            .collect();
        return resolveBanlistMeta(
            rows.map((r) => ({ source: r.source, syncedAt: r.syncedAt }))
        );
    },
});
