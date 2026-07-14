// Scryfall banlist sync — pure cores (PRD #1138, ADR 0057, issue #1143). The
// project has no convex-test harness (see `convex/__tests__/banlists.test.ts`
// / `decks.test.ts`), so every Convex function here is a thin wrapper and
// these tests exercise the pure cores directly: `parseScryfallSearchPage`,
// `parseBanlistResponse`, `diffBanlist`, and the injectable orchestration
// `runBanlistSync`. The admin gate itself (`isAdminUser`) is already covered
// by `convex/__tests__/adminAuth.test.ts` — `syncBanlist`'s non-admin
// rejection is documented/asserted here at the same seam that
// `deletePreset`/`updatePreset` use (see `decks.test.ts`
// "assertIsAdmin gate runs first").

import { describe, it, expect, vi } from "vitest";
import {
    diffBanlist,
    parseBanlistResponse,
    parseScryfallSearchPage,
    runBanlistSync,
    type BanlistFetchBatch,
    type BanlistSyncDeps,
    type ScryfallSearchPage,
} from "../banlistSync";
import { isAdminUser } from "../auth";
import type { Doc } from "../_generated/dataModel";
import {
    OLD_SCHOOL_BANNED_FIXTURE_PAGES,
    OLD_SCHOOL_RESTRICTED_FIXTURE_PAGES,
    PREMODERN_BANNED_FIXTURE_PAGES,
    SCRYFALL_ERROR_RESPONSE_FIXTURE,
} from "./fixtures/scryfallBanlist.fixture";

describe("parseScryfallSearchPage — raw response validation (issue #1143)", () => {
    it("accepts a well-formed page and narrows to { data, has_more, next_page }", () => {
        const raw = {
            object: "list",
            has_more: false,
            next_page: null,
            data: [{ name: "Balance", extra_field: "ignored" }],
        };
        expect(parseScryfallSearchPage(raw)).toEqual({
            data: [{ name: "Balance" }],
            has_more: false,
            next_page: null,
        });
    });

    it("defaults next_page to null when absent", () => {
        const raw = { object: "list", has_more: false, data: [] };
        expect(parseScryfallSearchPage(raw).next_page).toBeNull();
    });

    it("captures the Scryfall id when present (PRD #1138 image follow-up)", () => {
        const raw = {
            object: "list",
            has_more: false,
            data: [{ name: "Amulet of Quoz", id: "abc-123" }],
        };
        expect(parseScryfallSearchPage(raw).data).toEqual([
            { name: "Amulet of Quoz", id: "abc-123" },
        ]);
    });

    it("omits id (not null) when the card object has none", () => {
        const raw = {
            object: "list",
            has_more: false,
            data: [{ name: "Balance" }],
        };
        expect(parseScryfallSearchPage(raw).data[0]).toEqual({
            name: "Balance",
        });
        expect("id" in parseScryfallSearchPage(raw).data[0]).toBe(false);
    });

    it("rejects a captured Scryfall error response (malformed/bad-query fetch)", () => {
        expect(() =>
            parseScryfallSearchPage(SCRYFALL_ERROR_RESPONSE_FIXTURE)
        ).toThrow(/Scryfall API error/);
    });

    it("rejects a body with no data array", () => {
        expect(() => parseScryfallSearchPage({ object: "list" })).toThrow(
            /missing data array/
        );
    });

    it("rejects a card entry with no name", () => {
        const raw = { object: "list", has_more: false, data: [{ id: "x" }] };
        expect(() => parseScryfallSearchPage(raw)).toThrow(/missing a name/);
    });

    it("rejects a non-object body", () => {
        expect(() => parseScryfallSearchPage(null)).toThrow();
        expect(() => parseScryfallSearchPage("oops")).toThrow();
    });
});

