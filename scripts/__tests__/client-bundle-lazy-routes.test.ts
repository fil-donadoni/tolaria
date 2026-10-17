import { describe, it, expect, afterEach } from "vitest";
import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    rmSync,
    readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    ENGINE_SENTINEL,
    SET_CHUNK_PREFIX,
    chunksInStaticCycle,
    entryAssets,
    lightSurfaceViolations,
    reachableChunks,
    setChunkViolations,
    compiledAssetViolations,
} from "../lib/asset-graph";

/**
 * Login and lobby load without the rules engine and without the card
 * catalogue (issue #4854).
 *
 * The real assertion runs over the BUILT asset graph inside `check:bundle`
 * (`scripts/check-bundle-size.ts`) — a bundler is the only thing that knows
 * what `index.html` preloads. This file pins the two halves that can be pinned
 * without a build: the graph walker (against a hand-made `dist/`, so the
 * "re-add the preload, watch red" proof is a permanent test and not a manual
 * step) and the source-level seams that keep the entry graph light.
 */

const roots: string[] = [];

/** A fake `dist/` — `html` is index.html's body, `chunks` maps file → source. */
function fakeDist(html: string, chunks: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "asset-graph-"));
    roots.push(dir);
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), html);
    for (const [name, source] of Object.entries(chunks)) {
        writeFileSync(join(dir, "assets", name), source);
    }
    return dir;
}

afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true });
});

const ENTRY = `<script type="module" crossorigin src="/assets/index-AAAA1111.js"></script>`;
const PRELOAD = (file: string) =>
    `<link rel="modulepreload" crossorigin href="/assets/${file}">`;

describe("asset graph — static reachability", () => {
    it("follows static imports and modulepreload, never import()", () => {
        const dist = fakeDist(`${ENTRY}${PRELOAD("shared-BBBB2222.js")}`, {
            "index-AAAA1111.js": `import{a}from"./util-CCCC3333.js";import("./game-DDDD4444.js");`,
            "shared-BBBB2222.js": `export const s=1;`,
            "util-CCCC3333.js": `export const a=1;`,
            "game-DDDD4444.js": `export const g=1;`,
        });
        expect(entryAssets(dist).sort()).toEqual([
            "index-AAAA1111.js",
            "shared-BBBB2222.js",
        ]);
        expect([...reachableChunks(dist, entryAssets(dist))].sort()).toEqual([
            "index-AAAA1111.js",
            "shared-BBBB2222.js",
            "util-CCCC3333.js",
        ]);
    });
});

describe("asset graph — light surfaces", () => {
    const LIGHT = {
        "index-AAAA1111.js": `import{x}from"./util-CCCC3333.js";import("./game-DDDD4444.js");`,
        "util-CCCC3333.js": `export const x=1;`,
        "lobby.route-EEEE5555.js": `import{x}from"./util-CCCC3333.js";`,
        "match-setup.route-HHHH8888.js": `import{x}from"./util-CCCC3333.js";import("./game-DDDD4444.js");`,
        "game-DDDD4444.js": `import"./engine-FFFF6666.js";`,
        "engine-FFFF6666.js": `throw Error("${ENGINE_SENTINEL}")`,
        "card-set-lea-GGGG7777.js": `export const c=1;`,
    };

    it("passes when the engine and the catalogue sit behind import()", () => {
        const dist = fakeDist(ENTRY, LIGHT);
        expect(lightSurfaceViolations(dist)).toEqual([]);
    });

    // Proof of failure — these ARE the "re-add the preload, watch red" step.
    it("reds when index.html modulepreloads a Set chunk", () => {
        const dist = fakeDist(
            ENTRY + PRELOAD("card-set-lea-GGGG7777.js"),
            LIGHT
        );
        expect(lightSurfaceViolations(dist)).toContainEqual(
            expect.objectContaining({
                surface: "login",
                chunk: "card-set-lea-GGGG7777.js",
            })
        );
    });

    it("reds when the lobby route statically imports the engine", () => {
        const dist = fakeDist(ENTRY, {
            ...LIGHT,
            "lobby.route-EEEE5555.js": `import"./engine-FFFF6666.js";`,
        });
        const violations = lightSurfaceViolations(dist);
        expect(violations).toContainEqual(
            expect.objectContaining({
                surface: "lobby",
                chunk: "engine-FFFF6666.js",
            })
        );
        expect(violations.some((v) => v.surface === "login")).toBe(false);
    });

    it("reds when a light chunk names the compiled catalogue asset", () => {
        const dist = fakeDist(ENTRY, {
            ...LIGHT,
            "util-CCCC3333.js": `fetch("/assets/catalogue-ec6fafb74d0e9801-CMpD3mAP.json")`,
        });
        expect(lightSurfaceViolations(dist)).toContainEqual(
            expect.objectContaining({
                surface: "login",
                chunk: "util-CCCC3333.js",
            })
        );
    });

    it("reds when a light chunk names the packed corpus the gate fetches", () => {
        const dist = fakeDist(ENTRY, {
            ...LIGHT,
            "match-setup.route-HHHH8888.js": `fetch("/assets/packed-corpus-YygP3Rut.json")`,
        });
        expect(lightSurfaceViolations(dist)).toContainEqual(
            expect.objectContaining({
                surface: "match-setup",
                chunk: "match-setup.route-HHHH8888.js",
            })
        );
    });

    it.each([
        ["a compiled shard", "/assets/compiled-shard-lea-dd14ab094a1d.json"],
        [
            "the compiled names index",
            "/assets/compiled-index-0123456789ab.json",
        ],
        [
            "the shard dictionary",
            "/assets/compiled-dictionary-ba9876543210.json",
        ],
    ])("reds when a light chunk names %s (issue #5616)", (_what, url) => {
        const dist = fakeDist(ENTRY, {
            ...LIGHT,
            "match-setup.route-HHHH8888.js": `const u={lea:\`${url}\`};`,
        });
        expect(lightSurfaceViolations(dist)).toContainEqual(
            expect.objectContaining({
                surface: "match-setup",
                chunk: "match-setup.route-HHHH8888.js",
                reason: expect.stringMatching(/compiled catalogue asset/),
            })
        );
    });

    it("reds when the Setup flow statically imports a Set chunk (issue #5584)", () => {
        const dist = fakeDist(ENTRY, {
            ...LIGHT,
            "match-setup.route-HHHH8888.js": `import"./card-set-lea-GGGG7777.js";`,
        });
        const violations = lightSurfaceViolations(dist);
        expect(violations).toContainEqual(
            expect.objectContaining({
                surface: "match-setup",
                chunk: "card-set-lea-GGGG7777.js",
            })
        );
        expect(violations.some((v) => v.surface === "lobby")).toBe(false);
    });

    it("reds when no chunk carries the engine sentinel — the check cannot go vacuous", () => {
        const dist = fakeDist(ENTRY, {
            ...LIGHT,
            "engine-FFFF6666.js": `export const e=1;`,
        });
        expect(lightSurfaceViolations(dist)).toContainEqual(
            expect.objectContaining({ surface: "(all)" })
        );
    });

    it("reds when the lobby is not a route chunk of its own", () => {
        const rest = Object.fromEntries(
            Object.entries(LIGHT).filter(
                ([name]) => !name.startsWith("lobby.route-")
            )
        );
        const dist = fakeDist(ENTRY, rest);
        expect(lightSurfaceViolations(dist)).toContainEqual(
            expect.objectContaining({
                surface: "lobby",
                chunk: "lobby.route-*.js",
            })
        );
    });
});

