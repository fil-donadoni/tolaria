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
    chunksInStaticCycle,
    entryAssets,
    lightSurfaceViolations,
    reachableChunks,
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
        "game-DDDD4444.js": `import"./engine-FFFF6666.js";`,
        "engine-FFFF6666.js": `throw Error("${ENGINE_SENTINEL}")`,
        "card-catalogue-GGGG7777.js": `export const c=1;`,
    };

    it("passes when the engine and the catalogue sit behind import()", () => {
        const dist = fakeDist(ENTRY, LIGHT);
        expect(lightSurfaceViolations(dist)).toEqual([]);
    });

    // Proof of failure — these ARE the "re-add the preload, watch red" step.
    it("reds when index.html modulepreloads the catalogue chunk", () => {
        const dist = fakeDist(
            ENTRY + PRELOAD("card-catalogue-GGGG7777.js"),
            LIGHT
        );
        expect(lightSurfaceViolations(dist)).toContainEqual(
            expect.objectContaining({
                surface: "login",
                chunk: "card-catalogue-GGGG7777.js",
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
    it("flags a card-catalogue chunk that imports a helper chunk importing it back", () => {
        const dist = fakeDist(ENTRY, {
            "index-AAAA1111.js": `export const i=1;`,
            "card-catalogue-GGGG7777.js": `import{h}from"./helper-HHHH8888.js";`,
            "helper-HHHH8888.js": `import"./card-catalogue-GGGG7777.js";export const h=1;`,
        });
        expect(chunksInStaticCycle(dist, "card-catalogue-")).toEqual([
            "card-catalogue-GGGG7777.js",
        ]);
    });

    it("passes a one-way edge", () => {
        const dist = fakeDist(ENTRY, {
            "index-AAAA1111.js": `export const i=1;`,
            "card-catalogue-GGGG7777.js": `import{h}from"./helper-HHHH8888.js";`,
            "helper-HHHH8888.js": `export const h=1;`,
        });
        expect(chunksInStaticCycle(dist, "card-catalogue-")).toEqual([]);
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
