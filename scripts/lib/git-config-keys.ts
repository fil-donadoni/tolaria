/**
 * Sets repository-level git config keys without racing a sibling bootstrap
 * (issue #5958).
 *
 * Jobs started by one labelling burst run `worktree:init` concurrently on one
 * machine, and every linked worktree shares the primary's `.git/config`. A
 * plain `git config <key> <value>` takes `.git/config.lock` even when the key
 * already holds that value, so two jobs writing the same correct key collided
 * and one failed with `could not lock config file … File exists`. Hence:
 *
 *   - read first — a key that already holds the wanted value is never written
 *     (a read takes no lock), so a re-run performs no config write at all;
 *   - a needed write that meets a held lock retries with a short bounded
 *     backoff, then fails naming the lock.
 *
 * Builtins-only ON PURPOSE: `scripts/bootstrap-worktree.ts` imports it and
 * runs in a worktree that has no node_modules yet (the wiring test pins it).
 */
import { spawnSync } from "node:child_process";

export type ConfigKeyOutcome = "present" | "written";

export interface EnsureConfigOptions {
    cwd: string;
    /** Total write attempts before giving up on a held lock. */
    attempts?: number;
    /** Synchronous wait between attempts; injectable for tests. */
    sleep?: (ms: number) => void;
}

/** Backoff before attempt n+1 (ms): 50, 100, 200, … — ~6.4 s over 7 waits. */
export const LOCK_RETRY_BASE_MS = 50;
export const LOCK_RETRY_ATTEMPTS = 8;

const LOCK_COLLISION_RE = /could not lock config file/i;

function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The key's value in the repository config — the scope `git config <key>`
 * writes to — or null when unset. Takes no lock.
 */
function readKey(cwd: string, key: string): string | null {
    const r = spawnSync("git", ["config", "--local", "--get", key], {
        encoding: "utf8",
        cwd,
    });
    // `git config --get` exits 1 for an unset key; anything else is real.
    if (r.status === 1) return null;
    if (r.status !== 0) {
        throw new Error(
            `git config --get ${key} failed: ${r.error ?? r.stderr.trim()}`
        );
    }
    return r.stdout.replace(/\n$/, "");
}

/**
 * Makes `key` hold `value`: no write when it already does, else a write that
 * retries a lock collision up to `attempts` times. Throws on any other
 * failure, or on a lock still held past the bound.
 */
export function ensureGitConfig(
    key: string,
    value: string,
    {
        cwd,
        attempts = LOCK_RETRY_ATTEMPTS,
        sleep = sleepSync,
    }: EnsureConfigOptions
): ConfigKeyOutcome {
    if (readKey(cwd, key) === value) return "present";
    let stderr = "";
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const r = spawnSync("git", ["config", key, value], {
            encoding: "utf8",
            cwd,
        });
        if (r.status === 0) return "written";
        stderr = r.stderr.trim();
        if (!LOCK_COLLISION_RE.test(stderr)) {
            throw new Error(`git config ${key} failed: ${stderr}`);
        }
        // A sibling may have written the very value we want while we waited.
        if (readKey(cwd, key) === value) return "present";
        if (attempt < attempts) sleep(LOCK_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
    throw new Error(
        `git config ${key}: config lock still held after ${attempts} attempts — ${stderr}`
    );
}
