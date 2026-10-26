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
 *   1. the DRIFT SWEEP (ADR 0158 § 2b, issue #6687): the tip's misses —
 *      `ready` rows whose Bot verdict was not played on the definition the
 *      tip compiles (`staleVerdicts`, `check-oracle-lockfile.ts`) — counted
 *      with no lock; zero → `oracle:compile --carry-bot`, seconds, as before;
 *      else `oracle:compile --play-misses`, which plays exactly them — the
 *      drift rows a session's bare compile carried (`botStale`, issue
 *      #6688) and any graduation — in place up to `LOCK_FREE_MISSES`, under
 *      the heavy mutex past it, and keeps the header's Bot hash. A card it took out of `ready` is committed — its
 *      Bot Gap is `gaps:sync`'s to file; one it brought in gets its
 *      `oracle:index` row. Misses, played and wall are logged and appended
 *      to `$GITHUB_STEP_SUMMARY`;
 *   2. `catalogue:pack` on the tip — every generator on a corpus cache
 *      matching the tip's pin: the primary checkout's when it matches, else
 *      the pinned bulk (`lib/corpus-cache.ts`);
 *   3. the derived paths (and the card index) compared, blob by blob, with
 *      the tip's (`lib/derive-sync.ts` `derivePlan`): equal everywhere → no
 *      commit;
 *   4. else ONE commit with exactly the changed paths, built on a scratch
 *      index (`lib/commit-tree.ts`, the `gaps:sync` mechanics) and pushed
 *      to the base;
 *   5. COALESCING: a refused push is not rebuilt on the fetched tip and
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
 * one. `--dry-run` regenerates (the drift sweep included) and prints the
 * plan, commits nothing.
 *
 * `--settled` is health's question (ADR 0158 § 2b, ADR 0159): `--fresh` —
 * the same exit and stale line, so health waits on it within the grace and
 * reds past it — AND whether a maintenance job is LATE with the Bot state:
 * a stale row (the drift sweep's), the header's Bot hash not the tree's
 * (the replay's) unless this Bot's regression issue is open. Lateness is
 * exit 0 with a `derived state is late` line health carries onto its GREEN
 * record, and past `DERIVED_GRACE_MS` an issue filed once (`area:workflow`,
 * by title) — never a RED, never `pending` (ADR 0159: three hours of a
 * blocked queue were a 75-min replay's push timeout). A compile on the
 * pinned corpus, seconds. The deployment keeps asking `--fresh`: a stale
 * verdict never holds it.
 *
 * Until the PR stops carrying derived paths (ADR 0157's last ticket), PRs
 * still carry fresh derived state, so the
 * write path is a no-op on most tips — the safe rollout order. Measured
 * (MacBook, load 6): `oracle:compile --check` 3.7 s, `catalogue:check`
 * 1.0 s; the write path adds the two generators' disk writes and one push.
 *
 * `--replay-bot` is the Bot-play replay on the base, the
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
 *     (`lib/oracle-verdict-overlay.ts`), the tree moved to that
 *     tip and `oracle:compile --play-misses` plays its misses, and the commit is
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
import {
    appendFileSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { buildCatalogue } from "./catalogue-artifact";
import { headerHashDrift, staleVerdicts } from "./check-oracle-lockfile";
import { GIT_NET_TIMEOUT_MS } from "./gaps-sync";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { CATALOGUE_DIR, SOURCE_HASH_FILE } from "./lib/catalogue-merge";
import { DEFINITION_INDEX_PATH } from "./lib/definition-index";
import {
    BOT_REGRESSION_LABELS,
    BOT_REPLAY_COMMIT_SUBJECT,
    BOT_REPLAY_PATHS,
    DERIVED_LATE_LABELS,
    DERIVED_LATE_TITLE_PREFIX,
    DERIVED_PATHS,
    DERIVE_SYNC_COMMIT_SUBJECT,
    DERIVE_SYNC_PATHS,
    LOCKFILE_PATH,
    PUSH_RETRY_BACKOFF_MS,
    botRegressionTitle,
    botReplayOutcome,
    botReplayPlan,
    derivePlan,
    derivedFreshness,
    derivedLateLine,
    derivedLateTitle,
    derivedStaleLine,
    pushDerivedCommit,
    renderBotRegressionIssue,
    renderDerivedLateIssue,
    runDriftSweep,
    verdictCurrency,
    type CatalogueEntry,
    type Currency,
    type DerivedEntry,
    type DriftSweepResult,
    type Freshness,
    type LateKind,
    type LostCard,
} from "./lib/derive-sync";
import { gh } from "./lib/gh";
import { DERIVED_GRACE_MS } from "./lib/health-step";
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
import { readCorpus } from "./oracle-corpus";
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

/** `maxBuffer` well over the ~20 MB lockfile: the 1 MB default made
 *  `git show <tip>:<lockfile>` ENOBUFS mid-blob, and the truncated text
 *  reached `parseLockfile` as "Unterminated string" after a 39-min sweep
 *  (issue #6642). A child-process error (ENOBUFS, spawn failure) is a
 *  failure: status null, its message on stderr, never a partial stdout. */
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

function git(
    args: string[],
    opts: { env?: NodeJS.ProcessEnv; timeout?: number; cwd?: string } = {}
): {
    status: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
} {
    const r = spawnSync("git", args, {
        cwd: opts.cwd ?? ROOT,
        encoding: "utf8",
        env: opts.env,
        timeout: opts.timeout,
        killSignal: "SIGKILL",
        maxBuffer: GIT_MAX_BUFFER,
    });
    const code = (r.error as { code?: string } | undefined)?.code;
    if (r.error !== undefined && code !== "ETIMEDOUT")
        return {
            status: null,
            stdout: "",
            stderr: `git ${args[0]}: ${r.error.message}`,
            timedOut: false,
        };
    return {
        status: r.status,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
        timedOut: code === "ETIMEDOUT",
    };
}

/** A file's whole text at `rev`, or why it could not be read — the
 *  replay's moved-tip path parses two such blobs (issue #6642). */
export function blobAt(
    rev: string,
    path: string,
    cwd: string = ROOT
): { ok: true; text: string } | { ok: false; why: string } {
    const r = git(["show", `${rev}:${path}`], { cwd });
    if (r.status !== 0)
        return {
            ok: false,
            why: `git show ${rev.slice(0, 10)}:${path} failed: ${r.stderr.trim() || `exit ${r.status ?? "?"}`}`,
        };
    return { ok: true, text: r.stdout };
}

/** The lockfile as committed at `rev`, or `null` once the failure is said. */
function lockfileAt(rev: string): Lockfile | null {
    const blob = blobAt(rev, LOCKFILE_PATH);
    if (!blob.ok) {
        complain(blob.why);
        return null;
    }
    return parseLockfile(blob.text);
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

/** Health's second question (ADR 0158 § 2b, ADR 0159): are the tip's Bot
 *  verdicts current, or is a maintenance job late with them? Null when the
 *  corpus cannot be had — an unjudged tree, which the caller turns into no
 *  verdict, never into current. */
export function currency(): Currency | null {
    if (!ensureCorpus()) return null;
    const lock = readLockfile();
    const treeBotHash = botHash(ROOT);
    return verdictCurrency({
        stale: staleVerdicts(lock, readCorpus()).map((c) => c.name),
        headerBotHash: lock.header.botHash,
        treeBotHash,
        openRegression:
            lock.header.botHash === treeBotHash
                ? null
                : openIssueByTitle(
                      botRegressionTitle(treeBotHash),
                      BOT_REGRESSION_LABELS[1]!
                  ),
    });
}

/** HEAD's committer time, ms since the epoch. */
function headCommittedAtMs(): number {
    return (
        Number(git(["log", "-1", "--format=%ct", "HEAD"]).stdout.trim()) * 1000
    );
}

/** Since when the tip's Bot state has been late (ADR 0159) — never the
 *  tip's own commit, whose age resets at every landing: a late replay
 *  counts from the commit that moved the Bot hash off the header's; a late
 *  drift sweep from the first landing after the base's last derive commit
 *  (the sweep that would have played the misses). HEAD's time only when
 *  neither can be read. */
function lateSinceMs(kind: LateKind, headerBotHash: string): number {
    if (kind === "bot-hash") {
        const moved = botHashMove(headerBotHash).movedAtMs;
        if (moved !== null) return moved;
    }
    const lastDerive = git([
        "log",
        "-1",
        "--format=%H",
        `--grep=^${DERIVE_SYNC_COMMIT_SUBJECT.slice(0, 11)}`,
        "HEAD",
    ]).stdout.trim();
    const oldestSince =
        lastDerive === ""
            ? ""
            : (git(["log", "--reverse", "--format=%ct", `${lastDerive}..HEAD`])
                  .stdout.trim()
                  .split("\n")[0] ?? "");
    return /^\d+$/.test(oldestSince)
        ? Number(oldestSince) * 1000
        : headCommittedAtMs();
}

/** The open late issues closed with a comment once the Bot state is
 *  current again (ADR 0159): listed by label and title prefix, never
 *  searched (the search index lags). A `gh` failure is said, not fatal. */
function closeLateIssues(): void {
    for (const issue of openLateIssues()) {
        try {
            gh([
                "issue",
                "close",
                String(issue.number),
                "--comment",
                `\`derive:sync --settled\` on ${git(["rev-parse", "HEAD"]).stdout.trim().slice(0, 10)}: the Bot state is current again — closed by the predicate (ADR 0159).`,
            ]);
            say(`closed the late issue #${issue.number}`);
        } catch (error) {
            complain(
                `could not close issue #${issue.number}: ${String(error)}`
            );
        }
    }
}

/** Every open issue under the late label whose title carries the late
 *  prefix. Empty on a `gh` failure. */
function openLateIssues(): { number: number; title: string }[] {
    try {
        const rows = JSON.parse(
            gh([
                "issue",
                "list",
                "--state",
                "open",
                "--label",
                DERIVED_LATE_LABELS[1]!,
                "--limit",
                "100",
                "--json",
                "number,title",
            ])
        ) as { number: number; title: string }[];
        return rows.filter((r) =>
            r.title.startsWith(DERIVED_LATE_TITLE_PREFIX)
        );
    } catch (error) {
        complain(`could not list the open late issues: ${String(error)}`);
        return [];
    }
}

/** `--settled` (ADR 0159): fresh or stale as `--fresh` (exit 1 on stale),
 *  then the Bot state — current (exit 0), or LATE: the late line on stdout,
 *  exit 0, and past the grace the late issue filed once (`--no-file` keeps a
 *  by-hand run from filing). Exit 2 when no corpus can be had. */
function settled(noFile: boolean): number {
    const f = freshness();
    if (!f.fresh) {
        console.error(derivedStaleLine(f.why));
        return 1;
    }
    const c = currency();
    if (c === null) {
        complain("--settled gave no verdict: no corpus cache for the pin");
        return 2;
    }
    if (c.current) {
        say("this tree is derived-fresh and its Bot verdicts are current");
        if (!noFile) closeLateIssues();
        return 0;
    }
    const lock = readLockfile();
    const since = lateSinceMs(c.kind, lock.header.botHash);
    const lateMs = Date.now() - since;
    console.log(derivedLateLine(c.why, new Date(since).toISOString()));
    if (lateMs < DERIVED_GRACE_MS)
        say(
            `late by ${Math.round(lateMs / 60_000)} min, within the ${Math.round(DERIVED_GRACE_MS / 60_000)}-minute grace — not filed`
        );
    else if (noFile) say("past the grace — --no-file, not filed");
    else
        fileDerivedLate({
            sha: git(["rev-parse", "HEAD"]).stdout.trim(),
            kind: c.kind,
            why: c.why,
            sinceMs: since,
            headerBotHash: lock.header.botHash,
            treeBotHash: botHash(ROOT),
        });
    return 0;
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

/** Append to the job summary when there is one (`post-merge.yml`). */
function appendSummary(markdown: string): void {
    const path = process.env.GITHUB_STEP_SUMMARY;
    if (path === undefined || path === "") return;
    try {
        appendFileSync(path, `${markdown}\n`);
    } catch (error) {
        complain(`could not write the job summary: ${String(error)}`);
    }
}

/**
 * Step 1 (ADR 0158 § 2b, issue #6687): play the tip's misses, or carry when
 * there are none (`runDriftSweep`). The walls are the replay's
 * (`SWEEP_WALL_MS`: a re-pin's misses are the whole catalogue);
 * `housekeeping`'s `DERIVE_SYNC_TIMEOUT_MS` sits above them, so this run's
 * own SIGTERM reaches the compile first and the gate reaps the sweep.
 */
function driftSweep(head: string): DriftSweepResult {
    return runDriftSweep({
        head,
        readRows: () => readLockfile().cards,
        misses: () => {
            const ids = new Set(
                staleVerdicts(readLockfile(), readCorpus()).map(
                    (c) => c.oracleId
                )
            );
            if (ids.size > 0)
                say(
                    `${head.slice(0, 10)}: ${ids.size} \`ready\` row(s) carry no verdict for the definition the tip compiles — playing them`
                );
            return ids;
        },
        carry: () =>
            generate("oracle:compile --carry-bot", [
                "scripts/oracle-compile.ts",
                "--carry-bot",
            ]),
        // `--play-misses`: carries every current verdict, plays exactly the
        // misses — a bare run would carry the drift ones (issue #6688) —
        // keeps the header's Bot hash (the replay alone moves it).
        play: () =>
            generate(
                "oracle:compile --play-misses",
                ["scripts/oracle-compile.ts", "--play-misses"],
                SWEEP_WALL_MS,
                "SIGTERM"
            ),
        index: () =>
            generate(
                "oracle:index",
                ["scripts/oracle-index-backfill.ts"],
                INDEX_WALL_MS
            ),
        acknowledged: acknowledgedRegressions(),
        now: Date.now,
        report: ({ line, summary }) => {
            say(line);
            appendSummary(summary);
        },
        warn: complain,
    });
}

/** Regenerate on HEAD, commit what changed, push once. Exit code. */
function write(dryRun: boolean): number {
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    // Issue #6765 — the write path is the BASE's: it commits on HEAD and
    // pushes to the base, so on any other HEAD it would land that HEAD's own
    // commits too. Refused before the generators run; the dry run stays open
    // to a branch (it pushes nothing). The pusher's compare-and-swap is the
    // backstop for a base that moves after this check.
    if (!dryRun) {
        const tip = fetchedBaseTip();
        if (tip === null) return 1;
        if (
            tip !== head &&
            git(["merge-base", "--is-ancestor", head, tip]).status === 0
        ) {
            // The base moved past this tree since it was checked out: the
            // newer tip's own run derives (ADR 0157 coalescing), as a refused
            // push would have concluded after the whole regeneration.
            say(
                `${head.slice(0, 10)} is behind ${BASE_BRANCH} ${tip.slice(0, 10)} — coalesced: the newer tip's run derives (ADR 0157)`
            );
            return 0;
        }
        if (tip !== head) {
            complain(
                `refusing to write: HEAD ${head.slice(0, 10)} (${currentBranch()}) is not the ${BASE_BRANCH} tip ${tip.slice(0, 10)}. derive:sync commits on HEAD and pushes it to ${BASE_BRANCH}, so on a branch it would land the branch outside the queue (issue #6765). The base's post-merge run derives it; \`derive:sync --dry-run\` shows what is stale here.`
            );
            return 1;
        }
    }
    if (!ensureCorpus()) return 1;
    const swept = driftSweep(head);
    if (
        !swept.ok ||
        !generate("catalogue:pack", ["scripts/catalogue-artifact.ts"])
    )
        return 1;
    // The card index only when `oracle:index` ran — never a stray edit.
    const owned = swept.indexed ? DERIVE_SYNC_PATHS : DERIVED_PATHS;
    const found = entries(owned);
    if (found === null) return 1;
    const plan = derivePlan(found, owned);
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
 *  pushed — the mechanics ADR 0157 gave the derive commit, shared with the
 *  replay commit so there is one pusher; a transient refusal is retried
 *  with backoff (ADR 0159, issue #6990). The exit code, and the push's
 *  outcome (`error` when nothing was pushed) for a caller that retries a
 *  coalesced push, with its reason. */
function commitAndPush(
    head: string,
    paths: readonly string[],
    subject: string
): {
    code: number;
    outcome: "landed" | "coalesced" | "failed" | "off-base" | "error";
    why: string;
} {
    const files: { path: string; blob: string }[] = [];
    for (const path of paths) {
        const blob = git(["hash-object", "-w", join(ROOT, path)]);
        if (blob.status !== 0) {
            complain(`could not store ${path}: ${blob.stderr.trim()}`);
            return { code: 1, outcome: "error", why: blob.stderr.trim() };
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
        return { code: 1, outcome: "error", why: built.error };
    }
    const pushed = pushDerivedCommit((args, opts) => git(args, opts), {
        sha: built.sha,
        head,
        baseBranch: BASE_BRANCH,
        originBase: ORIGIN_BASE,
        netTimeoutMs: GIT_NET_TIMEOUT_MS,
        retry: {
            backoffMs: PUSH_RETRY_BACKOFF_MS,
            sleep: (ms) => Bun.sleepSync(ms),
            note: say,
        },
    });
    const { outcome, why } = pushed;
    switch (outcome) {
        case "landed":
            say(
                `${built.sha.slice(0, 10)} pushed to ${BASE_BRANCH} (${paths.length} file(s)${pushed.attempts > 1 ? `, ${pushed.attempts} attempts` : ""})`
            );
            return { code: 0, outcome, why };
        case "coalesced":
            say(
                `push refused (${why}) and ${BASE_BRANCH} moved to ${pushed.remoteTip.slice(0, 10)} meanwhile — not retried here: the newer tip's own run regenerates (ADR 0157)`
            );
            return { code: 0, outcome, why };
        case "failed":
            complain(
                `push refused (${why}) with ${BASE_BRANCH} still at ${head.slice(0, 10)} — the next housekeeping run retries`
            );
            return { code: 1, outcome, why };
        case "off-base":
            complain(
                `push refused: ${head.slice(0, 10)} is AHEAD of ${BASE_BRANCH} (${pushed.remoteTip.slice(0, 10)}) — a branch's HEAD, not the base tip; pushing would land the branch outside the queue (issue #6765). Nothing pushed.`
            );
            return { code: 1, outcome, why };
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

/** The open issue titled exactly `title` under `label` (the regression
 *  issue for THIS tree's Bot, the late issue), or null. Listed, never
 *  searched: the search index lags by minutes, and a filing from the
 *  replay beside one from a concurrent gate would file twice. A `gh`
 *  failure is a null too: filing twice is the smaller harm beside never
 *  sweeping again. */
function openIssueByTitle(title: string, label: string): number | null {
    try {
        const rows = JSON.parse(
            gh([
                "issue",
                "list",
                "--state",
                "open",
                "--label",
                label,
                "--limit",
                "100",
                "--json",
                "number,title",
            ])
        ) as { number: number; title: string }[];
        return rows.find((r) => r.title === title)?.number ?? null;
    } catch (error) {
        complain(`could not list the open issues: ${String(error)}`);
        return null;
    }
}

/** The commit range that moved the Bot hash off the header's — from the
 *  commit that wrote the header's hash to HEAD — the Bot-source commits in
 *  it, `%h %s` each, newest first, and the committer time of the OLDEST
 *  of them (when the state became late, ADR 0159; null without one). The
 *  hash is in HEAD's header, so the NEWEST commit changing its occurrence
 *  count is the one that wrote it (an older one is a revert-and-reland's
 *  first life). */
function botHashMove(headerBotHash: string): {
    range: string;
    commits: string[];
    movedAtMs: number | null;
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
    const rows =
        since === undefined
            ? []
            : git([
                  "log",
                  "--format=%h\t%ct\t%s",
                  `${since}..HEAD`,
                  "--",
                  ...botSourceFiles(ROOT),
              ])
                  .stdout.trim()
                  .split("\n")
                  .filter((l) => l !== "")
                  .map((l) => l.split("\t"));
    const commits = rows.map(([h, , subject]) => `${h} ${subject ?? ""}`);
    const oldest = rows.at(-1)?.[1];
    const movedAtMs =
        oldest === undefined || !/^\d+$/.test(oldest)
            ? null
            : Number(oldest) * 1000;
    return { range, commits, movedAtMs };
}

/** The latest `post-merge` runs, one line each (`gh run list`), for the
 *  late issue — the replay's and the drift sweep's jobs live there. Empty
 *  when `gh` cannot list them. */
function latestPostMergeRuns(): string[] {
    try {
        const rows = JSON.parse(
            gh([
                "run",
                "list",
                "--workflow",
                "post-merge.yml",
                "--limit",
                "5",
                "--json",
                "url,status,conclusion,createdAt,event",
            ])
        ) as {
            url: string;
            status: string;
            conclusion: string | null;
            createdAt: string;
            event: string;
        }[];
        return rows.map(
            (r) =>
                `${r.createdAt} ${r.event} ${r.conclusion ?? r.status}: ${r.url}`
        );
    } catch (error) {
        complain(`could not list the post-merge runs: ${String(error)}`);
        return [];
    }
}

/** File the late issue (ADR 0159, issue #6990) unless one stands open under
 *  its title; the number either way, null when `gh` refused. */
function fileDerivedLate(input: {
    sha: string;
    kind: LateKind;
    why: string;
    sinceMs: number;
    headerBotHash: string;
    treeBotHash: string;
    pushFailure?: string;
}): number | null {
    const title = derivedLateTitle(input.kind, input.treeBotHash);
    const open = openIssueByTitle(title, DERIVED_LATE_LABELS[1]!);
    if (open !== null) {
        say(`late past the grace — issue #${open} is open, not filed again`);
        return open;
    }
    const { range, commits } = botHashMove(input.headerBotHash);
    const body = renderDerivedLateIssue({
        sha: input.sha,
        kind: input.kind,
        why: input.why,
        sinceIso: new Date(input.sinceMs).toISOString(),
        lateMinutes: Math.round((Date.now() - input.sinceMs) / 60_000),
        headerBotHash: input.headerBotHash,
        treeBotHash: input.treeBotHash,
        range,
        commits,
        runs: latestPostMergeRuns(),
        ...(input.pushFailure === undefined
            ? {}
            : { pushFailure: input.pushFailure }),
    });
    const args = ["issue", "create", "--title", title, "--body", body];
    for (const label of DERIVED_LATE_LABELS) args.push("--label", label);
    try {
        const url = gh(args).trim();
        say(`late past the grace — filed ${url}`);
        const n = /\/(\d+)\s*$/.exec(url)?.[1];
        return n === undefined ? null : Number(n);
    } catch (error) {
        complain(`could not file the late issue: ${String(error)}`);
        return null;
    }
}

/** The swept lockfile a failed push would discard, kept under
 *  `$RUNNER_TEMP` for the job's artifact step (ADR 0159); the path, or null
 *  outside a job. */
function keepSweepArtifact(): string | null {
    const tmp = process.env.RUNNER_TEMP;
    if (!tmp) return null;
    const dir = join(tmp, "bot-replay");
    mkdirSync(dir, { recursive: true });
    const out = join(dir, "oracle-compiled.json");
    copyFileSync(join(ROOT, LOCKFILE_PATH), out);
    return out;
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

/** The checked-out branch name, or `detached`. */
function currentBranch(): string {
    const r = git(["symbolic-ref", "--short", "-q", "HEAD"]);
    return r.status === 0 ? r.stdout.trim() : "detached";
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
    const tip = git(["rev-parse", ORIGIN_BASE]);
    if (tip.status !== 0 || tip.stdout.trim() === "") {
        complain(`could not read ${ORIGIN_BASE}: ${tip.stderr.trim()}`);
        return null;
    }
    return tip.stdout.trim();
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
    // Read before the tree moves: a failed read leaves the sweep's files.
    const base = lockfileAt(head);
    if (base === null) return false;
    // The sweep's and the pack's writes: the detach needs a clean tree.
    if (git(["checkout", "-q", "--", "."]).status !== 0) {
        complain("could not restore the generated files before moving");
        return false;
    }
    if (!detachAt(newTip)) return false;
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
    // `--play-misses`: carries every overlaid verdict on its definition,
    // plays every miss the new tip brought (drift included, issue #6688),
    // keeps the swept Bot hash.
    return generate(
        "oracle:compile --play-misses",
        ["scripts/oracle-compile.ts", "--play-misses"],
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
            headerBotHash === treeBotHash
                ? null
                : openIssueByTitle(title, BOT_REGRESSION_LABELS[1]!),
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
            const tipBefore = lockfileAt(remoteTip);
            if (tipBefore === null) return 1;
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
        if (pushed.outcome === "failed") {
            // The sweep is not lost with the push (ADR 0159): its lockfile
            // is the run's artifact, and the lateness is an issue now — the
            // next run sweeps again, as health never waits on it.
            const kept = keepSweepArtifact();
            say(
                kept === null
                    ? "the swept lockfile stays on disk — not in a job, no artifact"
                    : `the swept lockfile is kept for the run's artifact: ${kept}`
            );
            fileDerivedLate({
                sha: head,
                kind: "bot-hash",
                why: `the replay swept ${head.slice(0, 10)} and its push failed`,
                sinceMs: lateSinceMs("bot-hash", headerBotHash),
                headerBotHash,
                treeBotHash,
                pushFailure: pushed.why,
            });
            return pushed.code;
        }
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
        console.error(derivedStaleLine(f.why));
        process.exit(1);
    }
    if (argv.includes("--settled"))
        process.exit(settled(argv.includes("--no-file")));
    if (argv.includes("--replay-bot")) {
        process.exit(replayBot(argv.includes("--dry-run")));
    }
    process.exit(write(argv.includes("--dry-run")));
}