describe("parseBanlistResponse — extract + dedupe by oracle name (issue #1143)", () => {
    it("extracts every card across both premodern fixture pages", () => {
        const batches: BanlistFetchBatch[] = [
            { status: "banned", pages: PREMODERN_BANNED_FIXTURE_PAGES },
        ];
        const entries = parseBanlistResponse(batches);
        expect(entries.every((e) => e.status === "banned")).toBe(true);
        expect(entries.map((e) => e.cardName)).toContain("Parallax Tide");
        expect(entries.map((e) => e.cardName)).toContain("Amulet of Quoz");
    });

    it("carries the Scryfall id onto the entry when the page provides one (PRD #1138 image follow-up)", () => {
        const batches: BanlistFetchBatch[] = [
            {
                status: "banned",
                pages: [
                    {
                        has_more: false,
                        next_page: null,
                        data: [{ name: "Amulet of Quoz", id: "amulet-id" }],
                    },
                ],
            },
        ];
        const entries = parseBanlistResponse(batches);
        expect(entries).toEqual([
            {
                cardName: "Amulet of Quoz",
                status: "banned",
                scryfallId: "amulet-id",
            },
        ]);
    });

    it("dedupes Strip Mine across pages (real multi-printing card, captured cross-page)", () => {
        const batches: BanlistFetchBatch[] = [
            { status: "banned", pages: PREMODERN_BANNED_FIXTURE_PAGES },
        ];
        const entries = parseBanlistResponse(batches);
        const stripMines = entries.filter((e) => e.cardName === "Strip Mine");
        expect(stripMines).toHaveLength(1);
        expect(stripMines[0]).toEqual({
            cardName: "Strip Mine",
            status: "banned",
        });
    });

    it("total premodern entry count matches the deduped name count (34 raw rows incl. dup → 33 names)", () => {
        const batches: BanlistFetchBatch[] = [
            { status: "banned", pages: PREMODERN_BANNED_FIXTURE_PAGES },
        ];
        const rawCount = PREMODERN_BANNED_FIXTURE_PAGES.flatMap(
            (p) => p.data
        ).length;
        const entries = parseBanlistResponse(batches);
        expect(rawCount).toBe(34); // 18 + 16, one dup (Strip Mine)
        expect(entries).toHaveLength(33);
    });

    it("merges banned + restricted batches for Old School, tagging each entry with its own status", () => {
        const batches: BanlistFetchBatch[] = [
            { status: "banned", pages: OLD_SCHOOL_BANNED_FIXTURE_PAGES },
            {
                status: "restricted",
                pages: OLD_SCHOOL_RESTRICTED_FIXTURE_PAGES,
            },
        ];
        const entries = parseBanlistResponse(batches);
        const byName = new Map(entries.map((e) => [e.cardName, e.status]));
        expect(byName.get("Bronze Tablet")).toBe("banned");
        expect(byName.get("Black Lotus")).toBe("restricted");
        expect(entries).toHaveLength(
            OLD_SCHOOL_BANNED_FIXTURE_PAGES[0]!.data.length +
                OLD_SCHOOL_RESTRICTED_FIXTURE_PAGES[0]!.data.length
        );
    });

    it("case-folds the dedup key but preserves original casing in the output", () => {
        const pages: ScryfallSearchPage[] = [
            { has_more: false, next_page: null, data: [{ name: "Balance" }] },
        ];
        const batches: BanlistFetchBatch[] = [
            { status: "banned", pages },
            {
                status: "restricted",
                pages: [
                    {
                        has_more: false,
                        next_page: null,
                        data: [{ name: "BALANCE" }],
                    },
                ],
            },
        ];
        const entries = parseBanlistResponse(batches);
        // First occurrence (banned) wins over the later-batch duplicate.
        expect(entries).toEqual([{ cardName: "Balance", status: "banned" }]);
    });

    it("returns an empty list for no batches / empty pages", () => {
        expect(parseBanlistResponse([])).toEqual([]);
        expect(
            parseBanlistResponse([
                { status: "banned", pages: [{ has_more: false, data: [] }] },
            ])
        ).toEqual([]);
    });
});

describe("diffBanlist — added/removed (issue #1143)", () => {
    it("computes added and removed correctly across a name-set change", () => {
        const prev = ["Balance", "Channel", "Strip Mine"];
        const next = ["Balance", "Strip Mine", "Parallax Tide"];
        expect(diffBanlist(prev, next)).toEqual({
            added: ["Parallax Tide"],
            removed: ["Channel"],
        });
    });

    it("reports everything added when prev is empty (fresh sync)", () => {
        expect(diffBanlist([], ["Balance", "Channel"])).toEqual({
            added: ["Balance", "Channel"],
            removed: [],
        });
    });

    it("reports everything removed when next is empty", () => {
        expect(diffBanlist(["Balance", "Channel"], [])).toEqual({
            added: [],
            removed: ["Balance", "Channel"],
        });
    });

    it("reports no changes for an identical list", () => {
        expect(diffBanlist(["Balance"], ["Balance"])).toEqual({
            added: [],
            removed: [],
        });
    });

    it("is case-insensitive: a pure case change is neither added nor removed", () => {
        expect(diffBanlist(["Balance"], ["BALANCE"])).toEqual({
            added: [],
            removed: [],
        });
    });
});

