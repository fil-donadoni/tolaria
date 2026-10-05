// Card Prints (ADR 0140, issue #5106): the two `by_cardId_set` readers — the
// decklist import's `earliestInSets` and Limited's `loadPrintIdsInSet`. The
// project has no convex-test harness (see `banlistSync.test.ts`), so each runs
// against a fake `ctx.db` that records the index probes it is asked for.
import { describe, expect, it } from "vitest";
import { earliestInSets } from "../cardPrints";
import { loadPrintIdsInSet } from "../cardPrintRows";

interface Row {
    printId: string;
    cardId: string;
    set: string;
}

/** A `ctx.db` over `rows` that answers `by_cardId_set` probes with `.first()`
 *  and logs every `(cardId, set)` it was asked for. */
function fakeCtx(rows: Row[]) {
    const probes: [string, string][] = [];
    const ctx = {
        db: {
            query: (table: string) => {
                expect(table).toBe("cardPrints");
                return {
                    withIndex: (
                        index: string,
                        build: (q: {
                            eq: (f: string, v: string) => unknown;
                        }) => unknown
                    ) => {
                        expect(index).toBe("by_cardId_set");
                        const eq: Record<string, string> = {};
                        const q = {
                            eq(field: string, value: string) {
                                eq[field] = value;
                                return q;
                            },
                        };
                        build(q);
                        probes.push([eq.cardId, eq.set]);
                        return {
                            first: async () =>
                                rows.find(
                                    (r) =>
                                        r.cardId === eq.cardId &&
                                        r.set === eq.set
                                ) ?? null,
                        };
                    },
                };
            },
        },
    };
    return { ctx, probes };
}

const rows: Row[] = [
    { printId: "m-3ed", cardId: "mountain", set: "3ed" },
    { printId: "m-4ed", cardId: "mountain", set: "4ed" },
    { printId: "b-4ed", cardId: "bolt", set: "4ed" },
];

type Handler = (
    ctx: unknown,
    args: { cardIds: string[]; allowedSets: string[] }
) => Promise<{ cardId: string; printId: string; set: string }[]>;
const earliest = (earliestInSets as unknown as { _handler: Handler })._handler;

describe("earliestInSets — the earliest allowed Set with a row, per Card ID", () => {
    it("walks the allowed Sets in Format order and stops at the first hit", async () => {
        const { ctx, probes } = fakeCtx(rows);
        const out = await earliest(ctx, {
            cardIds: ["mountain"],
            allowedSets: ["lea", "3ed", "4ed"],
        });
        expect(out).toEqual([
            { cardId: "mountain", printId: "m-3ed", set: "3ed" },
        ]);
        // lea (miss), 3ed (hit) — 4ed is never probed.
        expect(probes).toEqual([
            ["mountain", "lea"],
            ["mountain", "3ed"],
        ]);
    });

    it("omits a Card ID with no row in any allowed Set, and dedupes Card IDs", async () => {
        const { ctx } = fakeCtx(rows);
        const out = await earliest(ctx, {
            cardIds: ["bolt", "bolt", "ghost"],
            allowedSets: ["3ed", "4ed"],
        });
        expect(out).toEqual([{ cardId: "bolt", printId: "b-4ed", set: "4ed" }]);
    });
});

describe("loadPrintIdsInSet — Limited's drafted-Set basics", () => {
    it("reads one indexed probe per Card ID and maps Card ID → print id", async () => {
        const { ctx, probes } = fakeCtx(rows);
        const out = await loadPrintIdsInSet(
            ctx as never,
            ["mountain", "mountain", "ghost"],
            "4ed"
        );
        expect(out.get("mountain")).toBe("m-4ed");
        expect(out.has("ghost")).toBe(false);
        expect(probes).toEqual([
            ["mountain", "4ed"],
            ["ghost", "4ed"],
        ]);
    });
});
