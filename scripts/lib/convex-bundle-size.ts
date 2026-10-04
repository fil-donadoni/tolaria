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
 * WHAT THE REPRODUCTION ASSUMES, and asserts where it can. The CLI's
 * `doEsbuild` also wires in four plugins this module does not: `nodeShimsPlugin`,
 * `serverOnlyPlugin`, `wasmPlugin`, and the external-packages plugin driven by
 * `convex.json`'s `node.externalPackages`. All four are inert on a tree with no
 * `convex.json`, no `.wasm` import and no `server-only` import — this repo — and
 * `assertReproducible()` reds if that stops being true, because an
 * `externalPackages` entry would make this module OVERcount: it would bundle
 * what the real push marks external. It also pins the resolved `esbuild` to the
 * one `convex` itself depends on, since `esbuild` reaches this file only by
 * hoisting and a version split would measure with a different bundler than the
 * CLI runs. Last, the CLI's `hasUseNodeDirective` parses the module and only
 * falls back to a regex; this module uses the regex alone, a looser match on a
 * `"use node"` string that is not in directive position.
 *
 * The measurement is 0.028% low, and low for a known reason. The CLI bundles two files
 * `entryPoints()` excludes: `auth.config.ts` (`bundleAuthConfig`), which IS a
 * pushed module and is bundled here too, and `schema.ts` (`bundleSchema`),
 * which is NOT — the dump's 1,455 non-`_deps` entries carry `auth.config.js`
 * and no `schema.js` — so it is not counted. The residue is `metadata.json`,
 * whose length Convex also adds to `unzipped_size_bytes`. The budget's own
 * margin is ~313x that residue, so the residue can never be what decides a red.
 */
import esbuild from "esbuild";
import { deflateRawSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep, parse } from "node:path";

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

/** `useNodeDirectiveRegex` in the Convex bundler — what routes a file to the
 *  Node runtime, whose esbuild graph is separate from the isolate one. */
