// Scryfall banlist sync (PRD #1138, ADR 0057, issue #1143). The ADMIN-TRIGGERED
// counterpart to `convex/banlists.ts`'s read-side queries: this module fetches
// each format's official banned/restricted list from the Scryfall Search API
// and atomically replaces that format's `formatBanlists` rows, closing the
// "hand-edit a code list and ship a release" toil the PRD calls out.
//
// Split into PURE CORES (unit-tested directly, no network, no Convex ctx —
// the project's no-convex-test-harness convention, prior art:
// `convex/__tests__/decks.test.ts`, `convex/__tests__/banlists.test.ts`) and
// THIN CONVEX WRAPPERS (`replaceBanlist` internalMutation, `syncBanlist`
// action) that do nothing but plumb ctx.db / ctx.runQuery / ctx.runMutation
// around the pure cores below:
//
//   parseScryfallSearchPage  — validates/narrows one raw Scryfall JSON page
//                              (pure; the seam a malformed-response test
//                              exercises directly, no fetch involved).
//   parseBanlistResponse     — extracts + dedupes `{ cardName, status }[]`
//                              across every page of every status batch.
//   diffBanlist              — added/removed between a format's old and new
//                              name lists.
//   runBanlistSync           — the sync ORCHESTRATION, with `fetchPages` /
//                              `replace` / `now` injected exactly like the
//                              existing `resolve`/`banlist` dependencies
//                              elsewhere in the codebase (ADR 0036 purity).
//                              This is the seam the "a failed fetch never
//                              touches existing rows" acceptance criterion is
//                              tested against: `replace` is only reachable
//                              after every `fetchPages` call for the format
//                              has resolved, so a throwing/rejecting fetch
//                              aborts before any DB write is even scheduled.

import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { banlistEntryValidator, banlistFormatValidator } from "./banlists";
import type { BanlistEntry, BanlistFormatId } from "./formats";

// --- Scryfall wire shapes (pure) -------------------------------------------

/** The fields this module reads off a Scryfall card object. Scryfall cards
 *  carry dozens of others (image URIs, legalities, prices, …) — irrelevant
 *  here, so the type stays minimal. `id` (the stable Scryfall UUID) is
 *  captured so the admin dialog can render a card's image via Scryfall even
 *  when we never build that card (PRD #1138 follow-up); it's optional so a
 *  malformed/legacy page missing it still parses (the name is the only hard
 *  requirement). */
export interface ScryfallCard {
    name: string;
    id?: string;
}

/** One page of a Scryfall `/cards/search` response, trimmed to the fields
 *  this module needs for pagination + name extraction. */
export interface ScryfallSearchPage {
    data: readonly ScryfallCard[];
    has_more: boolean;
    next_page?: string | null;
}

/** One status-tagged fetch: the pages returned by a single Scryfall query
 *  (e.g. `banned:premodern`), paired with the status that query represents.
 *  `syncBanlist` issues one batch per `SCRYFALL_QUERIES[format]` entry;
 *  `parseBanlistResponse` merges every batch for a sync into one entry list. */
export interface BanlistFetchBatch {
    status: BanlistEntry["status"];
    pages: readonly ScryfallSearchPage[];
}

/**
 * Validates + narrows one raw Scryfall API response body into a
 * `ScryfallSearchPage`. PURE — no network. This is the seam a malformed/
 * error response is unit-tested against directly (no fetch stubbing
 * required): Scryfall returns `{ object: "error", details }` on a bad query
 * and always includes a `data` array on a real search page, so either
 * shape's absence is a clean signal to abort the sync before any DB write.
 */
export function parseScryfallSearchPage(raw: unknown): ScryfallSearchPage {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("Malformed Scryfall response: expected a JSON object");
    }
    const obj = raw as Record<string, unknown>;
    if (obj.object === "error") {
        const details =
            typeof obj.details === "string" ? obj.details : "unknown error";
        throw new Error(`Scryfall API error: ${details}`);
    }
    if (!Array.isArray(obj.data)) {
        throw new Error("Malformed Scryfall response: missing data array");
    }
    const data: ScryfallCard[] = obj.data.map((card) => {
        if (
            typeof card !== "object" ||
            card === null ||
            typeof (card as Record<string, unknown>).name !== "string"
        ) {
            throw new Error(
                "Malformed Scryfall response: card entry missing a name"
            );
        }
        const rec = card as Record<string, unknown>;
        return {
            name: rec.name as string,
            ...(typeof rec.id === "string" ? { id: rec.id } : {}),
        };
    });
    return {
        data,
        has_more: obj.has_more === true,
        next_page: typeof obj.next_page === "string" ? obj.next_page : null,
    };
}

