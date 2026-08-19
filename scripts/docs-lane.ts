#!/usr/bin/env bun
/**
 * The documentation lane — `bun run wt:docs <slug>` and `bun run docs:ship`.
 *
 * WHY. A discussion produces artefacts: an ADR, a PRD, a CONTEXT.md entry, a
 * findings note. Nobody thinks of a discussion as "work that needs isolating",
 * so those artefacts were written straight into the shared main checkout: ~40
 * documentation-only commits landed directly on `main` over 30 days, two of the
 * days also carrying a `Merge branch 'main' of …` — local `main` had diverged
 * from origin.
 *
 * That is not cosmetic, because DOCS ARE GATED. `format:check` covers
 * `**\/*.md`, `cr:lint` reads CR citations out of prose, and five guard tests
 * read documentation files directly. An unfinished ADR in the shared checkout
 * reds `check:all` for every other session on this machine — on a file that has
 * nothing to do with their work, which under the green-main invariant they then
 * have to stop and deal with.
 *
 * `.claude/hooks/deny-guard.sh` § 0 blocks the write. This is the door next to
 * that wall: the isolation has to be ONE command, or it will be skipped exactly
 * as reliably as the prose rule was.
 *
 * The lane is cheap on purpose. A documentation change cannot break the engine,
 * so it does not owe the heavy gate (`bun run test`, minutes, machine-wide
 * mutex): it owes `check:docs` — formatting, CR citations, and the guards that
 * actually read documentation — which is seconds and takes no lock. That is
 * what makes "a PR per discussion" affordable rather than a tax people route
 * around.
 *
 *   bun run wt:docs adr-0101      # worktree + branch off origin/main
 *   bun run check:docs            # the doc gate (also run by ship)
 *   bun run docs:ship             # gate, commit, push, PR, merge, tear down
 *   bun run docs:ship --no-merge  # …but leave the PR open for review
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// What the lane accepts, and what gates it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A path this lane may carry. Deliberately narrow: the point of the cheap gate
 * is that the change CANNOT affect the engine, so anything that is not prose
 * has to leave through the ordinary branch + full-gate route. `.claude/**` is
 * split — a skill is a document, a hook is a program.
 */
export function isDocPath(p: string): boolean {
    if (p.endsWith(".md")) return true;
    if (p.startsWith("docs/")) return true;
    return false;
}

/**
 * The guard tests that read documentation. `check:docs` runs exactly these, so
 * the lane's cheapness is bounded by a list — and a list drifts. The census in
 * `docs-lane.test.ts` fails when a NEW test under `scripts/__tests__` reads a
 * documentation path without being classified here, which is the only way this
 * list stays honest as guards get added.
 */
export const DOC_GATE_TESTS = [
    "scripts/__tests__/action-space.test.ts",
    "scripts/__tests__/adr-index.test.ts",
    "scripts/__tests__/findings.test.ts",
    "scripts/__tests__/project-skills.test.ts",
    "scripts/__tests__/resident-context-budget.test.ts",
];

/**
 * Tests whose source mentions a documentation path but which do not GUARD one —
 * fixtures that write a scratch `README.md`, scanners pointed at `data/`. Each
 * needs its reason recorded, so that adding a row here is a decision and not a
 * way to silence the census.
 */
export const DOC_GATE_TESTS_EXCLUDED: Record<string, string> = {
    "scripts/__tests__/cr-source.test.ts":
        "guards data/cr/, the vendored rules document — not repo prose; cr:lint covers the citation side",
    "scripts/__tests__/hook-policy.test.ts":
        "writes a throwaway README.md into a temp git fixture; reads no repo document",
    "scripts/__tests__/queue-lint.test.ts":
        "lints GitHub issue bodies, which are not files in this repo",
    "scripts/__tests__/queue-plan.test.ts":
        "plans over GitHub issues; the .md mention is an issue-body fixture",
    "scripts/__tests__/check-marker-liveness.test.ts":
        "the docs/adr and .md paths are synthetic examples fed to inScope()'s scope filter — the test asserts the filter EXCLUDES them (a real divergence marker is always a `//`-comment in compiled source, never prose); it reads no repo document",
};