export const USE_NODE_DIRECTIVE = /^\s*("|')use node("|');?\s*$/m;

export interface ConvexBundleMeasurement {
    /** Bytes of emitted module source (the `.js` half of the push). */
    sourceBytes: number;
    /** Bytes of emitted source maps — Convex counts these too. */
    sourceMapBytes: number;
    /**
     * `sourceBytes + sourceMapBytes` — the unzipped package size, the axis of
     * both the documented 32 MiB and the enforced `MAX_UNZIPPED_PACKAGES_SIZE`.
     */
    totalBytes: number;
    /**
     * Sum of each emitted file deflated on its own (zlib default level) — an
     * estimate of the zip Convex checks against `MAX_ZIPPED_PACKAGES_SIZE`.
     * Per-file deflate is what a zip archive does, so the estimate is off only
     * by headers and the compression level Convex's CLI picks; the 25% margin
     * of {@link CONVEX_HARD_BOUND_FRACTION} dwarfs both.
     */
    zippedBytes: number;
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

/**
 * Convex's DOCUMENTED ceiling: 32 MiB "code size", per deployment. Not
 * enforced today (ADR 0113 Amendment III): cloud dev accepted 36 and 60 MiB
 * pushes, cloud prod 40 MiB. Convex may start enforcing it, so it stays the
 * number the warning distance is measured to.
 */
export const CONVEX_CODE_SIZE_LIMIT_BYTES = 32 * 1024 * 1024;

/**
 * `MAX_UNZIPPED_PACKAGES_SIZE` in the open-source backend
 * (`crates/model/src/source_packages/types.rs`, `PackageSize::verify_size`):
 * the ENFORCED ceiling on the pushed package, source maps included — the axis
 * {@link ConvexBundleMeasurement.totalBytes} measures. ADR 0113 Amendment III.
 */
export const CONVEX_MAX_UNZIPPED_PACKAGES_SIZE = 230_000_000;

/**
 * `MAX_ZIPPED_PACKAGES_SIZE`, same function: the ENFORCED ceiling on the
 * zipped package. The one refusal Amendment III observed tripped this one
 * ("Total module size exceeded the zipped maximum (101.37 MiB > maximum size
 * 85.83 MiB)"), on an incompressible module; code compresses well, so for
 * this repo the unzipped bound binds first. Both are asserted.
 */
export const CONVEX_MAX_ZIPPED_PACKAGES_SIZE = 90_000_000;

/**
 * The hard bound is this fraction of each ENFORCED ceiling — the same 75% the
 * user-module budget keeps against `MAX_USER_MODULES`. The quarter left over
 * is the room a red gate needs to be actionable rather than an outage: a push
 * Convex already refuses cannot be fixed by a smaller next commit, and the
 * exits Amendment III records (self-hosted knobs, the GRE as its own service)
 * are not a one-PR move.
 */
export const CONVEX_HARD_BOUND_FRACTION = 0.75;

/** Unzipped hard bound: a failure, in every lane (ADR 0113 Amendment III). */
export const CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES = Math.floor(
    CONVEX_MAX_UNZIPPED_PACKAGES_SIZE * CONVEX_HARD_BOUND_FRACTION
);

/** Zipped hard bound: a failure, in every lane (ADR 0113 Amendment III). */
export const CONVEX_BUNDLE_HARD_BOUND_ZIPPED_BYTES = Math.floor(
    CONVEX_MAX_ZIPPED_PACKAGES_SIZE * CONVEX_HARD_BOUND_FRACTION
);

/** `MAX_USER_MODULES` default in the open-source backend's knobs. */
export const CONVEX_MAX_USER_MODULES = 4096;

/**
 * 30 MiB: a WARNING distance to Convex's documented 32 MiB, never a failure
 * (ADR 0113 Amendment III point 4: "`check:convex-bundle` stays at 30 MiB as
 * a warning distance to the documented number, not as the edge of a
 * refusal"). Crossing it prints a WARN line in the `check:convex-bundle`
 * receipt — and so in every `health` log, which runs it inside `check:all` —
 * and in the lane's test output; the lane stays green. What fails is
 * {@link CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES} /
 * {@link CONVEX_BUNDLE_HARD_BOUND_ZIPPED_BYTES}, a margin below the ceilings
 * Convex actually enforces.
 *
 * WHY IT WAS A WALL, AND WHY IT IS NOT. Amendments I and II (issue #3051,
 * issue #3444) read the 32 MiB as a hard ceiling — "there is no 32 MiB budget
 * to move to" — so this number was a failure, 2 MiB short of an outage. Nobody
 * had watched Convex cloud refuse a push; Amendment III did, and the enforced
 * limit is 90 MB zipped / 230 MB unzipped. The wall reading is withdrawn; the
 * number stays as the distance to what Convex documents and may one day
 * enforce, at which point the exit ladder in Amendment III applies.
 *
 * IT WAS RAISED TO 31 MiB ONCE, and put back here (issue #1268 raised it,
 * issue #3444 restored it). The round trip is recorded rather than tidied
 * away, because both halves of it were right and the pair is the lesson.
 *
 * The raise was correct on its facts: the base tip sat at 29.99 MiB, so the
 * guard had stopped being a warning and had become a block on EVERY engine
 * change — one keyword's worth of source crossed it — and a gate no
 * legitimate change can pass teaches sessions to route around it. The
 * restore is correct on different facts: the CAUSE was found and removed.
 * `convex/debugScenarioGenerator.ts` is a `"use node"` action, whose esbuild
 * graph is separate, and it imported the card registry for two name lookups
 * — so the compiled pool was bundled TWICE. Cutting that one import gave
 * back 7,200,356 B and dropped the push to 23.25 MiB.
 *
 * What the pair still says, now that crossing the line WARNS instead of
 * failing: a bundle near the documented number is a symptom, and the first
 * move on seeing the WARN line is to ask what is IN the bundle, not to move
 * the number. (Issue #4810's measurement: ~10 MiB of today's ~30 is
 * code-splitting glue from set and test files being Convex entry points.)
 *
 * THE WARN WAS ANSWERED THAT WAY (issue #4811). The base tip measured
 * 31,464,045 B (30.01 MiB, 1,602 user modules), past the warning, and a third
 * of it was not code: every card-set file (`cards/sets/**`, ADR 0043) and
 * every single-dot `__tests__` helper was a Convex ENTRY POINT, so with
 * `splitting: true` each of the ~450 real entries opened with ~1,300
 * `import … from "./_deps/<hash>.js"` lines of chunk glue. Renaming them
 * multi-dot (`<colour>.cards.ts`, `*.helper.ts`, `*.fixture.ts`) — which the
 * CLI skips as an entry while still bundling it into whatever imports it —
 * measured 20,808,233 B (19.84 MiB) and 459 user modules on the same tree:
 * -10,655,812 B (10.16 MiB), with the compiled pool still emitted once.
 * {@link nonFunctionEntryPoints} is what keeps them out
 * (`convex/cards/__tests__/nonFunctionEntryPoints.test.ts`).
 */
export const CONVEX_BUNDLE_WARNING_BYTES = 30 * 1024 * 1024;

/**
 * `MAX_USER_MODULES` counts files under `convex/`, excluding `_deps/**`
 * chunks (`crates/application/src/lib.rs`: "Too many function files ({} >
 * maximum {}) in \"convex/\"") — a SECOND ceiling, on a different axis
 * from bytes. 3,072 is 75% of Convex's 4,096. It was 1,455 at
 * issue #3051 and 1,602 at issue #4811, when card-set files (one per set
 * colour) were still entry points; since that issue's multi-dot rename they
 * are not, and the count is 459 — real function modules only, so card-corpus
 * growth no longer moves it.
 */
export const CONVEX_USER_MODULE_BUDGET = 3072;

/**
 * Marginal bundled cost of one compiled-pool row, re-measured at issue #4811
 * by re-bundling the real `convex/` tree at +2,000 and +6,000 synthetic rows
 * (uniquified `id` and `name`), linear to four digits across both deltas
 * (1,384.7 and 1,384.5 B/row). It was 1,013 at issue #3444 (1,012.9 and
 * 1,012.7); the rise is the rows, not the bundle layout — the mean raw row
 * grew from 347 B to 527 B in between, and the pool is still one chunk.
 * Still ~2.6x the raw definition: the bundled object literal is fatter than
 * the JSON it came from (Convex sets `minifyWhitespace: false` — it breaks
 * their source maps), and source maps count.
 *
 * It was 2,086 at issue #3051, because the pool was then inlined TWICE — once
 * into the shared isolate chunk, and once into the `"use node"` graph, which
 * esbuild bundles separately. Issue #3444 cut the second copy (the LLM scenario
 * generator reached the card registry by import; it now reaches it by
 * `ctx.runQuery`), and the doubling went with it. If a future `"use node"`
 * module imports the registry again this number is wrong by 2x AGAIN, in the
 * dangerous direction — which is why `scripts/__tests__/convex-node-bundle-seam.test.ts`
 * guards the cut by cause and by effect rather than trusting the budget alone.
 *
 * Re-measuring it: write the synthetic pool with the SAME 4-space formatting
 * the file ships in. A compact rewrite changes source-map size on its own (VLQ
 * column deltas over one very long line) and the delta stops being linear —
 * 236 B/row at +2,000 against 514 B/row at +6,000, measured, all of it
 * artefact.
 */
export const MEASURED_BYTES_PER_POOL_ROW = 1385;

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

/**
 * Entry points in directories that hold no Convex function by construction:
 * card-set data (`cards/sets/**`, ADR 0043) and test support
 * (any `__tests__/` directory). Every such file the CLI discovers is a user module
 * of its own, and with `splitting: true` every module shared between entries
 * becomes a chunk that each importing entry opens with an `import` line — the
 * ~1,100 set files alone cost ~9 MiB of that glue and 1,114 user modules
 * (issue #4811). The fix is a multi-dot name (`<colour>.cards.ts`,
 * `*.helper.ts`, `*.fixture.ts`): the CLI skips it, and it stays importable.
 * Returns `convex/`-relative POSIX paths.
 */
export function nonFunctionEntryPoints(convexDir: string): string[] {
    return discoverEntryPoints(convexDir)
        .map((f) => relative(convexDir, f).split(sep).join("/"))
        .filter(
            (rel) =>
                rel.startsWith("cards/sets/") ||
                rel.split("/").slice(0, -1).includes("__tests__")
        );
}

/**
 * Options copied verbatim from the Convex CLI's `innerEsbuild` — everything
 * but the entry points, the platform and the output naming, which differ per
 * caller. Shared with `convex-heap.ts`, so the heap of one call is measured on
 * the bundle the push would produce.
 */
export const CONVEX_ESBUILD_OPTIONS = {
    bundle: true,
    format: "esm",
    target: "esnext",
    jsx: "automatic",
    conditions: ["convex", "module"],
    treeShaking: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    // Convex leaves whitespace unminified on purpose — it breaks their
    // source maps. Keeping the flag matters: it is ~40% of the bytes.
    minifyWhitespace: false,
    keepNames: true,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
} as const satisfies esbuild.BuildOptions;

async function build(
    convexDir: string,
    entryPoints: string[],
    platform: "browser" | "node",
    chunksFolder: string
): Promise<{
    source: number;
    map: number;
    zipped: number;
    files: number;
    inputs: string[];
}> {
    if (entryPoints.length === 0)
        return { source: 0, map: 0, zipped: 0, files: 0, inputs: [] };
    const result = await esbuild.build({
        ...CONVEX_ESBUILD_OPTIONS,
        entryPoints,
        platform,
        outdir: "out",
        outbase: convexDir,
        write: false,
        sourcemap: true,
        sourcesContent: false,
        splitting: true,
        chunkNames: join(chunksFolder, "[hash]"),
        metafile: true,
    });
    let source = 0;
    let map = 0;
    let zipped = 0;
    let files = 0;
    for (const file of result.outputFiles ?? []) {
        zipped += deflateRawSync(file.contents).length;
        if (file.path.endsWith(".map")) map += file.contents.length;
        else {
            source += file.contents.length;
            files += 1;
        }
    }
    return {
        source,
        map,
        zipped,
        files,
        inputs: Object.keys(result.metafile?.inputs ?? {}),
    };
}

/**
 * Reds when one of the assumptions this reproduction rests on stops holding.
 * Each of these makes the CLI's bundle diverge from this one SILENTLY, and a
 * budget guard that has quietly stopped measuring the pushed artifact is worse
 * than no guard at all.
 */
function assertReproducible(repoRoot: string, inputs: string[]): void {
    const convexPkg = JSON.parse(
        readFileSync(
            join(repoRoot, "node_modules", "convex", "package.json"),
            "utf8"
        )
    ) as { version: string; dependencies?: Record<string, string> };
    const pinned = convexPkg.dependencies?.esbuild;
    if (pinned !== undefined && pinned !== esbuild.version) {
        throw new Error(
            `esbuild version drift: convex ${convexPkg.version} bundles with esbuild ` +
                `${pinned}, this process resolved ${esbuild.version}. \`esbuild\` reaches ` +
                `scripts/lib/convex-bundle-size.ts only by hoisting, so a split resolution ` +
                `measures the Convex bundle with a different bundler than \`convex deploy\` ` +
                `runs. Align the versions, or declare esbuild explicitly at convex's pin.`
        );
    }

    const convexJsonPath = join(repoRoot, "convex.json");
    if (existsSync(convexJsonPath)) {
        const cfg = JSON.parse(readFileSync(convexJsonPath, "utf8")) as {
            node?: { externalPackages?: string[] };
        };
        const external = cfg.node?.externalPackages ?? [];
        if (external.length > 0) {
            throw new Error(
                `convex.json declares node.externalPackages [${external.join(", ")}]. ` +
                    `The real push marks those external and does NOT bundle them; this ` +
                    `module has no external-packages plugin, so it would OVERcount. Wire ` +
                    `\`createExternalPlugin\` in before trusting the number again.`
            );
        }
    }

    const exotic = inputs.filter(
        (i) => i.endsWith(".wasm") || /(^|\/)server-only(\/|$)/.test(i)
    );
    if (exotic.length > 0) {
        throw new Error(
            `the convex graph now imports ${exotic.slice(0, 3).join(", ")}. The CLI ` +
                `bundles those through \`wasmPlugin\` / \`serverOnlyPlugin\`, which this ` +
                `module does not run, so the measurement no longer matches the push.`
        );
    }
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

    assertReproducible(
        join(convexDir, ".."),
        parts.flatMap((p) => p.inputs)
    );

    const sourceBytes = parts.reduce((n, p) => n + p.source, 0);
    const sourceMapBytes = parts.reduce((n, p) => n + p.map, 0);
    return {
        sourceBytes,
        sourceMapBytes,
        totalBytes: sourceBytes + sourceMapBytes,
        zippedBytes: parts.reduce((n, p) => n + p.zipped, 0),
        userModules: entryPoints.length + extras.length,
        emittedModules: parts.reduce((n, p) => n + p.files, 0),
    };
}

/** The thresholds {@link assessConvexBundle} reads — overridable so its tests
 *  can place a synthetic measurement on either side of each line. */
export interface ConvexBundleBounds {
    warningBytes: number;
    hardUnzippedBytes: number;
    hardZippedBytes: number;
    userModuleBudget: number;
}

export const CONVEX_BUNDLE_BOUNDS: ConvexBundleBounds = {
    warningBytes: CONVEX_BUNDLE_WARNING_BYTES,
    hardUnzippedBytes: CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES,
    hardZippedBytes: CONVEX_BUNDLE_HARD_BOUND_ZIPPED_BYTES,
    userModuleBudget: CONVEX_USER_MODULE_BUDGET,
};

/**
 * Splits a measurement into what ADR 0113 Amendment III says it is:
 * `warnings` (past the 30 MiB distance to the documented 32 MiB — printed,
 * never failing) and `failures` (past a hard bound below a ceiling Convex
 * ENFORCES, or past the user-module budget). The one place the verdict is
 * decided: `check:convex-bundle` and the lane test both read it, so the
 * receipt and the gate cannot disagree on which line is the wall.
 */
export function assessConvexBundle(
    m: Pick<
        ConvexBundleMeasurement,
        "totalBytes" | "zippedBytes" | "userModules"
    >,
    bounds: ConvexBundleBounds = CONVEX_BUNDLE_BOUNDS
): { warnings: string[]; failures: string[] } {
    const fmt = (n: number) => n.toLocaleString("en-US");
    const warnings: string[] = [];
    const failures: string[] = [];
    if (m.totalBytes > bounds.hardUnzippedBytes) {
        failures.push(
            `Convex function bundle is ${fmt(m.totalBytes)} B unzipped > hard bound ` +
                `${fmt(bounds.hardUnzippedBytes)} B (${CONVEX_HARD_BOUND_FRACTION * 100}% of ` +
                `Convex MAX_UNZIPPED_PACKAGES_SIZE ${fmt(CONVEX_MAX_UNZIPPED_PACKAGES_SIZE)} B, ` +
                `the enforced ceiling — ADR 0113 Amendment III). Ask what is IN the bundle ` +
                `before moving the number; the exits are Amendment III's ladder.`
        );
    }
    if (m.zippedBytes > bounds.hardZippedBytes) {
        failures.push(
            `Convex function bundle is ~${fmt(m.zippedBytes)} B zipped > hard bound ` +
                `${fmt(bounds.hardZippedBytes)} B (${CONVEX_HARD_BOUND_FRACTION * 100}% of ` +
                `Convex MAX_ZIPPED_PACKAGES_SIZE ${fmt(CONVEX_MAX_ZIPPED_PACKAGES_SIZE)} B, ` +
                `the enforced ceiling — ADR 0113 Amendment III).`
        );
    }
    if (m.totalBytes > bounds.warningBytes) {
        warnings.push(
            `Convex function bundle is ${fmt(m.totalBytes)} B > the ` +
                `${fmt(bounds.warningBytes)} B warning distance to Convex's DOCUMENTED ` +
                `${fmt(CONVEX_CODE_SIZE_LIMIT_BYTES)} B (32 MiB, not enforced today); the ` +
                `enforced ceiling is MAX_UNZIPPED_PACKAGES_SIZE ` +
                `${fmt(CONVEX_MAX_UNZIPPED_PACKAGES_SIZE)} B / MAX_ZIPPED_PACKAGES_SIZE ` +
                `${fmt(CONVEX_MAX_ZIPPED_PACKAGES_SIZE)} B (ADR 0113 Amendment III point 4). ` +
                `Not a failure — ask what is IN the bundle.`
        );
    }
    if (m.userModules > bounds.userModuleBudget) {
        failures.push(
            `${fmt(m.userModules)} files under convex/ become user modules > budget ` +
                `${fmt(bounds.userModuleBudget)}, against Convex's MAX_USER_MODULES ` +
                `${fmt(CONVEX_MAX_USER_MODULES)} ("Too many function files ... in \\"convex/\\"").`
        );
    }
    return { warnings, failures };
}

/**
 * Budget on the `"use node"` half of the push alone (issue #3444).
 *
 * Measured at 669,905 B once the card registry was cut out of the graph — the
 * Anthropic SDK and four small `convex/` modules. 1.5 MiB is 2.3x that, room
 * for the SDK to grow, and less than one re-entry of the compiled pool needs:
 * at the measured {@link MEASURED_BYTES_PER_POOL_ROW} the pool alone is
 * ~2.36 MB today, so the regression this exists to catch cannot hide under it.
 *
 * Deliberately NOT part of `check:convex-bundle`'s total, which is a sum and
 * so cannot say WHICH half grew. Enforced by
 * `scripts/__tests__/convex-node-bundle-seam.test.ts`, in the light lane.
 */
export const CONVEX_NODE_BUNDLE_BUDGET_BYTES = 1.5 * 1024 * 1024;

/**
 * The `"use node"` half of the push, on its own — entry points, the esbuild
 * INPUTS its graph pulled in, and its bytes (issue #3444).
 *
 * Convex bundles Node actions in a SEPARATE esbuild invocation from the
 * isolate modules, so every module a `"use node"` file reaches is emitted a
 * SECOND time. That is not a rounding error here: one import of `./cards` in
 * `convex/debugScenarioGenerator.ts` inlined `data/oracle-compiled-pool.json`
 * twice and cost 7,200,356 B of the 30 MiB budget — 23% of the whole push for
 * two name lookups.
 *
 * `measureConvexBundle` sums the halves and cannot see that. This function
 * exposes the node half so a guard can assert, by CAUSE (which modules are in
 * the graph) and by EFFECT (how many bytes), that the cut stays cut —
 * `scripts/__tests__/convex-node-bundle-seam.test.ts`.
 */
export async function measureConvexNodeBundle(convexDir: string): Promise<{
    /** `"use node"` entry points, repo-relative. Empty means the guard reading
     *  this is vacuous, and it must say so rather than pass. */
    entryPoints: string[];
    /** Every module esbuild pulled into the node graph, as metafile keys
     *  (repo-relative paths, `node_modules/...` included). */
    inputs: string[];
    /** Source + source-map bytes of the node half alone. */
    totalBytes: number;
}> {
    const node = discoverEntryPoints(convexDir).filter((fpath) =>
        USE_NODE_DIRECTIVE.test(readFileSync(fpath, "utf8"))
    );
    const built = await build(convexDir, node, "node", join("_deps", "node"));
    return {
        entryPoints: node.map((f) => relative(join(convexDir, ".."), f)),
        inputs: built.inputs,
        totalBytes: built.source + built.map,
    };
}

/** Byte size of the committed compiled pool, for the per-row headroom line. */
export function compiledPoolRows(repoRoot: string): number {
    const path = join(repoRoot, "data", "oracle-compiled-pool.json");
    if (!existsSync(path)) return 0;
    if (statSync(path).size === 0) return 0;
    return (JSON.parse(readFileSync(path, "utf8")) as unknown[]).length;
}
