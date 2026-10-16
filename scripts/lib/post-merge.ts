/**
 * The decisions of `scripts/post-merge.ts` (issue #5644): which PRs a push to
 * the base merged, which worktree each leaves behind, and what the machine
 * that owns the Convex deployment seeds. Pure — the git, `gh` and spawn I/O
 * is the script's.
 */
import { issueOfBranch, issueWorktree } from "./issue-worktree";

/** What `git` reports as the `before` of a push that created the branch. */
const NULL_SHA = /^0+$/;

/**
 * The revision range a push covers, for `git log` / `git diff`. A push that
 * created the branch has no `before`: only its tip is known.
 */
export function pushRange(before: string, after: string): string {
    return NULL_SHA.test(before) || before === ""
        ? `${after}~1..${after}`
        : `${before}..${after}`;
}

/**
 * The PR numbers the pushed commits merged, oldest first. A squash merge's
 * subject ends in ` (#N)`; a commit with no such suffix (a direct push such
 * as `gaps:sync`'s) merged no PR.
 */
export function mergedPrNumbers(subjects: readonly string[]): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const subject of subjects) {
        const m = /\(#(\d+)\)\s*$/.exec(subject.trim());
        if (!m) continue;
        const n = Number(m[1]);
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(n);
    }
    return out;
}

/** Did the push change a card set — the diff that obliges a preset reseed? */
export function cardSetsChanged(files: readonly string[]): boolean {
    return files.some((f) => f.startsWith("convex/cards/sets/"));
}

/**
 * The worktree a merged PR's session left standing, from the PR's own head
 * branch and by the rule `wt:new` created it with. null when the branch names
 * no issue — a docs-lane or hand-made branch has no worktree of ours.
 */
export function mergedWorktree(
    primary: string,
    headRefName: string
): string | null {
    const issue = issueOfBranch(headRefName);
    return issue === null
        ? null
        : issueWorktree(
              primary,
              issue,
              headRefName.startsWith("fix/") ? "fix" : "feat"
          ).worktree;
}

export interface SeedPlan {
    /** PRs whose `## Preset scenario` is registered, oldest first. */
    scenarios: number[];
    /** `seed:preset --all`: a card set changed, so every preset list reseeds. */
    presets: boolean;
}

/**
 * What the `seed` machine registers after the fast-forward. Nothing when the
 * fast-forward did not land: the seed resolves card names server-side against
 * the bundle pushed from the primary checkout's DISK (issue #3253), so seeding
 * a stale tree can never resolve the PR's own new card.
 */
export function seedPlan(
    fastForwarded: boolean,
    prs: readonly number[],
    changedFiles: readonly string[]
): SeedPlan {
    if (!fastForwarded) return { scenarios: [], presets: false };
    return { scenarios: [...prs], presets: cardSetsChanged(changedFiles) };
}

/**
 * Is a process working inside `dir`? Reads `lsof -a -d cwd -Fn` output (one
 * `n<path>` line per process). `land` still runs in the PR's worktree while
 * the push it made fires `post-merge`, and its health detach must run before
 * that worktree goes (`land.ts` § postMergeHousekeepingSteps), so a worktree
 * with a live cwd is left to its owner.
 */
export function cwdInside(lsofOut: string, dir: string): boolean {
    return lsofOut
        .split("\n")
        .some(
            (l) =>
                l.startsWith("n") &&
                (l.slice(1) === dir || l.slice(1).startsWith(`${dir}/`))
        );
}
