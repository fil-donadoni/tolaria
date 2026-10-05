/**
 * The Convex CLI's module discovery, reproduced — the list of files under
 * `convex/` that become user modules, hence keys of the generated `api`.
 *
 * Its own module (issue #5077) so a builtins-only caller can use it:
 * `bootstrap-worktree.ts` runs before `bun install`, and it compares this list
 * with the keys of the `convex/_generated/api.d.ts` it copied from the primary
 * checkout to tell a stale copy from a fresh one. `convex-bundle-size.ts`
 * re-exports it unchanged.
 *
 * Zero imports beyond node builtins ON PURPOSE.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, parse, relative, sep } from "node:path";

/** Copied verbatim from `convex/dist/esm/bundler/index.js`. */
const ENTRY_POINT_EXTENSIONS = [
    // ESBuild js loader
    ".js",
    ".mjs",
    ".cjs",
    // ESBuild ts loader
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    // ESBuild jsx loader
    ".jsx",
] as const;

/** The extensions the CLI's "no import/export, not a module" filter applies to. */
const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;

function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            // A nested component definition is pushed separately.
            if (existsSync(join(full, "convex.config.ts"))) continue;
            yield* walk(full);
        } else if (entry.isFile()) {
            yield full;
        }
    }
}

/**
 * Reproduces `entryPoints()` from the Convex bundler, including its exclusion
 * of `_generated/**`, dotfiles, `schema.*`, multi-dot filenames, paths with a
 * space, and TypeScript files carrying neither `import` nor `export`.
 */
export function discoverEntryPoints(convexDir: string): string[] {
    const found: string[] = [];
    for (const fpath of walk(convexDir)) {
        const relPath = relative(convexDir, fpath);
        const base = parse(fpath).base;
        if (!ENTRY_POINT_EXTENSIONS.some((ext) => relPath.endsWith(ext)))
            continue;
        if (relPath.startsWith("_generated" + sep)) continue;
        if (base.startsWith(".") || base.startsWith("#")) continue;
        if (base === "schema.ts" || base === "schema.js") continue;
        if ((base.match(/\./g) ?? []).length > 1) continue;
        if (relPath.includes(" ")) continue;
        if (TS_EXTENSIONS.some((ext) => base.endsWith(ext))) {
            const contents = readFileSync(fpath, "utf8");
            if (!/^\s{0,100}(import|export)/m.test(contents)) continue;
        }
        found.push(fpath);
    }
    return found.sort();
}
