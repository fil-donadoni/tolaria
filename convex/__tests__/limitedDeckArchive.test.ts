// Limited Deck Archive (PRD #8407, issue #8410): the admin-only, read-only
// global view of every player's Limited decks, grouped by Limited Origin.
// Every query is `assertIsAdmin`-gated (ADR 0033), reads through the
// `by_format_limitedOrigin` index (never a table scan), and the per-origin read
// is a bounded page. Registered handlers are driven for real against the shared
// in-memory ctx (no convex-test harness, see `deckDefinitionIdWrite.test.ts`).
import { describe, expect, it } from "vitest";

import type { QueryCtx } from "../_generated/server";
import {
    ARCHIVE_MAX_PAGE_SIZE,
    getLimitedDeckAdmin,
    listLimitedOriginDecksAdmin,
    listLimitedOriginsAdmin,
    listMine,
} from "../userDecks";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: QueryCtx, args: unknown): Promise<any> =>
    (fn as { _handler: (c: QueryCtx, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
    definitionId: "lightning-bolt",
};

function deck(id: string, userId: string, extra: Record<string, unknown>) {
    return {
        _id: id,
        userId,
        name: id,
        format: "limited",
        colors: ["R"],
        cards: [BOLT, BOLT],
        sideboard: [BOLT],
        ...extra,
    };
}

const SEED = {
    users: [
        { _id: "admin", nickname: "Root", isAdmin: true },
        { _id: "alice", nickname: "Alice" },
        { _id: "bob", nickname: "Bob" },
    ],
    userDecks: [
        deck("d1", "alice", { limitedOrigin: "sealed:lea" }),
        deck("d2", "bob", { limitedOrigin: "sealed:lea" }),
        deck("d3", "bob", { limitedOrigin: "draft:cube:vintage" }),
        deck("d4", "alice", {}),
        {
            ...deck("c1", "alice", { format: "freeform" }),
        },
    ],
};

const ctxFor = (subject: string) =>
    makeInMemoryDb(SEED, { identitySubject: `${subject}|s` });

const PAGE = { numItems: 10, cursor: null };

describe("Limited Deck Archive — admin gate", () => {
    it("refuses a signed-in non-admin on every query", async () => {
        const { ctx } = ctxFor("alice");
        const c = ctx as unknown as QueryCtx;
        await expect(run(listLimitedOriginsAdmin, c, {})).rejects.toThrow(
            /admin only/
        );
        await expect(
            run(listLimitedOriginDecksAdmin, c, {
                origin: "sealed:lea",
                paginationOpts: PAGE,
            })
        ).rejects.toThrow(/admin only/);
        await expect(
            run(getLimitedDeckAdmin, c, { deckId: "d1" })
        ).rejects.toThrow(/admin only/);
    });

    it("refuses an unauthenticated caller", async () => {
        const { ctx } = makeInMemoryDb(SEED);
        await expect(
            run(listLimitedOriginsAdmin, ctx as unknown as QueryCtx, {})
        ).rejects.toThrow(/admin only/);
    });
});

describe("Limited Deck Archive — origins", () => {
    it("lists each origin with its count, unclassified included, via the index", async () => {
        const { ctx, reads } = ctxFor("admin");
        const origins = await run(
            listLimitedOriginsAdmin,
            ctx as unknown as QueryCtx,
            {}
        );
        expect(origins).toEqual([
            { origin: "sealed:lea", deckCount: 2 },
            { origin: "draft:cube:vintage", deckCount: 1 },
            { origin: null, deckCount: 1 },
        ]);
        // Narrowed by `format` — never the unnarrowed scan, and the
        // constructed deck `c1` is not counted anywhere.
        const deckReads = reads.filter((r) => r.table === "userDecks");
        expect(deckReads).toEqual([{ table: "userDecks", key: ["limited"] }]);
    });
});

describe("Limited Deck Archive — one origin", () => {
    it("pages an origin's decks with owner, counts and legality, no card list", async () => {
        const { ctx, reads } = ctxFor("admin");
        const result = await run(
            listLimitedOriginDecksAdmin,
            ctx as unknown as QueryCtx,
            { origin: "sealed:lea", paginationOpts: PAGE }
        );
        expect(result.page.map((d: any) => d._id).sort()).toEqual(["d1", "d2"]);
        const d1 = result.page.find((d: any) => d._id === "d1");
        expect(d1).toMatchObject({
            ownerNickname: "Alice",
            cardCount: 2,
            sideboardCount: 1,
        });
        expect(typeof d1.isLegal).toBe("boolean");
        expect(Array.isArray(d1.reasons)).toBe(true);
        expect(d1.cards).toBeUndefined();
        expect(reads).toContainEqual({
            table: "userDecks",
            key: ["limited", "sealed:lea"],
        });
    });

    it("returns the unclassified group for a null origin", async () => {
        const { ctx } = ctxFor("admin");
        const result = await run(
            listLimitedOriginDecksAdmin,
            ctx as unknown as QueryCtx,
            { origin: null, paginationOpts: PAGE }
        );
        expect(result.page.map((d: any) => d._id)).toEqual(["d4"]);
    });

    it("caps the page size server-side", async () => {
        const many = Array.from({ length: ARCHIVE_MAX_PAGE_SIZE + 5 }, (_, i) =>
            deck(`m${i}`, "alice", { limitedOrigin: "sealed:lea" })
        );
        const { ctx } = makeInMemoryDb(
            { ...SEED, userDecks: many },
            { identitySubject: "admin|s" }
        );
        const result = await run(
            listLimitedOriginDecksAdmin,
            ctx as unknown as QueryCtx,
            {
                origin: "sealed:lea",
                paginationOpts: { numItems: 1000, cursor: null },
            }
        );
        expect(result.page).toHaveLength(ARCHIVE_MAX_PAGE_SIZE);
        expect(result.isDone).toBe(false);
    });
});

describe("Limited Deck Archive — deck detail", () => {
    it("returns the full card list with its owner", async () => {
        const { ctx } = ctxFor("admin");
        const detail = await run(
            getLimitedDeckAdmin,
            ctx as unknown as QueryCtx,
            {
                deckId: "d2",
            }
        );
        expect(detail).toMatchObject({
            ownerNickname: "Bob",
            limitedOrigin: "sealed:lea",
        });
        expect(detail.cards).toHaveLength(2);
        expect(detail.sideboard).toHaveLength(1);
    });

    it("returns null for a missing or non-Limited deck", async () => {
        const { ctx } = ctxFor("admin");
        const c = ctx as unknown as QueryCtx;
        expect(
            await run(getLimitedDeckAdmin, c, { deckId: "nope" })
        ).toBeNull();
        expect(await run(getLimitedDeckAdmin, c, { deckId: "c1" })).toBeNull();
    });
});

// The player's own archive (issue #8409) has no query of its own: it reads
// `listMine`, so this is where another player's deck is kept out of it.
describe("listMine as the player's Limited Deck Archive", () => {
    it("never returns another player's deck", async () => {
        const { ctx } = ctxFor("alice");
        const rows = await run(listMine, ctx as unknown as QueryCtx, {});
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r: any) => r.userId === "alice")).toBe(true);
    });
});
