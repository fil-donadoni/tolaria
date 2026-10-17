import { afterEach, describe, expect, it, vi } from "vitest";

// Issue #5584: the Import deck's parser is usable only once the catalogue it
// resolves names through is resident — the loader resolves after BOTH, and a
// catalogue that fails to load fails the load. Since issue #5616 that is the
// compiled Definition Index (every NAME, no definition), never the whole
// catalogue: the pasted deck's own shards load at submit.

const hydrateCatalogue = vi.fn<() => Promise<number>>();
vi.mock("../catalogueArtifact", () => ({ hydrateCatalogue }));
const installCompiledIndex = vi.fn<() => Promise<void>>();
vi.mock("../catalogue/compiled-shards", () => ({ installCompiledIndex }));
// The parser itself is the subject of `matchSetupDeckImport.test.ts`; here
// only WHEN the loader resolves matters, so its (catalogue-wide) module graph
// is not loaded.
vi.mock("../matchSetupDeckImport", () => ({
    strictImportWithPrintings: vi.fn(),
}));

const { loadStrictImport, loadedStrictImport } =
    await import("../strictImportLoader");

afterEach(() => vi.clearAllMocks());

describe("loadStrictImport", () => {
    it("propagates a names-index failure, and remembers nothing", async () => {
        installCompiledIndex.mockRejectedValue(new Error("HTTP 503"));
        await expect(loadStrictImport()).rejects.toThrow("HTTP 503");
        expect(loadedStrictImport()).toBeNull();
    });

    it("resolves only after the names index is resident, then is remembered — and never loads the whole catalogue", async () => {
        let resident!: () => void;
        installCompiledIndex.mockReturnValue(
            new Promise<void>((resolve) => {
                resident = resolve;
            })
        );
        let settled = false;
        const loading = loadStrictImport().then((m) => {
            settled = true;
            return m;
        });
        await new Promise((r) => setTimeout(r, 50));
        expect(settled).toBe(false);
        resident();
        const module = await loading;
        expect(typeof module.strictImportWithPrintings).toBe("function");
        expect(loadedStrictImport()).toBe(module);
        expect(hydrateCatalogue).not.toHaveBeenCalled();
    });
});
