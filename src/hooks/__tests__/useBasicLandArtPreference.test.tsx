// The basic-land art preference lives in the per-user `userCardPrints` table
// (issue #10462): a pick is a row for the authenticated user (the mutation
// carries no user id — the server derives it from `ctx.auth`), a second
// session with empty localStorage reads it back, and the per-device
// localStorage preference that predates the table is migrated exactly once,
// never over a row the table already holds.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import {
    normalizeCardPrintArgs,
    type CardPrintPreference,
} from "@convex/userCardPrints";
import {
    loadBasicLandPrintId,
    saveBasicLandPrintId,
} from "~/lib/deckViewPrefs";
import { useBasicLandArtPreference } from "../useBasicLandArtPreference";

const LEB_MOUNTAIN_PRINT = "7af9c715-8d72-4eae-b412-fc89138ff588";
const ICE_MOUNTAIN_PRINT = "4ecf39c3-3b5f-4263-a7b5-9881bded3494";
const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56";

/** One user's server rows, standing in for `userCardPrints`. */
const server = vi.hoisted(() => ({
    rows: [] as CardPrintPreference[],
    save: vi.fn(),
}));

vi.mock("convex/react", () => ({
    useQuery: (ref: unknown, args: unknown) => {
        if (args === "skip") return undefined;
        const name = getFunctionName(ref as never);
        if (name === "userCardPrints:listMyCardPrints") return server.rows;
        if (name === "cardPrints:getByPrintIds")
            return (args as { printIds: string[] }).printIds.map((printId) => ({
                printId,
                cardId: MOUNTAIN_ID,
                set: printId === LEB_MOUNTAIN_PRINT ? "leb" : "ice",
            }));
        return undefined;
    },
    useMutation: () => server.save,
}));

function makeStorage(): Storage {
    const data = new Map<string, string>();
    return {
        get length() {
            return data.size;
        },
        clear: () => data.clear(),
        getItem: (k: string) => data.get(k) ?? null,
        key: (i: number) => [...data.keys()][i] ?? null,
        removeItem: (k: string) => void data.delete(k),
        setItem: (k: string, v: string) => void data.set(k, v),
    };
}

beforeEach(() => {
    server.rows = [];
    server.save.mockReset();
    server.save.mockImplementation(
        (args: { cardName: string; printId: string; setCode: string }) => {
            const pref = normalizeCardPrintArgs(args);
            server.rows = [
                ...server.rows.filter((r) => r.cardKey !== pref.cardKey),
                pref,
            ];
            return Promise.resolve(null);
        }
    );
});

describe("useBasicLandArtPreference — the per-user table is the store (issue #10462)", () => {
    it("a pick writes the user's row, and a second session with empty localStorage reads it", () => {
        const first = renderHook(() =>
            useBasicLandArtPreference(makeStorage())
        );
        act(() =>
            first.result.current.recordBasicLandArt("Mountain", {
                printId: LEB_MOUNTAIN_PRINT,
                setCode: "leb",
            })
        );
        // No client-supplied user id: the server keys the row to ctx.auth.
        expect(server.save).toHaveBeenCalledWith({
            cardName: "Mountain",
            printId: LEB_MOUNTAIN_PRINT,
            setCode: "leb",
        });
        first.unmount();

        const second = renderHook(() =>
            useBasicLandArtPreference(makeStorage())
        );
        expect(second.result.current.basicLandArt).toEqual({
            Mountain: LEB_MOUNTAIN_PRINT,
        });
    });
});

describe("useBasicLandArtPreference — the localStorage migration (issue #10462)", () => {
    it("migrates a legacy choice once, then clears the key", () => {
        const storage = makeStorage();
        saveBasicLandPrintId("Mountain", LEB_MOUNTAIN_PRINT, storage);
        const hook = renderHook(() => useBasicLandArtPreference(storage));
        hook.rerender();
        hook.rerender();

        expect(server.save).toHaveBeenCalledTimes(1);
        expect(server.save).toHaveBeenCalledWith({
            cardName: "Mountain",
            printId: LEB_MOUNTAIN_PRINT,
            setCode: "leb",
        });
        expect(loadBasicLandPrintId("Mountain", storage)).toBeNull();
        expect(hook.result.current.basicLandArt).toEqual({
            Mountain: LEB_MOUNTAIN_PRINT,
        });
    });

    it("never overwrites a row the table already holds", () => {
        server.rows = [
            {
                cardKey: "mountain",
                printId: ICE_MOUNTAIN_PRINT,
                setCode: "ice",
            },
        ];
        const storage = makeStorage();
        saveBasicLandPrintId("Mountain", LEB_MOUNTAIN_PRINT, storage);
        const hook = renderHook(() => useBasicLandArtPreference(storage));

        expect(server.save).not.toHaveBeenCalled();
        expect(loadBasicLandPrintId("Mountain", storage)).toBeNull();
        expect(hook.result.current.basicLandArt).toEqual({
            Mountain: ICE_MOUNTAIN_PRINT,
        });
    });
});
