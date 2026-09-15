// The static import graph `check:ui` scopes its surfaces with (issue #3627).
// Asserted over a fixture tree on disk: what a caller observes is which files a
// closure contains, never how the edges are stored.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";
import {
    APP_ALIASES,
    createImportGraph,
    importSpecifiers,
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
    it("finds static, re-export, side-effect, dynamic and worker-URL specifiers", () => {
        const source = [
            `import a from "./a";`,
            `import {`,
            `    b,`,
            `    type C,`,
            `} from "~/b";`,
            `import type { D } from "./d";`,
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
                "./d",
                "./e",
                "./f",
                "./g.css",
                "~/lib/h",
                "./i.worker.ts",
            ].sort()
        );
    });
});

describe("createImportGraph — closureOf", () => {
    const root = fixtureTree({
        "src/routes/a.route.tsx": `import { Panel } from "../components/panel";\nimport Viewer from "~/components/viewer";\n`,
        "src/components/panel.tsx": `export * from "./panel-body";\n`,
        "src/components/panel-body.tsx": `import "./panel.css";\nexport const Panel = 1;\n`,
        "src/components/panel.css": `.x{}`,
        "src/components/viewer/index.tsx": `const lazy = () => import("@/lib/builder");\nexport default lazy;\n`,
        "src/lib/builder.ts": `import { rules } from "@convex/gre/rules";\nexport const b = rules;\n`,
        "convex/gre/rules.ts": `import data from "../../data/rules.json";\nexport const rules = data;\n`,
        "data/rules.json": `{}`,
        "src/components/unrelated.tsx": `export const U = 1;\n`,
        "src/routes/b.route.tsx": `import { U } from "../components/unrelated.js";\nimport React from "react";\n`,
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

    it("resolves a `.js` specifier to its `.ts(x)` source and ignores bare packages", () => {
        expect([...graph.closureOf("src/routes/b.route.tsx")].sort()).toEqual([
            "src/components/unrelated.tsx",
            "src/routes/b.route.tsx",
        ]);
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
