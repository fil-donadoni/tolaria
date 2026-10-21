import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { globSync } from "tinyglobby";
import vitestConfig from "../../vitest.config";
import {
    botRelatedTests,
    botTests,
    fileNameLiterals,
    generalTests,
    moduleKey,
    reachIndex,
    relatedTests,
    reverseReach,
    shellFileNames,
    TEST_ALIASES,
    type BotProject,
    type ReachIndex,
    type RelatedProject,
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
    // An index.tsx barrel, a TypeScript-ESM `.js` specifier, a `?url` query.
    "src/comp/index.tsx": `export * from "./leaf";\n`,
    "src/comp/leaf.ts": `export const leaf = 1;\n`,
    "src/q/y.ts": `export * from "./z";\n`,
    "src/q/z.ts": `export const z = 1;\n`,
    "src/assets/pool.json": `{}\n`,
    "src/__tests__/barrel.test.tsx": `import { leaf } from "../comp";\nimport { z } from "../q/y.js";\nimport url from "../assets/pool.json?url";\n`,
    // A reader that opens its input through fs, by file name.
    "data/idx.json": `{}\n`,
    "scripts/lib/reads-idx.ts": `export const p = ["data", "idx.json"].join("/");\n`,
    "scripts/__tests__/reader.test.ts": `import { p } from "../lib/reads-idx";\n`,
    // A tooling test that spawns a script by path.
    "scripts/spawned.ts": `console.log(1);\n`,
    "scripts/__tests__/spawns.test.ts": `const S = ["..", "spawned.ts"];\n`,
    // A tooling test that spawns a shell driver, which runs a module by
    // path, which imports a lib (issue #5555): test → a.sh → b.ts → c.ts.
    "scripts/__tests__/drives.test.ts": `const D = join(ROOT, "scripts", "a.sh");\n`,
    "scripts/a.sh": `#!/bin/sh\n# prose: d.ts is not a call\nbun "$SCRIPT_DIR/b.ts" "$@"\n`,
    "scripts/b.ts": `import { c } from "./lib/c";\nconsole.log(c);\n`,
    "scripts/lib/c.ts": `export const c = 1;\n`,
    "scripts/d.ts": `console.log(1);\n`,
    // A census: walks a directory, imports nothing it reads (issue #5535).
    "scripts/__tests__/census.test.ts": `const d = fs.readdirSync("corpus");\n`,
    "corpus/notes.txt": `notes\n`,
    // The bot fast lane (issue #6149): a src bot test with a DOM marker
    // (bot-dom), a DOM-free one (bot-node, issue #6151), the ladder (its own
    // project, never walked), and a bot census over convex/corpus/.
    "src/lib/ai/__tests__/five.bot.test.ts": `import { m } from "../../../m";\ndocument.body;\n`,
    "src/lib/ai/__tests__/six.bot.test.ts": `import { m } from "../../../m";\n`,
    "src/lib/ai/selfplay/ladder.bot.test.ts": `import { m } from "../../../m";\n`,
    "convex/__tests__/census.bot.test.ts": `const d = fs.readdirSync("convex/corpus");\n`,
    "convex/corpus/rows.ts": `export const rows = [];\n`,
};

const CENSUS = [
    { test: "scripts/__tests__/census.test.ts", admits: /^corpus\// },
];

const BOT_CENSUS = [
    {
        test: "convex/__tests__/census.bot.test.ts",
        admits: /^convex\/corpus\//,
    },
];

let root: string;
let index: ReachIndex;
let botIndex: ReachIndex<BotProject>;

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "test-reach-"));
    for (const [rel, text] of Object.entries(FIXTURE)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), text);
    }
    index = reachIndex(root);
    botIndex = reachIndex(root, botTests(root));
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

