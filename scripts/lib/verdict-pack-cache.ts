// The Verdict pack on a development machine: one fetch per lock, a
// content-addressed cache, and nothing believed that the lock does not pin
// (issue #3581, PRD #3574, ADR 0128 §9 / §10).
//
// ONE OBJECT PER LOCK. A lock's corpus is read from the single pack its
// `packHash` names (`packs/<packHash>.jsonl.gz`, `pack.ts`) — one GET, never
// one per verdict and never a listing.
//
// THE CACHE IS KEYED BY CONTENT. The pack is kept at its store name under
// `~/.cache/tolaria/verdicts/`: outside every worktree, so `land` removing one
// does not re-buy the download, and named by the hash of what it holds, so it
// never needs invalidating — a new corpus is a new name, and two locks over
// one pack share one file. A warm cache makes NO network call and never
// builds a store client, so a machine with a warm cache needs no read key.
//
// NOTHING IS BELIEVED. Cached or fetched, a pack is gunzipped, its text hashed
// against the lock's `packHash`, its ids checked to be exactly the lock's
// (`parseVerdictPack`) and every payload re-hashed against its id
// (`verdictsFromLock`) before a verdict is returned. A cached file that fails
// the hash is treated as absent — refetched and replaced — because the cache
// is this machine's disk, not a source of truth. A fetched pack that fails
// anything throws and is never written.
//
// WHY A FETCH DOES NOT BREAK "OFFLINE BY CONTRACT". The object is pinned by a
// hash in a committed file, so the network can make a run fail but can never
// change what a passing run computed — the property the contract protects,
// and the reason a lockfile'd dependency may be downloaded. `bun run
// verdicts:sync` warms the cache ahead of losing connectivity.
//
// `worktree:init` does NOT warm it: a bootstrap must not buy an artefact the
// session may never use.
//
// Imports `lockSource.ts`, never the verdicts index: the index reaches the
// blade registry and, through it, `lib.dom` (`lockedCorpus.ts` says how).

import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
    VERDICT_LOCK_PATH,
    parseVerdictLock,
    verdictsFromLock,
    type StoredVerdictPayload,
    type VerdictLock,
} from "../../convex/gre/ai/verdicts/lockSource";
import {
    encodeVerdictPack,
    parseVerdictPack,
    verdictPackObjectName,
} from "../../convex/gre/ai/verdicts/pack";
import type { Verdict } from "../../convex/gre/ai/verdicts/types";
import type { VerdictStoreReader } from "../../convex/verdictStore";

/** This machine's verdict cache — under the home directory, outside every
 *  checkout. */
export function verdictCacheDir(home: string = homedir()): string {
    return join(home, ".cache", "tolaria", "verdicts");
}

/** Where the pack `packHash` names is cached: its store name, under the
 *  cache. */
export function cachedVerdictPackPath(
    cacheDir: string,
    packHash: string
): string {
    return join(cacheDir, verdictPackObjectName(packHash));
}

/** A pack's hash: sha256 over its uncompressed text (`pack.ts` says why not
 *  over the gzip). */
export function verdictPackHash(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The pack for `entries` as the store holds it — what a promotion uploads
 *  (issue #3583), and what a test plays the bucket with. */
export function packVerdicts(entries: readonly StoredVerdictPayload[]): {
    packHash: string;
    bytes: Uint8Array;
} {
    const text = encodeVerdictPack(entries);
    return {
        packHash: verdictPackHash(text),
        bytes: new Uint8Array(gzipSync(text)),
    };
}

/** Where a lock's pack comes from. */
export type VerdictPackSource = {
    cacheDir: string;
    /** Called ONLY on a cache miss: a warm cache builds no store client. */
    store: () => VerdictStoreReader;
};

export type LockedVerdicts = {
    /** The lock's verdicts, verified, in lock order. The blade registry's
     *  are not among them. */
    verdicts: Verdict[];
    /** The cached pack they were read from. */
    path: string;
    /** `true` when this call fetched the pack; `false` when the cache was
     *  warm. */
    fetched: boolean;
};

/** The pack's text, if `bytes` gunzip to text hashing to the lock's
 *  `packHash`; otherwise why not. */
function packText(
    lock: VerdictLock,
    bytes: Uint8Array
): { text: string } | { why: string } {
    let text: string;
    try {
        text = gunzipSync(bytes).toString("utf8");
    } catch (error) {
        return {
            why: `not a gzip pack (${error instanceof Error ? error.message : String(error)})`,
        };
    }
    const actual = verdictPackHash(text);
    return actual === lock.packHash
        ? { text }
        : {
              why: `content hashes to ${actual}, not to the packHash ${VERDICT_LOCK_PATH} names`,
          };
}

function writeAtomically(path: string, bytes: Uint8Array): void {
    mkdirSync(dirname(path), { recursive: true });
    const partial = `${path}.${process.pid}.partial`;
    writeFileSync(partial, bytes);
    renameSync(partial, path);
}

/**
 * The verdicts `lock` names, read from its pack: from this machine's cache
 * when a file there hashes right, otherwise fetched once from the store,
 * verified, and only then cached.
 *
 * Throws when the store has no such pack, or when the pack is not what the
 * lock pins: not gzip, a different hash, ids that are not exactly the lock's,
 * or a payload that does not re-hash to its id.
 */
export async function loadLockedVerdicts(
    lock: VerdictLock,
    source: VerdictPackSource
): Promise<LockedVerdicts> {
    const path = cachedVerdictPackPath(source.cacheDir, lock.packHash);
    if (existsSync(path)) {
        const cached = packText(lock, readFileSync(path));
        if ("text" in cached) {
            const entries = parseVerdictPack(lock, cached.text);
            return {
                verdicts: verdictsFromLock(lock, entries),
                path,
                fetched: false,
            };
        }
    }

    const name = verdictPackObjectName(lock.packHash);
    const bytes = await source.store().get(name);
    if (bytes === null) {
        throw new Error(
            `the Verdict Store has no ${name}, the pack ${VERDICT_LOCK_PATH} names`
        );
    }
    const fetched = packText(lock, bytes);
    if ("why" in fetched) {
        throw new Error(`Verdict Store object ${name}: ${fetched.why}`);
    }
    const verdicts = verdictsFromLock(
        lock,
        parseVerdictPack(lock, fetched.text)
    );
    writeAtomically(path, bytes);
    return { verdicts, path, fetched: true };
}

/**
 * Warm the cache for the lock committed under `root`. Idempotent: a warm cache
 * is re-verified from disk with no network call. Returns the line to print.
 *
 * No lock is not an error — until the corpus is migrated (issue #3584) there
 * is nothing to sync, and saying so is the whole answer.
 */
export async function syncVerdictPack(
    root: string,
    source: VerdictPackSource
): Promise<string> {
    const lockFile = join(root, VERDICT_LOCK_PATH);
    if (!existsSync(lockFile)) {
        return `no ${VERDICT_LOCK_PATH} in ${root} — nothing to sync`;
    }
    const lock = parseVerdictLock(readFileSync(lockFile, "utf8"));
    const { verdicts, path, fetched } = await loadLockedVerdicts(lock, source);
    const count = `${verdicts.length} verdict${verdicts.length === 1 ? "" : "s"}`;
    return fetched
        ? `fetched and verified ${count} → ${path}`
        : `already warm: ${count} verified from ${path}, no network call`;
}
