import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { VITEST_FS_CACHE_ENV } from "../lib/vitest-fs-cache";

/**
 * vitest's filesystem module cache never serves a stale transform (issue
 * #4614). The cache is ON for every bare `bunx vitest run <path>`, so a hole
 * here is a green targeted run over code that no longer exists.
 *
 * A child vitest runs a fixture project whose config takes the cache options
 * from `fsModuleCacheOptions` — the same call both repo configs make — and
 * whose shape mirrors the node setup: a setup file reaching a module only
 * transitively (setup → mid → deep, as setup → catalogue → constants), a lib
 * the test imports directly, and a `define` constant standing in for
 * `__BUILD_COMMIT__`. A logging plugin records every transform, which is how
 * the suite proves the cache is WARM (a warm run transforms nothing) before
 * it trusts a red: an invalidation case over a cold cache proves nothing.
 */
const ROOT = resolve(__dirname, "../..");
const VITEST = join(ROOT, "node_modules", ".bin", "vitest");
const FS_CACHE_LIB = join(ROOT, "scripts", "lib", "vitest-fs-cache.ts");

let dir: string;

const FILES = {
    "lib.js": "export const v = 1;\n",
    "mid.js": 'export { deep } from "./deep.js";\n',
    "deep.js": "export const deep = 1;\n",
    "setup.js":
        'import { deep } from "./mid.js";\nglobalThis.deepValue = deep;\n',
    "fx.test.js": [
        'import { v } from "./lib.js";',
        'test("lib", () => expect(v).toBe(1));',
        'test("deep", () => expect(globalThis.deepValue).toBe(1));',
        'test("commit", () => expect(__BUILD_COMMIT__).toBe(process.env.EXPECT_COMMIT));',
        "",
    ].join("\n"),
} as const;
type FixtureFile = keyof typeof FILES;

function config(): string {
    return [
        'import { appendFileSync } from "node:fs";',
        `import { fsModuleCacheOptions } from ${JSON.stringify(FS_CACHE_LIB)};`,
        "export default {",
        "    define: { __BUILD_COMMIT__: JSON.stringify(process.env.FIXTURE_COMMIT) },",
        "    plugins: [{",
        '        name: "transform-log",',
        "        transform(_code: string, id: string) {",
        `            if (id.startsWith(${JSON.stringify(dir)})) appendFileSync(${JSON.stringify(join(dir, "transforms.log"))}, id + "\\n");`,
        "        },",
        "    }],",
        "    test: {",
        "        ...fsModuleCacheOptions(process.env),",
        "        globals: true,",
        '        setupFiles: ["./setup.js"],',
        '        include: ["fx.test.js"],',
        "    },",
        "};",
        "",
    ].join("\n");
}

function write(name: FixtureFile, content: string) {
    writeFileSync(join(dir, name), content);
}

function restore() {
    for (const [name, content] of Object.entries(FILES))
        write(name as FixtureFile, content);
}

/** One child vitest over the fixture against the shared cache directory. */
function run(commit = "aaa"): {
    status: number | null;
    out: string;
    transformed: string[];
} {
    const log = join(dir, "transforms.log");
    rmSync(log, { force: true });
    const r = spawnSync(
        VITEST,
        ["run", "--root", dir, "--config", join(dir, "vitest.config.ts")],
        {
            cwd: dir,
            encoding: "utf8",
            // A blocked child never reds a test — it hangs the worker.
            timeout: 60_000,
            env: {
                ...process.env,
                [VITEST_FS_CACHE_ENV]: join(dir, "cache"),
                FIXTURE_COMMIT: commit,
                EXPECT_COMMIT: commit,
            },
        }
    );
    let transformed: string[] = [];
    try {
        transformed = readFileSync(log, "utf8").split("\n").filter(Boolean);
    } catch {
        /* nothing transformed */
    }
    return { status: r.status, out: `${r.stdout}${r.stderr}`, transformed };
}

/** A clean warm run: green, and served entirely from the cache. */
function expectWarmGreen() {
    const r = run();
    expect(r.status, r.out).toBe(0);
    expect(r.transformed).toEqual([]);
}

describe("vitest fs module cache — invalidation against a warm cache", () => {
    beforeAll(() => {
        // Real path: Vite reports module ids resolved (macOS's tmpdir is
        // a symlink), and the transform log matches on the prefix.
        dir = realpathSync(mkdtempSync(join(tmpdir(), "tolaria-fs-cache-")));
        writeFileSync(join(dir, "vitest.config.ts"), config());
        restore();
        const cold = run();
        expect(cold.status, cold.out).toBe(0);
        expect(cold.transformed.length).toBeGreaterThan(0);
        expect(readdirSync(join(dir, "cache")).length).toBeGreaterThan(0);
    }, 120_000);

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("is warm: an unchanged second run transforms nothing", () => {
        expectWarmGreen();
    }, 60_000);

    it("an edit to a directly imported lib reds the run", () => {
        expectWarmGreen();
        write("lib.js", "export const v = 2;\n");
        try {
            const r = run();
            expect(r.status, r.out).not.toBe(0);
            expect(r.out).toMatch(/expected 2 to be 1/);
        } finally {
            restore();
        }
    }, 120_000);

    it("an edit to a module reached only transitively reds the run", () => {
        expectWarmGreen();
        write("deep.js", "export const deep = 2;\n");
        try {
            const r = run();
            expect(r.status, r.out).not.toBe(0);
            expect(r.out).toMatch(/expected 2 to be 1/);
        } finally {
            restore();
        }
    }, 120_000);

    it("an edit to the test file itself reds the run", () => {
        expectWarmGreen();
        write(
            "fx.test.js",
            FILES["fx.test.js"].replace(
                "expect(v).toBe(1)",
                "expect(v).toBe(3)"
            )
        );
        try {
            const r = run();
            expect(r.status, r.out).not.toBe(0);
            expect(r.out).toMatch(/expected 1 to be 3/);
        } finally {
            restore();
        }
    }, 120_000);

    it("a new commit is seen fresh: a define value is never baked into a cached transform", () => {
        expectWarmGreen();
        const r = run("bbb");
        expect(r.status, r.out).toBe(0);
    }, 120_000);
});
