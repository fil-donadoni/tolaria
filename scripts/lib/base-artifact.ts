/**
 * A committed artifact as the BASE BRANCH has it — the only honest baseline
 * for a guard that asks a question about CHANGE ("did this branch shrink the
 * pool", "did this branch grow the citation baseline") rather than about
 * staleness.
 *
 * Read through git rather than kept as a committed second copy: a checked-in
 * baseline would have to be refreshed alongside the artifact it guards, and a
 * baseline you refresh in the same commit as the thing it guards guards
 * nothing.
 *
 * Three OUTCOMES rather than a nullable, and the distinction is the whole
 * point (review of issue #2696, finding 1). "There is no other commit to
 * compare against" — a tarball export, a clone that never fetched the base, a
 * merge-base that predates the artifact — is a legitimate skip. "The
 * comparison broke" — git missing from `PATH`, a `git show` that failed for a
 * reason nobody anticipated — is a RED: a guard that cannot read its baseline
 * is a guard that is not there. Collapsing the two into `null` made every one
 * of those print a green skip line and exit 0.
 *
 * First written inside `check-oracle-lockfile.ts` for the Oracle lockfile's
 * state-regression tier; extracted here when the CR citation ledger (ADR 0133)
 * became the second artifact needing the same three answers. PURE given its
 * runner, so every branch has a fixture (`oracle-baseline-outcome.test.ts`).
 */
import { execFileSync } from "node:child_process";
import { ORIGIN_BASE } from "./branches";

/** One git invocation's outcome, so a failure is a value rather than a throw. */
export type GitResult =
    | { readonly ok: true; readonly out: string }
    | {
          readonly ok: false;
          readonly error: string;
          /**
           * The git BINARY could not be spawned at all (ENOENT), as opposed to
           * git running and answering "no".
           *
           * The difference decides skip vs red on the very first probe: a
           * tarball export with no `.git` is a legitimate skip, while git
           * missing from `PATH` is broken tooling on a tree that IS a
           * repository — and collapsing the two is how the guard came to
           * print green with no git at all (review of issue #2696, finding 1).
           */
          readonly missing?: boolean;
      };

/** Runs `git <args>` in the repo root. Injected so the decision is testable. */
export type GitRunner = (args: readonly string[]) => GitResult;

export type BaseArtifactOutcome =
    | { readonly kind: "text"; readonly text: string; readonly at: string }
    | { readonly kind: "unavailable"; readonly why: string }
    | { readonly kind: "broken"; readonly detail: string };

/**
 * The bytes of `relPath` at the merge-base of HEAD and the base branch, or
 * why they could not be read. Parsing is the caller's — a parse failure is
 * its own `broken` (the schema-rewrite moment is when a real regression is
 * most likely), and only the caller knows the schema.
 */
export function baseArtifact(
    git: GitRunner,
    relPath: string
): BaseArtifactOutcome {
    const repo = git(["rev-parse", "--is-inside-work-tree"]);
    if (!repo.ok && repo.missing === true)
        return {
            kind: "broken",
            detail: `git is not on PATH (${repo.error}) — this tree is a git repository, so the baseline is readable and something is wrong with the environment, not with the repo`,
        };
    if (!repo.ok)
        return {
            kind: "unavailable",
            why: `not a git work tree here (${repo.error})`,
        };
    const ref = git([
        "rev-parse",
        "--verify",
        "--quiet",
        `${ORIGIN_BASE}^{commit}`,
    ]);
    if (!ref.ok)
        return {
            kind: "unavailable",
            why: `${ORIGIN_BASE} is not a ref in this clone — fetch the base branch to enable it`,
        };
    const mergeBase = git(["merge-base", "HEAD", ORIGIN_BASE]);
    if (!mergeBase.ok)
        return {
            kind: "broken",
            detail: `git merge-base HEAD ${ORIGIN_BASE} failed: ${mergeBase.error}`,
        };
    const at = `${mergeBase.out.trim()}:${relPath}`;
    // `cat-file -e` separates "the merge-base predates the artifact" (a
    // legitimate skip) from "git show blew up" (a red). Without it both arrive
    // as the same non-zero exit from `show`.
    if (!git(["cat-file", "-e", at]).ok)
        return {
            kind: "unavailable",
            why: `${relPath} does not exist at the merge-base with ${ORIGIN_BASE}`,
        };
    const show = git(["show", at]);
    if (!show.ok)
        return {
            kind: "broken",
            detail: `git show ${at} failed: ${show.error}`,
        };
    return { kind: "text", text: show.out, at };
}

/**
 * The real runner. `maxBuffer` is generous on purpose: the Oracle lockfile is
 * ~10 MB of text today and grows with the corpus, and a buffer overrun would
 * surface as `broken` — a red on a healthy tree — rather than as a wrong
 * answer.
 */
export function gitRunner(root: string): GitRunner {
    return (args) => {
        try {
            return {
                ok: true,
                out: execFileSync("git", [...args], {
                    cwd: root,
                    encoding: "utf8",
                    stdio: ["ignore", "pipe", "pipe"],
                    maxBuffer: 512 * 1024 * 1024,
                }),
            };
        } catch (err) {
            const e = err as {
                stderr?: string;
                message?: string;
                code?: string;
            };
            return {
                ok: false,
                error: (e.stderr || e.message || "unknown error").trim(),
                ...(e.code === "ENOENT" ? { missing: true } : {}),
            };
        }
    };
}
