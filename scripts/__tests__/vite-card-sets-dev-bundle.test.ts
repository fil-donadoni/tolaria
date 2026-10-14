import { beforeAll, describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { createImportGraph } from "../lib/import-graph";
import {
    CARD_SETS_DEV_MODULE,
    CATALOGUE_MODULE,
    SETS_DIR,
    bundleCardSets,
    cardSetsDevBundle,
    cardSetsDevBundleApplies,
    rewriteCatalogueSetImports,
    type CardSetsBundle,
} from "../lib/vite-card-sets-dev-bundle";

/**
 * The dev server's one-module card catalogue (issue #5597). Four things must
 * hold for the bundle to be the SAME catalogue the app would have loaded file
 * by file: the catalogue's Set imports are all rewritten, and nothing else in
 * it moves; the bundle folds in Set modules and ONLY Set modules (anything
 * else stays an external URL — one module instance with the engine); no other
 * module imports a Set (it would load a second instance beside the bundle's);
 * and the plugin never runs where a test compares a Set export by identity.
 */

const ROOT = path.resolve(__dirname, "../..");
const catalogueSource = readFileSync(path.join(ROOT, CATALOGUE_MODULE), "utf8");
const SET_IMPORT =
    /^import \* as \w+ from "\.\/sets\/[a-z0-9]+\/index\.cards";$/gm;

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

describe("rewriteCatalogueSetImports — the real catalogue", () => {
    const { code, sets } = rewriteCatalogueSetImports(catalogueSource);

    it("rewrites every Set import into ONE import of the virtual module", () => {
        expect(sets.length).toBe(catalogueSource.match(SET_IMPORT)!.length);
        expect(code).not.toMatch(/["']\.\/sets\//);
        const virtualImports = code.match(
            new RegExp(`from "${CARD_SETS_DEV_MODULE}";`, "g")
        );
        expect(virtualImports).toHaveLength(1);
        for (const { name } of sets) {
            expect(code).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b`));
        }
    });

    it("preserves every line number — the rest of the module does not move", () => {
        expect(code.split("\n")).toHaveLength(
            catalogueSource.split("\n").length
        );
        const untouched = (src: string) =>
            src
                .split("\n")
                .filter(
                    (line) =>
                        !/\.\/sets\/|tolaria-card-sets/.test(line) &&
                        line !== ""
                );
        expect(untouched(code)).toEqual(untouched(catalogueSource));
    });
});

describe("rewriteCatalogueSetImports — refusals", () => {
    it("throws when the catalogue has no Set import to rewrite", () => {
        expect(() =>
            rewriteCatalogueSetImports(`import { x } from "./registry";\n`)
        ).toThrow(/no longer recognises it/);
    });

    it.each([
        `import { airElemental } from "./sets/lea/blue.cards";`,
        `import "./sets/lea/index.cards";`,
        `const lazy = () => import("./sets/lea/index.cards");`,
        "const all = import.meta.glob(`./sets/*/index.cards.ts`);",
    ])(
        "throws when a Set module is named some other way, which would load it twice: %s",
        (other) => {
            const source = [
                `import * as lea from "./sets/lea/index.cards";`,
                other,
            ].join("\n");
            expect(() => rewriteCatalogueSetImports(source)).toThrow(
                /would load that module twice/
            );
        }
    );
});

describe("the catalogue is the only importer of a Set module", () => {
    it("no other convex/ or src/ module imports one, statically or not", () => {
        const graph = createImportGraph({ root: ROOT });
        const setsPrefix = `${SETS_DIR}/`;
        const importers = ["convex", "src"]
            .flatMap((top) =>
                sourceFiles(path.join(ROOT, top), [".ts", ".tsx"])
            )
            .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
            .filter(
                (rel) =>
                    !rel.startsWith(setsPrefix) &&
                    rel !== CATALOGUE_MODULE &&
                    !/\.test\.tsx?$/.test(rel)
            )
            .filter((rel) =>
                graph.importsOf(rel).some((dep) => dep.startsWith(setsPrefix))
            );
        expect(importers).toEqual([]);
    });
});

describe("bundleCardSets — the Set boundary, over the real tree", () => {
    const setsRoot = path.join(ROOT, SETS_DIR) + path.sep;
    let bundled: CardSetsBundle;
    beforeAll(async () => {
        bundled = await bundleCardSets(
            ROOT,
            rewriteCatalogueSetImports(catalogueSource).sets
        );
    });

    it("folds in Set modules only, and keeps everything else an external root-relative URL", () => {
        const { modules, externals } = bundled;
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

    it("carries every hand-written definition the Set sources declare", () => {
        const DECLARATION = /=\s*defineCard\(/g;
        const declared = sourceFiles(path.join(ROOT, SETS_DIR)).reduce(
            (n, file) =>
                n +
                (readFileSync(file, "utf8").match(DECLARATION) ?? []).length,
            0
        );
        expect((bundled.code.match(DECLARATION) ?? []).length).toBe(declared);
    });

    it("watches every Set source file — the empty shims included — and no test", () => {
        expect([...bundled.watched].sort()).toEqual(
            sourceFiles(path.join(ROOT, SETS_DIR)).sort()
        );
    });

    it("maps back to the Set sources by the URL the dev server serves them under", () => {
        const map = JSON.parse(bundled.map) as {
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

    it("rewrites the catalogue module, whatever its query, and nothing else", () => {
        (plugin.configResolved as Hook)({ root: ROOT });
        const transform = plugin.transform as Hook;
        const catalogue = path.join(ROOT, CATALOGUE_MODULE);
        const rewritten = transform(catalogueSource, `${catalogue}?import`) as {
            code: string;
        };
        expect(rewritten.code).toContain(`from "${CARD_SETS_DEV_MODULE}";`);
        expect(
            transform(
                catalogueSource,
                path.join(ROOT, "convex/cards/registry.ts")
            )
        ).toBeNull();
    });
});
