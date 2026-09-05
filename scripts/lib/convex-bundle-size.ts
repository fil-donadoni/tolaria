/**
 * Measures the size of the Convex function bundle — the artifact
 * `npx convex deploy` pushes, and the one Convex's documented **32 MiB code
 * size** ceiling applies to (issue #3051, ADR 0113 § 2).
 *
 * WHY THIS EXISTS. ADR 0113 § 2 decided that compiled card definitions stay
 * bundled in the Convex module graph server-side ("zero reads, zero
 * bandwidth, zero billing"), and recorded, in its own words, that the bound
 * on that decision — "the Convex function bundle limit" — "is unverified and
 * must be measured before the corpus grows into it". This module is that
 * measurement, made repeatable so the ceiling is not rediscovered by a
 * refused deploy.
 *
 * WHAT CONVEX COUNTS. `crates/model/src/source_packages/upload_download.rs`
 * in the open-source backend builds the pushed source package by walking the
 * modules and adding, per module, `module.source.as_bytes().len()` AND — when
 * present — `source_map.as_bytes().len()`, plus the length of `metadata.json`.
 * So **source maps count**, which roughly doubles the number a naive
 * `.js`-only measurement reports. Reproduced here.
 *
 * HOW IT MEASURES. Convex's own documented procedure is
 * `npx convex dev --once --debug-bundle-path <dir>`
 * (`npm-packages/docs/docs/functions/bundling.mdx` § Code size limits), which
 * needs a resolvable deployment, spins up the local backend, and takes ~30 s.
 * A gate check can afford none of that, so this module re-runs the SAME
 * esbuild invocation the CLI uses — the options are copied verbatim from
 * `convex/dist/esm/bundler/debugBundle.js`'s `innerEsbuild`, and the entry
 * point discovery from `convex/dist/esm/bundler/index.js`'s `entryPoints` /
 * `entryPointsByEnvironment` — over the same `convex/` directory.
 *
 * FIDELITY, MEASURED (issue #3051, 2026-09-05, convex 1.39.1). Against the
 * real `--debug-bundle-path` dump of the same tree:
 *
 * |                   | CLI dump   | this module | delta  |
 * | ----------------- | ---------- | ----------- | ------ |
 * | source bytes      | 20,048,189 | 20,044,578  | -3,611 |
 * | source map bytes  |  8,878,529 |  8,874,035  | -4,494 |
 * | **total**         | 28,926,718 | 28,918,613  | -8,105 |
 * | user modules      |      1,455 |       1,455 |      0 |
 * | emitted modules   |      2,816 |       2,816 |      0 |
 *
 * 0.028% low, and low for a known reason. The CLI bundles two files
 * `entryPoints()` excludes: `auth.config.ts` (`bundleAuthConfig`), which IS a
 * pushed module and is bundled here too, and `schema.ts` (`bundleSchema`),
 * which is NOT — the dump's 1,455 non-`_deps` entries carry `auth.config.js`
 * and no `schema.js` — so it is not counted. The residue is `metadata.json`,
 * whose length Convex also adds to `unzipped_size_bytes`. The budget carries
 * three orders of magnitude more margin than that residue.
 */
import esbuild from "esbuild";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep, parse } from "node:path";

/** Copied from `convex/dist/esm/bundler/index.js`. */
const ENTRY_POINT_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"] as const;