/**
 * Extracts + dedupes `{ cardName, status }[]` across every page of every
 * status batch (issue #1143 acceptance criterion). PURE. Dedup key is the
 * oracle name, trimmed and case-folded to match how the `nameRegistry` keys
 * (PRD #1138's "fold consistently" note) — so "STRIP MINE" and "Strip Mine"
 * collapse to one entry, and a card with many printings (Strip Mine has
 * shipped in a dozen sets) yields exactly one row regardless of how many
 * printings Scryfall returned. Batches are processed in the order given, and
 * the FIRST occurrence of a name wins — `syncBanlist` lists `banned` before
 * `restricted`, so a name that (incorrectly) appeared in both keeps the
 * stricter `banned` status rather than being overwritten by `restricted`.
 */
export function parseBanlistResponse(
    batches: readonly BanlistFetchBatch[]
): BanlistEntry[] {
    const byName = new Map<string, BanlistEntry>();
    for (const batch of batches) {
        for (const page of batch.pages) {
            for (const card of page.data) {
                const trimmed = card.name.trim();
                if (!trimmed) continue;
                const key = trimmed.toLowerCase();
                if (byName.has(key)) continue; // first occurrence wins
                byName.set(key, {
                    cardName: trimmed,
                    status: batch.status,
                    ...(card.id ? { scryfallId: card.id } : {}),
                });
            }
        }
    }
    return [...byName.values()];
}

/**
 * Added/removed card names between a format's PREVIOUS and NEXT banlist name
 * lists (issue #1143 acceptance criterion). PURE — plain set arithmetic, no
 * Convex/network dependency, so it's usable both by `replaceBanlist` (diffing
 * the format's existing rows against the freshly-parsed entries) and
 * directly in tests. Case-folded comparison (matching `parseBanlistResponse`
 * / the `nameRegistry` convention) so a name that only changed case is
 * neither added nor removed; the returned arrays preserve the ORIGINAL
 * casing from their own side (next's casing for `added`, prev's for
 * `removed`).
 */
export function diffBanlist(
    prevNames: readonly string[],
    nextNames: readonly string[]
): { added: string[]; removed: string[] } {
    const prevKeys = new Set(prevNames.map((name) => name.toLowerCase()));
    const nextKeys = new Set(nextNames.map((name) => name.toLowerCase()));
    const added = nextNames.filter((name) => !prevKeys.has(name.toLowerCase()));
    const removed = prevNames.filter(
        (name) => !nextKeys.has(name.toLowerCase())
    );
    return { added, removed };
}

// --- Sync orchestration (pure aside from injected deps) -------------------

/** One Scryfall search query per status a format needs. Premodern has no
 *  official restricted list (PRD #1138 Out of Scope); Old School has both.
 *  `order=name` is not load-bearing for correctness (dedup makes ordering
 *  irrelevant) but keeps a captured fixture/response deterministic to read. */
const SCRYFALL_QUERIES: Record<
    BanlistFormatId,
    readonly { status: BanlistEntry["status"]; query: string }[]
> = {
    premodern: [{ status: "banned", query: "banned:premodern" }],
    "old-school": [
        { status: "banned", query: "banned:oldschool" },
        { status: "restricted", query: "restricted:oldschool" },
    ],
};

/** Injected dependencies for `runBanlistSync`, mirroring the existing
 *  `resolve`/`banlist` injection pattern (ADR 0036) so the orchestration is
 *  unit-testable without network or a Convex ctx. */
export interface BanlistSyncDeps {
    /** Fetches every page for one Scryfall query string (pagination already
     *  resolved). Rejecting here — a network error, a non-200 status, a
     *  malformed body — aborts the sync before `replace` is ever called. */
    fetchPages: (query: string) => Promise<ScryfallSearchPage[]>;
    /** Persists the parsed entries, returning the added/removed diff. Called
     *  at most once, and only after every `fetchPages` call for the format
     *  has resolved successfully. */
    replace: (args: {
        format: BanlistFormatId;
        entries: BanlistEntry[];
        syncedAt: number;
    }) => Promise<{ added: string[]; removed: string[] }>;
    /** Sync timestamp source, injected for determinism in tests. */
    now: () => number;
}

/**
 * The full sync orchestration for one format (issue #1143): fetch every
 * status batch the format needs, parse+dedupe, then persist. PURE aside from
 * the injected `deps` — no network, no `ctx`, so it's the seam both the
 * "syncs the right statuses per format" and "a failed fetch leaves existing
 * rows intact" acceptance criteria are tested against directly. If ANY
 * `fetchPages` call rejects (bad fetch, malformed body via
 * `parseScryfallSearchPage`), the `for` loop below propagates the rejection
 * immediately — `deps.replace` is syntactically unreachable on that path, so
 * a bad fetch can never wipe or partially update a format's rows.
 */
export async function runBanlistSync(
    format: BanlistFormatId,
    deps: BanlistSyncDeps
): Promise<{ added: string[]; removed: string[] }> {
    const batches: BanlistFetchBatch[] = [];
    for (const { status, query } of SCRYFALL_QUERIES[format]) {
        const pages = await deps.fetchPages(query);
        batches.push({ status, pages });
    }
    const entries = parseBanlistResponse(batches);
    return deps.replace({ format, entries, syncedAt: deps.now() });
}