describe("test-reach — the edges a plain import walk misses (issue #5464 review)", () => {
    it("follows an index.tsx barrel, a .js specifier naming a .ts file, and drops a ?url query", () => {
        for (const changed of [
            "src/comp/leaf.ts",
            "src/q/z.ts",
            "src/assets/pool.json",
        ])
            expect(relatedTests(index, [changed]).dom, changed).toEqual([
                "src/__tests__/barrel.test.tsx",
            ]);
    });

    it("a file-name literal is an edge: an fs reader and a spawned script", () => {
        expect(relatedTests(index, ["data/idx.json"])["node-tooling"]).toEqual([
            "scripts/__tests__/reader.test.ts",
        ]);
        expect(
            relatedTests(index, ["scripts/spawned.ts"])["node-tooling"]
        ).toEqual(["scripts/__tests__/spawns.test.ts"]);
    });
});

describe("test-reach — a spawned shell driver propagates reach (issue #5555)", () => {
    it("test → a.sh → b.ts: a diff on b.ts, or on what b.ts imports, plans the test", () => {
        for (const changed of [
            "scripts/a.sh",
            "scripts/b.ts",
            "scripts/lib/c.ts",
        ])
            expect(
                relatedTests(index, [changed])["node-tooling"],
                changed
            ).toEqual(["scripts/__tests__/drives.test.ts"]);
    });

    it("a name in a shell comment is not an edge", () => {
        expect(relatedTests(index, ["scripts/d.ts"])["node-tooling"]).toEqual(
            []
        );
    });

    it("shellFileNames reads bare and quoted words, drops directories, comments and test files", () => {
        const sh = [
            `#!/bin/sh`,
            `# runs gone.ts`,
            `_doctor="$SCRIPT_DIR/loop-doctor.ts"`,
            `bun scripts/lib/x.ts --flag # then y.ts`,
            `cat data/idx.json; echo "\${#arr[@]}"`,
            `bunx vitest run scripts/__tests__/z.test.ts`,
        ].join("\n");
        expect(shellFileNames(sh).sort()).toEqual([
            "idx.json",
            "loop-doctor.ts",
            "x.ts",
        ]);
    });

    it("live tree: a diff on the loop doctor alone plans the loop-drain prompt test (issue #5551)", () => {
        const live = reachIndex(resolve(__dirname, "../.."));
        expect(
            relatedTests(live, ["scripts/loop-doctor.ts"])["node-tooling"]
        ).toContain("scripts/__tests__/loop-drain-prompt.test.ts");
    });
});

/**
 * The project mirror (`generalTests`) against `vitest.config.ts` itself, on
 * the LIVE tree: a test the mirror places in the wrong project is a filter
 * that matches nothing (exit 1) or a test that silently never runs at land.
 */
