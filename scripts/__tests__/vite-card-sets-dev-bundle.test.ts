import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
    CARD_SETS_DEV_MODULE,
    CATALOGUE_MODULE,
    SETS_DIR,
    bundleCardSets,
    cardSetsDevBundleApplies,
    rewriteCatalogueSetImports,
} from "../lib/vite-card-sets-dev-bundle";

/**
 * The dev server's one-module card catalogue (issue #5597). Three things must
 * hold for the bundle to be the SAME catalogue the app would have loaded file
 * by file: the catalogue's Set imports are all rewritten, and nothing else in
 * it moves; the bundle folds in Set modules and ONLY Set modules (anything
 * else stays an external URL — one module instance with the engine); and the
 * plugin never runs where a test compares a Set export by identity.
 */

const ROOT = path.resolve(__dirname, "../..");
const catalogueSource = readFileSync(path.join(ROOT, CATALOGUE_MODULE), "utf8");
const SET_IMPORT =
    /^import \* as \w+ from "\.\/sets\/[a-z0-9]+\/index\.cards";$/gm;

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

    it("throws when a Set module is named some other way, which would load it twice", () => {
        const source = [
            `import * as lea from "./sets/lea/index.cards";`,
            `import { airElemental } from "./sets/lea/blue.cards";`,
        ].join("\n");
        expect(() => rewriteCatalogueSetImports(source)).toThrow(
            /would load that module twice/
        );
    });
});

describe("bundleCardSets — the Set boundary, over the real tree", () => {
    const setsRoot = path.join(ROOT, SETS_DIR) + path.sep;
    const bundled = bundleCardSets(
        ROOT,
        rewriteCatalogueSetImports(catalogueSource).sets
    );

    it("folds in Set modules only, and keeps everything else an external root-relative URL", async () => {
        const { modules, externals } = await bundled;
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
        const { code } = await bundled;
        const declared = (dir: string): number =>
            readdirSync(dir, { withFileTypes: true }).reduce(
                (n, entry) =>
                    entry.name === "__tests__"
                        ? n
                        : entry.isDirectory()
                          ? n + declared(path.join(dir, entry.name))
                          : entry.name.endsWith(".ts")
                            ? n +
                              (
                                  readFileSync(
                                      path.join(dir, entry.name),
                                      "utf8"
                                  ).match(/\bdefineCard\(/g) ?? []
                              ).length
                            : n,
                0
            );
        const inBundle = (code.match(/\bdefineCard\(/g) ?? []).length;
        expect(inBundle).toBe(declared(path.join(ROOT, SETS_DIR)));
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
