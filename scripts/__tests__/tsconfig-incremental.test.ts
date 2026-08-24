import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Incremental build state guard (#2739).
 *
 * `check:ts` is `tsc -b --noEmit` (package.json). Build mode decides a
 * project's up-to-dateness itself — but every leaf project declares
 * `noEmit: true` and, before this ticket, none declared `incremental` (or
 * `composite`), so `tsc -b` had no build-info state to consult and fell back
 * to looking for emitted `.js` output files. `noEmit` guarantees those files
 * never exist, so build mode judged every project stale on every run and
 * rebuilt all four from scratch: 41-54s per invocation, `.tsbuildinfo` files
 * written and never read (measured on a clean tree, #2739).
 *
 * Fix: `"incremental": true` on every leaf project referenced from the root
 * tsconfig, each with its own `tsBuildInfoFile`. `composite` was deliberately
 * NOT used — it additionally demands declaration (.d.ts) emit, which none of
 * these projects want (they are `noEmit: true` by design: Vite/esbuild does
 * the actual transpile, `tsc -b` only type-checks).
 *
 * This guard pins the fix so a config edit cannot silently drop it — the
 * failure mode is not a build error, it's the ~42s-per-gate rebuild coming
 * back invisibly (`check:pr`, `check:all`, and the merge-train all pay it).
 * Self-contained by the same convention as `check-guards-scope.test.ts`
 * (no shared test util) so it keeps running even if that convention changes.
 *
 * A caveat this guard does NOT need to protect against: `tsconfig.json`
 * itself is a "files": [] solo-config with no compilerOptions of its own
 * (see root config below) — it has nothing to declare incremental state on
 * and correctly stays out of the leaf list.
 */

const ROOT = path.resolve(__dirname, "../..");

/**
 * Minimal, string-aware comment stripper for tsconfig's JSONC — these files
 * use both `//` line comments (tsconfig.scripts.json) and `/* *\/` block
 * comments (convex/tsconfig.json). A naive regex would also eat `//` or `/*`
 * that happen to appear inside a string value; this walks the source
 * character-by-character and only strips comment syntax OUTSIDE strings.
 */
function stripJsonComments(source: string): string {
    let out = "";
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        const next = source[i + 1];
        if (inLineComment) {
            if (c === "\n") {
                inLineComment = false;
                out += c;
            }
            continue;
        }
        if (inBlockComment) {
            if (c === "*" && next === "/") {
                inBlockComment = false;
                i++;
            }
            continue;
        }
        if (inString) {
            out += c;
            if (c === "\\") {
                // Preserve the escaped character verbatim, including a
                // literal escaped quote, without re-entering string logic.
                out += source[i + 1] ?? "";
                i++;
                continue;
            }
            if (c === '"') inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            out += c;
            continue;
        }
        if (c === "/" && next === "/") {
            inLineComment = true;
            i++;
            continue;
        }
        if (c === "/" && next === "*") {
            inBlockComment = true;
            i++;
            continue;
        }
        out += c;
    }
    return out;
}

function readTsconfig(relPath: string): {
    compilerOptions?: Record<string, unknown>;
    references?: { path: string }[];
} {
    const raw = fs.readFileSync(path.join(ROOT, relPath), "utf8");
    return JSON.parse(stripJsonComments(raw));
}

const rootConfig = readTsconfig("tsconfig.json");
const leafRelPaths = (rootConfig.references ?? []).map((r) => {
    // References may point at a directory (e.g. "./convex", which resolves
    // to "./convex/tsconfig.json") or a file directly (e.g.
    // "./tsconfig.app.json").
    const p = r.path.replace(/^\.\//, "");
    return p.endsWith(".json") ? p : path.join(p, "tsconfig.json");
});

describe("root tsconfig references (sanity — pins the leaf-config list this guard walks)", () => {
    it("has at least the four known leaf projects", () => {
        expect(leafRelPaths.sort()).toEqual(
            [
                "tsconfig.app.json",
                "tsconfig.node.json",
                "tsconfig.scripts.json",
                "convex/tsconfig.json",
            ].sort()
        );
    });
});

describe("every referenced project declares incremental build state (#2739)", () => {
    for (const relPath of leafRelPaths) {
        it(`${relPath} sets "incremental": true`, () => {
            const config = readTsconfig(relPath);
            expect(
                config.compilerOptions?.incremental,
                `${relPath} does not declare "incremental": true under compilerOptions. ` +
                    `Without it, "tsc -b" has no build-info state to consult, falls back to ` +
                    `looking for emitted .js output files that "noEmit: true" guarantees will ` +
                    `never exist, and rebuilds this project from scratch on every "check:ts" ` +
                    `run — the ~42s-per-gate regression #2739 fixed. (Use "incremental", not ` +
                    `"composite": composite additionally demands declaration emit, which this ` +
                    `project does not want.)`
            ).toBe(true);
        });

        it(`${relPath} declares a tsBuildInfoFile path`, () => {
            const config = readTsconfig(relPath);
            const buildInfo = config.compilerOptions?.tsBuildInfoFile;
            expect(
                typeof buildInfo === "string" && buildInfo.length > 0,
                `${relPath} has no "tsBuildInfoFile" — "incremental": true alone still works ` +
                    `(tsc picks a default path), but this repo pins an explicit path under ` +
                    `node_modules/.tmp/ (gitignored, *.tsbuildinfo) so the cache location is ` +
                    `predictable across the four leaf projects.`
            ).toBe(true);
        });
    }
});

describe("noEmit projects use incremental, never composite (#2739)", () => {
    // "composite" implies declaration emit (and other constraints tsc-b
    // enforces for project references that emit .d.ts files). Every leaf
    // project here is noEmit: true by design — Vite/esbuild does the real
    // transpile, tsc only type-checks — so composite would fight that intent.
    for (const relPath of leafRelPaths) {
        it(`${relPath} does not set "composite": true`, () => {
            const config = readTsconfig(relPath);
            expect(
                config.compilerOptions?.composite,
                `${relPath} sets "composite": true. This repo intentionally uses "incremental" ` +
                    `instead (#2739) because every leaf project is "noEmit: true" and composite ` +
                    `demands declaration (.d.ts) emit, which none of them want.`
            ).not.toBe(true);
        });
    }
});
