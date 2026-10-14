import { afterEach, describe, expect, it, vi } from "vitest";

// Issue #5584: the Import deck's parser is usable only once the catalogue it
// resolves names through is resident — the loader resolves after BOTH, and a
// catalogue that fails to load fails the load.

const hydrateCatalogue = vi.fn<() => Promise<number>>();
vi.mock("../catalogueArtifact", () => ({ hydrateCatalogue }));

const { loadStrictImport, loadedStrictImport } =
    await import("../strictImportLoader");

afterEach(() => vi.clearAllMocks());

describe("loadStrictImport", () => {
    it("propagates a catalogue failure, and remembers nothing", async () => {
        hydrateCatalogue.mockRejectedValue(new Error("HTTP 503"));
        await expect(loadStrictImport()).rejects.toThrow("HTTP 503");
        expect(loadedStrictImport()).toBeNull();
    });

    it("resolves only after the catalogue has hydrated, then is remembered", async () => {
        let hydrate!: (n: number) => void;
        hydrateCatalogue.mockReturnValue(
            new Promise<number>((resolve) => {
                hydrate = resolve;
            })
        );
        let settled = false;
        const loading = loadStrictImport().then((m) => {
            settled = true;
            return m;
        });
        await new Promise((r) => setTimeout(r, 50));
        expect(settled).toBe(false);
        hydrate(1);
        const module = await loading;
        expect(typeof module.strictImportWithPrintings).toBe("function");
        expect(loadedStrictImport()).toBe(module);
    });
});
