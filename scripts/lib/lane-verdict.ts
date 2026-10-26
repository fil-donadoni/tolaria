/**
 * Lane verdicts keyed by the MERGED tree, and the re-verify scope of a rebase
 * (issue #6650).
 *
 * WHY. One tree paid the lane up to three times (`land:ready`'s pre-queue
 * steps, the advisory `check:lane`, the queue draft's `queue-lane`): 8.2 h of
 * `queue-lane` time in 2026-10-21 → 10-24 produced no landing. The result of a
 * lane is a function of the tree it ran on and of the plan it ran, so a green
 * verdict keyed by (tree sha, plan) is valid for any later run on the same
 * tree — whoever asks, however the branch got there.
 *
 * Two pure decisions plus a small file store:
 *   - `laneVerdictKey`: the key. The plan's commands are in it, so a lane that
 *     owes more (a different diff vs base, a changed gate) never reuses a
 *     verdict that ran less.
 *   - `reverifyScope`: after a rebase B → B', the tests worth re-running are
 *     those the base delta reaches AND the branch's own diff reaches, plus the
 *     tests behind conflict-resolved files. The rest is carried by the receipt
 *     of the pre-rebase verification (`base:drift`'s `baseSha`).
 *
 * The store lives in the git COMMON dir, so every worktree of one checkout —
 * the queue's job worktrees included — shares it. A hosted runner has no such
 * disk and always misses: a miss is a lane run, never a skip.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LANE_VERDICT_DIR = "tolaria-lane-verdicts";

/** Opt out: pay the lane even on a tree already recorded green. */
export const LANE_FORCE_ENV = "TOLARIA_LANE_FORCE";

export interface LaneVerdict {
    /** `git rev-parse HEAD^{tree}` of the tested tree. */
    tree: string;
    key: string;
    lane: string;
    /** HEAD of the run that proved it, for "points at the first". */
    provedAt: string;
    at: string;
    steps: number;
}

/** The commands the lane plans, in order — what a verdict vouches for. */
export function laneVerdictKey(
    tree: string,
    role: string,
    commands: readonly string[]
): string {
    const h = createHash("sha256");
    h.update(`${tree}\n${role}\n${commands.join("\n")}`);
    return h.digest("hex").slice(0, 40);
}

function verdictPath(dir: string, key: string): string {
    return join(dir, `${key}.json`);
}

export function readLaneVerdict(dir: string, key: string): LaneVerdict | null {
    const path = verdictPath(dir, key);
    if (!existsSync(path)) return null;
    try {
        const v = JSON.parse(readFileSync(path, "utf8")) as LaneVerdict;
        return v.key === key ? v : null;
    } catch {
        return null;
    }
}

/** Only a GREEN lane is recorded; a red leaves no file to trust. */
export function writeLaneVerdict(dir: string, verdict: LaneVerdict): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        verdictPath(dir, verdict.key),
        JSON.stringify(verdict, null, 2)
    );
}

export interface ReverifyInput {
    /** Files the base changed between B and B'. */
    baseDelta: readonly string[];
    /** Files the rebase conflicted on (resolved by hand). */
    conflictFiles: readonly string[];
    /** Tests reachable from a set of files (`relatedTests`, flattened). */
    related: (paths: readonly string[]) => readonly string[];
    /** The branch's own diff vs its merge-base. */
    branchFiles: readonly string[];
}

export interface ReverifyScope {
    /** Tests to re-run. */
    run: string[];
    /** Count of base-reached tests the receipt carries unchanged. */
    carried: number;
}

/**
 * The tests a rebase owes. A test the base delta reaches but the branch never
 * touched was not verified by this branch and is the base's (health's); a test
 * the branch reaches but the base delta does not still has its pre-rebase
 * verdict. Only the intersection can have changed meaning — plus the tests
 * behind a hand-resolved conflict, which are new code on both sides.
 */
export function reverifyScope(input: ReverifyInput): ReverifyScope {
    const branchReach = new Set(input.related(input.branchFiles));
    const baseReach = input.related(input.baseDelta);
    const run = new Set(input.related(input.conflictFiles));
    let carried = 0;
    for (const t of baseReach) {
        if (branchReach.has(t)) run.add(t);
        else carried++;
    }
    return { run: [...run].sort(), carried };
}
