/**
 * Seeds a fresh worktree's per-tree build caches from the primary checkout
 * (issue #3776, ADR 0136 §9).
 *
 * WHY. Two of the lane's checks are incremental by design and cold by
 * accident. `tsc -b` keeps one `.tsbuildinfo` per project under
 * `node_modules/.tmp/` and eslint keeps its result cache under
 * `node_modules/.cache/` — both gitignored, so every `git worktree add` starts
 * from nothing. Measured over a fortnight: `tsc -b --noEmit` 56s over 365 runs
 * (5.7h), `eslint .` 69s over 42 runs, and the whole of it was the cold start.
 * Measured on 2026-09-17 at load ~15–20: `tsc -b --noEmit` 113.8s cold →
 * 66.0s seeded with a week-old primary file → 0.2s warm; `eslint .` 77.2s
 * cold → 2.3s seeded.
 *
 * Both caches validate by CONTENT, so a stale seed is safe:
 *
 *   - `.tsbuildinfo` records a hash per source file and stores every path
 *     RELATIVE to itself, so the primary's file drops into the same relative
 *     location in any worktree and tsc re-checks exactly the files whose hash
 *     moved. A file from a different commit is not wrong, only less warm.
 *   - eslint's cache (`file-entry-cache`) validates each entry by content hash
 *     under `--cache-strategy content` and by a hash of the resolved config —
 *     but it keys every entry by ABSOLUTE path, so a byte copy would never
 *     hit. The seed rewrites the primary's path prefix to this worktree's
 *     inside the JSON text (both prefixes JSON-escaped, so an odd character in
 *     a checkout path cannot corrupt the document) and validates the result
 *     parses before writing it. The `metadata` strategy would defeat the seed
 *     entirely: a fresh checkout's mtimes differ from the primary's on every
 *     file, so `package.json`'s `lint` must keep `--cache-strategy content`.
 *
 * The vitest results cache (`node_modules/.vite/vitest/<hash>/results.json`,
 * issue #4483) is the third: it records each test file's last duration, keyed
 * by `<project>:<path RELATIVE to the root>`, so a byte copy hits in any
 * worktree. It is read ONLY by the sequencer (`scripts/lib/vitest-sequencer.ts`)
 * to start the longest project and file first — an order, never a selection,
 * so a stale seed costs wall time at worst, never a test.
 *
 * A cache is an optimisation, never an input: nothing here can fail the
 * bootstrap. A missing source is reported as a skip, and the caller wraps the
 * whole step so an unexpected error becomes a skip too.
 *
 * Node builtins only — `bootstrap-worktree.ts` imports this and must run in a
 * tree that has no `node_modules` yet (its own test pins that transitively).
 */
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Where every `tsconfig.*.json` in this repo points its `tsBuildInfoFile`. */
export const TSBUILDINFO_DIR = "node_modules/.tmp";

/**
 * The eslint result cache. `package.json`'s `lint` passes this exact path as
 * `--cache-location`; `worktree-bootstrap.test.ts` pins the two together.
 * A FILE, not a directory, on purpose: given a directory eslint names the
 * cache file after a hash of the cwd, which differs per worktree and would
 * make the seed unreachable by construction.
 */
export const ESLINT_CACHE_FILE = "node_modules/.cache/eslint.json";

/**
 * Caches keyed by absolute path in a JSON document — the `file-entry-cache`
 * shape. Each is seeded by rewriting the primary's prefix to the worktree's.
 */
/**
 * Vitest's cache root. One sub-directory per config, named by a hash of the
 * config's project name — copied whole-directory-by-directory rather than by a
 * hard-coded hash, so a config renaming itself cannot orphan the seed.
 */
export const VITEST_CACHE_DIR = "node_modules/.vite/vitest";

export const PATH_KEYED_CACHES = [
    { label: "eslint cache", file: ESLINT_CACHE_FILE },
] as const;

export interface SeedReport {
    /** One line per seeded artifact, for the bootstrap receipt. */
    done: string[];
    /** One line per artifact left alone, with the reason. */
    skipped: string[];
}

export interface SeedOptions {
    /** Absolute path of the primary checkout (the one that owns `.git/`). */
    primary: string;
    /** Absolute path of the worktree being bootstrapped. */
    cwd: string;
    /** Replace a cache that is already present. */
    force?: boolean;
}

