#!/usr/bin/env bun
/**
 * `bun run derive:sync` — the base writes its own derived whole-file state
 * (ADR 0157 § Option 1b, issue #6247).
 *
 * The lockfile's header hashes (`compilerHash`, `registryHash`, `poolHash`,
 * `botHash`) and the four `data/catalogue/*` files summarise the WHOLE tree,
 * so two PRs that each change any row collide on them textually and the
 * merge queue dequeues one (issue #6164). Here the BASE regenerates them
 * after each merge, from `housekeeping`'s throwaway worktree at
 * `origin/<base>`:
 *
 *   1. `oracle:compile --carry-bot` and `catalogue:pack` on the tip — the
 *      corpus cache is copied from the primary checkout when the worktree
 *      lacks it (gitignored; the self-hosted runners hold it);
 *   2. the five derived paths compared, blob by blob, with the tip's
 *      (`lib/derive-sync.ts` `derivePlan`): equal everywhere → no commit;
 *   3. else ONE commit with exactly the changed paths, built on a scratch
 *      index (`lib/commit-tree.ts`, the `gaps:sync` mechanics) and pushed
 *      to the base;
 *   4. COALESCING: a refused push is not rebuilt on the fetched tip and
 *      retried — if the base moved meanwhile, the newer tip's own post-merge
 *      run regenerates from scratch and this commit is dropped (exit 0, said);
 *      a refusal with the base unmoved is the run's red (exit 1). The hourly
 *      `housekeeping` is the backstop for a dropped commit.
 *
 * `--fresh` asks the other question: is THIS tree derived-fresh? — the
 * header-hash tier of `check:oracle` plus `catalogue:check`'s byte
 * comparison, no corpus, about a second. Exit 0 fresh, 1 stale with the
 * reason on stderr. `post-merge sync` runs it from the job worktree at the
 * pushed tip and fast-forwards the primary checkout (the local Convex
 * deployment) only on 0, so the deployment never serves a catalogue that
 * disagrees with its source; a stale tip leaves it on the previous fresh
 * one. `--dry-run` regenerates and prints the plan, commits nothing.
 *
 * Until issue #6248 lands, PRs still carry fresh derived state, so the
 * write path is a no-op on most tips — the safe rollout order. Measured
 * (MacBook, load 6): `oracle:compile --check` 3.7 s, `catalogue:check`
 * 1.0 s; the write path adds the two generators' disk writes and one push.
 *
 * The decisions are `lib/derive-sync.ts`; this file is the I/O.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildCatalogue } from "./catalogue-artifact";
import { headerHashDrift } from "./check-oracle-lockfile";
import { GIT_NET_TIMEOUT_MS } from "./gaps-sync";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { CATALOGUE_DIR, SOURCE_HASH_FILE } from "./lib/catalogue-merge";
import { DEFINITION_INDEX_PATH } from "./lib/definition-index";
import {
    DERIVED_PATHS,
    DERIVE_SYNC_COMMIT_SUBJECT,
    LOCKFILE_PATH,
    derivePlan,
    derivedFreshness,
    pushDerivedCommit,
    type CatalogueEntry,
    type DerivedEntry,
    type Freshness,
} from "./lib/derive-sync";
import {
    compilerHash,
    parseLockfile,
    poolHash,
    registryHash,
} from "./lib/oracle-lockfile";
import { PACKED_CORPUS_PATH } from "./lib/packed-corpus";
import { primaryCheckout } from "./lib/primary-checkout";
import { commitOnScratchIndex } from "./lib/commit-tree";
import { SEARCH_INDEX_PATH } from "./lib/search-index";
import { poolOracleIds } from "./oracle-compile";
import { CORPUS_PATH, corpusIsCached } from "./oracle-corpus";

/** This tree — the only tree the hashes and the generators can speak for:
 *  `registryHash()` reads the registry this file is imported with. */
const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

/** A generator's wall: the compile is seconds with the cache; a cold
 *  worktree pays its module graph once. */
const GENERATOR_WALL_MS = 5 * 60_000;

function git(
    args: string[],
    opts: { env?: NodeJS.ProcessEnv; timeout?: number } = {}
): {
    status: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
} {
    const r = spawnSync("git", args, {
        cwd: ROOT,
        encoding: "utf8",
        env: opts.env,
        timeout: opts.timeout,
        killSignal: "SIGKILL",
    });
    return {
        status: r.status,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
        timedOut:
            r.error !== undefined &&
            (r.error as { code?: string }).code === "ETIMEDOUT",
    };
}

const say = (line: string): void => console.log(`derive:sync: ${line}`);
const complain = (line: string): void => console.error(`derive:sync: ${line}`);

/** The four catalogue files: what this tree holds beside what it generates. */
function catalogueEntries(): CatalogueEntry[] {
    const build = buildCatalogue(ROOT);
    const onDisk = (path: string): string | null => {
        const full = join(ROOT, path);
        return existsSync(full) ? readFileSync(full, "utf8") : null;
    };
    return (
        [
            [join(CATALOGUE_DIR, SOURCE_HASH_FILE), build.sourceHashBytes],
            [PACKED_CORPUS_PATH, build.packedBytes],
            [DEFINITION_INDEX_PATH, build.definitionIndexBytes],
            [SEARCH_INDEX_PATH, build.searchIndexBytes],
        ] as const
    ).map(([path, expected]) => ({ path, committed: onDisk(path), expected }));
}

