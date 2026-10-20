/**
 * Deployment/tree skew (issues #6132, #6133): the browser walk serves the
 * frontend of the tree it gates, but talks to the ONE local Convex
 * deployment — and that deployment serves whatever `convex dev --local`
 * (`com.tolaria.convex`, `WorkingDirectory` = the primary checkout) last
 * pushed from the PRIMARY checkout's `convex/` tree.
 *
 * WHY. On 2026-10-20 the primary moved `staging` → `main`; the watcher pushed
 * `main`'s functions, 144+ commits behind the walked tip. Every `/game` cell
 * went `UNWALKED` (`Could not find public function for
 * 'gameReads:getDefinitionManifest'`), the health gate wrote a durable RED on
 * a green tree, and a fixer session could only answer `stuck`. Nothing asked
 * WHICH code the deployment served — only whether it answered (issue #6081).
 *
 * The signal is the primary checkout itself — its branch, its HEAD and its
 * working tree under `convex/` — compared with the walked tree's `convex/`:
 * no backend round-trip, two to four `git` calls (~30 ms). It cannot see a
 * `convex dev` that has not pushed YET after a switch; the deployment watch's
 * liveness probe and the cells' own console signatures still cover that.
 *
 * A primary AHEAD of the walked tree on the base branch is not a skew: the
 * queue lands ~10 issues an hour and `post-merge` fast-forwards the primary,
 * so a release's 40-minute offline phase or a PR branch forked an hour ago
 * meets newer BASE code — what the tree meets once it is rebased. Requiring
 * equality would make most walks INFRA. The incident's class is a deployment
 * OLDER than, or off the line of, the walked tree: the primary off base, dirty,
 * or not containing the walked tree's base point.
 *
 * `convex/_generated/` is outside the comparison: `convex dev` rewrites it in
 * the primary, and it is derived from the source the comparison already reads.
 *
 * `deploymentSkew` is the pure decision; `readDeploymentSkew` gathers its
 * inputs from git. Node builtins only (`health-main.ts`'s import constraint).
 */
import { spawnSync } from "node:child_process";

/**
 * `check:ui`'s exit code for a walk refused or abandoned on a skew: its own
 * code, beside `DEPLOYMENT_DOWN_EXIT` (3), so the health gate records
 * `infra` / `deployment-skew` — never a RED tip.
 */
export const DEPLOYMENT_SKEW_EXIT = 4;

/** The pathspec every comparison uses: `convex/`, minus the codegen. */
export const CONVEX_PATHSPEC = [
    "convex/",
    ":(exclude)convex/_generated/",
] as const;

/** At most this many paths are named in a reason; the rest are counted. */
const NAMED_PATHS = 5;

export interface SkewInput {
    /** The base branch (`tolaria.config.json`'s `branches.base`). */
    base: string;
    /** The branch the primary checkout is on; `null` when detached. */
    primaryBranch: string | null;
    /** The primary checkout's HEAD sha. */
    primaryHead: string;
    /** The walked tree's HEAD sha. */
    walkedHead: string;
    /** Paths under `convex/` modified, staged or untracked in the primary —
     *  `convex dev` pushes the working tree, not HEAD. */
    primaryDirty: readonly string[];
    /** Paths under `convex/` that differ between the primary's HEAD and the
     *  walked tree. */
    convexDiff: readonly string[];
    /** Paths under `convex/` the walked tree changes itself — a PR's own
     *  diff, which the deployment cannot be serving. Empty for a base tip. */
    ownDiff: readonly string[];
    /** The primary's HEAD contains the walked tree's base point (its fork
     *  from base, or the walked base tip itself): the deployment serves the
     *  same or NEWER base code. */
    primaryAhead: boolean;
}

export type SkewDecision = { kind: "ok" } | { kind: "skew"; reason: string };

function named(paths: readonly string[]): string {
    const shown = paths.slice(0, NAMED_PATHS).join(", ");
    const more = paths.length - NAMED_PATHS;
    return more > 0 ? `${shown} (+${more} more)` : shown;
}

/**
 * The refusal a primary checkout off the base branch earns, or null. Shared
 * by the walk's decision and `release.ts`'s seconds-long preflight.
 */
export function primaryBranchRefusal(
    primaryBranch: string | null,
    base: string
): string | null {
    if (primaryBranch === base) return null;
    return `the primary checkout is ${primaryBranch === null ? "on a detached HEAD" : `on \`${primaryBranch}\``}, not \`${base}\` — the local Convex deployment serves the primary's convex/ tree`;
}

/**
 * Whether the deployment serves the walked tree's Convex code: the primary is
 * on the base branch, clean under `convex/`, and either contains the walked
 * tree's base point or differs from it only in the walked tree's own
 * `convex/` paths.
 */
