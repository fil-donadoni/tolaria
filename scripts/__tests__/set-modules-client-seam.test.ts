import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * The premise the client's per-Set delivery rests on (issue #5615, PRD
 * #5602, ADR 0113 Amendment V) — the same premise, and the same guard, as
 * `compiled-pool-client-seam.test.ts` for the compiled half.
 *
 * `convex/cards/setModules.ts` imports every hand-written Set statically.
 * That is correct on the SERVER and exactly what must not reach a browser
 * graph, where a game is meant to download only the Sets of its Definition
 * Manifest. `vite.config.ts` aliases the specifier `./setModules` to the
 * browser seam (`src/lib/catalogue/set-modules.browser.ts`), which installs
 * a Set as its own chunk on demand. A Vite alias matches the import string
 * as written, so two things can silently defeat it, and neither fails a
 * type-check or any other suite:
 *
 *   1. a NEW importer inside `convex/cards/` writing `./setModules` — the
 *      alias fires, and that module unexpectedly sees an empty Set list on
 *      the client while seeing every Set on the server;
 *   2. an importer writing it any OTHER way (`@convex/cards/setModules`,
 *      `../cards/setModules`) — the alias does NOT fire and every Set walks
 *      straight back into the client's static graph.
 *
 * `scripts/check-bundle-size.ts` catches (2) by its EFFECT, in the bundler
 * that ships (`setChunkViolations`). This test catches both by their CAUSE,
 * in the light lane, and says which line did it.
 */

const ROOT = resolve(__dirname, "../..");
const SCANNED = ["convex", "src", "scripts"];
const SET_MODULES_IMPORT_RE =
    /(?:from|import)\s*\(?\s*["']([^"']*\/setModules)["']/g;

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

function setModulesImports(): Hit[] {
    const hits: Hit[] = [];
    for (const dir of SCANNED) {
        for (const file of walk(join(ROOT, dir))) {
            const rel = relative(ROOT, file).replaceAll("\\", "/");
            if (/(^|\/)__tests__\//.test(rel) || /\.test\.tsx?$/.test(rel))
                continue;
            const source = readFileSync(file, "utf8");
            for (const [index, text] of source.split("\n").entries()) {
                for (const match of text.matchAll(SET_MODULES_IMPORT_RE)) {
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

describe("the Set modules' client seam (issue #5615)", () => {
    it("has exactly one non-test importer, and it is the catalogue", () => {
        expect(
            setModulesImports().map((h) => `${h.file} → ${h.specifier}`),
            setModulesImports()
                .map((h) => `  ${h.file}:${h.line} imports "${h.specifier}"`)
                .join("\n")
        ).toEqual(["convex/cards/catalogue.ts → ./setModules"]);
    });

    it("that importer spells the specifier the Vite alias matches", () => {
        const alias = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
        // The alias source, as written in the config: /^\.\/setModules$/
        expect(alias).toMatch(/find:\s*\/\^\\\.\\\/setModules\$\//);
        for (const hit of setModulesImports()) {
            expect(
                new RegExp("^\\./setModules$").test(hit.specifier),
                `${hit.file}:${hit.line} imports the Set modules as "${hit.specifier}", which the Vite alias does not match — every Set would re-enter the client's static graph`
            ).toBe(true);
        }
    });

    it("the browser replacement exports the same name, over the lazy loader", () => {
        const seam = readFileSync(
            resolve(ROOT, "src/lib/catalogue/set-modules.browser.ts"),
            "utf8"
        );
        const server = readFileSync(
            resolve(ROOT, "convex/cards/setModules.ts"),
            "utf8"
        );
        const names = (text: string) =>
            [...text.matchAll(/^export const (\w+)/gm)].map((m) => m[1]).sort();
        expect(names(seam)).toEqual(names(server));
        expect(names(seam)).toEqual(["setModuleSource"]);
        // No Set is static here: the seam reaches a Set through the loader.
        expect(seam).not.toMatch(/from\s+["'][^"']*\/sets\//);
        expect(seam).toContain('from "./set-chunk-loader"');
    });
});
