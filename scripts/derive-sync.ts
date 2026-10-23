#!/usr/bin/env bun
/**
 * `bun run derive:sync` — the base writes its own derived whole-file state
 * (ADR 0157 § Option 1b, issue #6247).
 *
 * The lockfile's header hashes (`compilerHash`, `registryHash`, `poolHash`,
 * `botHash`) and the four `data/catalogue/*` files summarise the WHOLE tree,
 * so two PRs that each change any row collide on them textually and the
 * merge queue dequeues one (ADR 0157 § Context). Here the BASE regenerates them
 * after each merge, from `housekeeping`'s throwaway worktree at
 * `origin/<base>`:
 *
 *   1. `oracle:compile --carry-bot` and `catalogue:pack` on the tip — on a
 *      corpus cache matching the tip's pin: the primary checkout's when it
 *      matches, else the pinned bulk (`lib/corpus-cache.ts`, issue #6381);
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
 * Until the PR stops carrying derived paths (ADR 0157's last ticket), PRs
 * still carry fresh derived state, so the
 * write path is a no-op on most tips — the safe rollout order. Measured
 * (MacBook, load 6): `oracle:compile --check` 3.7 s, `catalogue:check`
 * 1.0 s; the write path adds the two generators' disk writes and one push.
 *
 * `--replay-bot` is the Bot-play replay on the base (issue #6463), the
 * `bot-replay` job of `post-merge.yml`: a session's bare `oracle:compile`
 * carries the committed verdicts whatever the Bot hash says, so the header's
 * Bot hash moves only here. Seconds when the header's hash is the tree's
 * (nothing pushed); else ONE whole sweep (`oracle:compile --replay-bot`,
 * 20–40 min under the heavy mutex) on this tip, then:
 *
 *   - no card left `ready` → the derived paths plus the card index
 *     regenerated (`oracle:index` for a card the Bot unfroze, `catalogue:pack`)
 *     and ONE commit pushed, header = this tree's Bot hash. A base that moved
 *     meanwhile is not a dropped sweep: the swept verdicts are laid over the
 *     new tip's lockfile through the merge driver's overlay
 *     (`lib/oracle-verdict-overlay.ts`, issue #5814), the tree moved to that
 *     tip and a bare compile plays its definition misses, and the commit is
 *     built there; a second Bot-hash move in the meantime simply leaves a
 *     mismatch for the next run;
 *   - a card left `ready` → nothing committed; one `bug` issue
 *     (`area:game-bot`, `## Band`) names the cards, their verdicts and the
 *     commit range that moved the hash. The same Bot is not swept again
 *     while that issue is open.
 *
 * The decisions are `lib/derive-sync.ts`; this file is the I/O.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildCatalogue } from "./catalogue-artifact";
import { headerHashDrift } from "./check-oracle-lockfile";
import { GIT_NET_TIMEOUT_MS } from "./gaps-sync";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { CATALOGUE_DIR, SOURCE_HASH_FILE } from "./lib/catalogue-merge";
import { DEFINITION_INDEX_PATH } from "./lib/definition-index";
import {
    BOT_REGRESSION_LABELS,
    BOT_REPLAY_COMMIT_SUBJECT,
    BOT_REPLAY_PATHS,
    DERIVED_PATHS,
    DERIVE_SYNC_COMMIT_SUBJECT,
    LOCKFILE_PATH,
    botRegressionTitle,
    botReplayOutcome,
    botReplayPlan,
    derivePlan,
    derivedFreshness,
    pushDerivedCommit,
    renderBotRegressionIssue,
    type CatalogueEntry,
    type DerivedEntry,
    type Freshness,
    type LostCard,
} from "./lib/derive-sync";
import { gh } from "./lib/gh";
import { botHash, botSourceFiles } from "./lib/oracle-bot-reach";
import {
    compilerHash,
    parseLockfile,
    poolHash,
    registryHash,
    serializeLockfile,
    type Lockfile,
} from "./lib/oracle-lockfile";
import {
    REGRESSION_LEDGER_PATH,
    parseRegressionLedger,
} from "./lib/oracle-state-regressions";
import { overlayBranchVerdicts } from "./lib/oracle-verdict-overlay";
import { PACKED_CORPUS_PATH } from "./lib/packed-corpus";
import { primaryCheckout } from "./lib/primary-checkout";
import { commitOnScratchIndex } from "./lib/commit-tree";
import { SEARCH_INDEX_PATH } from "./lib/search-index";
import {
    pinnedSha,
    realCorpusSeedDeps,
    seedPinnedCorpus,
} from "./lib/corpus-cache";
import { poolOracleIds } from "./oracle-compile";

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

/** A corpus cache matching THIS tree's pin (gitignored; issue #6381): kept,
 *  copied from the primary checkout only when it matches, else the pinned
 *  bulk downloaded. false when none can be had — never a mismatched file,
 *  since the lockfile is a derived path and would be committed from it. */