/**
 * Seeds `node_modules/.tmp/*.tsbuildinfo` and every path-keyed cache from the
 * primary checkout. Pure over the filesystem: no process state, no git.
 */
export function seedWorktreeCaches(opts: SeedOptions): SeedReport {
    const report: SeedReport = { done: [], skipped: [] };
    seedTsBuildInfo(opts, report);
    seedVitestResults(opts, report);
    for (const cache of PATH_KEYED_CACHES) {
        seedPathKeyedCache(opts, cache.label, cache.file, report);
    }
    return report;
}

function seedTsBuildInfo(opts: SeedOptions, report: SeedReport): void {
    const label = "tsbuildinfo seed";
    const srcDir = join(opts.primary, TSBUILDINFO_DIR);
    const files = existsSync(srcDir)
        ? readdirSync(srcDir)
              .filter((f) => f.endsWith(".tsbuildinfo"))
              .sort()
        : [];
    if (files.length === 0) {
        report.skipped.push(`${label} (primary has none — cold type-check)`);
        return;
    }
    const dstDir = join(opts.cwd, TSBUILDINFO_DIR);
    const copied: string[] = [];
    const present: string[] = [];
    for (const file of files) {
        const dst = join(dstDir, file);
        if (existsSync(dst) && !opts.force) {
            present.push(file);
            continue;
        }
        mkdirSync(dstDir, { recursive: true });
        copyFileSync(join(srcDir, file), dst);
        copied.push(file);
    }
    if (copied.length > 0) {
        report.done.push(
            `${label} (${copied.length} file${copied.length === 1 ? "" : "s"} from primary: ${copied.join(", ")})`
        );
    }
    if (present.length > 0) {
        report.skipped.push(
            `${label} (${present.length} present: ${present.join(", ")})`
        );
    }
}

function seedVitestResults(opts: SeedOptions, report: SeedReport): void {
    const label = "vitest results cache";
    const srcDir = join(opts.primary, VITEST_CACHE_DIR);
    const dirs = existsSync(srcDir)
        ? readdirSync(srcDir)
              .filter((d) => existsSync(join(srcDir, d, "results.json")))
              .sort()
        : [];
    if (dirs.length === 0) {
        report.skipped.push(`${label} (primary has none — name order)`);
        return;
    }
    let copied = 0;
    let present = 0;
    for (const dir of dirs) {
        const dst = join(opts.cwd, VITEST_CACHE_DIR, dir, "results.json");
        if (existsSync(dst) && !opts.force) {
            present++;
            continue;
        }
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(join(srcDir, dir, "results.json"), dst);
        copied++;
    }
    if (copied > 0) {
        report.done.push(
            `${label} (${copied} file${copied === 1 ? "" : "s"} from primary)`
        );
    }
    if (present > 0) report.skipped.push(`${label} (${present} present)`);
}

/**
 * The needle and its replacement are the JSON-ESCAPED forms of the two
 * prefixes, each with its trailing separator so `…/tolaria/` can never match
 * inside `…/tolaria-issue-N/`. Both `""` quotes of `JSON.stringify` are
 * stripped; the escaping of what is between them is what we want.
 */
function jsonEscaped(s: string): string {
    return JSON.stringify(s).slice(1, -1);
}

function seedPathKeyedCache(
    opts: SeedOptions,
    label: string,
    relFile: string,
    report: SeedReport
): void {
    const src = join(opts.primary, relFile);
    const dst = join(opts.cwd, relFile);
    if (!existsSync(src)) {
        report.skipped.push(`${label} (primary has none — cold run)`);
        return;
    }
    if (existsSync(dst) && !opts.force) {
        report.skipped.push(`${label} (present)`);
        return;
    }
    const from = jsonEscaped(`${opts.primary}/`);
    const to = jsonEscaped(`${opts.cwd}/`);
    const text = readFileSync(src, "utf8");
    const parts = text.split(from);
    const rewritten = parts.join(to);
    try {
        JSON.parse(rewritten);
    } catch {
        report.skipped.push(
            `${label} (primary's ${relFile} is not valid JSON after the path rewrite — cold run)`
        );
        return;
    }
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, rewritten);
    report.done.push(
        `${label} (seeded from primary, ${parts.length - 1} paths rewritten)`
    );
}
