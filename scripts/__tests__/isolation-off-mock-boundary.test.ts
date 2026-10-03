import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import picomatch from "picomatch";
import ts from "typescript";
import vitestConfig from "../../vitest.config";
import bladeConfig from "../../vitest.blade.config";

/**
 * Module-mock boundary for the `isolate: false` projects (issue #5020).
 *
 * `node-engine`, `node-tooling`, `bot-node` and the blade suite run with
 * per-file isolation OFF — the import-cost lever of issue #811 / PR #815 /
 * PR #1475: one module registry per worker, so the ~290-module card catalogue
 * is evaluated once per worker instead of once per file. The price is that a
 * MODULE mock (`vi.mock` / `vi.doMock`) binds nothing once an earlier file in
 * the same worker has imported its target: the importers keep the original.
 * The test is green alone and wrong beside a neighbour — observed in issue
 * #4460 (an SBA/RNG mock counted zero beside the search bot test) and issue
 * #5001 (the search cost fixture's mocks missed every call from a module the
 * shared setup file had already loaded).
 *
 * The `src` side already has its rule: `scripts/test-env-split.ts` routes a
 * `src` file that mocks a module to the isolated `dom` project. This is the
 * `convex` / `scripts` side, which had only a config comment claiming the
 * mocks did not exist.
 *
 * ALLOWED: a namespace `vi.spyOn` restored in `afterEach`. It patches the
 * shared namespace object at run time, which every importer reads through, so
 * it works whatever the import order (`convex/gre/__tests__/
 * searchCost.bot.test.ts`). Observing through state — a canary — needs no
 * vitest API at all.
 *
 * Membership is read from the configs' own `include` / `exclude` globs, as
 * vitest decides it (`perf-test-boundary.test.ts`'s shape): a hard-coded
 * directory list drifts. The detector reads the AST, so a mock named only in
 * a comment or a string literal — `convex-cards-barrel-mock.test.ts` quotes
 * one — does not trip it, and the specimens below are built at runtime so
 * this file does not flag itself.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Directories worth walking — everything else holds no test files. */
const SCAN_ROOTS = ["convex", "scripts", "src"];

/** The `vi.*` calls that replace a MODULE rather than patch a namespace. */
const MODULE_MOCK_CALLS = new Set(["mock", "doMock"]);

/** Cheap text pre-filter: only a file that passes is parsed. */
const MAY_MOCK_RE = /\bvi\s*\.\s*(?:mock|doMock)\b/;

/** Every module-mock CALL in `source` (never a comment or a string). */
function moduleMockCalls(source: string): { line: number; call: string }[] {
    if (!MAY_MOCK_RE.test(source)) return [];
    const sf = ts.createSourceFile(
        "specimen.ts",
        source,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TSX
    );
    const hits: { line: number; call: string }[] = [];
    const visit = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === "vi" &&
            MODULE_MOCK_CALLS.has(node.expression.name.text)
        ) {
            hits.push({
                line:
                    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line +
                    1,
                call: `vi.${node.expression.name.text}`,
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return hits;
}

// ─── membership ─────────────────────────────────────────────────────────────

interface ProjectTest {
    name?: string;
    include?: string[];
    exclude?: string[];
    isolate?: boolean;
    setupFiles?: string | string[];
}

const allProjects: ProjectTest[] = [
    ...(
        (vitestConfig as { test?: { projects?: { test?: ProjectTest }[] } })
            .test?.projects ?? []
    ).map((p) => p.test ?? {}),
    (bladeConfig as { test?: ProjectTest }).test ?? {},
];

/** The projects that share one module registry per worker. */
const isolationOff = allProjects.filter((p) => p.isolate === false);

function selectedBy(project: ProjectTest, file: string): boolean {
    return (
        (project.include ?? []).some((g) => picomatch(g)(file)) &&
        !(project.exclude ?? []).some((g) => picomatch(g)(file))
    );
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

/** Every file an isolation-off project selects, repo-relative, posix. */
function isolationOffFiles(): string[] {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
        const abs = path.join(REPO_ROOT, root);
        if (!fs.existsSync(abs)) continue;
        for (const f of walk(abs)) {
            if (!/\.(test|spec)\.tsx?$/.test(f)) continue;
            const rel = path.relative(REPO_ROOT, f).split(path.sep).join("/");
            if (isolationOff.some((p) => selectedBy(p, rel))) files.push(rel);
        }
    }
    // A setup file runs before every file of its project, so a mock there
    // reaches the whole project — scanned like the files it precedes.
    for (const p of isolationOff) {
        for (const setup of [p.setupFiles ?? []].flat()) {
            files.push(path.posix.normalize(setup));
        }
    }
    return [...new Set(files)].sort();
}

describe("isolation-off projects mock no module (issue #5020)", () => {
    it("reads the isolation-off projects from the configs (an empty list would pass vacuously)", () => {
        expect(isolationOff.map((p) => p.name)).toEqual(
            expect.arrayContaining(["node-engine", "bot-node", "blade"])
        );
    });

    it("selects test files at all (an empty walk would pass vacuously)", () => {
        expect(isolationOffFiles().length).toBeGreaterThan(1000);
    });

    it("no file selected by an isolation-off project calls vi.mock / vi.doMock", () => {
        const violations: string[] = [];
        for (const file of isolationOffFiles()) {
            const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");
            for (const hit of moduleMockCalls(source)) {
                violations.push(`${file}:${hit.line}  ${hit.call}(…)`);
            }
        }
        expect(
            violations,
            `These files run in a project with \`isolate: false\` (one module ` +
                `registry per worker), where a module mock binds nothing once ` +
                `an earlier file in the worker has imported its target — green ` +
                `alone, wrong beside a neighbour (issue #4460, issue #5001). ` +
                `Observe through a namespace \`vi.spyOn\` restored in ` +
                `\`afterEach\`, or through state (a canary); or move the file to ` +
                `an isolated project:\n` +
                violations.join("\n")
        ).toEqual([]);
    });
});

describe("the module-mock detector", () => {
    // Built at runtime, never as literals: this file is itself walked by the
    // scan above, and a literal specimen would make the guard flag its own
    // fixture. Same trick as perf-test-boundary.test.ts.
    const vi = "vi";
    const mock = `${vi}.${"mock"}`;
    const doMock = `${vi}.${"doMock"}`;

    it("flags a vi.mock and a vi.doMock call", () => {
        expect(moduleMockCalls(`${mock}("node:fs");`)).toEqual([
            { line: 1, call: "vi.mock" },
        ]);
        expect(
            moduleMockCalls(
                `it("x", async () => {\n    ${doMock}("./a", () => ({}));\n});`
            )
        ).toEqual([{ line: 2, call: "vi.doMock" }]);
    });

    it("passes a namespace vi.spyOn", () => {
        expect(
            moduleMockCalls(
                `import * as sba from "./sba";\n${vi}.spyOn(sba, "applySBAs");`
            )
        ).toEqual([]);
    });

    it("ignores a mock named only in a comment or a string", () => {
        expect(
            moduleMockCalls(
                [
                    `// ${mock}("@convex/cards") would bind nothing here`,
                    `/* ${doMock}("./a") */`,
                    `const needle = '${mock}("@convex/cards"';`,
                    `const tpl = \`${mock}("x")\`;`,
                    `const re = /${vi}\\.mock\\(/;`,
                ].join("\n")
            )
        ).toEqual([]);
    });
});