describe("asset graph — chunk cycles", () => {
    it("flags a Set chunk that imports a helper chunk importing it back", () => {
        const dist = fakeDist(ENTRY, {
            "index-AAAA1111.js": `export const i=1;`,
            "card-set-lea-GGGG7777.js": `import{h}from"./helper-HHHH8888.js";`,
            "helper-HHHH8888.js": `import"./card-set-lea-GGGG7777.js";export const h=1;`,
        });
        expect(chunksInStaticCycle(dist, SET_CHUNK_PREFIX)).toEqual([
            "card-set-lea-GGGG7777.js",
        ]);
    });

    it("passes a one-way edge", () => {
        const dist = fakeDist(ENTRY, {
            "index-AAAA1111.js": `export const i=1;`,
            "card-set-lea-GGGG7777.js": `import{h}from"./helper-HHHH8888.js";`,
            "helper-HHHH8888.js": `export const h=1;`,
        });
        expect(chunksInStaticCycle(dist, SET_CHUNK_PREFIX)).toEqual([]);
    });
});

describe("asset graph — a game downloads only its own Sets (issue #5615)", () => {
    // The shape `vite build` emits: the catalogue glue holds the loader's
    // `import()` of every Set chunk; a Set may import another Set's helper
    // (`drk` → `leg`), and a Set's facade re-exports its chunk.
    const SHARDED = {
        "index-AAAA1111.js": `import{x}from"./util-CCCC3333.js";import("./game.route-DDDD4444.js");`,
        "util-CCCC3333.js": `export const x=1;`,
        "game.route-DDDD4444.js": `import"./engine-FFFF6666.js";import("./catalogue-gate-IIII9999.js");`,
        "engine-FFFF6666.js": `throw Error("${ENGINE_SENTINEL}")`,
        "catalogue-gate-IIII9999.js": `import"./catalogue-JJJJ0000.js";`,
        "catalogue-JJJJ0000.js": `const m={"lea":()=>import(\`./card-set-lea-GGGG7777.js\`),"drk":()=>import("./card-set-drk-KKKK1111.js")};`,
        "card-set-lea-GGGG7777.js": `export const c=1;`,
        "card-set-drk-KKKK1111.js": `import{c}from"./card-set-lea-GGGG7777.js";export const d=c;`,
        "card-set-ice-LLLL2222.js": `import"./card-set-ice-MMMM3333.js";`,
        "card-set-ice-MMMM3333.js": `export const i=1;`,
    };

    it("passes when every Set chunk sits behind the loader's import()", () => {
        expect(setChunkViolations(fakeDist(ENTRY, SHARDED))).toEqual([]);
    });

    // Proof of failure — the static imports restored, one at a time.
    it("reds when a route chunk statically imports a Set chunk", () => {
        const dist = fakeDist(ENTRY, {
            ...SHARDED,
            "game.route-DDDD4444.js": `import"./engine-FFFF6666.js";import"./card-set-lea-GGGG7777.js";`,
        });
        expect(setChunkViolations(dist)).toEqual([
            expect.objectContaining({
                chunk: "card-set-lea-GGGG7777.js",
                reason: expect.stringContaining(
                    "imported statically by game.route-DDDD4444.js"
                ),
            }),
        ]);
    });

    it("reds when the catalogue glue statically imports a Set chunk — the pre-#5615 shape", () => {
        const dist = fakeDist(ENTRY, {
            ...SHARDED,
            "catalogue-JJJJ0000.js": `import"./card-set-lea-GGGG7777.js";import"./card-set-drk-KKKK1111.js";`,
        });
        const violations = setChunkViolations(dist);
        expect(violations.map((v) => v.chunk).sort()).toEqual(
            [
                "card-set-drk-KKKK1111.js",
                "card-set-lea-GGGG7777.js",
                // No chunk reaches a Set through import() any more either.
                `${SET_CHUNK_PREFIX}*.js`,
            ].sort()
        );
    });

    it("reds when index.html preloads a Set chunk", () => {
        const dist = fakeDist(
            ENTRY + PRELOAD("card-set-lea-GGGG7777.js"),
            SHARDED
        );
        expect(setChunkViolations(dist)).toContainEqual(
            expect.objectContaining({
                chunk: "card-set-lea-GGGG7777.js",
                reason: "Set chunk preloaded by index.html",
            })
        );
    });

    it("reds when there is no Set chunk at all — the check cannot go vacuous", () => {
        const rest = Object.fromEntries(
            Object.entries(SHARDED).filter(
                ([name]) => !name.startsWith(SET_CHUNK_PREFIX)
            )
        );
        expect(setChunkViolations(fakeDist(ENTRY, rest))).toEqual([
            expect.objectContaining({ chunk: `${SET_CHUNK_PREFIX}*.js` }),
        ]);
    });
});

