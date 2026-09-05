/**
 * The class of generated, committed `data/` artifacts that must be
 * REGENERATED, never merged (issue #3069).
 *
 * WHY A CLASS AND NOT A FILE. Every byte of these artifacts is a function of
 * the tree — the compiler source, the Mechanics Registry, the pinned Card
 * Corpus, the card index. Nothing in them is a judgement call, so resolving a
 * conflict in one by picking hunks is at best a no-op and at worst commits an
 * artifact that matches neither side.
 *
 * THE DISCRIMINATOR IS WHOLE-FILE STATE, NOT "GENERATED". `data/card-index.json`
 * is generated and committed too, and it merges cleanly, because its committed
 * form is per-row and sorted by name: two PRs adding two different cards touch
 * disjoint line ranges. What makes an artifact conflict-prone is a committed
 * field that is a function of the WHOLE file — a content hash, a tally — because
 * several such fields sit within a few lines of each other and move for
 * unrelated reasons, so two PRs moving two DIFFERENT fields still collide.
 *
 * The status of every other committed `data/` artifact, stated rather than left
 * unmentioned (issue #3069 asks for exactly this):
 *
 *   - `data/card-index.json` — IMMUNE BY SHAPE. Per-row, sorted by name, no
 *     header, no hash, no tally. `scripts/__tests__/generated-artifact-merge.test.ts`
 *     pins that shape so the immunity cannot silently lapse.
 *   - `data/oracle-compiled-pool.json` — IMMUNE BY SHAPE. A bare array of
 *     resolved card rows; no header, no hash, no tally (ADR 0114 §2 keeps it a
 *     catalogue with nothing left to resolve at runtime).
 *   - `data/oracle-corpus.pin.json` — whole-file state, but NOT in this class:
 *     it is not re-derivable from the tree at all (its generator needs the
 *     network, and the gate is offline by contract), and it moves only in a
 *     deliberate re-pin PR, never as a side effect of unrelated work.
 *   - `data/oracle-retirements.json` — hand-authored INPUT, not a generated
 *     artifact. A conflict there is a real judgement call and must reach a
 *     human.
 */

/** A generated, committed artifact whose conflicts are resolved by re-deriving it. */
export interface RegeneratedArtifact {
    /** Repo-relative POSIX path, exactly as `.gitattributes` names it. */
    readonly path: string;
    /** The `package.json` script that re-derives it, run as `bun run <script>`. */
    readonly script: string;
    /** The committed field(s) that are a function of the whole file. */
    readonly wholeFileState: string;
    /** Whether re-deriving it needs the gitignored Card Corpus cache. */
    readonly requiresCorpus: boolean;
}

export const REGENERATED_ARTIFACTS: readonly RegeneratedArtifact[] = [
    {
        path: "data/oracle-compiled.json",
        script: "oracle:compile",
        wholeFileState:
            "header.compilerHash, header.registryHash, header.counts, formats[*]",
        requiresCorpus: true,
    },
    {
        path: "data/oracle-legality.json",
        script: "oracle:legality",
        wholeFileState: "contentHash, corpus",
        requiresCorpus: true,
    },
] as const;

/**
 * The gitignored Card Corpus cache, repo-relative.
 *
 * Kept relative (rather than importing `oracle-corpus.ts`'s absolute
 * `CORPUS_PATH`) because the resolver has to ask the question about the
 * WORKTREE it was invoked in, not about the checkout the module happens to live
 * in. A test pins the two against each other so there is still one authority.
 */
export const CORPUS_CACHE_REL = "data/oracle-corpus.json.gz";

/**
 * The `.gitattributes` merge-driver name, and the name
 * `scripts/bootstrap-worktree.ts` registers in local git config.
 *
 * The bootstrap cannot import this — it is node-builtins-only on purpose, so it
 * can run in a worktree with no `node_modules` — so the constant is hand-typed
 * there and a test pins it to this one.
 */
export const MERGE_DRIVER_NAME = "regenerated";

/**
 * Marker the merge driver appends resolved paths to, resolved through
 * `git rev-parse --git-path` so it lands in the right per-worktree git dir.
 */
export const REGENERATE_MARKER = "tolaria-regenerate";

export function regeneratedArtifact(
    path: string
): RegeneratedArtifact | undefined {
    return REGENERATED_ARTIFACTS.find((a) => a.path === path);
}

export type Resolution =
    | { readonly kind: "none" }
    | { readonly kind: "refuse"; readonly message: string }
    | {
          readonly kind: "regenerate";
          readonly artifacts: readonly RegeneratedArtifact[];
      };

/**
 * What to do about the paths the merge driver marked — the whole decision, pure
 * so it is testable without a git repo, a corpus or a network.
 *
 * Three outcomes, and the third one is the point of the issue: with no corpus
 * cache the artifacts CANNOT be re-derived, and taking one side silently is the
 * one thing that must never happen.
 *
 * WHY REFUSE RATHER THAN LEAN ON THE DRIFT GUARD. Since issue #3070 the
 * guard's offline tier hashes the pool projection too, so it would in fact go
 * red on most side-taken lockfiles — the issue allows either degradation. This
 * refuses anyway, for two reasons the guard cannot give:
 *
 *   - it names the CAUSE. A hash mismatch tells the reader the lockfile is
 *     stale; it never tells them a merge silently took a side, which is the
 *     one fact needed to know that re-running the generator is safe rather
 *     than a way to paper over someone else's lost change.
 *   - it does not depend on which fields the guard happens to cover offline.
 *     The per-format `total`/`ready`/`quarantine`/`unparsed` tallies are still
 *     corpus-derived and unhashed; today nothing can move them without also
 *     moving a hashed field, and that is a coincidence of the current header,
 *     not an invariant this resolver should inherit.
 *
 * The guard stays the authority on whether the tree is consistent. This decides
 * only whether a resolution is allowed to proceed at all.
 */
export function planResolution(input: {
    readonly markedPaths: readonly string[];
    readonly corpusPresent: boolean;
}): Resolution {
    const artifacts: RegeneratedArtifact[] = [];
    const unknown: string[] = [];
    for (const path of dedupe(input.markedPaths)) {
        const artifact = regeneratedArtifact(path);
        if (artifact) artifacts.push(artifact);
        else unknown.push(path);
    }
    if (unknown.length > 0) {
        return {
            kind: "refuse",
            message:
                `marked for regeneration but not in the regenerated-artifact class: ${unknown.join(", ")}\n` +
                `  fix: resolve by hand, or add it to REGENERATED_ARTIFACTS in scripts/lib/generated-artifacts.ts`,
        };
    }
    if (artifacts.length === 0) return { kind: "none" };
    if (artifacts.some((a) => a.requiresCorpus) && !input.corpusPresent) {
        return {
            kind: "refuse",
            message:
                `cannot re-derive ${artifacts.map((a) => a.path).join(", ")} — ` +
                `the Card Corpus cache (${CORPUS_CACHE_REL}) is gitignored and absent here.\n` +
                `  A merge took one side of a generated artifact; regenerating is the only correct resolution.\n` +
                `  fix: bun run oracle:corpus && ${artifacts.map((a) => `bun run ${a.script}`).join(" && ")}`,
        };
    }
    return { kind: "regenerate", artifacts };
}

function dedupe(paths: readonly string[]): string[] {
    return [...new Set(paths.map((p) => p.trim()).filter((p) => p.length > 0))];
}
