/**
 * What of the derived whole-file state a PR CARRIES, and how it is put back
 * (ADR 0157 § Option 1b, "The PR never carries them", issue #6248).
 *
 * The base writes the lockfile's header hashes and `data/catalogue/*` after
 * each merge (`derive:sync`); a PR's diff is its rows, sources and tests. The
 * generators still write the derived bytes locally — a worktree's tests need
 * fresh ones — so at hand-off `land:ready` restores them to the merge-base
 * (`restoreHeaderHashes`, the catalogue files checked out whole), and
 * `check:lane`'s `check:derived-in-diff` guard reds a diff that still moves
 * them (`derivedCarried` → `derivedInDiffProblems`).
 *
 * The lockfile is split: its ROWS are the PR's, its four header hashes are
 * the base's — so the lockfile's test is a line test over the header, never
 * a path test. `grammarVersion` and `corpus` stay the PR's: a bump or a repin
 * is a deliberate change that carries its own (rare) conflict.
 *
 * Pure: the git reads are the callers'.
 */
import {
    DERIVED_PATHS,
    DERIVE_SYNC_COMMIT_SUBJECT,
    LOCKFILE_PATH,
} from "./derive-sync";
import type { TreeRole } from "./derived-state";

/** The header lines the base owns — `derive:regenerate` rewrites exactly
 *  these (`treeHashes` + `botHash`, carried). */
export const HEADER_HASH_KEYS = [
    "compilerHash",
    "registryHash",
    "poolHash",
    "botHash",
] as const;
export type HeaderHashKey = (typeof HEADER_HASH_KEYS)[number];

/** The derived paths restored WHOLE: every one but the lockfile. */
export const CATALOGUE_DERIVED_PATHS: readonly string[] = DERIVED_PATHS.filter(
    (p) => p !== LOCKFILE_PATH
);

/** The subject of the commit `land:ready` adds when a PR carried derived
 *  state — `derive:sync`'s counterpart on the PR side. */
export const RESTORE_COMMIT_SUBJECT =
    "land:ready — derived state restored to the merge-base (ADR 0157)";

/** The header block: everything before the first row array. Bounded, so a
 *  20 MB lockfile is never regex-scanned whole. */
function headerBlock(text: string): string {
    const end = text.indexOf('"fragments"');
    return end === -1 ? text.slice(0, 4096) : text.slice(0, end);
}

function hashLine(key: HeaderHashKey): RegExp {
    return new RegExp(`^(\\s*"${key}":\\s*")([^"]*)(")`, "m");
}

/** The four header hashes a lockfile text carries (absent keys left out). */
export function headerHashes(
    text: string
): Partial<Record<HeaderHashKey, string>> {
    const block = headerBlock(text);
    const out: Partial<Record<HeaderHashKey, string>> = {};
    for (const key of HEADER_HASH_KEYS) {
        const m = hashLine(key).exec(block);
        if (m) out[key] = m[2];
    }
    return out;
}

/** The header hashes that differ between two lockfile texts. */
export function headerHashesDiffering(
    head: string,
    base: string
): HeaderHashKey[] {
    const h = headerHashes(head);
    const b = headerHashes(base);
    return HEADER_HASH_KEYS.filter((k) => h[k] !== b[k]);
}

/**
 * `head`'s text with each header hash set to `base`'s value — the lines are
 * rewritten in place, every other byte (rows included) untouched. A key the
 * base lacks is left as it is.
 */
export function restoreHeaderHashes(head: string, base: string): string {
    const target = headerHashes(base);
    // Bounded like `headerBlock`: the rewrite never reaches a row.
    const end = head.indexOf('"fragments"');
    const cut = end === -1 ? Math.min(head.length, 4096) : end;
    const block = head.slice(0, cut);
    const rest = head.slice(cut);
    let out = block;
    for (const key of HEADER_HASH_KEYS) {
        const value = target[key];
        if (value === undefined) continue;
        out = out.replace(hashLine(key), `$1${value}$3`);
    }
    return out + rest;
}

/** What a diff carries of the derived state: catalogue paths changed, and
 *  the lockfile header hashes that moved. Empty on both = rows only. */
export interface DerivedCarried {
    readonly catalogue: string[];
    readonly headerKeys: HeaderHashKey[];
}

export function carriesNothing(c: DerivedCarried): boolean {
    return c.catalogue.length === 0 && c.headerKeys.length === 0;
}

/**
 * The hand-off's two decisions (issue #6348): whether the restore makes a
 * commit, and how the pre-queue steps judge the tree. The role is ALWAYS
 * `draft`, whatever was carried — the queue's lane judges every PR as a
 * draft (`--regenerate-derived`), and a tree carrying nothing holds the
 * MERGE-BASE's derived state, not its own: a PR that changed a lockfile input
 * (or a card) has a stale header (or catalogue) by design. Judged as `base`,
 * a re-run of `land:ready` after a repair — the header already restored by
 * the first run — reds on `compiler hash drift`.
 */
export function handOff(c: DerivedCarried): {
    commit: boolean;
    role: TreeRole;
} {
    return { commit: !carriesNothing(c), role: "draft" };
}

/**
 * The derived state a diff (merge-base → HEAD) carries.
 *
 * `changed` is the diff's changed paths; the lockfile texts are read at both
 * ends only when it is among them. `subjectsTouching(path)` names the commits
 * in the range that touch a path: a path moved ONLY by `derive:sync` commits
 * (the base's own writer, riding along in a range that includes base
 * commits) is exempt — the PR did not carry it.
 */
export function derivedCarried(input: {
    readonly changed: readonly string[];
    readonly lockfile: () => { head: string | null; base: string | null };
    readonly subjectsTouching?: (path: string) => readonly string[];
}): DerivedCarried {
    const prOwned = (path: string): boolean => {
        const subjects = input.subjectsTouching?.(path);
        if (subjects === undefined) return true;
        return subjects.some((s) => s !== DERIVE_SYNC_COMMIT_SUBJECT);
    };
    const catalogue = CATALOGUE_DERIVED_PATHS.filter(
        (p) => input.changed.includes(p) && prOwned(p)
    );
    let headerKeys: HeaderHashKey[] = [];
    if (input.changed.includes(LOCKFILE_PATH) && prOwned(LOCKFILE_PATH)) {
        const { head, base } = input.lockfile();
        if (head !== null && base !== null)
            headerKeys = headerHashesDiffering(head, base);
    }
    return { catalogue, headerKeys };
}

/** The guard's red lines, one per carried item; empty = green. */
export function derivedInDiffProblems(c: DerivedCarried): string[] {
    const out: string[] = [];
    for (const p of c.catalogue)
        out.push(`${p} changed — the base writes it after the merge`);
    if (c.headerKeys.length > 0)
        out.push(
            `${LOCKFILE_PATH} header ${c.headerKeys.join(", ")} changed — the base writes the header hashes; the PR owns the rows`
        );
    return out;
}

/** The one-line remedy printed under the guard's red. */
export const DERIVED_IN_DIFF_REMEDY =
    "bun run land:ready <PR#> restores them to the merge-base at hand-off; by hand: `git checkout <merge-base> -- data/catalogue/` and the header hashes from `git show <merge-base>:data/oracle-compiled.json`, then regenerate locally when you keep working (ADR 0157)";