function ensureCorpus(): boolean {
    const seed = seedPinnedCorpus(
        ROOT,
        primaryCheckout(ROOT),
        pinnedSha(ROOT),
        realCorpusSeedDeps
    );
    if (!seed.ok) {
        complain(seed.why);
        return false;
    }
    if (seed.how !== "kept") say(`corpus cache ${seed.how} for the pin`);
    return true;
}

/** One generator, inheriting stdio: its own lines are the log. `signal` is
 *  what the wall sends: SIGKILL reaches the direct child only, so a generator
 *  that re-runs itself under the heavy gate (`oracle:compile`'s sweep,
 *  `lib/heavy-admission.ts`) takes SIGTERM, which it forwards to the gate
 *  and the gate reaps its group — an orphaned sweep would keep the mutex
 *  and write into a tree this run has already moved. */
function generate(
    label: string,
    argv: string[],
    wallMs: number = GENERATOR_WALL_MS,
    signal: NodeJS.Signals = "SIGKILL"
): boolean {
    const r = spawnSync("bun", argv, {
        cwd: ROOT,
        stdio: "inherit",
        timeout: wallMs,
        killSignal: signal,
    });
    if (r.status === 0) return true;
    complain(
        r.error !== undefined &&
            (r.error as { code?: string }).code === "ETIMEDOUT"
            ? `${label} gave no answer within ${wallMs / 1000}s`
            : `${label} failed (exit ${r.status ?? r.signal ?? "?"})`
    );
    return false;
}

/** Each derived path's blob on HEAD beside the blob of the regenerated file. */
function entries(
    paths: readonly string[] = DERIVED_PATHS
): DerivedEntry[] | null {
    const out: DerivedEntry[] = [];
    for (const path of paths) {
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
    return commitAndPush(head, plan.paths, DERIVE_SYNC_COMMIT_SUBJECT).code;
}

/** ONE commit with exactly `paths`, built on `head` on a scratch index and
 *  pushed once — the mechanics ADR 0157 gave the derive commit, shared with
 *  the replay commit so there is one pusher. The exit code, and the push's
 *  outcome (`error` when nothing was pushed) for a caller that retries a
 *  coalesced push. */
function commitAndPush(
    head: string,
    paths: readonly string[],
    subject: string
): { code: number; outcome: "landed" | "coalesced" | "failed" | "error" } {
    const files: { path: string; blob: string }[] = [];
    for (const path of paths) {
        const blob = git(["hash-object", "-w", join(ROOT, path)]);
        if (blob.status !== 0) {
            complain(`could not store ${path}: ${blob.stderr.trim()}`);
            return { code: 1, outcome: "error" };
        }
        files.push({ path, blob: blob.stdout.trim() });
    }
    const built = commitOnScratchIndex(
        (args, opts) => git(args, opts),
        head,
        files,
        subject
    );
    if ("error" in built) {
        complain(`could not build the commit on ${head}: ${built.error}`);
        return { code: 1, outcome: "error" };
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
                `${built.sha.slice(0, 10)} pushed to ${BASE_BRANCH} (${paths.length} file(s))`
            );
            return { code: 0, outcome };
        case "coalesced":
            say(
                `push refused (${why}) and ${BASE_BRANCH} moved to ${pushed.remoteTip.slice(0, 10)} meanwhile — not retried here: the newer tip's own run regenerates (ADR 0157)`
            );
            return { code: 0, outcome };
        case "failed":
            complain(
                `push refused (${why}) with ${BASE_BRANCH} still at ${head.slice(0, 10)} — the next housekeeping run retries`
            );
            return { code: 1, outcome };
    }
}

// ── --replay-bot (issue #6463) ────────────────────────────────────────────

/** The sweep's wall: 20–40 min measured for ~6,500 cards, plus the wait for
 *  the heavy mutex (`oracle:compile --replay-bot` queues on it). */
