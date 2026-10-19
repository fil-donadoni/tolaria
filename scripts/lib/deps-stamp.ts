/**
 * Whether a worktree's `node_modules/` was installed from the dependency
 * manifests its tree carries NOW (issue #6000).
 *
 * `land` rebases a PR onto a base that may have changed `bun.lock` /
 * `package.json`, in a worktree whose `node_modules/` was installed from the
 * OLD manifests — and a reused `-land-<pr>` worktree carries them even before
 * the rebase. Nothing reinstalled, so `tsc` redded the lane on a module the
 * worktree lacked (PR #5932, PR #5961: `@mergifyio/vitest`). The answer is a
 * stamp: the fingerprint of the manifests a successful install ran from,
 * written into `node_modules/` beside what it describes. A tree whose
 * manifests fingerprint differently — or that carries no stamp — reinstalls.
 *
 * Node builtins only: `bootstrap-worktree.ts` imports it, and it runs in a
 * worktree that has no `node_modules/` yet.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What an install reads — a change to either can change `node_modules/`. */
export const DEPS_INPUTS = ["package.json", "bun.lock"] as const;
/** Inside `node_modules/` on purpose: removing the deps removes the stamp. */
export const DEPS_STAMP = join("node_modules", ".tolaria-deps-stamp");

/** sha256 over each input's name and content; an absent input hashes as such. */
export function depsFingerprint(
    inputs: Readonly<Record<string, string | null>>
): string {
    const h = createHash("sha256");
    for (const name of DEPS_INPUTS)
        h.update(`${name}\0${inputs[name] ?? "\0absent"}\0`);
    return h.digest("hex");
}

/** The pure decision: install unless the stamp names exactly these manifests. */
export function depsInstallNeeded(
    stamp: string | null,
    fingerprint: string
): boolean {
    return stamp?.trim() !== fingerprint;
}

function readOrNull(path: string): string | null {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** The tree's current fingerprint and the stamp its `node_modules/` holds. */
export function readDepsState(cwd: string): {
    fingerprint: string;
    stamp: string | null;
} {
    const inputs: Record<string, string | null> = {};
    for (const name of DEPS_INPUTS) inputs[name] = readOrNull(join(cwd, name));
    return {
        fingerprint: depsFingerprint(inputs),
        stamp: readOrNull(join(cwd, DEPS_STAMP)),
    };
}

/** Records that `node_modules/` now matches the tree's manifests. */
export function writeDepsStamp(cwd: string): void {
    if (!existsSync(join(cwd, "node_modules"))) return;
    writeFileSync(join(cwd, DEPS_STAMP), `${readDepsState(cwd).fingerprint}\n`);
}

export type EnsureDepsOutcome = "fresh" | "installed" | "failed";

/**
 * Install iff the stamp is stale, then stamp. `install` is the I/O
 * (`bun install --frozen-lockfile`), injected so a test counts its calls.
 */
export function ensureDeps(
    cwd: string,
    install: () => boolean
): EnsureDepsOutcome {
    const { fingerprint, stamp } = readDepsState(cwd);
    if (!depsInstallNeeded(stamp, fingerprint)) return "fresh";
    if (!install()) return "failed";
    writeDepsStamp(cwd);
    return "installed";
}