/** Is this tree derived-fresh (ADR 0157 § Option 1b, "Deployment")? */
export function freshness(): Freshness {
    const lockPath = join(ROOT, LOCKFILE_PATH);
    if (!existsSync(lockPath))
        return { fresh: false, why: `${LOCKFILE_PATH} is missing` };
    const lock = parseLockfile(readFileSync(lockPath, "utf8"));
    // `botHash` is NOT a drift condition (`lib/oracle-bot-reach.ts`): the
    // write path carries the committed verdicts (`--carry-bot`), so a tip is
    // judged on the three hashes `headerHashDrift` compares.
    const hashDrift = headerHashDrift(lock.header, {
        compilerHash: compilerHash(ROOT),
        registryHash: registryHash(),
        poolHash: poolHash(poolOracleIds()),
    });
    return derivedFreshness({ hashDrift, catalogue: catalogueEntries() });
}

/** The corpus cache, copied from the primary checkout into a worktree that
 *  lacks it (gitignored). false when neither tree holds one. */
function ensureCorpus(): boolean {
    if (corpusIsCached()) return true;
    const source = join(primaryCheckout(ROOT), "data", "oracle-corpus.json.gz");
    if (!existsSync(source) || source === CORPUS_PATH) {
        complain(
            `no corpus cache here nor in the primary checkout (${source}) — run \`bun run oracle:corpus\` there once`
        );
        return false;
    }
    mkdirSync(dirname(CORPUS_PATH), { recursive: true });
    copyFileSync(source, CORPUS_PATH);
    say(`corpus cache copied from ${source}`);
    return corpusIsCached();
}

/** One generator, inheriting stdio: its own lines are the log. */
function generate(label: string, argv: string[]): boolean {
    const r = spawnSync("bun", argv, {
        cwd: ROOT,
        stdio: "inherit",
        timeout: GENERATOR_WALL_MS,
        killSignal: "SIGKILL",
    });
    if (r.status === 0) return true;
    complain(
        r.error !== undefined &&
            (r.error as { code?: string }).code === "ETIMEDOUT"
            ? `${label} gave no answer within ${GENERATOR_WALL_MS / 1000}s`
            : `${label} failed (exit ${r.status ?? r.signal ?? "?"})`
    );
    return false;
}

/** Each derived path's blob on HEAD beside the blob of the regenerated file. */
function entries(): DerivedEntry[] | null {
    const out: DerivedEntry[] = [];
    for (const path of DERIVED_PATHS) {
        const committed = git(["rev-parse", "--verify", "-q", `HEAD:${path}`]);
        const regenerated = git(["hash-object", join(ROOT, path)]);
        if (regenerated.status !== 0) {
            complain(
                `${path} was not regenerated: ${regenerated.stderr.trim()}`
            );
            return null;
        }
        out.push({
            path,
            committed: committed.status === 0 ? committed.stdout.trim() : null,
            regenerated: regenerated.stdout.trim(),
        });
    }
    return out;
}

/** Regenerate on HEAD, commit what changed, push once. Exit code. */
function write(dryRun: boolean): number {
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    if (!ensureCorpus()) return 1;
    if (
        !generate("oracle:compile --carry-bot", [
            "scripts/oracle-compile.ts",
            "--carry-bot",
        ]) ||
        !generate("catalogue:pack", ["scripts/catalogue-artifact.ts"])
    )
        return 1;
    const found = entries();
    if (found === null) return 1;
    const plan = derivePlan(found);
    if (plan.kind === "no-op") {
        say(`${head.slice(0, 10)} is derived-fresh — nothing to commit`);
        return 0;
    }
    say(
        `${head.slice(0, 10)} is derived-stale: ${plan.paths.join(", ")}${dryRun ? " — dry run, nothing committed" : ""}`
    );
    if (dryRun) return 0;

    const files: { path: string; blob: string }[] = [];
    for (const path of plan.paths) {
        const blob = git(["hash-object", "-w", join(ROOT, path)]);
        if (blob.status !== 0) {
            complain(`could not store ${path}: ${blob.stderr.trim()}`);
            return 1;
        }
        files.push({ path, blob: blob.stdout.trim() });
    }
    const built = commitOnScratchIndex(
        (args, opts) => git(args, opts),
        head,
        files,
        DERIVE_SYNC_COMMIT_SUBJECT
    );
    if ("error" in built) {
        complain(`could not build the commit on ${head}: ${built.error}`);
        return 1;
    }
    const pushed = pushDerivedCommit((args, opts) => git(args, opts), {
        sha: built.sha,
        head,
        baseBranch: BASE_BRANCH,
        originBase: ORIGIN_BASE,
        netTimeoutMs: GIT_NET_TIMEOUT_MS,
    });
    const { outcome, why } = pushed;
    switch (outcome) {
        case "landed":
            say(
                `${built.sha.slice(0, 10)} pushed to ${BASE_BRANCH} (${plan.paths.length} file(s))`
            );
            return 0;
        case "coalesced":
            say(
                `push refused (${why}) and ${BASE_BRANCH} moved to ${pushed.remoteTip.slice(0, 10)} meanwhile — dropped, not retried: the newer tip's own run regenerates (ADR 0157)`
            );
            return 0;
        case "failed":
            complain(
                `push refused (${why}) with ${BASE_BRANCH} still at ${head.slice(0, 10)} — the next housekeeping run retries`
            );
            return 1;
    }
}

if (import.meta.main) {
    const argv = process.argv.slice(2);
    if (argv.includes("--fresh")) {
        const f = freshness();
        if (f.fresh) {
            say("this tree is derived-fresh");
            process.exit(0);
        }
        complain(`this tree is derived-stale — ${f.why}`);
        process.exit(1);
    }
    process.exit(write(argv.includes("--dry-run")));
}