const SWEEP_WALL_MS = 120 * 60_000;

/** `oracle:index` resolves a newly `ready` card's printing at Scryfall —
 *  network, one call per new card, 503s retried by the script itself. */
const INDEX_WALL_MS = 30 * 60_000;

/** How many times the base may move under the sweep before the run gives
 *  its work up (review of this PR, finding 8): the derive commit of the push
 *  that triggered the run lands minutes into the sweep, so a moved tip is
 *  the COMMON case, and each re-apply is seconds — a bare compile over the
 *  overlaid verdicts, a pack, a push. */
const MAX_TIP_MOVES = 3;

function readLockfile(): Lockfile {
    return parseLockfile(readFileSync(join(ROOT, LOCKFILE_PATH), "utf8"));
}

/** The oracle ids `data/oracle-state-regressions.json` acknowledges: a
 *  freeze a human ruled correct is not a regression the replay files, and
 *  `check:oracle` accepts the commit for the same reason. */
function acknowledgedRegressions(): ReadonlySet<string> {
    const path = join(ROOT, REGRESSION_LEDGER_PATH);
    if (!existsSync(path)) return new Set();
    return new Set(
        parseRegressionLedger(readFileSync(path, "utf8")).acknowledged.map(
            (a) => a.oracleId
        )
    );
}

/** The open regression issue for THIS tree's Bot, by its title, or null.
 *  A `gh` failure is a null too: filing twice is the smaller harm beside
 *  never sweeping again. */
function openRegressionIssue(title: string): number | null {
    try {
        const rows = JSON.parse(
            gh([
                "issue",
                "list",
                "--state",
                "open",
                "--label",
                BOT_REGRESSION_LABELS[1]!,
                "--search",
                `in:title "${title}"`,
                "--limit",
                "20",
                "--json",
                "number,title",
            ])
        ) as { number: number; title: string }[];
        return rows.find((r) => r.title === title)?.number ?? null;
    } catch (error) {
        complain(`could not list the open regression issues: ${String(error)}`);
        return null;
    }
}

/** The commit range that moved the Bot hash off the header's — from the
 *  commit that wrote the header's hash to HEAD — and the Bot-source commits
 *  in it, `%h %s` each, newest first. The hash is in HEAD's header, so the
 *  NEWEST commit changing its occurrence count is the one that wrote it (an
 *  older one is a revert-and-reland's first life). */
function botHashMove(headerBotHash: string): {
    range: string;
    commits: string[];
} {
    const since = git([
        "log",
        "--format=%H",
        "-S",
        headerBotHash,
        "--",
        LOCKFILE_PATH,
    ])
        .stdout.trim()
        .split("\n")
        .filter((l) => l !== "")
        .at(0);
    const range = since === undefined ? "HEAD" : `${since.slice(0, 10)}..HEAD`;
    const commits =
        since === undefined
            ? []
            : git([
                  "log",
                  "--format=%h %s",
                  `${since}..HEAD`,
                  "--",
                  ...botSourceFiles(ROOT),
              ])
                  .stdout.trim()
                  .split("\n")
                  .filter((l) => l !== "");
    return { range, commits };
}

function fileRegression(input: {
    sha: string;
    headerBotHash: string;
    treeBotHash: string;
    lost: readonly LostCard[];
    dryRun: boolean;
}): void {
    const title = botRegressionTitle(input.treeBotHash);
    const body = renderBotRegressionIssue({
        ...input,
        ...botHashMove(input.headerBotHash),
    });
    say(
        `${input.lost.length} card(s) left \`ready\` under this Bot — nothing committed: ${input.lost.map((c) => c.name).join(", ")}`
    );
    if (input.dryRun) {
        say(`dry run — would file: ${title}`);
        return;
    }
    const args = ["issue", "create", "--title", title, "--body", body];
    for (const label of BOT_REGRESSION_LABELS) args.push("--label", label);
    const url = gh(args).trim();
    say(`filed ${url}`);
}

/** Detach this tree at `tip` and bootstrap it (`worktree:init`: the tip's
 *  `_generated`, dependencies, corpus pin). The tree must be clean — the
 *  caller restores its generated files first. */
function detachAt(tip: string): boolean {
    if (git(["checkout", "-q", "--detach", tip]).status !== 0) {
        complain(`could not move the tree to ${tip.slice(0, 10)}`);
        return false;
    }
    return (
        generate("worktree:init", ["scripts/bootstrap-worktree.ts"]) &&
        ensureCorpus()
    );
}

