import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * The premise the client's catalogue delivery rests on (issue #3053,
 * ADR 0113 §2).
 *
 * `convex/cards/compiledPool.ts` imports `data/oracle-compiled-pool.json` at
 * module load. That is correct on the SERVER — a Convex mutation cannot fetch
 * — and it is exactly what must not reach a browser, where the same ~1.6 MB
 * of card data landed in both the `card-catalogue` chunk and the
 * `brain.worker` bundle on every cold load.
 *
 * `vite.config.ts` takes it out of both graphs by ALIASING the specifier
 * `./compiledPool` to an empty array. A Vite alias matches the import string
 * as written, so the swap only happens for importers that spell it exactly
 * that way — and a `convex/` module has to, because the Convex bundler does
 * not know the `@convex` alias. Two things can therefore silently defeat it,
 * and neither fails a type-check or any other suite:
 *
 *   1. a NEW importer inside `convex/cards/` writing `./compiledPool` — the
 *      alias fires, and that module unexpectedly sees an empty pool on the
 *      client while seeing the real one on the server;
 *   2. an importer writing it any OTHER way (`@convex/cards/compiledPool`,
 *      `../cards/compiledPool`, an absolute path) — the alias does NOT fire
 *      and the pool walks straight back into the client bundle.
 *
 * `scripts/check-bundle-size.ts` catches (2) by its EFFECT, in the bundler
 * that ships. This test catches both by their CAUSE, in the light lane, and
 * says which line did it.
 *
 * Test files are exempt: vitest resolves through `vitest.config.ts`, which
 * carries no such alias, so a test importing the pool gets the real rows on
 * purpose (`src/components/cards/__tests__/card-preview-engine-tree.test.tsx`
 * asserts a compiled row renders like a hand-written one).
 */

const ROOT = resolve(__dirname, "../..");
const SCANNED = ["convex", "src", "scripts"];
const POOL_IMPORT_RE =
    /(?:from|import)\s*\(?\s*["']([^"']*(?:^|\/)compiledPool)["']/g;

interface Hit {
    readonly file: string;
    readonly specifier: string;
    readonly line: number;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

function poolImports(): Hit[] {
    const hits: Hit[] = [];
    for (const dir of SCANNED) {
        for (const file of walk(join(ROOT, dir))) {
            const rel = relative(ROOT, file).replaceAll("\\", "/");
            if (/(^|\/)__tests__\//.test(rel) || /\.test\.tsx?$/.test(rel))
                continue;
            const source = readFileSync(file, "utf8");
            for (const [index, text] of source.split("\n").entries()) {
                for (const match of text.matchAll(POOL_IMPORT_RE)) {
                    hits.push({
                        file: rel,
                        specifier: match[1]!,
                        line: index + 1,
                    });
                }
            }
        }
    }
    return hits;
}

describe("the compiled pool's client seam (issue #3053)", () => {
    it("has exactly one non-test importer, and it is the catalogue", () => {
        // File and specifier, never the line: pinning a line number would
        // red this guard on any unrelated edit above it, and the line is
        // carried in the FAILURE message below instead, where it helps.
        expect(
            poolImports().map((h) => `${h.file} → ${h.specifier}`),
            poolImports()
                .map((h) => `  ${h.file}:${h.line} imports "${h.specifier}"`)
                .join("\n")
        ).toEqual(["convex/cards/catalogue.ts → ./compiledPool"]);
    });

    it("that importer spells the specifier the Vite alias matches", () => {
        const alias = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
        // The alias source, as written in the config: /^\.\/compiledPool$/
        expect(alias).toMatch(/find:\s*\/\^\\\.\\\/compiledPool\$\//);
        for (const hit of poolImports()) {
            expect(
                new RegExp("^\\./compiledPool$").test(hit.specifier),
                `${hit.file}:${hit.line} imports the pool as "${hit.specifier}", which the Vite alias does not match — the pool would re-enter the client bundle`
            ).toBe(true);
        }
    });

    it("the browser replacement exports the same name, and nothing else", () => {
        const stub = readFileSync(
            resolve(ROOT, "src/lib/catalogue/compiled-pool.browser.ts"),
            "utf8"
        );
        expect(stub).toMatch(
            /export const compiledReadyDefinitions: CardDefinition\[\] = \[\];/
        );
        expect(stub.match(/^export /gm)).toHaveLength(1);
    });
});
