/**
 * Content-hash cache for the pure drift guards (issue #3646, PRD #3643).
 *
 * A guard that is a pure function of its input files — `check:index`,
 * `check:stubs`, `check:oracle`, `cr:lint` — has nothing new to say about a
 * tree it already proved green, and each of them runs inside every
 * `check:pr`/`check:lane`. So each guard DECLARES what it reads
 * (`GuardInputs`), hashes that before doing any work, and skips with
 * `cached PASS (<hash>)` when the cache holds a green record for exactly that
 * hash. Anything else — a miss, an unhashable tree, a bypass — runs the guard,
 * and only an exit 0 is recorded. A red is never cached, so a failing guard
 * re-proves itself every time.
 *
 * THE HASH is taken from git, not from re-reading every file: the index blob
 * sha of each tracked input (`git ls-files -s`, free — git already hashed
 * them) plus the CONTENT of every input the index cannot vouch for
 * (`git ls-files -m -o`: modified, deleted, untracked-not-ignored). Reading all
 * ~5,000 files `cr:lint` scans measured 350–500ms, more than `check:index`
 * itself; the index form measured 70–190ms. Trusting `-m` is trusting git's
 * stat cache, including its racy-git handling: an entry whose mtime is not
 * older than the index is compared by content, not by stat, so a same-tick
 * edit still reads as modified. Gitignored inputs a guard consults
 * when present (`ignoredFiles`) and non-file inputs (`keys`, e.g. the
 * merge-base a guard diffs against) are folded in explicitly — git cannot see
 * either. This module's own source is an input of every guard, so changing the
 * hashing scheme invalidates every record.
 *
 * THE DECLARATION IS THE RISK: an input a guard reads but does not declare is a
 * stale PASS nobody sees. Declare wide — `convex/**` rather than the files a
 * registry import happens to reach today. A too-wide declaration costs a cache
 * miss; a too-narrow one costs a guard.
 *
 * THE BYPASS: `TOLARIA_GUARD_CACHE=off` reads no record (and still writes one on
 * green). `health-main.ts` sets it, so `bun run release` and `bun run health`
 * prove every guard from scratch on the tip they gate.
 *
 * Records live in the gitignored telemetry directory (`.claude/telemetry/
 * guard-cache/<guard>/<hash>`), one file per green hash, so concurrent sessions
 * never merge-race a shared JSON file. Node builtins only — the guards run
 * under bun, their tests under vitest/node.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface GuardInputs {
    /** The guard's script name — the cache namespace and the printed label. */
    readonly guard: string;
    /** Repo-relative globs (git `:(glob)` pathspecs) of every tracked or
     *  untracked-not-ignored file the verdict is a function of. */
    readonly globs: readonly string[];
    /** Gitignored files the guard reads when present, hashed by content —
     *  absence is hashed too, so a cache appearing is a miss. */
    readonly ignoredFiles?: readonly string[];
    /** Non-file inputs, e.g. the base-branch commit a guard compares against. */
    readonly keys?: readonly string[];
}

export type GuardCacheDecision =
    | { readonly kind: "cached"; readonly hash: string }
    | {
          readonly kind: "run";
          readonly hash: string | null;
          readonly reason: "miss" | "bypassed" | "unhashable";
      };

export const GUARD_CACHE_BYPASS_ENV = "TOLARIA_GUARD_CACHE";

/**
 * What a guard that loads the card registry (`getAllCards()`) reads. `convex/**`
 * imports `data/**` (boosters, the compiled pool, legality) and
 * `scripts/lib/**` (marker and baseline helpers), so all three are declared
 * whole, plus the files that decide how bun resolves those imports.
 */
export const CARD_REGISTRY_GLOBS = [
    "convex/**",
    "data/**",
    "scripts/lib/**",
    "package.json",
    "bun.lock*",
    "tsconfig*.json",
] as const;

/** Every guard's hash covers the scheme that produced it. */
const SELF = "scripts/lib/guard-cache.ts";
const SCHEME = "guard-cache/v1";
/** Records kept per guard — enough for every live worktree's tree. */
const KEEP_PER_GUARD = 64;
const SHORT = 12;

function git(root: string, args: readonly string[]): string {
    return execFileSync("git", [...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024,
    });
}

const nulSplit = (out: string) => out.split("\0").filter(Boolean);

function hashFile(hash: ReturnType<typeof createHash>, path: string): void {
    try {
        hash.update(readFileSync(path));
    } catch {
        hash.update("\0<absent>\0");
    }
}

/**
 * The sha256 of everything `inputs` declares, as seen from `root`; `null` when
 * git cannot answer (not a work tree, git missing) — an unhashable tree runs
 * the guard, it never skips it.
 */
