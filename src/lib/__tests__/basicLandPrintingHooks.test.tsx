// Card Prints (ADR 0140, issue #5106): the wiring of the hook that reads
// `cardPrints` for the decklist import — chunked under the server cap.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
    query: vi.fn(),
}));

vi.mock("convex/react", () => ({
    useConvex: () => ({ query: (...args: unknown[]) => h.query(...args) }),
}));
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

import { useEarliestPrintFetcher } from "../useEarliestPrintFetcher";

beforeEach(() => {
    h.query.mockReset();
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
