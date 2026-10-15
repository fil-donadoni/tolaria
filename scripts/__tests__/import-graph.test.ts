// The static import graph `check:ui` scopes its surfaces with (issue #3627).
// Asserted over a fixture tree on disk: what a caller observes is which files a
// closure contains, never how the edges are stored.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";
import type { Plugin } from "vite";
import {
    APP_ALIASES,
    BROWSER_SEAMS,
    createImportGraph,
    importSpecifiers,
    typeOnlySpecifiers,
    type ImportAlias,
} from "../lib/import-graph";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function fixtureTree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "import-graph-"));
    for (const [rel, body] of Object.entries(files)) {
        fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
    }
    roots.push(root);
    return root;
}
const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("importSpecifiers", () => {
    it("finds static, re-export, side-effect, dynamic and worker-URL specifiers — and no type-only import (issue #4913)", () => {
        const source = [
            `import a from "./a";`,
            `import {`,
            `    b,`,
            `    type C,`,
            `} from "~/b";`,
            `import type { D } from "./d";`,
            `export type { D2 } from "./d2";`,
            `export { e } from "./e";`,
            `export * from "./f";`,
            `import "./g.css";`,
            `const h = await import(`,
            `    "~/lib/h"`,
            `);`,
            `new Worker(new URL("./i.worker.ts", import.meta.url));`,
            `const notLiteral = import(name);`,
        ].join("\n");
        expect(importSpecifiers(source).sort()).toEqual(
            [
                "./a",
                "~/b",
                "./e",
                "./f",
                "./g.css",
                "~/lib/h",
                "./i.worker.ts",
            ].sort()
        );
        expect(typeOnlySpecifiers(source).sort()).toEqual(["./d", "./d2"]);
    });

    it("a module named both ways is a runtime import, not a type-only one", () => {
        const source = [
            `import type { A } from "./a";`,
            `import { a } from "./a";`,
            `export type { B } from "./b";`,
        ].join("\n");
        expect(importSpecifiers(source)).toEqual(["./a"]);
        expect(typeOnlySpecifiers(source)).toEqual(["./b"]);
    });
});

describe("createImportGraph — closureOf", () => {
    const root = fixtureTree({
        "src/routes/a.route.tsx": `import { Panel } from "../components/panel";\nimport Viewer from "~/components/viewer";\n`,
        "src/components/panel.tsx": `export * from "./panel-body";\n`,
        "src/components/panel-body.tsx": `import "./panel.css";\nexport const Panel = 1;\n`,
        "src/components/panel.css": `.x{}`,
        "src/components/viewer/index.tsx": `const lazy = () => import("@/lib/builder");\nexport default lazy;\n`,
        "src/lib/chunk-loader.ts":
            "export const load = (code: string) => import(`../../convex/cards/sets/${code}/index.cards.ts`);\n",
        "convex/cards/sets/lea/index.cards.ts": `export const lea = 1;\n`,
        "convex/cards/sets/leb/index.cards.ts": `export const leb = 1;\n`,
        "convex/cards/sets/leb/red.cards.ts": `export const red = 1;\n`,
        "convex/cards/sets/notes.txt": `not a module`,
        "src/lib/builder.ts": `import { rules } from "@convex/gre/rules";\nexport const b = rules;\n`,
        "convex/gre/rules.ts": `import data from "../../data/rules.json";\nexport const rules = data;\n`,
        "data/rules.json": `{}`,
        "src/components/unrelated.tsx": `export const U = 1;\n`,
        "src/routes/b.route.tsx": `import { U } from "../components/unrelated.js";\nimport React from "react";\nimport type { Shape } from "../components/shape";\n`,
        "src/components/shape.ts": `import { deep } from "./deep";\nexport type Shape = typeof deep;\n`,
        "src/components/deep.ts": `export const deep = 1;\n`,
    });
    const graph = createImportGraph({ root });

    it("follows resolved relative imports, including re-exports and a directory index", () => {
        const closure = graph.closureOf("src/routes/a.route.tsx");
        expect(closure).toContain("src/components/panel.tsx");
        expect(closure).toContain("src/components/panel-body.tsx");
        expect(closure).toContain("src/components/panel.css");
        expect(closure).toContain("src/components/viewer/index.tsx");
    });

    it("follows the app's path aliases (~, @, @convex)", () => {
        const closure = graph.closureOf("src/routes/a.route.tsx");
        expect(closure).toContain("convex/gre/rules.ts");
        expect(closure).toContain("data/rules.json");
    });

    it("follows a dynamic import() with a literal specifier", () => {
        expect(graph.closureOf("src/components/viewer/index.tsx")).toContain(
            "src/lib/builder.ts"
        );
    });

    it("fans a template import(`…${x}…`) out to every file it matches on disk — one edge per Set chunk (issue #5615)", () => {
        expect(
            importSpecifiers(
                "import(`../../convex/cards/sets/${code}/index.cards.ts`)"
            )
        ).toEqual(["../../convex/cards/sets/*/index.cards.ts"]);
        const closure = graph.closureOf("src/lib/chunk-loader.ts");
        expect([...closure].sort()).toEqual([
            "convex/cards/sets/lea/index.cards.ts",
            "convex/cards/sets/leb/index.cards.ts",
            "src/lib/chunk-loader.ts",
        ]);
        // On demand, like a literal import(): not part of the static closure.
        expect(
            graph.closureOf("src/lib/chunk-loader.ts", { staticOnly: true })
        ).toEqual(new Set(["src/lib/chunk-loader.ts"]));
    });

    it("resolves a `.js` specifier to its `.ts(x)` source and ignores bare packages", () => {
        expect([...graph.closureOf("src/routes/b.route.tsx")].sort()).toEqual([
            "src/components/unrelated.tsx",
            "src/routes/b.route.tsx",
        ]);
    });

    it("does not follow a type-only import, unless asked to (issue #4913)", () => {
        const runtime = graph.closureOf("src/routes/b.route.tsx");
        expect(runtime).not.toContain("src/components/shape.ts");
        expect(runtime).not.toContain("src/components/deep.ts");
        expect(graph.typeImportsOf("src/routes/b.route.tsx")).toEqual([
            "src/components/shape.ts",
        ]);
        const typed = graph.closureOf("src/routes/b.route.tsx", {
            types: true,
        });
        expect(typed).toContain("src/components/shape.ts");
        // Followed through: `shape.ts` imports `deep.ts` at runtime, and the
        // type-inclusive closure keeps walking past a type-only edge.
        expect(typed).toContain("src/components/deep.ts");
    });

    it("does not reach a module nothing imports", () => {
        expect(graph.closureOf("src/routes/a.route.tsx")).not.toContain(
            "src/components/unrelated.tsx"
        );
    });

    it("prunes without traversing, and never prunes the entry", () => {
        const closure = graph.closureOf("src/routes/a.route.tsx", {
            prune: (p) =>
                p === "src/components/panel.tsx" || p.endsWith(".route.tsx"),
        });
        expect(closure).toContain("src/routes/a.route.tsx");
        expect(closure).not.toContain("src/components/panel.tsx");
        expect(closure).not.toContain("src/components/panel-body.tsx");
    });
});

