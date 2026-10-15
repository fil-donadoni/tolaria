import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { createImportGraph } from "../lib/import-graph";
import {
    CARD_SETS_DEV_LOADER,
    CARD_SETS_DEV_MODULE,
    SET_CHUNK_LOADER_SPECIFIER,
    SET_MODULES_BROWSER_SEAM,
    SET_MODULES_MODULE,
    SETS_DIR,
    bundleCardSets,
    cardSetsDevBundle,
    cardSetsDevBundleApplies,
    cardSetsLoaderSource,
    isSetModulesBrowserSeam,
    parseSetModuleImports,
    type CardSetsBundle,
} from "../lib/vite-card-sets-dev-bundle";

/**
 * The dev server's one-module card catalogue (issue #5597), behind the
 * per-Set loader of issue #5615. Four things must hold for the bundle to be
 * the SAME catalogue the app would have loaded chunk by chunk: the server's
 * Set list is read whole, each import with its code; the bundle folds in Set
 * modules and ONLY Set modules (anything else stays an external URL — one
 * module instance with the engine); a Set module has exactly its two
 * importers (the server's static list, the client's one `import()`); and the
 * plugin never runs where a test compares a Set export by identity.
 */

const ROOT = path.resolve(__dirname, "../..");
const setModulesSource = readFileSync(
    path.join(ROOT, SET_MODULES_MODULE),
    "utf8"
);
const SET_IMPORT =
    /^import \* as \w+ from "\.\/sets\/[a-z0-9]+\/index\.cards";$/gm;
/** The client's one `import()` of a Set module: a template specifier Vite
 *  expands into one chunk per Set directory. */
const SET_CHUNK_LOADER = "src/lib/catalogue/set-chunk-loader.ts";

/** Every source file under `dir` with one of `exts`, `__tests__` left out,
 *  absolute. */
function sourceFiles(dir: string, exts: readonly string[] = [".ts"]): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
            return entry.name === "__tests__" ? [] : sourceFiles(full, exts);
        return exts.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
    });
}

describe("parseSetModuleImports — the real Set list", () => {
    const sets = parseSetModuleImports(setModulesSource);

    it("reads every Set import, with the code its list entry gives it", () => {
        expect(sets.length).toBe(setModulesSource.match(SET_IMPORT)!.length);
        expect(sets.find((s) => s.dir === "5dn")?.name).toBe("fifthDawn");
        expect(sets.find((s) => s.dir === "lea")?.name).toBe("lea");
    });

    it("names every Set directory, and no other", () => {
        const dirs = readdirSync(path.join(ROOT, SETS_DIR), {
            withFileTypes: true,
        })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();
        expect(sets.map((s) => s.dir).sort()).toEqual(dirs);
    });
});

describe("parseSetModuleImports — refusals", () => {
    it("throws when the module has no Set import to read", () => {
        expect(() =>
            parseSetModuleImports(`import { x } from "./registry";\n`)
        ).toThrow(/no longer recognises it/);
    });

    it("throws when an import has no list entry", () => {
        expect(() =>
            parseSetModuleImports(
                `import * as lea from "./sets/lea/index.cards";\n` +
                    `import * as leb from "./sets/leb/index.cards";\n` +
                    `const setModules = [{ code: "lea", exports: lea }];\n`
            )
        ).toThrow(/lists no .* entry for it/);
    });

    it("throws when a list entry's code is not the import's directory", () => {
        expect(() =>
            parseSetModuleImports(
                `import * as lea from "./sets/lea/index.cards";\n` +
                    `const setModules = [{ code: "leb", exports: lea }];\n`
            )
        ).toThrow(/under code "leb" but imports it from \.\/sets\/lea/);
    });

    it("throws when the list has an entry no import backs", () => {
        expect(() =>
            parseSetModuleImports(
                `import * as lea from "./sets/lea/index.cards";\n` +
                    `const setModules = [{ code: "lea", exports: lea }, { code: "leb", exports: leb }];\n`
            )
        ).toThrow(/lists 2 Set entries but imports 1/);
    });
});