describe("test-reach — a declared census is admitted by its corpus (issue #5535)", () => {
    it("a changed corpus path plans the census, which no import edge reaches", () => {
        expect(
            relatedTests(index, ["corpus/notes.txt"], CENSUS)["node-tooling"]
        ).toEqual(["scripts/__tests__/census.test.ts"]);
        expect(
            relatedTests(index, ["corpus/notes.txt"], [])["node-tooling"]
        ).toEqual([]);
    });

    it("a path outside the corpus does not admit it", () => {
        expect(
            relatedTests(index, ["scripts/lib/t.ts"], CENSUS)["node-tooling"]
        ).toEqual(["scripts/__tests__/t.test.ts"]);
    });

    it("a healthOnly census is never admitted", () => {
        const costly = [{ ...CENSUS[0], healthOnly: "20 s" }];
        expect(
            relatedTests(index, ["corpus/notes.txt"], costly)["node-tooling"]
        ).toEqual([]);
    });

    it("a census row naming no general test is never planned", () => {
        const ghost = [
            { test: "scripts/__tests__/ghost.test.ts", admits: /^corpus\// },
        ];
        expect(relatedTests(index, ["corpus/notes.txt"], ghost)).toEqual({
            "node-engine": [],
            "node-tooling": [],
            dom: [],
        });
    });
});

describe("test-reach — the bot fast lane is walked the same way (issue #6149)", () => {
    it("botTests holds every bot fast lane file in its project, never the ladder or a perf file", () => {
        expect(Object.fromEntries(botTests(root))).toEqual({
            "convex/__tests__/three.bot.test.ts": "bot-node",
            "convex/__tests__/census.bot.test.ts": "bot-node",
            "src/lib/ai/__tests__/five.bot.test.ts": "bot-dom",
            "src/lib/ai/__tests__/six.bot.test.ts": "bot-node",
        });
    });

    it("a module a bot test imports plans that bot file, in its project", () => {
        expect(botRelatedTests(botIndex, ["convex/x/b.ts"], [])).toEqual({
            "bot-node": ["convex/__tests__/three.bot.test.ts"],
            "bot-dom": [],
        });
        expect(botRelatedTests(botIndex, ["src/m.ts"], [])).toEqual({
            "bot-node": ["src/lib/ai/__tests__/six.bot.test.ts"],
            "bot-dom": ["src/lib/ai/__tests__/five.bot.test.ts"],
        });
    });

    it("a bot census is admitted when its watched tree changes, which no import edge reaches", () => {
        expect(
            botRelatedTests(botIndex, ["convex/corpus/rows.ts"], BOT_CENSUS)[
                "bot-node"
            ]
        ).toEqual(["convex/__tests__/census.bot.test.ts"]);
        expect(
            botRelatedTests(botIndex, ["convex/corpus/rows.ts"], [])["bot-node"]
        ).toEqual([]);
    });

    it("a census row of the other suite is planned by neither walk", () => {
        expect(botRelatedTests(botIndex, ["corpus/notes.txt"], CENSUS)).toEqual(
            { "bot-node": [], "bot-dom": [] }
        );
        expect(
            relatedTests(index, ["convex/corpus/rows.ts"], BOT_CENSUS)
        ).toEqual({ "node-engine": [], "node-tooling": [], dom: [] });
    });
});

describe("test-reach — the mirror equals vitest.config.ts (issue #5464 review)", () => {
    const ROOT = resolve(__dirname, "../..");
    interface Project {
        test?: { name?: string; include?: string[]; exclude?: string[] };
    }
    const config = vitestConfig as {
        resolve?: { alias?: Record<string, string> };
        test?: { projects?: Project[] };
    };

    it("every general project's files, project by project", () => {
        const mirror = generalTests(ROOT);
        for (const name of ["node-engine", "node-tooling", "dom"] as const) {
            const p = config.test!.projects!.find(
                (x) => x.test?.name === name
            )!;
            const files = globSync(p.test!.include!, {
                cwd: ROOT,
                ignore: p.test!.exclude ?? [],
            }).sort();
            const mirrored = [...mirror]
                .filter(([, proj]) => proj === (name as RelatedProject))
                .map(([f]) => f)
                .sort();
            expect(mirrored, name).toEqual(files);
        }
    });

    it("every bot fast lane project's files, project by project (issue #6149)", () => {
        const mirror = botTests(ROOT);
        for (const name of ["bot-node", "bot-dom"] as const) {
            const p = config.test!.projects!.find(
                (x) => x.test?.name === name
            )!;
            const files = globSync(p.test!.include!, {
                cwd: ROOT,
                ignore: p.test!.exclude ?? [],
            }).sort();
            const mirrored = [...mirror]
                .filter(([, proj]) => proj === name)
                .map(([f]) => f)
                .sort();
            expect(mirrored, name).toEqual(files);
        }
    });

    it("TEST_ALIASES equals resolve.alias", () => {
        const alias = config.resolve!.alias!;
        expect(
            Object.fromEntries(
                TEST_ALIASES.map(({ find, replacement }) => [
                    String(find),
                    resolve(ROOT, replacement),
                ])
            )
        ).toEqual(alias);
    });
});

describe("test-reach — file-name literals are narrowed so a hub cannot drag the suite in", () => {
    it("ignores comments, test-file names, and module names outside a test", () => {
        const hub = [
            `// see card-utils.test.ts and "notes.txt"`,
            `/* "old.json" */`,
            `const a = "pool.json";`,
            `const b = "gate.ts";`,
            `const c = "other.test.ts";`,
        ].join("\n");
        expect(fileNameLiterals(hub, false)).toEqual(["pool.json"]);
        expect(fileNameLiterals(hub, true).sort()).toEqual([
            "gate.ts",
            "pool.json",
        ]);
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
