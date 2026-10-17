/**
 * The gitignored inputs a fresh worktree copies from the primary checkout.
 *
 * node_modules is deliberately NOT copied — `bun install` in the bootstrap is
 * correct and nearly free once bun's global cache is warm, and a copied tree
 * can carry stale platform binaries.
 *
 * Builtins-only ON PURPOSE: `scripts/bootstrap-worktree.ts` imports it and
 * runs in a worktree that has no node_modules yet (the wiring test pins it).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

export interface CopyEntry {
    from: string;
    to: string;
    /** Missing in the primary is a skip, never a failure: regenerable. */
    optional?: true;
    /**
     * Missing in the primary is a skip only in a CI run (issue #5786). A
     * GitHub-hosted runner's clone never has the file and its offline gate
     * never needs it; on a developer machine the same absence means the
     * deployment is not set up, and failing loudly is the point.
     */
    optionalInCi?: true;
}

// `optional` entries are nice-to-have: the Full Catalogue is regenerable
// (`bun run catalogue:ensure`, which `dev`/`build` run anyway), so a primary
// checkout that never generated it must not fail the bootstrap — copying just
// saves this worktree a ~1 MB Scryfall download.
//
// The Full Catalogue is a DIRECTORY holding one content-addressed artifact
// since issue #3500, and it is copied whole rather than by file name — the name
// is a content hash, so the primary's differs from this worktree's whenever the
// two branches carry different generations. It is skipped outright when the
// destination already exists (the normal case: the artifact is committed), so
// this can never leave two artifacts behind, which is the one state the
// client's build-time glob refuses to resolve.
//
// `.env.local` is the deployment URL. The offline gate does without it:
// `convex/_generated` is regenerated offline when missing (issue #5077, issue
// #5636) and `readEnvLocal` returns `{}` for a missing file.
export const COPIES: readonly CopyEntry[] = [
    { from: "convex/_generated", to: "convex/_generated" },
    { from: ".env.local", to: ".env.local", optionalInCi: true },
    { from: "data/full-catalogue", to: "data/full-catalogue", optional: true },
];

export interface CopyReport {
    done: string[];
    skipped: string[];
    failed: string[];
}

export interface CopyOptions {
    primary: string;
    cwd: string;
    /** Re-copy even when the destination is present. */
    force?: boolean;
    /** A CI run (`process.env.CI` set). */
    ci?: boolean;
}

export function copyFromPrimary(opts: CopyOptions): CopyReport {
    const { primary, cwd, force = false, ci = false } = opts;
    const report: CopyReport = { done: [], skipped: [], failed: [] };
    for (const { from, to, optional, optionalInCi } of COPIES) {
        const src = join(primary, from);
        const dst = join(cwd, to);
        if (existsSync(dst) && !force) {
            report.skipped.push(`${to} (present)`);
            continue;
        }
        if (!existsSync(src)) {
            if (optional) {
                report.skipped.push(`${to} (not in primary — regenerable)`);
            } else if (optionalInCi && ci) {
                report.skipped.push(
                    `${to} (not in primary — CI, offline gate)`
                );
            } else {
                report.failed.push(`${to} — not in primary checkout (${src})`);
            }
            continue;
        }
        // `--force` means REPLACE, not merge: copying a directory over an
        // existing one unions their contents, which for the content-addressed
        // Full Catalogue would leave two artifacts and a build-time glob with
        // no way to choose.
        if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
        mkdirSync(dirname(dst), { recursive: true });
        cpSync(src, dst, { recursive: true });
        report.done.push(to);
    }
    return report;
}
