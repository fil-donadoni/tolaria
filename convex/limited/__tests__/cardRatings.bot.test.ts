// Bot Drafter Pick Rating DB layer tests (PRD #1296 Slice A, ADR 0066, issue
// #1297). Mirrors `pickRatings.test.ts`/`botDrafter.test.ts`'s discipline:
// pure functions, deterministic, no convex-test harness needed —
// `resolveEventPickRating` is handed a plain in-memory `GetDbRating` closure
// standing in for `ctx.db`, exactly like `convex/limitedEvents.ts`'s real
// `loadEventPickRating` builds one from a `cardRatings` table scan.
import { describe, it, expect } from "vitest";
import {
    resolveEventPickRating,
    buildCardRatingRow,
    listScopeCards,
    buildScopeCardRatings,
    buildDbRatingLookup,
    type GetDbRating,
    type ScopedCardRating,
} from "../cardRatingsCore";
import {
    getPickRating,
    getPickRatingFile,
    isValidRating,
    PICK_RATING_MIN,
    PICK_RATING_MAX,
} from "../pickRatings";
import { isAdminUser } from "../../auth";
import { buildCubePool, CUBE_SOURCE_KEY } from "../cube";
import type { Doc } from "../../_generated/dataModel";

/** Builds a `GetDbRating` from a plain `(scope, cardId) -> rating` map — the
 *  test-side stand-in for a `cardRatings` table scan. */
function fakeDb(rows: Record<string, Record<string, number>>): GetDbRating {
    return (scope, cardId) => rows[scope]?.[cardId] ?? null;
}

