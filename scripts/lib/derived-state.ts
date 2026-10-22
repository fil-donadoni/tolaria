/**
 * Derived whole-file state, judged by the tree's ROLE (ADR 0157, issue #6246).
 *
 * The lockfile's header hashes and `data/catalogue/*` are derived from the
 * rows and sources beside them. On the base they are committed and must be
 * fresh; in a queue draft the PR no longer owns them, so the lane regenerates
 * them in the tested tree (`derive-regenerate.ts`) and judges only what the
 * PR DOES own: the lockfile's rows. The role travels in the environment so
 * every child of `check:lane` — `check:oracle`, the vitest workers — reads the
 * one answer.
 */

import { corpusExcluded } from "./corpus-exclusion";

export const TREE_ROLE_ENV = "TOLARIA_TREE_ROLE";

/**
 * `base`: committed derived bytes must be fresh. `draft`: regenerated in-tree.
 * `pr`: the PR-event lane (issue #6347) — the PR carries the base's header and
 * catalogue bytes (`land:ready` restores them, `check:derived-in-diff` enforces
 * it), never regenerated, so only its rows are judged; no corpus on the hosted
 * runner is not a red.
 */
export type TreeRole = "base" | "draft" | "pr";

export function treeRole(env: NodeJS.ProcessEnv = process.env): TreeRole {
    const role = env[TREE_ROLE_ENV];
    return role === "draft" || role === "pr" ? role : "base";
}

/** What the lane's checks observed about the tree's derived state. */
export interface DerivedFacts {
    /** The header-hash drift message, or null when the header matches. */
    readonly headerDrift: string | null;
    /** The first lockfile row that disagrees with a regeneration, or null. */
    readonly rowDrift: string | null;
    /** Whether the committed `data/catalogue/*` bytes differ from a regeneration. */
    readonly catalogueStale: boolean;
}

/**
 * The lane's decision, pure: the problems that make the tree red.
 *
 * - base: every drift is a red (the cheap corpus-free `headerHashDrift` tier
 *   stays, and committed catalogue bytes are supposed to be fresh).
 * - draft: the header and the catalogue are the base's to write and the lane
 *   has regenerated them, so only a wrong ROW is a red.
 */
/**
 * What a draft with no oracle corpus cache owes (issue #6338). Its header was
 * regenerated, so only the per-row regenerate-and-diff would judge the
 * lockfile: everywhere that check is a gate (`land`, the queue's lane, on the
 * owner's machines where the corpus lives) its absence is a red. The hosted
 * advisory lane holds no corpus and gates nothing — the queue's lane judges
 * the rows before any merge — so there, and only there (`corpusExcluded`:
 * the variable AND a GitHub-hosted runner), it is a declared skip.
 */
export function draftWithoutCorpus(
    env: NodeJS.ProcessEnv = process.env
): "fail" | "skip" {
    return corpusExcluded(env) ? "skip" : "fail";
}

export function derivedProblems(role: TreeRole, facts: DerivedFacts): string[] {
    const problems: string[] = [];
    if (facts.rowDrift !== null) problems.push(facts.rowDrift);
    if (role === "base") {
        if (facts.headerDrift !== null) problems.push(facts.headerDrift);
        if (facts.catalogueStale)
            problems.push("data/catalogue/* is not what the tree generates");
    }
    return problems;
}

/**
 * The first row (by position in the committed file) that a regeneration does
 * not reproduce, named by card — or a row-count mismatch. Null when every row
 * agrees. Headers are deliberately not compared.
 */
export function firstRowDrift(
    committed: readonly { readonly oracleId: string; readonly name: string }[],
    regenerated: readonly { readonly oracleId: string; readonly name: string }[]
): string | null {
    const byId = new Map(regenerated.map((row) => [row.oracleId, row]));
    for (const row of committed) {
        const fresh = byId.get(row.oracleId);
        if (fresh === undefined)
            return `row ${row.name} (${row.oracleId}) is committed but the compiler no longer produces it`;
        if (JSON.stringify(fresh) !== JSON.stringify(row))
            return `row ${row.name} (${row.oracleId}) disagrees with the tree's compiler`;
    }
    const known = new Set(committed.map((row) => row.oracleId));
    const missing = regenerated.find((row) => !known.has(row.oracleId));
    return missing === undefined
        ? null
        : `row ${missing.name} (${missing.oracleId}) is produced by the compiler but not committed`;
}