describe("a Set module has exactly its two importers", () => {
    it("the server's static list and the client's one import(), nothing else", () => {
        const graph = createImportGraph({ root: ROOT });
        const setsPrefix = `${SETS_DIR}/`;
        const importers = ["convex", "src"]
            .flatMap((top) =>
                sourceFiles(path.join(ROOT, top), [".ts", ".tsx"])
            )
            .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
            .filter(
                (rel) =>
                    !rel.startsWith(setsPrefix) && !/\.test\.tsx?$/.test(rel)
            )
            .filter(
                (rel) =>
                    graph
                        .importsOf(rel)
                        .some((dep) => dep.startsWith(setsPrefix)) ||
                    // The template `import()` the graph's literal-only scan
                    // cannot see: named by its source.
                    readFileSync(path.join(ROOT, rel), "utf8").includes(
                        "convex/cards/sets/${"
                    )
            );
        expect(importers.sort()).toEqual([
            SET_MODULES_MODULE,
            SET_CHUNK_LOADER,
        ]);
    });

    it("the chunk loader spells one template import of a Set's barrel", () => {
        const loader = readFileSync(path.join(ROOT, SET_CHUNK_LOADER), "utf8");
        expect(loader.match(/\bimport\(/g)).toHaveLength(1);
        expect(loader).toContain(
            "import(`../../../convex/cards/sets/${code}/index.cards.ts`)"
        );
    });

    it("the browser seam imports the loader by the specifier the plugin swaps", () => {
        const seam = readFileSync(
            path.join(ROOT, SET_MODULES_BROWSER_SEAM),
            "utf8"
        );
        expect(seam).toContain(`from "${SET_CHUNK_LOADER_SPECIFIER}";`);
        expect(
            isSetModulesBrowserSeam(path.join(ROOT, SET_MODULES_BROWSER_SEAM))
        ).toBe(true);
        expect(
            isSetModulesBrowserSeam(
                `${path.join(ROOT, SET_MODULES_BROWSER_SEAM)}?import`
            )
        ).toBe(true);
        expect(isSetModulesBrowserSeam(path.join(ROOT, SET_CHUNK_LOADER))).toBe(
            false
        );
        expect(isSetModulesBrowserSeam(undefined)).toBe(false);
    });
});

describe("cardSetsLoaderSource", () => {
    const sets = [
        { name: "lea", dir: "lea" },
        { name: "fifthDawn", dir: "5dn" },
    ];

    it("answers a code from the one bundle, by the namespace its import gives it", () => {
        const source = cardSetsLoaderSource(sets);
        expect(source).toContain(`import("${CARD_SETS_DEV_MODULE}")`);
        expect(source).toContain('"5dn":"fifthDawn"');
        expect(source).toContain("export function loadSetModule(code)");
        expect(source).toContain("Unknown Set module");
        expect(source).toContain("return bundle.then((m) => m[name]);");
    });
});

describe("bundleCardSets — the Set boundary, over the real tree", () => {
    const setsRoot = path.join(ROOT, SETS_DIR) + path.sep;
    // Built once, on the first test that asks — never at collection.
    let pending: Promise<CardSetsBundle> | null = null;
    const bundled = (): Promise<CardSetsBundle> =>
        (pending ??= bundleCardSets(
            ROOT,
            parseSetModuleImports(setModulesSource)
        ));

    it("folds in Set modules only, and keeps everything else an external root-relative URL", async () => {
        const { modules, externals } = await bundled();
        expect(modules.length).toBeGreaterThan(0);
        for (const m of modules) expect(m.startsWith(setsRoot)).toBe(true);
        expect(externals.length).toBeGreaterThan(0);
        for (const e of externals) {
            expect(e).toMatch(/^\/(convex|src)\//);
            expect(e.startsWith(`/${SETS_DIR}/`)).toBe(false);
        }
        // The engine's shared modules are among them: one instance each.
        expect(externals).toContain("/convex/cards/types.ts");
        expect(
            externals.some((e) => e.startsWith("/convex/cards/abilities/"))
        ).toBe(true);
    });

    it("carries every hand-written definition the Set sources declare", async () => {
        const { code } = await bundled();
        const DECLARATION = /=\s*defineCard\(/g;
        const declared = sourceFiles(path.join(ROOT, SETS_DIR)).reduce(
            (n, file) =>
                n +
                (readFileSync(file, "utf8").match(DECLARATION) ?? []).length,
            0
        );
        expect((code.match(DECLARATION) ?? []).length).toBe(declared);
    });

    it("watches every Set source file — the empty shims included — and no test", async () => {
        const { watched } = await bundled();
        expect([...watched].sort()).toEqual(
            sourceFiles(path.join(ROOT, SETS_DIR)).sort()
        );
    });

    it("maps back to the Set sources by the URL the dev server serves them under", async () => {
        const map = JSON.parse((await bundled()).map) as {
            sources: string[];
            sourcesContent?: (string | null)[];
        };
        expect(map.sources.length).toBeGreaterThan(0);
        // Carried, so Vite has no source to read back from disk.
        expect(map.sourcesContent?.every((c) => typeof c === "string")).toBe(
            true
        );
        for (const source of map.sources) {
            expect(source.startsWith(`/${SETS_DIR}/`)).toBe(true);
        }
    });
});

describe("cardSetsDevBundleApplies", () => {
    it("runs on the dev server", () => {
        expect(
            cardSetsDevBundleApplies(
                { command: "serve", mode: "development" },
                {}
            )
        ).toBe(true);
    });

    it("never runs in a build, nor under vitest, nor in test mode", () => {
        expect(
            cardSetsDevBundleApplies(
                { command: "build", mode: "production" },
                {}
            )
        ).toBe(false);
        expect(
            cardSetsDevBundleApplies(
                { command: "serve", mode: "development" },
                { VITEST: "true" }
            )
        ).toBe(false);
        expect(
            cardSetsDevBundleApplies({ command: "serve", mode: "test" }, {})
        ).toBe(false);
    });
});

describe("the plugin's wiring", () => {
    const plugin: Plugin = cardSetsDevBundle();
    type Hook = (...args: unknown[]) => unknown;

    it("is gated by cardSetsDevBundleApplies — off here, under vitest, and in a build", () => {
        expect(typeof plugin.apply).toBe("function");
        const apply = plugin.apply as Hook;
        expect(apply({}, { command: "serve", mode: "development" })).toBe(
            false
        );
        expect(apply({}, { command: "build", mode: "production" })).toBe(false);
    });

    it("swaps the seam's chunk loader for the dev loader, and nothing else's", () => {
        (plugin.configResolved as Hook)({ root: ROOT });
        const resolveId = plugin.resolveId as Hook;
        const seam = path.join(ROOT, SET_MODULES_BROWSER_SEAM);
        expect(resolveId(SET_CHUNK_LOADER_SPECIFIER, `${seam}?import`)).toBe(
            `\0${CARD_SETS_DEV_LOADER}`
        );
        expect(
            resolveId(
                SET_CHUNK_LOADER_SPECIFIER,
                path.join(ROOT, "src/lib/catalogueArtifact.ts")
            )
        ).toBeNull();
        expect(resolveId(CARD_SETS_DEV_MODULE, seam)).toBe(
            `\0${CARD_SETS_DEV_MODULE}`
        );
        expect(resolveId("./registry", seam)).toBeNull();
    });

    it("serves the dev loader from the real Set list", async () => {
        (plugin.configResolved as Hook)({ root: ROOT });
        const load = plugin.load as Hook;
        const source = (await load(`\0${CARD_SETS_DEV_LOADER}`)) as string;
        expect(source).toContain('"5dn":"fifthDawn"');
        expect(source).toContain(`import("${CARD_SETS_DEV_MODULE}")`);
        expect(
            await load(path.join(ROOT, "convex/cards/registry.ts"))
        ).toBeNull();
    });
});
