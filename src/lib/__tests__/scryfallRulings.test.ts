// Issue #4816 — Rulings are fetched on demand and cached in the browser only
// (ADR 0142): memory for the page session, `localStorage` for 24 h.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    fetchRulings,
    parseRulings,
    resetRulingsCacheForTests,
    RULINGS_TTL_MS,
} from "../scryfallRulings";

const ID = "ab000000-0000-0000-0000-000000000000";
const BODY = {
    data: [
        { source: "scryfall", published_at: "2020-02-02", comment: "B {T}" },
        { source: "wotc", published_at: "2019-01-01", comment: "A" },
    ],
};

function ok(body: unknown) {
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

beforeEach(() => {
    resetRulingsCacheForTests();
    localStorage.clear();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("scryfallRulings", () => {
    it("sorts ascending and drops malformed rows", () => {
        const r = parseRulings({ data: [...BODY.data, { source: "x" }] });
        expect(r.map((x) => x.comment)).toEqual(["A", "B {T}"]);
        expect(() => parseRulings({})).toThrow();
    });

    it("memory cache: a second call does not refetch", async () => {
        const f = vi.fn(() => ok(BODY));
        vi.stubGlobal("fetch", f);
        await fetchRulings(ID);
        await fetchRulings(ID);
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("localStorage hit within 24h, miss past it", async () => {
        vi.useFakeTimers();
        const f = vi.fn(() => ok(BODY));
        vi.stubGlobal("fetch", f);
        await fetchRulings(ID);
        resetRulingsCacheForTests();
        vi.advanceTimersByTime(RULINGS_TTL_MS - 1000);
        await fetchRulings(ID);
        expect(f).toHaveBeenCalledTimes(1);
        resetRulingsCacheForTests();
        vi.advanceTimersByTime(2000);
        await fetchRulings(ID);
        expect(f).toHaveBeenCalledTimes(2);
    });

    it("caches an empty list", async () => {
        const f = vi.fn(() => ok({ data: [] }));
        vi.stubGlobal("fetch", f);
        await fetchRulings(ID);
        await fetchRulings(ID);
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("does not cache errors or 429", async () => {
        const f = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 429 })
            .mockResolvedValueOnce({ ok: false, status: 500 })
            .mockImplementation(() => ok(BODY));
        vi.stubGlobal("fetch", f);
        await expect(fetchRulings(ID)).rejects.toThrow();
        await expect(fetchRulings(ID)).rejects.toThrow();
        await fetchRulings(ID);
        expect(f).toHaveBeenCalledTimes(3);
    });

    it("still works when localStorage throws", async () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("denied");
            },
        });
        const f = vi.fn(() => ok(BODY));
        vi.stubGlobal("fetch", f);
        expect((await fetchRulings(ID)).length).toBe(2);
        await fetchRulings(ID);
        expect(f).toHaveBeenCalledTimes(1);
    });
});
