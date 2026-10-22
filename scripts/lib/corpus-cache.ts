// The Card Corpus cache against its pin (issue #6381).
//
// `data/oracle-corpus.json.gz` is gitignored and moves between checkouts by
// COPY: a worktree that lacks one takes the primary checkout's. The pin
// (`data/oracle-corpus.pin.json`, committed) records the sha256 of the reduced
// payload the lockfile was compiled from — and nothing compared the two. So a
// re-pin in one checkout handed its corpus to every worktree still pinned to
// the old one, and, after a re-pin merged, every worktree pinned to the NEW
// bulk took a primary cache of the OLD one; `derive:sync`, which commits the
// whole lockfile, would then rewrite the rows from the wrong corpus.
//
// A cache is usable only for a tree whose pin names its bytes. This module is
// that comparison and the one seeding decision every copy site shares — keep a
// matching cache, copy the primary's only if IT matches this tree's pin, else
// download the pinned bulk — with the I/O injected so each branch is testable
// without a 25 MB file or the network.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * The gitignored Card Corpus cache, repo-relative.
 *
 * Kept relative (rather than importing `oracle-corpus.ts`'s absolute
 * `CORPUS_PATH`) because a caller has to ask the question about the WORKTREE
 * it was invoked in, not about the checkout the module happens to live in. A
 * test pins the two against each other so there is still one authority.
 */
export const CORPUS_CACHE_REL = "data/oracle-corpus.json.gz";
export const CORPUS_PIN_REL = "data/oracle-corpus.pin.json";

/** sha256 of a cache file's reduced payload — the bytes a pin's `sha256`
 *  names (`oracle-corpus.ts` hashes the JSON before gzipping it). */
export function corpusCacheSha(path: string): string {
    return createHash("sha256")
        .update(gunzipSync(readFileSync(path)))
        .digest("hex");
}

/** The `sha256` the tree at `root` is pinned to, or null for a pin-less tree. */
export function pinnedSha(root: string): string | null {
    const path = join(root, CORPUS_PIN_REL);
    if (!existsSync(path)) return null;
    const pin = JSON.parse(readFileSync(path, "utf8")) as { sha256?: unknown };
    return typeof pin.sha256 === "string" ? pin.sha256 : null;
}

/** The refusal a mismatched cache earns, naming both hashes and the fix. */
export function corpusPinMismatch(
    path: string,
    cacheSha: string,
    pinSha: string
): string {
    return (
        `oracle corpus cache does not match the pin (issue #6381)\n` +
        `  cache: ${cacheSha} (${path})\n` +
        `  pin:   ${pinSha} (${CORPUS_PIN_REL})\n` +
        `It was compiled from a different Scryfall bulk than this tree is pinned to — ` +
        `typically copied from a checkout on another pin. Fix: bun run oracle:corpus ` +
        `(re-downloads THE PINNED bulk; never --repin)`
    );
}

export interface CorpusSeedDeps {
    readonly exists: (path: string) => boolean;
    /** Content hash of a cache file, as `corpusCacheSha`. */
    readonly sha: (path: string) => string;
    readonly copy: (from: string, to: string) => void;
    /** Fetch the pinned bulk into `root`'s cache; false on failure. */
    readonly fetchPinned: (root: string) => boolean;
}

export type CorpusSeed =
    | { readonly ok: true; readonly how: "kept" | "copied" | "fetched" }
    | { readonly ok: false; readonly why: string };

/**
 * Give the tree at `root` a corpus cache matching ITS pin.
 *
 *   1. its own cache matches → kept;
 *   2. the primary's cache matches this tree's pin → copied;
 *   3. otherwise the pinned bulk is downloaded → fetched.
 *
 * A pin-less tree keeps the old rule (any cache is taken), since there is
 * nothing to compare against. A failed fetch is a failure: a mismatched file
 * is never the fallback, because compiling against it is the silent rewrite
 * this module exists to stop.
 */
export function seedPinnedCorpus(
    root: string,
    primary: string,
    pinSha: string | null,
    deps: CorpusSeedDeps
): CorpusSeed {
    const dest = join(root, CORPUS_CACHE_REL);
    const source = join(primary, CORPUS_CACHE_REL);
    const usable = (path: string): boolean =>
        deps.exists(path) && (pinSha === null || deps.sha(path) === pinSha);
    if (usable(dest)) return { ok: true, how: "kept" };
    if (source !== dest && usable(source)) {
        deps.copy(source, dest);
        return { ok: true, how: "copied" };
    }
    if (deps.fetchPinned(root) && usable(dest))
        return { ok: true, how: "fetched" };
    return {
        ok: false,
        why:
            `no corpus cache matching the pin${pinSha === null ? "" : ` ${pinSha.slice(0, 12)}`} ` +
            `here (${dest}), in the primary checkout (${source}), or from the pinned bulk download`,
    };
}

/** The real I/O: fs, the gunzip hash, and `oracle:corpus` (which re-downloads
 *  the pinned bulk when the cache present does not match). */
export const realCorpusSeedDeps: CorpusSeedDeps = {
    exists: existsSync,
    sha: corpusCacheSha,
    copy: (from, to) => {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
    },
    fetchPinned: (root) =>
        spawnSync("bun", ["scripts/oracle-corpus.ts"], {
            cwd: root,
            stdio: "inherit",
        }).status === 0,
};
