// Cube lists — deck-builder discovery filter (DB-backed, admin-editable).
//
// A cube is a named, curated card LIST (e.g. the Vintage Cube, 540 cards) used
// to narrow the deck builder's card pool. It is NOT a legality Format: it never
// touches `validateDeck`/`assertDeckLegal` or the game-start gate — it only
// restricts which cards the builder surfaces.
//
// Like `convex/banlists.ts`, this is the CONVEX-FUNCTION sibling of a small
// pure core (`resolveCubeMembership`) kept separate so the thin query/mutation
// wrappers stay trivial and the core is directly unit-testable without a
// convex-test harness (`convex/__tests__/cubes.test.ts`).
//
// Cubes are stored by oracle NAME and resolved to the built pool LIVE on every
// read via `tryGetCardByName` (the `nameRegistry` authority): a name with no
// built `CardDefinition` is dropped, and a card ships into every cube it's
// named in with no cube edit and no migration — exactly the banlist model.

import { v } from "convex/values";
import {
    internalMutation,
    mutation,
    query,
    type MutationCtx,
    type QueryCtx,
} from "./_generated/server";
import { tryGetCardByName } from "./cards";
import { assertIsAdmin } from "./auth";
import type { ResolveCardByName } from "./formats";
import { VINTAGE_CUBE_NAMES } from "./cubes/vintageCubeNames";

/**
 * Pure core: resolve a cube's stored card NAMES to the canonical `cardId`s of
 * its members that are actually built (`resolve` returns `null` for an unbuilt
 * name). Deduped by cardId (two names collapsing to the same card, or a
 * duplicated name, count once) and order-stable on first appearance. `resolve`
 * is injected exactly like the banlist cores so this stays pure and testable.
 */
export function resolveCubeMembership(
    cardNames: readonly string[],
    resolve: ResolveCardByName
): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const name of cardNames) {
        const card = resolve(name);
        if (card) {
            if (seen.has(card.id)) continue;
            seen.add(card.id);
            ids.push(card.id);
        } else {
            // Unbuilt name — fall back to the name itself so catalogue
            // entries (whose cardId is a per-print UUID) can still pass
            // the cube gate when `hideUnavailable: false`.
            if (seen.has(name)) continue;
            seen.add(name);
            ids.push(name);
        }
    }
    return ids;
}

/** One cube projected for the builder's cube dropdown: its stable `slug`, its
 *  display `name`, and how many of its cards are actually built (`count` =
 *  resolved membership size — what the filter will surface). */
export interface CubeSummary {
    slug: string;
    name: string;
    count: number;
}

async function loadCube(ctx: QueryCtx, slug: string) {
    return ctx.db
        .query("cubeLists")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
}

/**
 * Every cube, projected for the dropdown (`{ slug, name, count }`), sorted by
 * display name. `count` is the LIVE resolved membership size, so a cube whose
 * cards are mostly unbuilt reads honestly (implemented ∩ cube), and the number
 * grows as cards ship — no cube edit needed.
 */
export const list = query({
    args: {},
    returns: v.array(
        v.object({ slug: v.string(), name: v.string(), count: v.number() })
    ),
    handler: async (ctx): Promise<CubeSummary[]> => {
        const rows = await ctx.db.query("cubeLists").collect();
        return rows
            .map((r) => ({
                slug: r.slug,
                name: r.name,
                count: resolveCubeMembership(r.cardNames, tryGetCardByName)
                    .length,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    },
});

/**
 * The resolved membership of one cube: the canonical `cardId`s of its built
 * members. The deck builder wraps this in a `Set` and gates the card pool by
 * it. An unknown `slug` resolves to `[]` (fail-open to "no cards", never a
 * throw) — a stale URL param can't crash the builder.
 */
export const membership = query({
    args: { slug: v.string() },
    returns: v.array(v.string()),
    handler: async (ctx, { slug }): Promise<string[]> => {
        const row = await loadCube(ctx, slug);
        if (!row) return [];
        return resolveCubeMembership(row.cardNames, tryGetCardByName);
    },
});

/**
 * Upsert a cube by `slug` (admin only). The write surface for cube lists —
 * used by the seed script and any future admin UI. `assertIsAdmin` runs first,
 * the same "gate before anything else" convention as every admin mutation in
 * `convex/decks.ts`. Stamps `updatedAt` server-side.
 */
/** Upsert a cube row by `slug`, stamping `updatedAt`. Shared by the admin
 *  `saveCube` mutation and the `seedVintageCube` internal seed so the write is
 *  identical on both paths. */
async function upsertCube(
    ctx: MutationCtx,
    slug: string,
    name: string,
    cardNames: readonly string[]
): Promise<void> {
    const existing = await loadCube(ctx, slug);
    const patch = {
        slug,
        name,
        cardNames: [...cardNames],
        updatedAt: Date.now(),
    };
    if (existing) {
        await ctx.db.patch(existing._id, patch);
    } else {
        await ctx.db.insert("cubeLists", patch);
    }
}

export const saveCube = mutation({
    args: {
        slug: v.string(),
        name: v.string(),
        cardNames: v.array(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, { slug, name, cardNames }) => {
        await assertIsAdmin(ctx);
        await upsertCube(ctx, slug, name, cardNames);
        return null;
    },
});

/**
 * Seed (or refresh) the Vintage Cube list from the committed
 * `VINTAGE_CUBE_NAMES` module (generated from the worklist by
 * `scripts/gen-vintage-cube.ts`). An `internalMutation` — not admin-gated,
 * callable only via `npx convex run cubes:seedVintageCube` / the dashboard,
 * never from a client. Idempotent (upsert by slug).
 */
export const seedVintageCube = internalMutation({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
        await upsertCube(
            ctx,
            "vintage-cube",
            "Vintage Cube",
            VINTAGE_CUBE_NAMES
        );
        return null;
    },
});