describe("runBanlistSync — orchestration with injected deps (issue #1143)", () => {
    function fakeDeps(
        pagesByQuery: Record<string, ScryfallSearchPage[]>
    ): BanlistSyncDeps & { replace: ReturnType<typeof vi.fn> } {
        const replace = vi.fn(
            async (args: {
                format: string;
                entries: { cardName: string; status: string }[];
                syncedAt: number;
            }) => ({ added: args.entries.map((e) => e.cardName), removed: [] })
        );
        return {
            fetchPages: async (query: string) => {
                const pages = pagesByQuery[query];
                if (!pages) throw new Error(`unexpected query: ${query}`);
                return pages;
            },
            replace,
            now: () => 12345,
        };
    }

    it("Premodern syncs banned only — fetches exactly one query and persists banned entries", async () => {
        const deps = fakeDeps({
            "banned:premodern": PREMODERN_BANNED_FIXTURE_PAGES,
        });
        const result = await runBanlistSync("premodern", deps);

        expect(deps.replace).toHaveBeenCalledTimes(1);
        const call = deps.replace.mock.calls[0]![0];
        expect(call.format).toBe("premodern");
        expect(call.syncedAt).toBe(12345);
        expect(
            call.entries.every((e: { status: string }) => e.status === "banned")
        ).toBe(true);
        expect(
            call.entries.map((e: { cardName: string }) => e.cardName)
        ).toContain("Parallax Tide");
        expect(result.added).toContain("Parallax Tide");
    });

    it("Old School syncs banned + restricted — fetches both queries and tags each entry's status", async () => {
        const deps = fakeDeps({
            "banned:oldschool": OLD_SCHOOL_BANNED_FIXTURE_PAGES,
            "restricted:oldschool": OLD_SCHOOL_RESTRICTED_FIXTURE_PAGES,
        });
        await runBanlistSync("old-school", deps);

        expect(deps.replace).toHaveBeenCalledTimes(1);
        const call = deps.replace.mock.calls[0]![0];
        expect(call.format).toBe("old-school");
        const byName = new Map(
            call.entries.map((e: { cardName: string; status: string }) => [
                e.cardName,
                e.status,
            ])
        );
        expect(byName.get("Bronze Tablet")).toBe("banned");
        expect(byName.get("Black Lotus")).toBe("restricted");
    });

    it("a rejecting fetch aborts the sync WITHOUT ever calling replace (existing rows stay intact)", async () => {
        const replace = vi.fn();
        const deps: BanlistSyncDeps = {
            fetchPages: async () => {
                throw new Error("Scryfall API error (500): server error");
            },
            replace,
            now: () => 1,
        };
        await expect(runBanlistSync("premodern", deps)).rejects.toThrow(
            /Scryfall API error/
        );
        expect(replace).not.toHaveBeenCalled();
    });

    it("a malformed second-query fetch for Old School also aborts before replace (partial-fetch case)", async () => {
        const replace = vi.fn();
        const deps: BanlistSyncDeps = {
            fetchPages: async (query: string) => {
                if (query === "banned:oldschool") {
                    return OLD_SCHOOL_BANNED_FIXTURE_PAGES;
                }
                throw new Error("Malformed Scryfall response");
            },
            replace,
            now: () => 1,
        };
        await expect(runBanlistSync("old-school", deps)).rejects.toThrow(
            /Malformed Scryfall response/
        );
        expect(replace).not.toHaveBeenCalled();
    });
});

// `syncBanlist`'s non-admin rejection (issue #1143 acceptance criterion): the
// action calls `ctx.runQuery(internal.auth.requireAdminQuery)` — which wraps
// `assertIsAdmin`, itself a thin wrapper over `isAdminUser` — as its FIRST
// line, mirroring the exact convention `decks.ts`'s admin mutations use (see
// `decks.test.ts` "assertIsAdmin gate runs first"). `isAdminUser`'s full
// truth table is already exercised by `adminAuth.test.ts`; this block
// re-asserts it in this module's context so the acceptance criterion has a
// visible, named test here too.
describe("syncBanlist admin gate (issue #1143) — mirrors requireAdminQuery/assertIsAdmin", () => {
    function user(overrides: Partial<Doc<"users">> = {}): Doc<"users"> {
        return {
            _id: "user_1" as Doc<"users">["_id"],
            _creationTime: 0,
            nickname: "Tester",
            ...overrides,
        };
    }

    it("rejects a non-admin / unauthenticated caller (the gate `syncBanlist` runs first)", () => {
        expect(isAdminUser(user({ isAdmin: false }))).toBe(false);
        expect(isAdminUser(user())).toBe(false);
        expect(isAdminUser(null)).toBe(false);
    });

    it("allows an admin through the same gate", () => {
        expect(isAdminUser(user({ isAdmin: true }))).toBe(true);
    });
});
