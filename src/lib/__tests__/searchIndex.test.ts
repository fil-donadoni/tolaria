import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    fromSearchIndexWire,
    type SearchIndexWireRow,
} from "@convex/cards/searchIndex";
import { loadSearchIndex, resetSearchIndexForTests } from "../searchIndex";

// Issue #4861 — the deck builder's search index is the generated asset,
// fetched once and decoded by `fromSearchIndexWire`; a failure is retried.
const WIRE = JSON.parse(
    readFileSync(
        resolve(__dirname, "../../../data/catalogue/search-index.json"),
        "utf8"
    )
) as SearchIndexWireRow[];

const serve = (body: unknown, ok = true) =>
    vi.fn(() =>
        Promise.resolve({
            ok,
            status: ok ? 200 : 503,
            statusText: ok ? "OK" : "Service Unavailable",
            json: () => Promise.resolve(body),
        } as Response)
    );

afterEach(() => {
    vi.unstubAllGlobals();
    resetSearchIndexForTests();
});

describe("loadSearchIndex (issue #4861)", () => {
    it("decodes the committed asset into the rows the generator derived", async () => {
        vi.stubGlobal("fetch", serve(WIRE));
        await expect(loadSearchIndex()).resolves.toEqual(
            fromSearchIndexWire(WIRE)
        );
    });

    it("fetches once and shares the rows", async () => {
        const fetchMock = serve(WIRE);
        vi.stubGlobal("fetch", fetchMock);
        const [a, b] = await Promise.all([
            loadSearchIndex(),
            loadSearchIndex(),
        ]);
        expect(await loadSearchIndex()).toBe(a);
        expect(b).toBe(a);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not memoise a failure — the next call re-fetches", async () => {
        vi.stubGlobal("fetch", serve(null, false));
        await expect(loadSearchIndex()).rejects.toThrow(/HTTP 503/);
        const retry = serve(WIRE);
        vi.stubGlobal("fetch", retry);
        await expect(loadSearchIndex()).resolves.toHaveLength(WIRE.length);
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it("refuses a body that is not rows", async () => {
        vi.stubGlobal("fetch", serve({ rows: [] }));
        await expect(loadSearchIndex()).rejects.toThrow(
            /not a non-empty array/
        );
    });
});
