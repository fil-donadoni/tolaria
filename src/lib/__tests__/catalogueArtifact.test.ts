import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDefinition, tryGetDefinition } from "@convex/cards";
import { getCardByName, getAllRawCards } from "@convex/cards/catalogue";
import type { CardDefinition } from "@convex/cards/types";
import {
    catalogueArtifactUrl,
    hydrateCatalogue,
    resetCatalogueHydrationForTests,
} from "../catalogueArtifact";

/**
 * The client's catalogue hydration (issue #3053, ADR 0113 §1/§3).
 *
 * What this file is FOR: `getDefinition` is synchronous and 382 call sites
 * rely on it, so the whole design rests on the registry being fully hydrated
 * before any consumer runs. The two ways that can be false are a fetch that
 * silently does nothing, and a fetch that does something WRONG — overwriting
 * a hand-written definition with the artifact's relocated copy of it. Both
 * are asserted here through the real registry seam (`getDefinition`), never
 * through a return value alone.
 */

const ROW: CardDefinition = {
    id: "test-fetched-row",
    name: "Test Fetched Row",
    types: ["Creature"],
    manaCost: { G: 1 },
    power: 1,
    toughness: 1,
} as CardDefinition;

function respondWith(rows: unknown, init: Partial<Response> = {}) {
    return vi.fn(() =>
        Promise.resolve({
            ok: init.ok ?? true,
            status: init.status ?? 200,
            statusText: init.statusText ?? "OK",
            json: () => Promise.resolve(rows),
        } as Response)
    );
}

beforeEach(() => {
    resetCatalogueHydrationForTests();
});

afterEach(() => {
    vi.unstubAllGlobals();
    resetCatalogueHydrationForTests();
});

describe("catalogue artifact URL", () => {
    it("is the one content-addressed artifact, resolved at build", () => {
        expect(catalogueArtifactUrl()).toMatch(/catalogue-[0-9a-f]{16}/);
        expect(catalogueArtifactUrl()).toMatch(/\.json$/);
    });
});

describe("hydrateCatalogue", () => {
    it("registers the fetched rows into the synchronous registry", async () => {
        expect(tryGetDefinition(ROW.id)).toBeNull();
        vi.stubGlobal("fetch", respondWith([ROW]));

        const registered = await hydrateCatalogue();

        expect(registered).toBe(1);
        expect(getDefinition(ROW.id).name).toBe("Test Fetched Row");
        expect(getCardByName("Test Fetched Row").id).toBe(ROW.id);
    });

    it("fetches once — a second call reuses the promise, not the network", async () => {
        const fetchMock = respondWith([ROW]);
        vi.stubGlobal("fetch", fetchMock);

        await Promise.all([hydrateCatalogue(), hydrateCatalogue()]);
        await hydrateCatalogue();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            catalogueArtifactUrl(),
            expect.objectContaining({ signal: expect.anything() })
        );
    });

    it("never overwrites a hand-written definition with the artifact's relocated copy", async () => {
        // The artifact carries the 890 relocated hand-written rows too
        // (issue #3052). The module is what the engine runs and what the
        // divergence baseline rules authoritative, so the fetched twin must
        // be DROPPED — not merged, not preferred.
        const handWritten = getAllRawCards()[0]!;
        const impostor = {
            ...handWritten,
            name: "Impostor",
            oracleText: "This must never reach the registry.",
        } as CardDefinition;
        vi.stubGlobal("fetch", respondWith([impostor, ROW]));

        const registered = await hydrateCatalogue();

        expect(registered).toBe(1);
        expect(getDefinition(handWritten.id).name).toBe(handWritten.name);
    });

    it("does not memoise a rejection — a retry really re-fetches", async () => {
        const failing = vi.fn(() => Promise.reject(new Error("offline")));
        vi.stubGlobal("fetch", failing);
        await expect(hydrateCatalogue()).rejects.toThrow("offline");

        const succeeding = respondWith([ROW]);
        vi.stubGlobal("fetch", succeeding);
        await expect(hydrateCatalogue()).resolves.toBe(1);
        expect(succeeding).toHaveBeenCalledTimes(1);
    });

    it("bounds a stalled fetch, so the gate and the Worker see a rejection", async () => {
        // The failure this guards is a `fetch` that never settles: a pending
        // promise reaches neither the gate's error branch nor the Worker's
        // re-arm, and both would wait for the rest of the session.
        vi.stubGlobal(
            "fetch",
            vi.fn((_url: string, init?: RequestInit) => {
                return new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () =>
                        reject(
                            (init.signal as AbortSignal & { reason?: unknown })
                                .reason
                        )
                    );
                });
            })
        );
        vi.useFakeTimers();
        try {
            const inFlight = hydrateCatalogue();
            const settled = vi.fn();
            void inFlight.catch(settled);
            await vi.advanceTimersByTimeAsync(59_000);
            expect(settled).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(2_000);
            await expect(inFlight).rejects.toThrow();
        } finally {
            vi.useRealTimers();
        }
    });

    it("refuses a non-OK response instead of registering nothing in silence", async () => {
        vi.stubGlobal(
            "fetch",
            respondWith([], { ok: false, status: 404, statusText: "Not Found" })
        );
        await expect(hydrateCatalogue()).rejects.toThrow(/HTTP 404/);
    });

    it("refuses a body that is not a non-empty array of definitions", async () => {
        vi.stubGlobal("fetch", respondWith([]));
        await expect(hydrateCatalogue()).rejects.toThrow(
            /not a non-empty array/
        );
    });
});