describe("source seams that keep the entry graph light", () => {
    const ROOT = resolve(__dirname, "../..");
    const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

    it("src/main.tsx neither imports the catalogue nor starts its fetch", () => {
        const main = read("src/main.tsx").replace(/\/\/.*$/gm, "");
        expect(main).not.toMatch(/@convex\/cards\/catalogue/);
        expect(main).not.toMatch(/catalogueArtifact|hydrateCatalogue/);
    });

    it("src/router.tsx imports no route module statically", () => {
        const router = read("src/router.tsx").replace(/\/\/.*$/gm, "");
        expect(router).not.toMatch(/from\s+["']\.\/routes\//);
        expect(router).not.toMatch(/components\/ui\/catalogue-gate["']/);
    });

    it("the formats seam plugin still names the one importer and the one specifier", () => {
        const vite = read("vite.config.ts");
        expect(vite).toContain('name: "formats-cards-browser-seam"');
        expect(vite).toContain('source === "./cards"');
        expect(vite).toContain('endsWith("/convex/formats.ts")');
        // The plugin keys on this exact spelling: one import, written `./cards`.
        const imports = read("convex/formats.ts").match(
            /from\s+["']\.\/cards["']/g
        );
        expect(imports).toHaveLength(1);
    });

    it("the engine sentinel is still a literal in the engine source", () => {
        expect(read("convex/gre/activation.ts")).toContain(ENGINE_SENTINEL);
    });

    it("the two engine leaves the lobby reads import nothing at runtime", () => {
        for (const leaf of [
            "convex/gre/manaColors.ts",
            "convex/gre/difficulty.ts",
        ]) {
            expect(read(leaf), leaf).not.toMatch(/^import\s+(?!type\b)/m);
        }
    });
});

describe("compiledAssetViolations — shards, never the whole corpus (issue #5616)", () => {
    const SHARD = "compiled-shard-lea-dd14ab094a1d.json";

    it("passes a build that ships shards and no whole corpus", () => {
        const dist = fakeDist(ENTRY, { [SHARD]: "{}" });
        expect(compiledAssetViolations(dist)).toEqual([]);
    });

    it("reds a build that still emits the packed corpus", () => {
        const dist = fakeDist(ENTRY, {
            [SHARD]: "{}",
            "packed-corpus-YygP3Rut.json": "{}",
        });
        expect(compiledAssetViolations(dist)).toEqual([
            expect.objectContaining({ asset: "packed-corpus-YygP3Rut.json" }),
        ]);
    });

    it("reds a build with no compiled shard at all — the check cannot go vacuous", () => {
        const dist = fakeDist(ENTRY, {});
        expect(compiledAssetViolations(dist)).toEqual([
            expect.objectContaining({ asset: "compiled-shard-*.json" }),
        ]);
    });
});