/** The base's tip, fetched — null when the fetch failed. */
function fetchedBaseTip(): string | null {
    const fetched = git(["fetch", "-q", "origin", BASE_BRANCH], {
        timeout: GIT_NET_TIMEOUT_MS,
    });
    if (fetched.status !== 0) {
        complain(`could not fetch ${BASE_BRANCH}: ${fetched.stderr.trim()}`);
        return null;
    }
    return git(["rev-parse", ORIGIN_BASE]).stdout.trim();
}

/**
 * The base moved while the sweep ran: move this tree to the new tip and
 * carry the swept verdicts onto its lockfile through the overlay, so the bare
 * compile that follows plays only the definition misses the new tip brought
 * (issue #6463). `swept` is the lockfile the sweep wrote on `head`.
 *
 * The overlay and the intermediate serialization run in THIS process — the
 * old tip's code — over a file the new tip's compile then rewrites whole; a
 * lockfile schema change between the two tips would have to survive one
 * parse/serialize round trip of the old code, an accepted bound (the schema
 * moves in the same PRs as `serializeLockfile`, which is also the one that
 * restamps `compilerHash`, and the compile reads the file back through
 * `cachedVerdict`, which carries only rows it can read).
 */
function moveToTip(head: string, newTip: string, swept: Lockfile): boolean {
    say(
        `${BASE_BRANCH} moved to ${newTip.slice(0, 10)} during the sweep — re-applying the verdicts over it`
    );
    // The sweep's and the pack's writes: the detach needs a clean tree.
    if (git(["checkout", "-q", "--", "."]).status !== 0) {
        complain("could not restore the generated files before moving");
        return false;
    }
    if (!detachAt(newTip)) return false;
    const base = parseLockfile(
        git(["show", `${head}:${LOCKFILE_PATH}`]).stdout
    );
    const ours = readLockfile();
    const { lock, carried } = overlayBranchVerdicts(base, ours, swept);
    // The header: the swept Bot hash — every carried verdict was played
    // under it; the misses the bare compile plays next are played under the
    // new tip's Bot, a mixed state the next run resolves when the two hashes
    // differ (the same honesty bound as `--carry-bot --replay-card`).
    writeFileSync(
        join(ROOT, LOCKFILE_PATH),
        serializeLockfile({
            ...lock,
            header: { ...lock.header, botHash: swept.header.botHash },
        })
    );
    say(
        `${carried} swept verdict(s) laid over ${newTip.slice(0, 10)}'s lockfile`
    );
    // Bare: carries every overlaid verdict on its definition, plays the
    // definition misses the new tip brought, keeps the swept Bot hash.
    return generate(
        "oracle:compile",
        ["scripts/oracle-compile.ts"],
        SWEEP_WALL_MS,
        "SIGTERM"
    );
}

