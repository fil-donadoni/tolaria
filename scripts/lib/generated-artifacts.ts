import { CORPUS_CACHE_REL } from "./corpus-cache";
import { LEDGER_PATH } from "./cr-ledger-path";

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
 *   - `data/ai-effects-allowlist.json` — IMMUNE BY SHAPE (issue #3017). The
 *     aiEffects guard's baseline: per-row, sorted by class then card name, no
 *     header, no hash, no tally. It exists BECAUSE of this property — it
 *     replaced four literal arrays in a 3.3k-line test file that every
 *     resolve()->effects[] migration PR had to hand-edit, and that any two
 *     concurrent ones collided in. Re-derived (prune-only) by `ai:allowlist`.
 *     `scripts/__tests__/generated-artifact-merge.test.ts` pins its shape too.
 *   - `data/catalogue/source-hash.json` — IN THIS CLASS (issue #3055). One
 *     line of whole-file state on a STABLE path: the hash of the catalogue
 *     source both renderings are generated from. Two branches that both
 *     regenerate collide on it, and taking a side would leave the server's
 *     record of the hash disagreeing with the packed corpus that carries it
 *     too — which is the drift ADR 0113 §2 makes the whole guard about.
 *     Re-derived by `catalogue:pack`, which needs no corpus.
 *   - `data/catalogue/packed-corpus.json` — IN THIS CLASS (issue #4164). The
 *     packed server corpus is ONE base64 string of deflated blocks plus
 *     indexes and the source hash: every regeneration rewrites the whole
 *     line, so two branches that both regenerate always collide, and no
 *     hunk-picking can yield bytes that decode. Re-derived by the same
 *     `catalogue:pack` run as the source hash. It is the server's ONLY
 *     rendering of the compiled rows since issue #4168 retired
 *     `data/oracle-compiled-pool.json`, the bare-array pool that was immune
 *     by shape and so needed no row here.
 *   - `data/catalogue/definition-index.json` — IN THIS CLASS (issue #4856).
 *     The hand-written Definition Index: one entry per line, which git could
 *     merge, but its derived `lookups` are ONE line of whole-file state: two
 *     branches that each add a card with a twin name both rewrite that line.
 *     Re-derived by the same
 *     `catalogue:pack` run.
 *   - `data/catalogue/search-index.json` — IN THIS CLASS (issue #4861). The
 *     deck-builder search index: ONE minified line of rows, so any two
 *     branches that regenerate it collide on that line. Re-derived by the
 *     same `catalogue:pack` run.
 *   - `data/catalogue/catalogue-<hash>.json` — RETIRED (issue #5124): the
 *     merged rows are held in memory and only their renderings above are
 *     committed. A branch cut before the retirement that regenerates it
 *     brings back a file `scripts/__tests__/catalogue-artifact.test.ts` reds
 *     on by name; `bun run catalogue:pack` deletes it.
 *   - `data/full-catalogue/full-catalogue-<hash>.json.gz` — CONTENT-ADDRESSED
 *     BY NAME too (issue #3500), and outside this class for the same reason
 *     plus a stronger one: it is a gzip BLOB, so git cannot produce a textual
 *     conflict in it at all. Two branches that regenerate produce two
 *     differently named files and the merged tree holds both, which
 *     `scripts/__tests__/full-catalogue-size.test.ts` reds on by name and
 *     `catalogue:ensure` refuses before a build. Its remedy is NOT re-derivable
 *     offline — the generator downloads a Scryfall bulk — so `catalogue:build`
 *     is named at the point of failure rather than run for the reader.
 *   - `data/oracle-corpus.pin.json` — whole-file state, but NOT in this class:
 *     it is not re-derivable from the tree at all (its generator needs the
 *     network, and the gate is offline by contract), and it moves only in a
 *     deliberate re-pin PR, never as a side effect of unrelated work.
 *   - `data/cr/citations-ledger.json` — NOT RE-DERIVABLE, so out of this class,
 *     but UNION-MERGEABLE BY KEY and served by its OWN driver (issue #3768,
 *     ADR 0133). It was read as immune by shape — per-row, sorted, no header
 *     hash — and it is not: rows sort by rule id, a hot id carries hundreds of
 *     them (the hottest, 525), so two branches confirming two DIFFERENT
 *     citations under the SAME id insert into the same sorted hunk and git
 *     reports a textual conflict with no semantic content. The remedy is not
 *     this class: `cr:ledger` upserts confirmations and prunes stale ones, it
 *     never regenerates the whole file, so there is nothing to re-derive at
 *     the rebased tip and taking ours would silently drop the other branch's
 *     confirmations. It gets {@link OTHER_MERGE_DRIVERS}'s `cr-ledger` driver
 *     instead, which resolves the file as a keyed set of independent facts.
 *   - `data/oracle-retirements.json` — hand-authored INPUT, not a generated
 *     artifact. A conflict there is a real judgement call and must reach a
 *     human.
 *   - `data/blade-card-index.json`, `data/blade-reproducers.json` — IN THIS
 *     CLASS (issue #6116), though they carry no hash: both are a pure function
 *     of `BLADE_SCENARIOS`, re-derived offline by `blade:card-index`, and their
 *     rows sort by card name / scenario label, so two PRs pinning blade
 *     entries for neighbouring cards insert into the same hunk. Measured: PR
 *     #6064 and PR #6068 were each dequeued `land-failed` on exactly that, and
 *     each repair pass resolved them by hand. The rule this extends: an
 *     artifact that is BOTH re-derivable offline AND collides in practice is
 *     regenerated — immunity by shape is a reason to stay out only when the
 *     rows really are disjoint (`card-index.json`: one row per card, which a
 *     PR adds once).
 *   - `AGENTS.md`, `convex/AGENTS.md`, `src/AGENTS.md` — IN THIS CLASS (issue
 *     #6116): whole-file mirrors of the `CLAUDE.md` sources and
 *     `.claude/rules/*.md`, re-derived offline by `agents:build`, so any two
 *     PRs that edit a source collide in the mirror while the sources merge.
 *   - Every OTHER tracked file under `data/` — generated or not — is a row of
 *     {@link UNREGENERATED_DATA} with its reason (issue #6116): sticky by
 *     design, human-written, not re-derivable offline, one-shot importer
 *     output, a blob, or hand input.
 *   - `convex/cubes/vintageCubeNames.ts` — the one script-written file outside
 *     `data/`: one-shot output of `scripts/gen-vintage-cube.ts`, no two PRs
 *     share it.
 *
 * THE NORM FOR A NEW ONE (issue #6116). A new committed file under `data/` —
 * and any script-written committed file elsewhere — is classified HERE in the
 * same PR: a row of {@link REGENERATED_ARTIFACTS} (re-derivable offline — its
 * `.gitattributes` row, and its path in `.prettierignore` so the generator's
 * bytes ARE the committed bytes and a regeneration never needs a format
 * step), a row of {@link OTHER_MERGE_DRIVERS}, or a row of {@link
 * UNREGENERATED_DATA} saying why it is neither. `generated-artifact-merge.test.ts`
 * reds on a `data/` path with no row, so the choice cannot be skipped. A
 * conflict on an unclassified generated file is a repair pass spent on bytes
 * nobody chose.
 */

/** A generated, committed artifact whose conflicts are resolved by re-deriving it. */
export interface RegeneratedArtifact {
    /** Repo-relative POSIX path, exactly as `.gitattributes` names it. */
    readonly path: string;
    /** The `package.json` script that re-derives it, run as `bun run <script>`. */
    readonly script: string;
    /** Extra arguments passed to that script. */
    readonly args?: readonly string[];
    /** The committed field(s) that are a function of the whole file. */
    readonly wholeFileState: string;
    /** Whether re-deriving it needs the gitignored Card Corpus cache. */
    readonly requiresCorpus: boolean;
}

export const REGENERATED_ARTIFACTS: readonly RegeneratedArtifact[] = [
    {
        path: "data/oracle-compiled.json",
        script: "oracle:compile",
        // ADR 0105 § 7.2 — `land` runs this resolver, and the sweep never
        // runs inside `land`: the lockfile is re-derived with the committed
        // Bot-play verdicts CARRIED FORWARD, never played. A card whose
        // definition the merge changed is left unswept until the next
        // `oracle:compile` (issue #3830 — without this, `land` played all
        // 3,400 cards under the machine mutex). The verdicts a rebased
        // commit replayed survive the conflict: the driver lays them over
        // the side it takes (issue #5814, `oracle-verdict-overlay.ts`).
        args: ["--carry-bot"],
        wholeFileState: "header.compilerHash, header.registryHash",
        requiresCorpus: true,
    },
    {
        path: "data/oracle-legality.json",
        script: "oracle:legality",
        wholeFileState: "contentHash, corpus",
        requiresCorpus: true,
    },
    {
        path: "data/catalogue/source-hash.json",
        script: "catalogue:pack",
        wholeFileState: "hash",
        // The catalogue is a pure JOIN of three COMMITTED sources (the module
        // graph, the compiler's lockfile, the card index) — offline, so a
        // conflict here is resolvable in any worktree, corpus or no corpus.
        requiresCorpus: false,
    },
    {
        path: "data/catalogue/packed-corpus.json",
        script: "catalogue:pack",
        wholeFileState: "blocks, blockOffsets, dictionary, sourceHash",
        // The same offline join as the source hash above (issue #4164).
        requiresCorpus: false,
    },
    {
        path: "data/catalogue/definition-index.json",
        script: "catalogue:pack",
        wholeFileState: "lookups",
        // The hand-written Definition Index (issue #4856): a walk of the
        // module graph alone — offline, written by the same run.
        requiresCorpus: false,
    },
    {
        path: "data/catalogue/search-index.json",
        script: "catalogue:pack",
        wholeFileState: "rows (one line)",
        // The deck-builder search index (issue #4861): derived from the same
        // offline join, written by the same run.
        requiresCorpus: false,
    },
    // Issue #6116 — derived from `BLADE_SCENARIOS` alone; the append-only
    // driver merges `scenarios.ts` first, so the tip's registry is the union.
    {
        path: "data/blade-card-index.json",
        script: "blade:card-index",
        wholeFileState: "rows sorted by card name (neighbouring inserts)",
        requiresCorpus: false,
    },
    {
        path: "data/blade-reproducers.json",
        script: "blade:card-index",
        wholeFileState: "rows sorted by scenario label (neighbouring inserts)",
        requiresCorpus: false,
    },
    // Issue #6116 — whole-file mirrors of the CLAUDE.md sources.
    {
        path: "AGENTS.md",
        script: "agents:build",
        wholeFileState: "the whole file (mirror of CLAUDE.md + rules)",
        requiresCorpus: false,
    },
    {
        path: "convex/AGENTS.md",
        script: "agents:build",
        wholeFileState: "the whole file (mirror of convex/CLAUDE.md)",
        requiresCorpus: false,
    },
    {
        path: "src/AGENTS.md",
        script: "agents:build",
        wholeFileState: "the whole file (mirror of src/CLAUDE.md)",
        requiresCorpus: false,
    },
] as const;

// The gitignored Card Corpus cache, repo-relative — defined beside the cache's
// pin check (`corpus-cache.ts`), which `oracle-corpus.ts` imports and so must
// not pull this module's imports into the compiler's program.
export { CORPUS_CACHE_REL };

/**
 * The merge-driver name `.gitattributes` gives every {@link
 * REGENERATED_ARTIFACTS} path, and the name `scripts/bootstrap-worktree.ts`
 * registers in local git config.
 *
 * The bootstrap cannot import this — it is node-builtins-only on purpose, so it
 * can run in a worktree with no `node_modules` — so the constant is hand-typed
 * there and a test pins it to this one.
 */
export const MERGE_DRIVER_NAME = "regenerated";

/**
 * A committed path carrying a merge driver that is NOT {@link
 * MERGE_DRIVER_NAME} — it is not re-derivable from the tree, so the
 * regenerated class's contract ("take a side, re-run the generator at the
 * rebased tip") does not fit it, but its conflicts are still never a real
 * disagreement.
 *
 * This exists so `.gitattributes` has ONE authority covering every row of it:
 * the guard pins the file to `REGENERATED_ARTIFACTS` followed by this list, so
 * a path can carry a different driver without being smuggled into the
 * regenerated class to get one.
 */
export interface DrivenArtifact {
    /** Repo-relative POSIX path, exactly as `.gitattributes` names it. */
    readonly path: string;
    /** The `merge=<name>` driver, registered by the worktree bootstrap. */
    readonly driver: string;
    /** The driver's implementation, repo-relative. */
    readonly script: string;
    /** Why it is out of the regenerated class and what its driver does. */
    readonly why: string;
}

/** The merge-driver name of the CR citation ledger (issue #3768). */
export const LEDGER_MERGE_DRIVER_NAME = "cr-ledger";

/** The merge-driver name of the hand-written append-only lists (issue #5942). */
export const APPEND_ONLY_MERGE_DRIVER_NAME = "append-only";

/** The merge-driver name of the issue-log ratchet baseline (issue #6276). */
export const KEY_SET_MERGE_DRIVER_NAME = "key-set";

export const OTHER_MERGE_DRIVERS: readonly DrivenArtifact[] = [
    {
        path: LEDGER_PATH,
        driver: LEDGER_MERGE_DRIVER_NAME,
        script: "scripts/merge-driver-cr-ledger.ts",
        why:
            "not re-derivable (`cr:ledger` upserts and prunes, it never regenerates), " +
            "but a keyed set of independent facts — merged by (id, line) against the base",
    },
    {
        path: "data/issue-log-comments-baseline.json",
        driver: KEY_SET_MERGE_DRIVER_NAME,
        script: "scripts/merge-driver-key-set.ts",
        why:
            "a sorted set of keys that only shrinks; the guard reds on stale keys, so PRs " +
            "delete rows of files they never touched and adjacent deletions conflict as text " +
            "(issue #6276) — merged as base minus removals plus additions",
    },
    {
        path: "data/card-index.json",
        driver: KEY_SET_MERGE_DRIVER_NAME,
        script: "scripts/merge-driver-key-set.ts",
        why:
            "one row per card sorted by name, regenerated only with Scryfall; every card PR " +
            "inserts its rows, and two PRs adding adjacent names conflict as text (issue #6648) " +
            "— merged row by row keyed by `name`, a row both sides changed differently stays a conflict",
    },
    {
        path: "data/gold-incomparable.json",
        driver: KEY_SET_MERGE_DRIVER_NAME,
        script: "scripts/merge-driver-key-set.ts",
        why:
            "the gold harness's incomparable cards, a sorted name set `gold.test.ts` pins equal " +
            "to the harness (issue #6648): Grammar PRs each add a name — merged as a set",
    },
    {
        path: "convex/cards/__tests__/compilerRoundTrip.baseline.ts",
        driver: APPEND_ONLY_MERGE_DRIVER_NAME,
        script: "scripts/merge-driver-append-only.ts",
        why:
            "Guard C's shrink-only baseline, one quoted name per line: every Grammar PR deletes " +
            "the rows it graduates, and two deleting adjacent names conflict as text (issue #6648) " +
            "— the driver keeps the rows both sides kept",
    },
    // Hand-written, append-only lists (issue #5942): two branches appending at
    // the same end conflict without disagreeing. The driver concatenates only
    // pure-insertion hunks and leaves every other conflict to a human.
    ...[
        "convex/gre/ai/blade/scenarios.ts",
        "convex/oracle/grammar/fixtures.ts",
    ].map((path) => ({
        path,
        driver: APPEND_ONLY_MERGE_DRIVER_NAME,
        script: "scripts/merge-driver-append-only.ts",
        why:
            "hand-written input, not an artifact, but an append-only list — a hunk where " +
            "both sides only inserted is concatenated, one where both only deleted distinct " +
            "lines keeps what both kept (issue #6648), anything else stays a conflict",
    })),
] as const;

/**
 * Every committed path whose rebase conflicts a merge driver absorbs — the
 * regenerated class and every other driven path. The queue planner reads
 * this, never its own copy, to decide which shared files are NOT an edge
 * between two issues (issue #6648): a path git merges without a human cannot
 * serialise two batches, and a path it cannot merge must not be waved through.
 */
export const MERGE_ABSORBED_PATHS: readonly string[] = [
    ...REGENERATED_ARTIFACTS.map((a) => a.path),
    ...OTHER_MERGE_DRIVERS.map((a) => a.path),
];

/** Why a tracked `data/` file is neither regenerated nor driven. */
export type UnregeneratedKind =
    /** Per-row, sorted, no whole-file state: two PRs touch disjoint hunks. */
    | "immune-by-shape"
    /** Re-derivable, but moving it at a rebased tip would be a side effect. */
    | "sticky"
    /** Its generator needs the network, a deployment or a Bot sweep. */
    | "not-offline"
    /** Written by a person (or by a script recording a person's decision). */
    | "human-input"
    /** One importer run per file; no two PRs share it. */
    | "one-shot"
    /** A binary, content-addressed by name: git cannot conflict in it. */
    | "blob";

/** A tracked `data/` file (or every file directly under a `dir/*`) that is
 *  out of both classes above, with its reason (issue #6116). */
export interface UnregeneratedData {
    /** A repo-relative path, or `<dir>/*` for every file directly in `<dir>`. */
    readonly pattern: string;
    readonly kind: UnregeneratedKind;
    readonly why: string;
}

/**
 * Every tracked `data/` file outside {@link REGENERATED_ARTIFACTS} and {@link
 * OTHER_MERGE_DRIVERS}. Exhaustive by test: a `data/` path with no row reds
 * `generated-artifact-merge.test.ts`, so a new artefact is classified in the
 * PR that adds it — never left to the default text merge by omission.
 */
export const UNREGENERATED_DATA: readonly UnregeneratedData[] = [
    {
        pattern: "data/ai-effects-allowlist.json",
        kind: "immune-by-shape",
        why: "aiEffects baseline, per-row sorted by class then name (issue #3017)",
    },
    {
        pattern: "data/ai-effects-inert.json",
        kind: "immune-by-shape",
        why: "the allowlist's sibling: same writer (`ai:allowlist`), same per-row sorted form",
    },
    {
        pattern: "data/catalogue/shard-dictionary.json",
        kind: "sticky",
        why: "every client shard URL derives from it; `catalogue:shard-dictionary` moves it on purpose only",
    },
    {
        pattern: "data/bot-reach-findings.json",
        kind: "not-offline",
        why: "written by a full Bot sweep (`bot:reach`), never inside a rebase",
    },
    {
        pattern: "data/grammar-gaps.json",
        kind: "not-offline",
        why: "`gaps:sync` records the GitHub issues it files there",
    },
    {
        pattern: "data/oracle-corpus.pin.json",
        kind: "not-offline",
        why: "pins a downloaded corpus; moves only in a deliberate re-pin PR",
    },
    {
        pattern: "data/premodern-metagame-decks.json",
        kind: "not-offline",
        why: "`metagame:import --refresh` fetches mtgtop8",
    },
    {
        pattern: "data/premodern-metagame-decks.pin.json",
        kind: "not-offline",
        why: "the metagame import's fetch pin (`fetchedAt`)",
    },
    {
        pattern: "data/cr/VERSION.json",
        kind: "not-offline",
        why: "`cr:sync` downloads the Comprehensive Rules (ADR 0098)",
    },
    {
        pattern: "data/cr/comprehensive-rules.txt",
        kind: "not-offline",
        why: "the vendored CR itself, written by `cr:sync` (ADR 0098)",
    },
    {
        pattern: "data/verdicts.lock.json",
        kind: "not-offline",
        why: "`verdicts:promote` derives it from self-play and blade runs",
    },
    {
        pattern: "data/oracle-retirements.json",
        kind: "human-input",
        why: "each retirement is a decision (`oracle:retire` records it); a conflict is a judgement call",
    },
    {
        pattern: "data/oracle-state-regressions.json",
        kind: "human-input",
        why: "entries carry a human-written reason (`--acknowledge`); stale ones are pruned after merge (issue #6061)",
    },
    {
        pattern: "data/targets.json",
        kind: "human-input",
        why: "the owner's Enforced Targets",
    },
    {
        pattern: "data/prints-rarity-overrides.json",
        kind: "human-input",
        why: "hand-curated rarity corrections",
    },
    {
        pattern: "data/premodern-tier1-decks.json",
        kind: "human-input",
        why: "hand-curated Tier 1 deck lists",
    },
    {
        pattern: "data/worklists/*",
        kind: "human-input",
        why: "card lists a person wrote for an import or a rollout",
    },
    {
        pattern: "data/json/*",
        kind: "one-shot",
        why: "MTGJSON set dumps, one file per set",
    },
    {
        pattern: "data/boosters/*",
        kind: "one-shot",
        why: "`import-booster-config.ts` output, one file per set",
    },
    {
        pattern: "data/pick-ratings/*",
        kind: "human-input",
        why: "the checked-in seed layer under the Admin-editable Pick Ratings (`cardRatings`)",
    },
    {
        pattern: "data/card-profiles/*",
        kind: "human-input",
        why: "per-card profiles a person reviews (`reviewed` flag)",
    },
    {
        pattern: "data/full-catalogue/*",
        kind: "blob",
        why: "gzip, content-addressed by name (issue #3500); `catalogue:build` needs Scryfall",
    },
] as const;

/** Whether `path` is matched by an {@link UnregeneratedData} pattern. */
export function matchesUnregeneratedPattern(
    pattern: string,
    path: string
): boolean {
    if (!pattern.endsWith("/*")) return pattern === path;
    const dir = pattern.slice(0, -1);
    return path.startsWith(dir) && !path.slice(dir.length).includes("/");
}

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
          /**
           * Marked paths the PR never owns (ADR 0157, issue #6248): the four
           * `data/catalogue/*` files, taken from the BASE instead of
           * regenerated — the base writes them after the merge, and a PR
           * rebased onto it must carry the base's bytes, not fresh ones.
           */
          readonly fromBase: readonly string[];
          /**
           * The lockfile was regenerated, so its header hashes are this
           * tree's: they are rewritten to the base's after the run (the rows
           * stay regenerated — they are the PR's).
           */
          readonly restoreHeader: boolean;
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
    const fromBase: string[] = [];
    const unknown: string[] = [];
    for (const path of dedupe(input.markedPaths)) {
        const artifact = regeneratedArtifact(path);
        if (artifact === undefined) unknown.push(path);
        // ADR 0157 (issue #6248): a derived path the PR never carries is
        // resolved by the base's bytes, never regenerated here — the one
        // derived path the PR shares, the lockfile, is regenerated for its
        // rows and its header put back (`restoreHeader`).
        else if (BASE_OWNED_PATHS.includes(path)) fromBase.push(path);
        else artifacts.push(artifact);
    }
    if (unknown.length > 0) {
        return {
            kind: "refuse",
            message:
                `marked for regeneration but not in the regenerated-artifact class: ${unknown.join(", ")}\n` +
                `  fix: resolve by hand, or add it to REGENERATED_ARTIFACTS in scripts/lib/generated-artifacts.ts`,
        };
    }
    if (artifacts.length === 0 && fromBase.length === 0)
        return { kind: "none" };
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
    return {
        kind: "regenerate",
        artifacts,
        fromBase,
        restoreHeader: artifacts.some((a) => a.path === BASE_OWNED_LOCKFILE),
    };
}

/**
 * The derived paths the BASE writes after each merge (ADR 0157 § Option 1b,
 * issue #6248) and a PR never carries: `derive:sync`'s five less the
 * lockfile, whose rows ARE the PR's. Restated from `lib/derive-sync.ts`
 * (a leaf this module must not drag the compiler through); pinned equal by
 * `generated-artifact-merge.test.ts`.
 */
export const BASE_OWNED_LOCKFILE = "data/oracle-compiled.json";
export const BASE_OWNED_PATHS: readonly string[] = [
    "data/catalogue/source-hash.json",
    "data/catalogue/packed-corpus.json",
    "data/catalogue/definition-index.json",
    "data/catalogue/search-index.json",
];

function dedupe(paths: readonly string[]): string[] {
    return [...new Set(paths.map((p) => p.trim()).filter((p) => p.length > 0))];
}