export function deploymentSkew(input: SkewInput): SkewDecision {
    const branch = primaryBranchRefusal(input.primaryBranch, input.base);
    if (branch !== null) return { kind: "skew", reason: branch };
    if (input.primaryDirty.length > 0) {
        return {
            kind: "skew",
            reason: `the primary checkout has uncommitted convex/ changes the deployment serves: ${named(input.primaryDirty)}`,
        };
    }
    if (input.primaryAhead) return { kind: "ok" };
    const own = new Set(input.ownDiff);
    const foreign = input.convexDiff.filter((p) => !own.has(p));
    if (foreign.length > 0) {
        return {
            kind: "skew",
            reason: `the deployment serves convex/ from the primary @ ${input.primaryHead.slice(0, 8)}, which does not contain the walked tree @ ${input.walkedHead.slice(0, 8)}'s base; ${foreign.length} convex/ file(s) differ outside the tree's own diff: ${named(foreign)}`,
        };
    }
    return { kind: "ok" };
}

/** What to do about a skew — one sentence, no double quotes (`loop-drain`
 *  reads `INFRA_REMEDY` with `sed`). */
export function skewRemedy(primary: string, base: string): string {
    return `put the primary checkout back on the base branch (\`git -C ${primary} switch ${base} && git -C ${primary} merge --ff-only origin/${base}\`), wait for convex dev to push, and rebase a branch that is behind origin/${base}; then re-run`;
}

function gitLines(cwd: string, args: readonly string[]): string[] {
    const r = spawnSync("git", args as string[], { cwd, encoding: "utf8" });
    if (r.status !== 0) {
        throw new Error(
            `git ${args.join(" ")} failed in ${cwd}: ${(r.stderr ?? "").trim()}`
        );
    }
    return (r.stdout ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
}

/** The branch `cwd` is on, or null when detached. */
export function currentBranch(cwd: string): string | null {
    const r = spawnSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
        cwd,
        encoding: "utf8",
    });
    const name = (r.stdout ?? "").trim();
    return r.status === 0 && name.length > 0 ? name : null;
}

export interface SkewRead {
    /** The primary checkout (where `convex dev` runs). */
    primary: string;
    base: string;
    /** The walked tree: a directory whose WORKING TREE is walked (`check:ui`
     *  serves it with Vite), or `{ dir, rev }` for a commit (the health walk's
     *  tip, before its worktree exists). */
    walked: string | { dir: string; rev: string };
    /** The ref a PR's own diff is measured from (`origin/<base>`); omitted, no
     *  own diff is excused — a base tip has none. */
    ownDiffFrom?: string;
}

/** The decision's inputs, read from git. Throws when git does. */
export function readSkewInput(read: SkewRead): SkewInput {
    const { primary, base } = read;
    const primaryHead = gitLines(primary, ["rev-parse", "HEAD"])[0];
    const primaryDirty = gitLines(primary, [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        ...CONVEX_PATHSPEC,
    ]).map((l) => l.slice(3));
    const dir = typeof read.walked === "string" ? read.walked : read.walked.dir;
    const walkedRev = typeof read.walked === "string" ? null : read.walked.rev;
    const walkedHead = gitLines(dir, ["rev-parse", walkedRev ?? "HEAD"])[0];
    // A commit against a commit, or the walked WORKING TREE against the
    // primary's HEAD (the objects are shared: one repository).
    const convexDiff = gitLines(dir, [
        "diff",
        "--name-only",
        primaryHead,
        ...(walkedRev ? [walkedRev] : []),
        "--",
        ...CONVEX_PATHSPEC,
    ]);
    // The walked tree's base point: its fork from base, else itself.
    let basePoint = walkedHead;
    let ownDiff: string[] = [];
    if (read.ownDiffFrom) {
        const fork = gitLines(dir, [
            "merge-base",
            read.ownDiffFrom,
            walkedRev ?? "HEAD",
        ])[0];
        basePoint = fork;
        ownDiff = gitLines(dir, [
            "diff",
            "--name-only",
            fork,
            ...(walkedRev ? [walkedRev] : []),
            "--",
            ...CONVEX_PATHSPEC,
        ]);
    }
    // Uncommitted convex/ edits in a walked working tree are past ANY commit
    // the primary holds — unless they are excused as the tree's own diff.
    const unexcusedEdits =
        walkedRev === null &&
        !read.ownDiffFrom &&
        gitLines(dir, ["diff", "--name-only", "HEAD", "--", ...CONVEX_PATHSPEC])
            .length > 0;
    const ahead = spawnSync(
        "git",
        ["merge-base", "--is-ancestor", basePoint, primaryHead],
        { cwd: dir }
    );
    return {
        base,
        primaryAhead: !unexcusedEdits && ahead.status === 0,
        primaryBranch: currentBranch(primary),
        primaryHead,
        walkedHead,
        primaryDirty,
        convexDiff,
        ownDiff,
    };
}

/** `readSkewInput` + `deploymentSkew`. */
export function readDeploymentSkew(read: SkewRead): SkewDecision {
    return deploymentSkew(readSkewInput(read));
}