// ─────────────────────────────────────────────────────────────────────────────
// git plumbing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Environment for anything that talks to GitHub.
 *
 * bun auto-loads `.env.local`, which in this repo carries a `GITHUB_TOKEN`
 * scoped for the app — not for pushing. Inherited by `git`/`gh` it SHADOWS the
 * gh keyring credential, and every network call comes back
 * `remote: Write access to repository not granted … 403`, on a plain fetch, with
 * nothing in the message pointing at the token. Dropping it here restores the
 * keyring; `GH_TOKEN`, if the caller set one deliberately, is left alone.
 */
const NET_ENV: NodeJS.ProcessEnv = (() => {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    return env;
})();

function git(args: string[], cwd = process.cwd(), trim = true): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd, env: NET_ENV });
    if (r.status !== 0) {
        throw new Error(
            `git ${args.join(" ")} failed: ${(r.stderr || "").trim()}`
        );
    }
    return trim ? r.stdout.trim() : r.stdout;
}

/**
 * Paths out of `git status --porcelain`, which is COLUMN-ORIENTED: two status
 * characters, a space, then the path — and for an unstaged modification the
 * first of those two characters is itself a space.
 *
 * So the output must NOT be trimmed before it is split. Trimming removes the
 * leading space of the FIRST line only, shifting that one line's columns by
 * one, and `slice(3)` then eats the first character of the path:
 * `CLAUDE.md` shipped as `LAUDE.md` and `git add` failed with
 * `pathspec 'LAUDE.md' did not match any files`. Only the first line, only
 * sometimes — which is exactly the kind of bug that survives a smoke test.
 */
export function parsePorcelainPaths(raw: string): string[] {
    const out: string[] = [];
    for (const line of raw.split("\n")) {
        if (line.length < 4) continue;
        let p = line.slice(3);
        // Renames and copies read `R  old -> new`; the new path is the one that
        // has to be staged.
        const arrow = p.indexOf(" -> ");
        if (arrow !== -1) p = p.slice(arrow + 4);
        // git quotes paths carrying unusual characters.
        if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
        if (p !== "") out.push(p);
    }
    return out;
}

function run(cmd: string, args: string[], cwd = process.cwd()): boolean {
    return (
        spawnSync(cmd, args, { stdio: "inherit", cwd, env: NET_ENV }).status ===
        0
    );
}

/** The checkout that owns `.git/` — the one nobody may author in. */
function primaryCheckout(cwd = process.cwd()): string {
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    return common.startsWith("/") ? dirname(resolve(common)) : resolve(cwd);
}

function fail(message: string): never {
    console.error(`docs-lane: ${message}`);
    process.exit(1);
}

const GATE = resolve(__dirname, "gate.ts");
const PR_MERGE = resolve(__dirname, "pr-merge.ts");

function shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Everything the docs lane does under the machine-wide merge lock, as ONE
 * shell string — the same shape (and the same reasons) as `land`'s
 * `buildLockedCommand`, with the doc gate in place of the full suite.
 *
 * WHY THE LANE TAKES THE LOCK AT ALL (issue #2537). The cheap gate is the
 * lane's whole point and stays unlocked: prose cannot break the engine, so it
 * owes `check:docs` (seconds), never `bun run test`. **Merging is a different
 * act from gating.** `scripts/gate.ts`'s mutex serialises gating; `land`
 * extends it across the merge (#2517) precisely because a merge moves `main`
 * under whoever is mid-gate, and their verified tree stops being the tree that
 * lands. A docs merge moves `main` exactly as much as any other. So the lane
 * pays the queue for the seconds it merges in, and for nothing else.
 *
 * Re-gating inside the lock is what makes that meaningful: `main` may have
 * moved between the pre-PR push and acquiring the lock, so the rebase, the doc
 * gate and the force-push all happen in here, on the tree that actually lands.
 *
 * `pr-merge.ts`, not a bare `gh pr merge`, for the same reason `land` uses it
 * (#2536): the force-push immediately above invalidates GitHub's cached view
 * of the PR and the merge is refused while that recomputes. This lane
 * force-pushes right before merging too, so it had the identical race.
 *
 * `--delete-branch` is deliberately NOT passed: `gh` switches the local repo to
 * the default branch before deleting, and `main` is checked out in the primary
 * worktree, so it dies with `fatal: 'main' is already used by worktree at …`
 * AFTER the merge has landed — a failure reported on a PR that merged fine.
 * Both refs are deleted explicitly instead, each wrapped `(… || true)` so
 * cleanup can never turn a landed merge into a reported failure.
 */
export function buildShipMergeCommand(opts: {
    branch: string;
    pr: number;
    primary: string;
    cwd: string;
}): string {
    const b = shQuote(opts.branch);
    return [
        "git fetch origin main -q",
        "git rebase origin/main",
        "bun run check:docs",
        `git push --force-with-lease origin ${b}`,
        `bun ${shQuote(PR_MERGE)} ${opts.pr}`,
        `(git push origin --delete ${b} || true)`,
        `(git -C ${shQuote(opts.primary)} worktree remove --force ${shQuote(opts.cwd)} || true)`,
        `(git -C ${shQuote(opts.primary)} branch -D ${b} || true)`,
    ].join(" && ");
}

// ─────────────────────────────────────────────────────────────────────────────
// `new` — open the lane
// ─────────────────────────────────────────────────────────────────────────────

/** `docs/<slug>`, with the slug reduced to what a branch name may hold. */
export function slugify(raw: string): string {
    const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    if (slug === "") throw new Error(`unusable slug: ${JSON.stringify(raw)}`);
    return slug;
}

function cmdNew(rawSlug: string | undefined): void {
    if (!rawSlug) {
        fail(
            "usage: bun run wt:docs <slug>   (e.g. `bun run wt:docs adr-0101-as-enters`)"
        );
    }
    const slug = slugify(rawSlug);
    const primary = primaryCheckout();
    const worktree = resolve(primary, "..", `${basename(primary)}-wt-${slug}`);
    const branch = `docs/${slug}`;

    if (existsSync(worktree)) {
        console.log(`docs-lane: reusing existing worktree\n  ${worktree}`);
        console.log(`\ncd ${worktree}`);
        return;
    }

    // Branch off the REMOTE tip, never the local one: a stale local `main` is
    // exactly the condition this lane exists to stop reproducing.
    git(["fetch", "origin", "main", "-q"], primary);
    git(["worktree", "add", worktree, "-b", branch, "origin/main"], primary);
    // Prettier and the guard tests need node_modules; the bootstrap is
    // idempotent and mostly cache hits.
    run("bun", ["run", "worktree:init"], worktree);

    console.log(`\ndocs-lane: lane open on ${branch}`);
    console.log(`  ${worktree}`);
    console.log(`\ncd ${worktree}   # write the document there, then:`);
    console.log(`bun run docs:ship`);
}

// ─────────────────────────────────────────────────────────────────────────────
// `ship` — gate, PR, merge, tear down
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split changed paths into what the lane carries and what it refuses. Pure, so
 * the refusal is testable without a git fixture.
 */
export function classifyChanges(paths: string[]): {
    docs: string[];
    foreign: string[];
} {
    const docs: string[] = [];
    const foreign: string[] = [];
    for (const p of paths) (isDocPath(p) ? docs : foreign).push(p);
    return { docs, foreign };
}

function cmdShip(argv: string[]): void {
    const noMerge = argv.includes("--no-merge");
    const cwd = process.cwd();
    const primary = primaryCheckout(cwd);
    if (resolve(cwd) === primary) {
        fail(
            "docs:ship runs from a lane worktree, not the shared main checkout.\n" +
                "  bun run wt:docs <slug>"
        );
    }

    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    if (!branch.startsWith("docs/")) {
        fail(
            `this is branch ${branch}, not a docs/* lane.\n` +
                "  A change outside documentation goes through the ordinary branch + full gate."
        );
    }

    git(["fetch", "origin", "main", "-q"], cwd);
    const changed = [
        ...git(["diff", "--name-only", "origin/main...HEAD"], cwd).split("\n"),
        ...parsePorcelainPaths(git(["status", "--porcelain"], cwd, false)),
    ].filter((p) => p !== "");

    const { docs, foreign } = classifyChanges([...new Set(changed)]);
    if (foreign.length > 0) {
        fail(
            "the docs lane carries documentation only; these are not documentation:\n" +
                foreign.map((p) => `    ${p}`).join("\n") +
                "\n  Move them to an ordinary branch and run the full gate (bun run check:all && bun run test)."
        );
    }
    if (docs.length === 0) fail("nothing to ship — no documentation changed.");

    console.log(`docs-lane: shipping ${docs.length} file(s) on ${branch}`);

    if (!run("bun", ["run", "check:docs"], cwd)) {
        fail(
            "check:docs failed — fix it and re-run (bun run format repairs drift)."
        );
    }

    if (git(["status", "--porcelain"], cwd) !== "") {
        // Name the paths: `git add -A` in a shared tree is the sweep this whole
        // change is about, and the habit is worth not building even here.
        git(["add", "--", ...docs], cwd);
        git(["commit", "-m", `docs: ${branch.slice("docs/".length)}`], cwd);
    }

    // Rebase before pushing: the two files a documentation change collides on
    // (docs/adr/README.md, CONTEXT.md) are append-at-the-end, so this is
    // normally a no-op and a one-line conflict at worst.
    git(["rebase", "origin/main"], cwd);
    if (
        !run("git", ["push", "-u", "--force-with-lease", "origin", branch], cwd)
    ) {
        fail("push failed.");
    }

    const title = git(["log", "-1", "--pretty=%s"], cwd);
    const existing = spawnSync(
        "gh",
        ["pr", "view", branch, "--json", "number", "--jq", ".number"],
        { encoding: "utf8", cwd, env: NET_ENV }
    );
    if ((existing.status ?? 1) !== 0) {
        run(
            "gh",
            [
                "pr",
                "create",
                "--title",
                title,
                "--body",
                "Documentation only. Gated with `bun run check:docs` (format, cr:lint, doc guards) — the heavy suite does not apply to prose.",
            ],
            cwd
        );
    }

    if (noMerge) {
        console.log("docs-lane: PR left open (--no-merge). Worktree kept.");
        return;
    }

    const pr = Number(
        spawnSync(
            "gh",
            ["pr", "view", branch, "--json", "number", "--jq", ".number"],
            { encoding: "utf8", cwd, env: NET_ENV }
        ).stdout?.trim()
    );
    if (!Number.isInteger(pr) || pr <= 0) {
        fail("could not read the PR number — the PR is open, merge it there.");
    }

    console.log(`docs-lane: landing PR #${pr} under the merge lock`);
    const locked = spawnSync(
        "bun",
        [GATE, "heavy", buildShipMergeCommand({ branch, pr, primary, cwd })],
        { stdio: "inherit", cwd, env: NET_ENV }
    );
    if (locked.status !== 0) {
        fail(
            `landing failed (exit ${locked.status ?? "?"}). Re-check with ` +
                `\`gh pr view ${pr} --json state\`: MERGED means only a cleanup ` +
                `step failed; OPEN means fix and re-run \`bun run docs:ship\`.`
        );
    }
    console.log("docs-lane: merged, worktree and branch removed.");
}

// ─────────────────────────────────────────────────────────────────────────────

// Only dispatch when RUN, never when imported: the census test imports
// DOC_GATE_TESTS from here, and a module that exits on import would take the
// suite with it.
if (import.meta.main) {
    const [, , sub, ...rest] = process.argv;
    switch (sub) {
        case "new":
            cmdNew(rest.find((a) => !a.startsWith("-")));
            break;
        case "ship":
            cmdShip(rest);
            break;
        default:
            fail(
                `unknown subcommand ${JSON.stringify(sub ?? "")} — use new | ship`
            );
    }
}