describe("resolveEventPickRating (PRD #1296 Slice A, issue #1297): the layering boundary", () => {
    it("a database row OVERRIDES the seed rating for the same (scope, cardId)", () => {
        // Black Lotus is curated in the checked-in LEA seed file — pick a
        // real seed-rated cardId so the override is provably an override,
        // not just "the only rating that exists".
        const leaRatings = getPickRatingFile("lea")!;
        const [cardId, seedRating] = Object.entries(leaRatings.ratings)[0];
        expect(seedRating).not.toBeNull();

        const dbOverride = seedRating === 1 ? 2 : 1; // guaranteed different
        const getPickRatingFn = resolveEventPickRating(
            ["lea"],
            fakeDb({ lea: { [cardId]: dbOverride } })
        );
        expect(getPickRatingFn(cardId)).toBe(dbOverride);
        expect(getPickRatingFn(cardId)).not.toBe(seedRating);
    });

    it("absent from the database -> falls back to the seed rating", () => {
        const leaRatings = getPickRatingFile("lea")!;
        const [cardId, seedRating] = Object.entries(leaRatings.ratings)[0];

        const getPickRatingFn = resolveEventPickRating(["lea"], fakeDb({}));
        expect(getPickRatingFn(cardId)).toBe(seedRating);
    });

    it("absent from BOTH the database and the seed -> null (Pick Heuristic alone)", () => {
        const getPickRatingFn = resolveEventPickRating(["lea"], fakeDb({}));
        expect(getPickRatingFn("not-a-real-card-id")).toBeNull();
    });

    it("a multi-scope event resolves a rating from ANY of its distinct scopes", () => {
        const getPickRatingFn = resolveEventPickRating(
            ["lea", "vintage-cube"],
            fakeDb({ "vintage-cube": { "some-cube-card": 4.5 } })
        );
        expect(getPickRatingFn("some-cube-card")).toBe(4.5);
    });

    it("dedupes a repeated scope (a 3-round mono-set Draft's packSlots) without changing the result", () => {
        const getPickRatingFn = resolveEventPickRating(
            ["lea", "lea", "lea"],
            fakeDb({ lea: { "card-x": 3 } })
        );
        expect(getPickRatingFn("card-x")).toBe(3);
    });

    it("a database row for a scope OUTSIDE the event's scopes never leaks in", () => {
        // The row exists for "ice", but this event only drafts "lea" — the
        // rating must not apply even though the cardId is the same.
        const getPickRatingFn = resolveEventPickRating(
            ["lea"],
            fakeDb({ ice: { "shared-card-id": 5 } })
        );
        expect(getPickRatingFn("shared-card-id")).toBeNull();
    });

    it("scope matching is case-insensitive (mirrors packSlots/pickRatings.ts discipline)", () => {
        const getPickRatingFn = resolveEventPickRating(
            ["LEA"],
            fakeDb({ lea: { "card-y": 2 } })
        );
        expect(getPickRatingFn("card-y")).toBe(2);
    });

    it("regression: an empty database (every getDbRating call returns null) reproduces the seed-only path byte-for-byte", () => {
        const leaRatings = getPickRatingFile("lea")!;
        const emptyDb = resolveEventPickRating(["lea"], fakeDb({}));
        for (const cardId of Object.keys(leaRatings.ratings)) {
            expect(emptyDb(cardId)).toBe(getPickRating("lea", cardId));
        }
        // And a card the seed file doesn't rate at all still falls through
        // to null, exactly as the pre-database code path did.
        expect(emptyDb("totally-unrated-card")).toBeNull();
    });

    it("a rating of exactly 0 from the database is honoured, not treated as falsy/absent", () => {
        const getPickRatingFn = resolveEventPickRating(
            ["lea"],
            fakeDb({ lea: { "never-play-this": 0 } })
        );
        expect(getPickRatingFn("never-play-this")).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Admin write mutations (PRD #1296 Slice B, issue #1298). No convex-test
// harness (project convention, `convex/__tests__/adminAuth.test.ts` /
// `convex/__tests__/decks.test.ts`'s `deletePreset` section) — assert the
// same pure decisions the `setCardRating`/`clearCardRating` mutations are
// built from: the admin gate (`isAdminUser`), the bounds check
// (`isValidRating`, reused verbatim from Slice A — never duplicated), the
// row-shape builder (`buildCardRatingRow`), and the upsert/delete decision
// against a `by_scope_and_card` lookup modeled as a plain array.
function admin(isAdmin?: boolean): Doc<"users"> {
    return {
        _id: "u1" as Doc<"users">["_id"],
        _creationTime: 0,
        isAdmin,
    } as Doc<"users">;
}

describe("buildCardRatingRow — write shape (PRD #1296 Slice B, issue #1298)", () => {
    it("lowercases the scope, carries cardId/rating verbatim", () => {
        expect(buildCardRatingRow("LEA", "black-lotus", 5)).toEqual({
            scope: "lea",
            cardId: "black-lotus",
            rating: 5,
        });
    });

    it("preserves a fractional rating", () => {
        expect(buildCardRatingRow("vintage-cube", "sol-ring", 4.5).rating).toBe(
            4.5
        );
    });

    it("already-lowercase scope round-trips unchanged", () => {
        expect(buildCardRatingRow("lea", "card-x", 1).scope).toBe("lea");
    });
});

describe("setCardRating — admin gate (PRD #1296 Slice B, issue #1298)", () => {
    it("rejects a non-admin caller (assertIsAdmin gate runs first)", () => {
        expect(isAdminUser(admin(false))).toBe(false);
        expect(isAdminUser(admin(undefined))).toBe(false);
        expect(isAdminUser(null)).toBe(false);
    });

    it("allows an admin through the gate", () => {
        expect(isAdminUser(admin(true))).toBe(true);
    });
});

describe("setCardRating — bounds via isValidRating, reused from Slice A (issue #1298)", () => {
    it("accepts the endpoints and a mid-range fractional value", () => {
        expect(isValidRating(PICK_RATING_MIN)).toBe(true);
        expect(isValidRating(2.5)).toBe(true);
        expect(isValidRating(PICK_RATING_MAX)).toBe(true);
    });

    it("rejects a rating below the minimum", () => {
        expect(isValidRating(PICK_RATING_MIN - 1)).toBe(false);
    });

    it("rejects a rating above the maximum", () => {
        expect(isValidRating(PICK_RATING_MAX + 0.1)).toBe(false);
    });

    it("rejects NaN", () => {
        expect(isValidRating(NaN)).toBe(false);
    });

    it("rejects positive and negative Infinity", () => {
        expect(isValidRating(Infinity)).toBe(false);
        expect(isValidRating(-Infinity)).toBe(false);
    });

    it("rejects a non-number value", () => {
        expect(isValidRating("5" as unknown as number)).toBe(false);
        expect(isValidRating(null as unknown as number)).toBe(false);
        expect(isValidRating(undefined as unknown as number)).toBe(false);
    });
});

describe("setCardRating — upsert replaces an existing (scope, cardId) row (issue #1298)", () => {
    // Models ctx.db.patch/insert keyed by the `by_scope_and_card` lookup:
    // patch the existing row's rating (identity/_id preserved) when found,
    // else insert a fresh row — mirrors `cubes.ts`'s `upsertCube` shape.
    interface Row {
        _id: string;
        scope: string;
        cardId: string;
        rating: number;
    }

    function upsert(
        rows: readonly Row[],
        scope: string,
        cardId: string,
        rating: number
    ): Row[] {
        const row = buildCardRatingRow(scope, cardId, rating);
        const idx = rows.findIndex(
            (r) => r.scope === row.scope && r.cardId === row.cardId
        );
        if (idx === -1) {
            return [...rows, { _id: `new-${rows.length}`, ...row }];
        }
        const next = [...rows];
        next[idx] = { ...next[idx], rating: row.rating };
        return next;
    }

    it("inserts a fresh row when none exists for (scope, cardId)", () => {
        const after = upsert([], "lea", "black-lotus", 5);
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({
            scope: "lea",
            cardId: "black-lotus",
            rating: 5,
        });
    });

    it("replaces the rating of an existing row, keeping its identity (_id)", () => {
        const before: Row[] = [
            { _id: "row-1", scope: "lea", cardId: "black-lotus", rating: 5 },
        ];
        const after = upsert(before, "lea", "black-lotus", 2);
        expect(after).toHaveLength(1);
        expect(after[0]._id).toBe("row-1");
        expect(after[0].rating).toBe(2);
    });

    it("targets the same row regardless of scope casing (LEA vs lea)", () => {
        const before: Row[] = [
            { _id: "row-1", scope: "lea", cardId: "black-lotus", rating: 5 },
        ];
        const after = upsert(before, "LEA", "black-lotus", 1);
        expect(after).toHaveLength(1);
        expect(after[0].rating).toBe(1);
    });

    it("does not touch a different (scope, cardId) pair", () => {
        const before: Row[] = [
            { _id: "row-1", scope: "lea", cardId: "black-lotus", rating: 5 },
        ];
        const after = upsert(before, "lea", "sol-ring", 3);
        expect(after).toHaveLength(2);
        expect(after.find((r) => r.cardId === "black-lotus")?.rating).toBe(5);
        expect(after.find((r) => r.cardId === "sol-ring")?.rating).toBe(3);
    });
});

describe("clearCardRating — admin gate + idempotent delete (PRD #1296 Slice B, issue #1298)", () => {
    interface Row {
        _id: string;
        scope: string;
        cardId: string;
        rating: number;
    }

    // Models ctx.db.delete keyed by the same `by_scope_and_card` lookup.
    function clear(rows: readonly Row[], scope: string, cardId: string): Row[] {
        const normalizedScope = scope.toLowerCase();
        return rows.filter(
            (r) => !(r.scope === normalizedScope && r.cardId === cardId)
        );
    }

    it("rejects a non-admin caller (assertIsAdmin gate runs first)", () => {
        expect(isAdminUser(admin(false))).toBe(false);
        expect(isAdminUser(admin(undefined))).toBe(false);
        expect(isAdminUser(null)).toBe(false);
    });

    it("allows an admin through the gate", () => {
        expect(isAdminUser(admin(true))).toBe(true);
    });

    it("deletes the matching row", () => {
        const before: Row[] = [
            { _id: "row-1", scope: "lea", cardId: "black-lotus", rating: 5 },
        ];
        expect(clear(before, "lea", "black-lotus")).toEqual([]);
    });

    it("is a no-op (idempotent) when no row exists for the pair", () => {
        const before: Row[] = [
            { _id: "row-1", scope: "lea", cardId: "black-lotus", rating: 5 },
        ];
        const after = clear(before, "lea", "sol-ring");
        expect(after).toEqual(before);
        // Re-clearing the same already-absent pair again changes nothing.
        expect(clear(after, "lea", "sol-ring")).toEqual(before);
    });

    it("is idempotent on a repeated clear of the SAME pair (already deleted)", () => {
        const before: Row[] = [
            { _id: "row-1", scope: "lea", cardId: "black-lotus", rating: 5 },
        ];
        const onceCleared = clear(before, "lea", "black-lotus");
        expect(onceCleared).toEqual([]);
        expect(clear(onceCleared, "lea", "black-lotus")).toEqual([]);
    });

    it("scope is case-insensitive on clear (LEA vs lea)", () => {
        const before: Row[] = [
            { _id: "row-1", scope: "lea", cardId: "black-lotus", rating: 5 },
        ];
        expect(clear(before, "LEA", "black-lotus")).toEqual([]);
    });

    it("leaves other rows untouched", () => {
        const before: Row[] = [
            { _id: "row-1", scope: "lea", cardId: "black-lotus", rating: 5 },
            { _id: "row-2", scope: "lea", cardId: "sol-ring", rating: 3 },
        ];
        const after = clear(before, "lea", "black-lotus");
        expect(after).toEqual([before[1]]);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Admin editor read query (PRD #1296 Slice C, issue #1300). Same "no
// convex-test harness" discipline as the rest of this file
// (`convex/__tests__/limitedEvents.test.ts`'s doc comment) — drives the exact
// pure functions the query handler calls, against the REAL card registry and
// the REAL checked-in LEA Booster Config / Vintage Cube pool, not stubs.
// ─────────────────────────────────────────────────────────────────────────

describe("listScopeCards — set scope (PRD #1296 Slice C, issue #1300)", () => {
    it("enumerates LEA's cards with canonical cardId + display name", () => {
        const cards = listScopeCards("lea");
        expect(cards.length).toBeGreaterThan(0);
        // Every entry from the checked-in LEA Pick Rating seed file must
        // resolve to a card of the enumerated LEA scope.
        const leaRatings = getPickRatingFile("lea")!;
        const ids = new Set(cards.map((c) => c.cardId));
        for (const cardId of Object.keys(leaRatings.ratings)) {
            expect(ids.has(cardId)).toBe(true);
        }
        // Every card carries a non-empty display name.
        expect(cards.every((c) => c.name.length > 0)).toBe(true);
    });

    it("deduplicates by canonical cardId across sheets", () => {
        const cards = listScopeCards("lea");
        const ids = cards.map((c) => c.cardId);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("is case-insensitive on the scope (LEA vs lea)", () => {
        expect(listScopeCards("LEA")).toEqual(listScopeCards("lea"));
    });

    it("returns [] for a scope with no checked-in Booster Config", () => {
        expect(listScopeCards("not-a-real-set")).toEqual([]);
    });
});

describe("listScopeCards — Vintage Cube scope (PRD #1296 Slice C, issue #1300)", () => {
    it("enumerates the SAME pool buildCubePool() reports, as {cardId, name}", () => {
        const cards = listScopeCards(CUBE_SOURCE_KEY);
        const pool = buildCubePool();
        expect(cards.map((c) => c.cardId).sort()).toEqual([...pool].sort());
        expect(cards.every((c) => c.name.length > 0)).toBe(true);
    });

    it("is case-insensitive on the cube scope key", () => {
        expect(listScopeCards("Vintage-Cube")).toEqual(
            listScopeCards(CUBE_SOURCE_KEY)
        );
    });
});

describe("buildScopeCardRatings — layering annotation (PRD #1296 Slice C, issue #1300)", () => {
    it("attaches null dbRating and null seedRating when neither layer has an entry", () => {
        const rows = buildScopeCardRatings(
            "lea",
            [{ cardId: "totally-unrated-card", name: "Nothing" }],
            fakeDb({})
        );
        expect(rows).toEqual([
            {
                cardId: "totally-unrated-card",
                name: "Nothing",
                dbRating: null,
                seedRating: null,
            },
        ]);
    });

    it("attaches the seed rating when the database has no override", () => {
        const leaRatings = getPickRatingFile("lea")!;
        const [cardId, seedRating] = Object.entries(leaRatings.ratings)[0];
        const rows = buildScopeCardRatings(
            "lea",
            [{ cardId, name: "Seeded Card" }],
            fakeDb({})
        );
        expect(rows[0].dbRating).toBeNull();
        expect(rows[0].seedRating).toBe(seedRating);
    });

    it("attaches BOTH the database override and the underlying seed rating (editor shows override-vs-default)", () => {
        const leaRatings = getPickRatingFile("lea")!;
        const [cardId, seedRating] = Object.entries(leaRatings.ratings)[0];
        const dbOverride = seedRating === 1 ? 2 : 1;
        const rows = buildScopeCardRatings(
            "lea",
            [{ cardId, name: "Overridden Card" }],
            fakeDb({ lea: { [cardId]: dbOverride } })
        );
        expect(rows[0].dbRating).toBe(dbOverride);
        expect(rows[0].seedRating).toBe(seedRating);
    });

    it("normalizes scope casing before querying either layer", () => {
        const rows = buildScopeCardRatings(
            "LEA",
            [{ cardId: "card-x", name: "Card X" }],
            fakeDb({ lea: { "card-x": 3 } })
        );
        expect(rows[0].dbRating).toBe(3);
    });

    it("preserves a rating of exactly 0 from the database (not falsy/absent)", () => {
        const rows = buildScopeCardRatings(
            "lea",
            [{ cardId: "never-play-this", name: "Filler" }],
            fakeDb({ lea: { "never-play-this": 0 } })
        );
        expect(rows[0].dbRating).toBe(0);
    });

    it("preserves card order and does not drop/reorder entries", () => {
        const cards = [
            { cardId: "a", name: "Alpha" },
            { cardId: "b", name: "Bravo" },
            { cardId: "c", name: "Charlie" },
        ];
        const rows = buildScopeCardRatings("lea", cards, fakeDb({}));
        expect(rows.map((r) => r.cardId)).toEqual(["a", "b", "c"]);
    });
});

describe("buildDbRatingLookup (issue #1613 fixup, pre-merge review finding 2)", () => {
    it("turns flat scoped rows into a (scope, cardId) -> rating lookup", () => {
        const rows: ScopedCardRating[] = [
            { scope: "lea", cardId: "black-lotus", rating: 5 },
            { scope: "lea", cardId: "sol-ring", rating: 4 },
        ];
        const getDbRating = buildDbRatingLookup(rows);
        expect(getDbRating("lea", "black-lotus")).toBe(5);
        expect(getDbRating("lea", "sol-ring")).toBe(4);
    });

    it("returns null for a (scope, cardId) pair with no row", () => {
        const getDbRating = buildDbRatingLookup([]);
        expect(getDbRating("lea", "black-lotus")).toBeNull();
    });

    it("is case-insensitive on scope, matching resolveEventPickRating's own normalization", () => {
        const rows: ScopedCardRating[] = [
            { scope: "lea", cardId: "card-x", rating: 3 },
        ];
        const getDbRating = buildDbRatingLookup(rows);
        expect(getDbRating("LEA", "card-x")).toBe(3);
    });

    it("a row for one scope never leaks into a lookup call for a different scope", () => {
        const rows: ScopedCardRating[] = [
            { scope: "ice", cardId: "shared-card-id", rating: 5 },
        ];
        const getDbRating = buildDbRatingLookup(rows);
        expect(getDbRating("lea", "shared-card-id")).toBeNull();
    });

    it("preserves a rating of exactly 0 (not falsy/absent)", () => {
        const rows: ScopedCardRating[] = [
            { scope: "lea", cardId: "never-play-this", rating: 0 },
        ];
        const getDbRating = buildDbRatingLookup(rows);
        expect(getDbRating("lea", "never-play-this")).toBe(0);
    });

    it("composes with resolveEventPickRating exactly like the server's own loadEventPickRating map does — the replay's recomputed pick now agrees with the historical one when a rating was edited", () => {
        const leaRatings = getPickRatingFile("lea")!;
        const [cardId, seedRating] = Object.entries(leaRatings.ratings)[0];
        const dbOverride = seedRating === 1 ? 2 : 1;
        const rows: ScopedCardRating[] = [
            { scope: "lea", cardId, rating: dbOverride },
        ];
        const getPickRatingFn = resolveEventPickRating(
            ["lea"],
            buildDbRatingLookup(rows)
        );
        expect(getPickRatingFn(cardId)).toBe(dbOverride);
        expect(getPickRatingFn(cardId)).not.toBe(seedRating);
    });
});

describe("listScopeCardRatings end-to-end shape (PRD #1296 Slice C, issue #1300) — regression: empty DB matches the seed-only path byte-for-byte", () => {
    it("for every LEA scope card, an empty database annotation equals getPickRating('lea', cardId)", () => {
        const cards = listScopeCards("lea");
        const rows = buildScopeCardRatings("lea", cards, fakeDb({}));
        for (const row of rows) {
            expect(row.dbRating).toBeNull();
            expect(row.seedRating).toBe(getPickRating("lea", row.cardId));
        }
    });

    it("for every Vintage Cube scope card, an empty database annotation equals getPickRating(vintage-cube, cardId)", () => {
        const cards = listScopeCards(CUBE_SOURCE_KEY);
        const rows = buildScopeCardRatings(CUBE_SOURCE_KEY, cards, fakeDb({}));
        for (const row of rows) {
            expect(row.dbRating).toBeNull();
            expect(row.seedRating).toBe(
                getPickRating(CUBE_SOURCE_KEY, row.cardId)
            );
        }
    });
});
