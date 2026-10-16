/**
 * The rebase-and-resolve step of `land`, extracted (issue #5638) so
 * `scripts/pr-refresh.ts` runs the very same shell the landing does: rebase
 * onto the base, re-derive any generated artifact a merge driver took a side
 * of, bring `convex/_generated` in step. Shell STRINGS, not functions, because
 * `land` embeds them in ONE locked `sh -c` (see `buildLockedCommand`).
 */
import { resolve } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "./branches";
import { REGENERATE_MARKER } from "./generated-artifacts";

const RESOLVE_ARTIFACTS = resolve(
    __dirname,
    "..",
    "resolve-generated-artifacts.ts"
);
const REFRESH_GENERATED_API = resolve(
    __dirname,
    "..",
    "refresh-generated-api.ts"
);

function shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ─────────────────────────────────────────────────────────────────────────

/**
 * Rebase onto `origin/main`; on conflict, print the conflicting paths,
 * `--abort` (leaving the tree usable — never leave a `sh -c` pipeline
 * mid-rebase), and fail. Parenthesised as one unit so a `git fetch` failure
 * (not a conflict) short-circuits the whole `&&` chain instead of also
 * triggering the abort branch.
 */
export function rebaseStep(): string {
    return (
        `git fetch origin ${BASE_BRANCH} && ` +
        `(git rebase ${ORIGIN_BASE} || ` +
        "{ git --no-pager diff --name-only --diff-filter=U; git rebase --abort; " +
        // Clear the regenerate marker ONLY on the abort path. `--abort`
        // restores the pre-rebase tree, so anything the merge driver marked
        // during this attempt is moot. Clearing it BEFORE the rebase instead
        // would erase a debt from a rebase or merge the developer ran BY HAND —
        // the driver is registered in local config and fires there too, and
        // that side-taken artifact would then land with nothing to catch it
        // (review of issue #3069).
        `rm -f "$(git rev-parse --git-path ${REGENERATE_MARKER})"; ` +
        "exit 1; })"
    );
}

/**
 * Re-derive any generated artifact the `merge=regenerated` driver took a side
 * of during the rebase, ONCE, at the rebased tip — the second half of "a
 * generated artifact is regenerated, not merged" (issue #3069).
 *
 * Sits between the rebase and `check:lane` because the whole point is that the
 * tree the LANE GATE sees is the tree a fresh regeneration produces; running it
 * after the gate would gate a tree nobody ships. A no-op (exit 0, no output) on
 * every landing where nothing conflicted, which is nearly all of them.
 */
export function resolveGeneratedArtifactsStep(): string {
    return `bun ${shQuote(RESOLVE_ARTIFACTS)}`;
}

/**
 * Bring the worktree's gitignored `convex/_generated/` in step with the
 * REBASED tree (issue #5077). It was copied (or regenerated) when the
 * worktree was cut; a landing that added Convex modules since then leaves it
 * without them, and `check:lane` would red `check:ts` on modules this branch
 * never touched. Silent and ~0.1 s when the module list already matches;
 * regenerates offline (no deployment, no backend) when it does not. Before
 * the lane for the same reason as the artefact step: the gate must see the
 * tree that lands. It writes only gitignored files, so the tip's sha is
 * unchanged.
 */
export function refreshGeneratedApiStep(): string {
    return `bun ${shQuote(REFRESH_GENERATED_API)}`;
}

/**
 * The steps between "the branch is checked out" and "the lane may run", in
 * order, for a caller that joins them with ` && `.
 */
export function rebaseAndResolveSteps(): string[] {
    return [
        rebaseStep(),
        resolveGeneratedArtifactsStep(),
        refreshGeneratedApiStep(),
    ];
}
