import { afterEach, describe, expect, it, vi } from "vitest";

// Issue #5584: the Setup flow warms what Start match needs, at idle, best
// effort — a part that fails never blocks the rest nor surfaces.

const hydrateGameCatalogue = vi.fn<() => Promise<void>>();
vi.mock("../catalogueArtifact", () => ({ hydrateGameCatalogue }));
const prefetchCatalogueGate = vi.fn<() => Promise<void>>();
vi.mock("../catalogueGateLoader", () => ({ prefetchCatalogueGate }));

const { prefetchStartMatch, whenIdle } = await import("../startMatchPrefetch");

afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("prefetchStartMatch", () => {
    it("starts the catalogue, the gate and the game route together", async () => {
        hydrateGameCatalogue.mockResolvedValue(undefined);
        prefetchCatalogueGate.mockResolvedValue();
        const preload = vi.fn(async () => {});
        await prefetchStartMatch(preload);
        expect(hydrateGameCatalogue).toHaveBeenCalledTimes(1);
        expect(prefetchCatalogueGate).toHaveBeenCalledTimes(1);
        expect(preload).toHaveBeenCalledTimes(1);
    });

    it("settles, never rejects, when every part fails", async () => {
        hydrateGameCatalogue.mockRejectedValue(new Error("offline"));
        prefetchCatalogueGate.mockRejectedValue(new Error("offline"));
        await expect(
            prefetchStartMatch(() => Promise.reject(new Error("offline")))
        ).resolves.toBeUndefined();
    });
});

describe("whenIdle", () => {
    it("uses requestIdleCallback when the browser has it, and cancels through it", () => {
        const requestIdleCallback = vi.fn(() => 7);
        const cancelIdleCallback = vi.fn();
        vi.stubGlobal("requestIdleCallback", requestIdleCallback);
        vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
        const task = vi.fn();
        const cancel = whenIdle(task);
        expect(requestIdleCallback).toHaveBeenCalledWith(task, {
            timeout: 3000,
        });
        cancel();
        expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    });

    it("falls back to a timer where requestIdleCallback is missing, and cancels", () => {
        vi.useFakeTimers();
        vi.stubGlobal("requestIdleCallback", undefined);
        const task = vi.fn();
        const cancel = whenIdle(task);
        cancel();
        vi.advanceTimersByTime(5000);
        expect(task).not.toHaveBeenCalled();

        whenIdle(task);
        vi.advanceTimersByTime(5000);
        expect(task).toHaveBeenCalledTimes(1);
    });
});
