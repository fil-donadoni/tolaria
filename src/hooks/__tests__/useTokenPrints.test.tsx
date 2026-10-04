// The Game-load Token Print fetch (ADR 0140 §4, issue #4120): ONE subscription
// for every Print ID in both decks — never a query per token — and the last
// loaded rows are kept across a re-query so a token's art never flickers back
// to the placeholder.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const useQuery = vi.fn();
vi.mock("~/hooks/useResilientQuery", () => ({
    useResilientQuery: (...args: unknown[]) => ({ data: useQuery(...args) }),
}));

import { useTokenPrintsState } from "../useTokenPrints";

const ROW = {
    printId: "print-1",
    cardId: "card-1",
    tokenPrints: [{ name: "Wasp", tokenPrintId: "wasp-print" }],
};

describe("useTokenPrintsState", () => {
    beforeEach(() => useQuery.mockReset());

    it("subscribes once, with every Print ID the Game names", () => {
        useQuery.mockReturnValue([ROW]);
        const { result } = renderHook(() =>
            useTokenPrintsState(["print-1", "print-2"])
        );
        expect(useQuery).toHaveBeenCalledTimes(1);
        expect(useQuery.mock.calls[0][1]).toEqual({
            printIds: ["print-1", "print-2"],
        });
        expect(result.current.get("print-1")).toEqual(ROW);
    });

    it("skips the query until the Game's Print IDs are known", () => {
        useQuery.mockReturnValue(undefined);
        const { result, rerender } = renderHook(
            ({ ids }: { ids: string[] | undefined }) =>
                useTokenPrintsState(ids),
            { initialProps: { ids: undefined as string[] | undefined } }
        );
        expect(useQuery.mock.calls[0][1]).toBe("skip");
        expect(result.current.size).toBe(0);
        rerender({ ids: [] });
        expect(useQuery.mock.calls[1][1]).toBe("skip");
    });

    it("keeps the last loaded rows while a changed id set re-queries", () => {
        useQuery.mockReturnValue([ROW]);
        const { result, rerender } = renderHook(
            ({ ids }: { ids: string[] }) => useTokenPrintsState(ids),
            { initialProps: { ids: ["print-1"] } }
        );
        useQuery.mockReturnValue(undefined);
        rerender({ ids: ["print-1", "print-2"] });
        expect(result.current.get("print-1")).toEqual(ROW);
    });
});

describe("useTokenPrintsState — cosmetic rows never break the board", () => {
    beforeEach(() => useQuery.mockReset());

    it("an answer that is not a row list degrades to no edition art", () => {
        useQuery.mockReturnValue({ not: "rows" });
        const { result } = renderHook(() => useTokenPrintsState(["print-1"]));
        expect(result.current.size).toBe(0);
    });
});