// --- Network (impure — action-only) ----------------------------------------

const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
/** Scryfall asks integrations to stay under ~10 req/s; a paginated banlist
 *  fetch is at most a handful of pages, but this keeps a multi-page sync
 *  polite regardless. */
const SCRYFALL_PAGE_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchScryfallSearchPage(
    url: string
): Promise<ScryfallSearchPage> {
    const res = await fetch(url, {
        headers: {
            "User-Agent": "tolaria-banlist-sync",
            Accept: "application/json",
        },
    });
    // Scryfall returns a 4xx WITH an `{ object: "error", details }` JSON
    // body for a bad query — read the body either way so
    // `parseScryfallSearchPage` can surface Scryfall's own error detail.
    const json = await res.json().catch(() => {
        throw new Error(`Scryfall API error (${res.status}): invalid JSON`);
    });
    return parseScryfallSearchPage(json);
}

/** Fetches every page of a Scryfall search query, following `next_page`
 *  until `has_more` is false. Any page failing (network error, non-JSON,
 *  malformed body) rejects the whole call — no partial page list is ever
 *  returned to `runBanlistSync`. */
async function fetchAllScryfallPages(
    query: string
): Promise<ScryfallSearchPage[]> {
    const pages: ScryfallSearchPage[] = [];
    let url: string | null =
        `${SCRYFALL_SEARCH_URL}?q=${encodeURIComponent(query)}&order=name`;
    while (url) {
        if (pages.length > 0) await sleep(SCRYFALL_PAGE_DELAY_MS);
        const page = await fetchScryfallSearchPage(url);
        pages.push(page);
        url = page.has_more && page.next_page ? page.next_page : null;
    }
    return pages;
}

// --- Convex wrappers (thin) -------------------------------------------------

/** Source tag stamped on every Scryfall-synced row, distinguishing it from
 *  the code-side seed (`BANLIST_SEED_SOURCE` in `convex/formats.ts`). */
export const SCRYFALL_SYNC_SOURCE = "scryfall";

/**
 * Atomically replaces a format's `formatBanlists` rows with `entries` (issue
 * #1143). `internalMutation` — never called directly by a client, only via
 * `syncBanlist`'s `ctx.runMutation`. A single Convex mutation invocation is
 * already a transaction, so the delete-then-insert below is atomic for free:
 * a reader never observes a half-replaced table. Returns the `diffBanlist`
 * summary against the rows that existed before the swap.
 */
export const replaceBanlist = internalMutation({
    args: {
        format: banlistFormatValidator,
        entries: v.array(banlistEntryValidator),
        syncedAt: v.number(),
    },
    returns: v.object({
        added: v.array(v.string()),
        removed: v.array(v.string()),
    }),
    handler: async (ctx, { format, entries, syncedAt }) => {
        const existing = await ctx.db
            .query("formatBanlists")
            .withIndex("by_format", (q) => q.eq("format", format))
            .collect();
        const diff = diffBanlist(
            existing.map((row) => row.cardName),
            entries.map((entry) => entry.cardName)
        );
        for (const row of existing) {
            await ctx.db.delete(row._id);
        }
        for (const entry of entries) {
            await ctx.db.insert("formatBanlists", {
                format,
                cardName: entry.cardName,
                status: entry.status,
                source: SCRYFALL_SYNC_SOURCE,
                syncedAt,
                ...(entry.scryfallId ? { scryfallId: entry.scryfallId } : {}),
            });
        }
        return diff;
    },
});

/**
 * Admin-triggered Scryfall banlist sync (PRD #1138 User Story 5, issue
 * #1143). `action` — network-capable, unlike a mutation. Admin-gated via
 * `ctx.runQuery(internal.auth.requireAdminQuery)` FIRST (mirrors
 * `assertIsAdmin`, the same "gate runs before anything else" convention as
 * every admin mutation in `convex/decks.ts`) — a non-admin/unauthenticated
 * caller is rejected server-side before a single Scryfall request is made.
 * The actual work is `runBanlistSync`, with the network fetch and the
 * `replaceBanlist` mutation injected as `deps` — this handler is a thin
 * wrapper so the orchestration itself stays unit-testable without network or
 * a Convex ctx.
 */
export const syncBanlist = action({
    args: { format: banlistFormatValidator },
    returns: v.object({
        added: v.array(v.string()),
        removed: v.array(v.string()),
    }),
    handler: async (
        ctx,
        { format }
    ): Promise<{ added: string[]; removed: string[] }> => {
        await ctx.runQuery(internal.auth.requireAdminQuery, {});
        return runBanlistSync(format, {
            fetchPages: fetchAllScryfallPages,
            replace: (args) =>
                ctx.runMutation(internal.banlistSync.replaceBanlist, args),
            now: () => Date.now(),
        });
    },
});
