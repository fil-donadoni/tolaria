import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
    moduleKey,
    reachIndex,
    relatedTests,
    reverseReach,
    type ReachIndex,
} from "../lib/test-reach";

/**
 * Issue #5464 / ADR 0154 §2 — the import-graph walk `check:lane` scopes the
 * `engine` and `skin` vitest runs by. A FIXTURE REPO on disk, never the live
 * tree: the assertions pin what the walk does, not what it happens to find
 * today.
 */

const FIXTURE: Record<string, string> = {
    // node-engine: a two-hop chain, an alias import, a deleted module.
    "convex/x/a.ts": `import { b } from "./b";\nexport const a = b;\n`,
    "convex/x/b.ts": `export const b = 1;\n`,
    "convex/x/c.ts": `export const c = 2;\n`,
    "convex/x/lonely.ts": `export const lonely = 3;\n`,
    "convex/__tests__/one.test.ts": `import { a } from "../x/a";\n`,
    "convex/__tests__/two.test.ts": `import { c } from "@convex/x/c";\nimport "../x/gone";\n`,
    // Never a related test: bot and perf belong to no general project.
    "convex/__tests__/three.bot.test.ts": `import { a } from "../x/a";\n`,
    "convex/__tests__/four.perf.test.ts": `import { a } from "../x/a";\n`,
    // dom: reached only through a vi.mock specifier.
    "src/m.ts": `export const m = 1;\n`,
    "src/__tests__/v.test.tsx": `import { vi } from "vitest";\nvi.mock("../m");\n`,
    // node-tooling: reaches nothing under convex/ or data/.
    "scripts/lib/t.ts": `export const t = 1;\n`,
    "scripts/__tests__/t.test.ts": `import { t } from "../lib/t";\n`,
};

let root: string;
let index: ReachIndex;

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "test-reach-"));
    for (const [rel, text] of Object.entries(FIXTURE)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), text);
    }
    index = reachIndex(root);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("test-reach — the tests a diff reaches through the import graph (issue #5464)", () => {
    it("a module imported by exactly one test plans that one file, in its project", () => {
        expect(relatedTests(index, ["convex/x/a.ts"])).toEqual({
            "node-engine": ["convex/__tests__/one.test.ts"],
            "node-tooling": [],
            dom: [],
        });
    });

    it("follows the closure transitively (b ← a ← one.test)", () => {
        expect(relatedTests(index, ["convex/x/b.ts"])["node-engine"]).toEqual([
            "convex/__tests__/one.test.ts",
        ]);
    });

    it("resolves the @convex alias", () => {
        expect(relatedTests(index, ["convex/x/c.ts"])["node-engine"]).toEqual([
            "convex/__tests__/two.test.ts",
        ]);
    });

    it("a deleted module still reaches the test that imports it", () => {
        expect(
            relatedTests(index, ["convex/x/gone.ts"])["node-engine"]
        ).toEqual(["convex/__tests__/two.test.ts"]);
    });

    it("a vi.mock specifier is a dependency, and a .tsx src test is dom", () => {
        expect(relatedTests(index, ["src/m.ts"])).toEqual({
            "node-engine": [],
            "node-tooling": [],
            dom: ["src/__tests__/v.test.tsx"],
        });
    });

    it("a scripts test that reaches no engine path is node-tooling", () => {
        expect(
            relatedTests(index, ["scripts/lib/t.ts"])["node-tooling"]
        ).toEqual(["scripts/__tests__/t.test.ts"]);
    });

    it("a test file in the diff is related to itself", () => {
        expect(
            relatedTests(index, ["convex/__tests__/two.test.ts"])["node-engine"]
        ).toEqual(["convex/__tests__/two.test.ts"]);
    });

    it("a module no test imports reaches nothing — bot and perf tests never count", () => {
        for (const changed of [["convex/x/lonely.ts"], ["public/img/x.png"]])
            expect(relatedTests(index, changed), changed[0]).toEqual({
                "node-engine": [],
                "node-tooling": [],
                dom: [],
            });
        // a.ts IS imported by three.bot.test.ts and four.perf.test.ts.
        expect(
            relatedTests(index, ["convex/x/a.ts"])["node-engine"]
        ).not.toContain("convex/__tests__/three.bot.test.ts");
    });
});

describe("test-reach — the pure core", () => {
    it("reverseReach terminates on a cycle and returns only tests", () => {
        const graph: Record<string, string[]> = {
            t1: ["a"],
            a: ["b"],
            b: ["a"],
            t2: ["c"],
        };
        expect(
            reverseReach(["t1", "t2"], (k) => graph[k] ?? [], ["b"])
        ).toEqual(["t1"]);
    });

    it("moduleKey drops the module extension and a trailing /index", () => {
        expect(moduleKey("convex/x/a.ts")).toBe("convex/x/a");
        expect(moduleKey("src/y/index.tsx")).toBe("src/y");
        expect(moduleKey("data/z.json")).toBe("data/z.json");
    });
});