/** The Bot-play replay on the base (issue #6463). Exit code. */
function replayBot(dryRun: boolean): number {
    // A throwaway tree only: the run detaches and restores files below, and
    // would take a session's uncommitted work with it.
    const dirt = git(["status", "--porcelain"]).stdout.trim();
    if (dirt !== "") {
        complain(
            `--replay-bot moves and restores this tree — refusing on a tree with uncommitted changes:\n${dirt.split("\n").slice(0, 5).join("\n")}`
        );
        return 2;
    }
    // The BASE's tip, never the job's own sha: a scheduled or dispatched run
    // is handed the default branch's sha (the release branch), and the Bot
    // hash to compare is the base's.
    const tip = fetchedBaseTip();
    if (tip === null) return 1;
    let head = git(["rev-parse", "HEAD"]).stdout.trim();
    if (head !== tip) {
        say(
            `${head.slice(0, 10)} is not ${BASE_BRANCH}'s tip — moving to ${tip.slice(0, 10)}`
        );
        if (!detachAt(tip)) return 1;
        head = tip;
    }
    const committed = readLockfile();
    const headerBotHash = committed.header.botHash;
    const treeBotHash = botHash(ROOT);
    const title = botRegressionTitle(treeBotHash);
    const plan = botReplayPlan({
        headerBotHash,
        treeBotHash,
        openRegression:
            headerBotHash === treeBotHash ? null : openRegressionIssue(title),
    });
    if (plan.kind === "current") {
        say(
            `${head.slice(0, 10)}: the header's Bot hash is the tree's — nothing to replay`
        );
        return 0;
    }
    if (plan.kind === "filed") {
        say(
            `${head.slice(0, 10)}: this Bot (${treeBotHash.slice(0, 19)}) already took cards out of \`ready\` — issue #${plan.issue} is open, not swept again`
        );
        return 0;
    }
    say(
        `${head.slice(0, 10)}: header Bot hash ${headerBotHash.slice(0, 19)} ≠ tree ${treeBotHash.slice(0, 19)} — replaying every \`ready\` card`
    );
    if (!ensureCorpus()) return 1;
    // `before` is this tree's own compile with the verdicts carried, not the
    // committed rows: a tip whose derive commit has not landed yet may owe
    // state changes to the compiler or the registry, and those are not the
    // Bot's regression (review of this PR, finding 7).
    if (
        !generate("oracle:compile --carry-bot", [
            "scripts/oracle-compile.ts",
            "--carry-bot",
        ])
    )
        return 1;
    const before = readLockfile();
    if (
        !generate(
            "oracle:compile --replay-bot",
            ["scripts/oracle-compile.ts", "--replay-bot"],
            SWEEP_WALL_MS,
            "SIGTERM"
        )
    )
        return 1;
    let swept = readLockfile();
    const acknowledged = acknowledgedRegressions();
    let outcome = botReplayOutcome(before.cards, swept.cards, acknowledged);
    if (outcome.lost.length > 0) {
        fileRegression({
            sha: head,
            headerBotHash,
            treeBotHash,
            lost: outcome.lost,
            dryRun,
        });
        return 0;
    }

    for (let moves = 0; moves <= MAX_TIP_MOVES; moves++) {
        const remoteTip = fetchedBaseTip();
        if (remoteTip === null) return 1;
        if (remoteTip !== head) {
            if (dryRun) {
                say(
                    `${BASE_BRANCH} moved to ${remoteTip.slice(0, 10)} — dry run, the verdicts would be re-applied over it; nothing moved, nothing committed`
                );
                return 0;
            }
            const tipBefore = parseLockfile(
                git(["show", `${remoteTip}:${LOCKFILE_PATH}`]).stdout
            );
            if (!moveToTip(head, remoteTip, swept)) return 1;
            head = remoteTip;
            swept = readLockfile();
            outcome = botReplayOutcome(
                tipBefore.cards,
                swept.cards,
                acknowledged
            );
            if (outcome.lost.length > 0) {
                fileRegression({
                    sha: head,
                    headerBotHash,
                    treeBotHash,
                    lost: outcome.lost,
                    dryRun,
                });
                return 0;
            }
        }
        if (outcome.gained.length > 0) {
            say(
                `${outcome.gained.length} card(s) newly \`ready\` under this Bot — indexing their printings`
            );
            if (
                !generate(
                    "oracle:index",
                    ["scripts/oracle-index-backfill.ts"],
                    INDEX_WALL_MS
                )
            )
                return 1;
        }
        if (!generate("catalogue:pack", ["scripts/catalogue-artifact.ts"]))
            return 1;
        const found = entries(BOT_REPLAY_PATHS);
        if (found === null) return 1;
        const plan2 = derivePlan(found, BOT_REPLAY_PATHS);
        if (plan2.kind === "no-op") {
            // Cannot happen with a moved header hash, but never push an empty commit.
            say(
                `${head.slice(0, 10)}: the sweep changed nothing — nothing to commit`
            );
            return 0;
        }
        say(
            `${head.slice(0, 10)}: replayed, header → ${swept.header.botHash.slice(0, 19)}: ${plan2.paths.join(", ")}${dryRun ? " — dry run, nothing committed" : ""}`
        );
        if (dryRun) return 0;
        const pushed = commitAndPush(
            head,
            plan2.paths,
            BOT_REPLAY_COMMIT_SUBJECT
        );
        if (pushed.outcome !== "coalesced") return pushed.code;
        say(
            `re-applying the sweep over the moved tip (${moves + 1}/${MAX_TIP_MOVES})`
        );
    }
    say(
        `${BASE_BRANCH} moved ${MAX_TIP_MOVES} times under the replay — giving the sweep up; the next run sweeps again`
    );
    return 0;
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
    if (argv.includes("--replay-bot")) {
        process.exit(replayBot(argv.includes("--dry-run")));
    }
    process.exit(write(argv.includes("--dry-run")));
}