export function inputHash(inputs: GuardInputs, root: string): string | null {
    const pathspecs = [...inputs.globs, SELF].map((g) => `:(glob)${g}`);
    let staged: string[];
    let unvouched: string[];
    try {
        staged = nulSplit(
            git(root, ["ls-files", "-s", "-z", "--", ...pathspecs])
        );
        unvouched = [
            ...new Set(
                nulSplit(
                    git(root, [
                        "ls-files",
                        "-z",
                        "-m",
                        "-o",
                        "--exclude-standard",
                        "--",
                        ...pathspecs,
                    ])
                )
            ),
        ].sort();
    } catch {
        return null;
    }
    const hash = createHash("sha256");
    hash.update(`${SCHEME}\0${inputs.guard}\0${pathspecs.join("\0")}\0`);
    for (const line of staged) hash.update(`${line}\0`);
    for (const file of unvouched) {
        hash.update(`\0worktree\0${file}\0`);
        hashFile(hash, join(root, file));
    }
    for (const file of inputs.ignoredFiles ?? []) {
        hash.update(`\0ignored\0${file}\0`);
        hashFile(hash, join(root, file));
    }
    for (const key of inputs.keys ?? []) hash.update(`\0key\0${key}\0`);
    return hash.digest("hex");
}

/** `.claude/telemetry/guard-cache` under the session's project — the same root
 *  `gate.ts` logs telemetry to. */
export function defaultCacheDir(
    env = process.env,
    cwd = process.cwd()
): string {
    return join(
        env.CLAUDE_PROJECT_DIR ?? cwd,
        ".claude",
        "telemetry",
        "guard-cache"
    );
}

const recordPath = (cacheDir: string, guard: string, hash: string) =>
    join(cacheDir, guard.replace(/[^A-Za-z0-9_.-]/g, "_"), hash);

export function hasPass(
    cacheDir: string,
    guard: string,
    hash: string
): boolean {
    return existsSync(recordPath(cacheDir, guard, hash));
}

/** Record a green run. Best effort: a cache that cannot be written only costs
 *  the next run its skip. */
export function recordPass(
    cacheDir: string,
    guard: string,
    hash: string,
    now = new Date()
): void {
    const path = recordPath(cacheDir, guard, hash);
    const dir = join(path, "..");
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            path,
            `${JSON.stringify({ guard, hash, verdict: "PASS", at: now.toISOString() })}\n`
        );
        const records = readdirSync(dir)
            .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        for (const stale of records.slice(KEEP_PER_GUARD))
            rmSync(join(dir, stale.name), { force: true });
    } catch {
        /* the cache is never load-bearing */
    }
}

export function decide(
    inputs: GuardInputs,
    opts: { root: string; cacheDir: string; env?: NodeJS.ProcessEnv }
): GuardCacheDecision {
    const hash = inputHash(inputs, opts.root);
    if (hash === null) return { kind: "run", hash, reason: "unhashable" };
    if ((opts.env ?? process.env)[GUARD_CACHE_BYPASS_ENV] === "off")
        return { kind: "run", hash, reason: "bypassed" };
    return hasPass(opts.cacheDir, inputs.guard, hash)
        ? { kind: "cached", hash }
        : { kind: "run", hash, reason: "miss" };
}

const REASON: Record<"miss" | "bypassed" | "unhashable", string> = {
    miss: "no green record for these inputs",
    bypassed: `cache bypassed (${GUARD_CACHE_BYPASS_ENV}=off)`,
    unhashable: "inputs could not be hashed — git unavailable",
};

/** The one line every cached guard prints before it does anything else. */
export function decisionLine(
    guard: string,
    decision: GuardCacheDecision
): string {
    const short = decision.hash?.slice(0, SHORT) ?? "unhashed";
    return decision.kind === "cached"
        ? `✓ ${guard}: cached PASS (${short}) — inputs unchanged since a green run`
        : `▶ ${guard}: ran (${short}) — ${REASON[decision.reason]}`;
}

/**
 * The CLI seam: call at the top of a guard, BEFORE its expensive imports. On a
 * cached PASS it prints and exits 0; otherwise it prints that the guard runs
 * and records the hash iff the process exits 0.
 */
export function enterGuardCache(
    inputs: GuardInputs,
    root: string = process.cwd()
): void {
    const cacheDir = defaultCacheDir();
    const decision = decide(inputs, { root, cacheDir });
    console.log(decisionLine(inputs.guard, decision));
    if (decision.kind === "cached") process.exit(0);
    const { hash } = decision;
    if (hash === null) return;
    process.on("exit", (code) => {
        if (code === 0) recordPass(cacheDir, inputs.guard, hash);
    });
}