describe("createImportGraph — static closure and seams (issue #5584)", () => {
    const root = fixtureTree({
        "src/routes/setup.route.tsx": `import { dialog } from "../dialog";\nimport { rules } from "@convex/formats";\n`,
        "src/dialog.ts": `export const dialog = () => import("./parser");\nconst w = new Worker(new URL("./worker.ts", import.meta.url));\n`,
        "src/parser.ts": `export const parse = 1;\n`,
        "src/worker.ts": `export const w = 1;\n`,
        "convex/formats.ts": `import { meta } from "./cards";\nexport const rules = meta;\n`,
        "convex/cards/index.ts": `export const meta = 1;\n`,
        "src/stub.ts": `export const meta = null;\n`,
    });

    it("a static closure leaves out import() and new URL(…, import.meta.url)", () => {
        const graph = createImportGraph({ root });
        const all = graph.closureOf("src/routes/setup.route.tsx");
        expect(all).toContain("src/parser.ts");
        expect(all).toContain("src/worker.ts");
        const statics = graph.closureOf("src/routes/setup.route.tsx", {
            staticOnly: true,
        });
        expect(statics).toContain("src/dialog.ts");
        expect(statics).not.toContain("src/parser.ts");
        expect(statics).not.toContain("src/worker.ts");
    });

    it("a seam substitutes one importer's specifier, and only when passed", () => {
        const plain = createImportGraph({ root });
        expect(plain.closureOf("src/routes/setup.route.tsx")).toContain(
            "convex/cards/index.ts"
        );
        const seamed = createImportGraph({
            root,
            seams: [
                {
                    importer: "convex/formats.ts",
                    specifier: "./cards",
                    replacement: "src/stub.ts",
                },
            ],
        });
        const closure = seamed.closureOf("src/routes/setup.route.tsx");
        expect(closure).toContain("src/stub.ts");
        expect(closure).not.toContain("convex/cards/index.ts");
    });
});

describe("APP_ALIASES", () => {
    it("is vite.config.ts's resolve.alias, in order, made repo-relative", () => {
        const vite = (viteConfig.resolve?.alias ?? []) as ImportAlias[];
        const normalised = vite.map(({ find, replacement }) => ({
            find: String(find),
            replacement: path.relative(REPO_ROOT, replacement),
        }));
        expect(normalised).toEqual(
            APP_ALIASES.map(({ find, replacement }) => ({
                find: String(find),
                replacement,
            }))
        );
    });
});

describe("BROWSER_SEAMS", () => {
    it("is what vite.config.ts's resolveId plugins return for each seam (issue #5584)", () => {
        const plugins = (viteConfig.plugins ?? []).flat() as Plugin[];
        type ResolveId = (source: string, importer?: string) => unknown;
        const resolve = (source: string, importer: string) =>
            plugins
                .map((p) =>
                    typeof p?.resolveId === "function"
                        ? (p.resolveId as ResolveId)(source, importer)
                        : null
                )
                .find((r) => typeof r === "string") as string | undefined;
        expect(BROWSER_SEAMS.length).toBeGreaterThan(0);
        for (const seam of BROWSER_SEAMS) {
            const resolved = resolve(
                seam.specifier,
                path.join(REPO_ROOT, seam.importer)
            );
            expect(resolved && path.relative(REPO_ROOT, resolved)).toBe(
                seam.replacement
            );
        }
    });
});
