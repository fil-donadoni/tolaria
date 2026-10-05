// Card Prints (ADR 0140, issue #5106): the wiring of the hooks that read
// `cardPrints` for the basic-land art picker and the decklist import. The
// rows' composition is the pure core's (`basicLands.test.ts`); this pins what
// each hook asks the table FOR — the Format filter inside the query, nothing
// read while the popover is closed, the import chunked under the server cap.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
    paginated: vi.fn(),
    query: vi.fn(),
}));

vi.mock("convex/react", () => ({
    usePaginatedQuery: (...args: unknown[]) => h.paginated(...args),
    useConvex: () => ({ query: (...args: unknown[]) => h.query(...args) }),
}));
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

import { useBasicLandPrintings } from "../useBasicLandPrintings";
import { useEarliestPrintFetcher } from "../useEarliestPrintFetcher";

const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56";

beforeEach(() => {
    h.paginated.mockReset();
    h.query.mockReset();
    h.paginated.mockReturnValue({
        results: [],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
});

describe("useBasicLandPrintings", () => {
    it("reads nothing while the popover is closed", () => {
        renderHook(() => useBasicLandPrintings("Mountain", ["lea"], false));
        expect(h.paginated.mock.calls[0][1]).toBe("skip");
    });

    it("asks for the subtype's Card ID with the Format's allowed Sets inside the query, a page at a time", () => {
        renderHook(() =>
            useBasicLandPrintings("Mountain", ["lea", "leb"], true)
        );
        const [, args, opts] = h.paginated.mock.calls[0];
        expect(args).toEqual({
            cardId: MOUNTAIN_ID,
            allowedSets: ["lea", "leb"],
        });
        expect(opts.initialNumItems).toBeLessThan(100);
    });

    it("sends no allowedSets for an unrestricted Format", () => {
        renderHook(() => useBasicLandPrintings("Mountain", null, true));
        expect(h.paginated.mock.calls[0][1]).toEqual({
            cardId: MOUNTAIN_ID,
            allowedSets: undefined,
        });
    });

    it("lists the definition's own printing first, then the rows, and reports another page", () => {
        h.paginated.mockReturnValue({
            results: [{ printId: "m-leb", cardId: MOUNTAIN_ID, set: "leb" }],
            status: "CanLoadMore",
            loadMore: vi.fn(),
        });
        const { result } = renderHook(() =>
            useBasicLandPrintings("Mountain", null, true)
        );
        expect(result.current.printings.map((p) => p.printId)).toEqual([
            MOUNTAIN_ID,
            "m-leb",
        ]);
        expect(result.current.canLoadMore).toBe(true);
    });
});

describe("useEarliestPrintFetcher", () => {
    it("splits a long decklist into calls under the server's Card ID cap and merges the answers", async () => {
        h.query.mockImplementation(
            async (_ref: unknown, args: { cardIds: string[] }) =>
                args.cardIds.map((cardId) => ({
                    cardId,
                    printId: `p-${cardId}`,
                    set: "lea",
                }))
        );
        const ids = Array.from({ length: 95 }, (_, i) => `card-${i}`);
        const { result } = renderHook(() => useEarliestPrintFetcher());
        const out = await result.current(ids, ["lea"]);
        expect(h.query).toHaveBeenCalledTimes(3); // 40 + 40 + 15
        for (const [, args] of h.query.mock.calls) {
            expect(args.cardIds.length).toBeLessThanOrEqual(40);
        }
        expect(out.size).toBe(95);
        expect(out.get("card-7")).toEqual({ printId: "p-card-7", set: "lea" });
    });
});