/** `mustBeIsolate` in the Convex bundler: these never go to the node runtime. */
const USE_NODE_DIRECTIVE = /^\s*("|')use node("|');?\s*$/m;

export interface ConvexBundleMeasurement {
    /** Bytes of emitted module source (the `.js` half of the push). */
    sourceBytes: number;
    /** Bytes of emitted source maps — Convex counts these too. */
    sourceMapBytes: number;
    /** `sourceBytes + sourceMapBytes` — what the 32 MiB ceiling applies to. */
    totalBytes: number;
    /**
     * Files under `convex/` that become user modules. Convex caps these at
     * `MAX_USER_MODULES` (default 4096, `crates/common/src/knobs.rs`);
     * `_deps/**` chunks are explicitly excluded from that count by
     * `crates/application/src/lib.rs`.
     */
    userModules: number;
    /** Emitted files, `_deps/**` shared chunks included. */
    emittedModules: number;
}

/** Convex's documented ceiling: 32 MiB "code size", per deployment. */
export const CONVEX_CODE_SIZE_LIMIT_BYTES = 32 * 1024 * 1024;

/** `MAX_USER_MODULES` default in the open-source backend's knobs. */
export const CONVEX_MAX_USER_MODULES = 4096;

/**
 * 30 MiB, against Convex's hard 32 MiB. The 2 MiB gap is the room a red gate
 * needs to be actionable rather than an outage: a deploy that is already
 * refused cannot be fixed by a smaller next commit. At the measured
 * 2,086 B/row (below) it is ~1,000 rows of warning distance, and the 2 MB
 * budget on `data/oracle-compiled-pool.json`
 * (`scripts/__tests__/oracle-pool-size.test.ts`) fires far sooner than that —
 * this guard is the backstop for everything else that grows the server
 * bundle, not only the pool.
 *
 * Crossing it is the signal to stop bundling the compiled pool server-side,
 * not to raise the number. See ADR 0113 § Amendment.
 */
export const CONVEX_BUNDLE_BUDGET_BYTES = 30 * 1024 * 1024;

/**
 * `MAX_USER_MODULES` counts files under `convex/`, excluding `_deps/**`
 * chunks (`crates/application/src/lib.rs`: "Too many function files ({} >
 * maximum {}) in \"convex/\""). Every hand-written card definition is one
 * such file, so this is a SECOND ceiling the corpus grows into, on a
 * different axis from bytes. 3,072 is 75% of Convex's 4,096; at 1,455 today
 * there is no risk, and the point of the row is that the number is now
 * visible in a receipt.
 */
export const CONVEX_USER_MODULE_BUDGET = 3072;

/**
 * Marginal bundled cost of one compiled-pool row — 1,258 B of source plus
 * 828 B of source map — measured at issue #3051 by re-bundling the real
 * `convex/` tree at +2,000 and +6,000 synthetic rows (uniquified `id` and
 * `name`), linear to three digits across both deltas. Six times the 347 B/row
 * of the raw definition: the pool is inlined TWICE (the shared isolate chunk,
 * and the `"use node"` module that imports it, whose graph is separate), the
 * bundled object literal is fatter than the JSON it came from (Convex sets
 * `minifyWhitespace: false` — it breaks their source maps), and source maps
 * count.
 */
export const MEASURED_BYTES_PER_POOL_ROW = 2086;

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
function discoverEntryPoints(convexDir: string): string[] {
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
        if (base.endsWith(".ts") || base.endsWith(".tsx")) {
            const contents = readFileSync(fpath, "utf8");
            if (!/^\s{0,100}(import|export)/m.test(contents)) continue;
        }
        found.push(fpath);
    }
    return found.sort();
}

/** Options copied verbatim from the Convex CLI's `innerEsbuild`. */
async function build(
    convexDir: string,
    entryPoints: string[],
    platform: "browser" | "node",
    chunksFolder: string
): Promise<{ source: number; map: number; files: number }> {
    if (entryPoints.length === 0) return { source: 0, map: 0, files: 0 };
    const result = await esbuild.build({
        entryPoints,
        bundle: true,
        platform,
        format: "esm",
        target: "esnext",
        jsx: "automatic",
        outdir: "out",
        outbase: convexDir,
        conditions: ["convex", "module"],
        write: false,
        sourcemap: true,
        sourcesContent: false,
        splitting: true,
        chunkNames: join(chunksFolder, "[hash]"),
        treeShaking: true,
        minifySyntax: true,
        minifyIdentifiers: true,
        // Convex leaves whitespace unminified on purpose — it breaks their
        // source maps. Keeping the flag matters: it is ~40% of the bytes.
        minifyWhitespace: false,
        keepNames: true,
        define: { "process.env.NODE_ENV": '"production"' },
        metafile: true,
        logLevel: "silent",
    });
    let source = 0;
    let map = 0;
    let files = 0;
    for (const file of result.outputFiles ?? []) {
        if (file.path.endsWith(".map")) map += file.contents.length;
        else {
            source += file.contents.length;
            files += 1;
        }
    }
    return { source, map, files };
}

export async function measureConvexBundle(
    convexDir: string
): Promise<ConvexBundleMeasurement> {
    const entryPoints = discoverEntryPoints(convexDir);
    const isolate: string[] = [];
    const node: string[] = [];
    for (const fpath of entryPoints) {
        if (USE_NODE_DIRECTIVE.test(readFileSync(fpath, "utf8")))
            node.push(fpath);
        else isolate.push(fpath);
    }

    // `auth.config.ts` is excluded from `entryPoints()` but IS pushed as a
    // module of its own (`bundleAuthConfig`). `schema.ts` is excluded and
    // NOT pushed — verified against the `--debug-bundle-path` dump, whose
    // 1,455 non-`_deps` modules include `auth.config.js` and no `schema.js`.
    const extras = ["auth.config.ts"]
        .map((f) => join(convexDir, f))
        .filter((f) => existsSync(f));

    const parts = await Promise.all([
        build(convexDir, isolate, "browser", "_deps"),
        build(convexDir, node, "node", join("_deps", "node")),
        build(convexDir, extras, "browser", join("_deps", "extra")),
    ]);

    const sourceBytes = parts.reduce((n, p) => n + p.source, 0);
    const sourceMapBytes = parts.reduce((n, p) => n + p.map, 0);
    return {
        sourceBytes,
        sourceMapBytes,
        totalBytes: sourceBytes + sourceMapBytes,
        userModules: entryPoints.length + extras.length,
        emittedModules: parts.reduce((n, p) => n + p.files, 0),
    };
}

/** Byte size of the committed compiled pool, for the per-row headroom line. */
export function compiledPoolRows(repoRoot: string): number {
    const path = join(repoRoot, "data", "oracle-compiled-pool.json");
    if (!existsSync(path)) return 0;
    if (statSync(path).size === 0) return 0;
    return (JSON.parse(readFileSync(path, "utf8")) as unknown[]).length;
}
