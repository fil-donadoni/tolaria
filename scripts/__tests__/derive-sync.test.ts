/**
 * `derive:sync` — the base writes its derived whole-file state (ADR 0157
 * § Option 1b, issue #6247): the decisions of `lib/derive-sync.ts`, the
 * scratch-index commit of `lib/commit-tree.ts` against a real repository,
 * and the pins that keep the leaf's literals equal to their owners'.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCKFILE_PATH as CHECK_GAPS_LOCKFILE_PATH } from "../check-gaps";
import { BASE_BRANCH } from "../lib/branches";
import { CATALOGUE_DIR, SOURCE_HASH_FILE } from "../lib/catalogue-merge";
import { commitOnScratchIndex } from "../lib/commit-tree";
import { DEFINITION_INDEX_PATH } from "../lib/definition-index";
import {
    BOT_REGRESSION_LABELS,
    BOT_REPLAY_COMMIT_SUBJECT,
    BOT_REPLAY_PATHS,
    CARD_INDEX_PATH,
    DERIVED_PATHS,
    DERIVE_SYNC_COMMIT_SUBJECT,
    LOCKFILE_PATH,
    botRegressionTitle,
    botReplayOutcome,
    botReplayPlan,
    derivePlan,
    derivedFreshness,
    pushDerivedCommit,
    pushOutcome,
    renderBotRegressionIssue,
    type GitRun,
    type ReplayRow,
} from "../lib/derive-sync";
import { POOL_PROJECTION_SOURCE } from "../lib/oracle-lockfile";
import { PACKED_CORPUS_PATH } from "../lib/packed-corpus";
import { SEARCH_INDEX_PATH } from "../lib/search-index";

describe("derive:sync --replay-bot — the one Bot-play replay per Bot change (issue #6463)", () => {
    it("header == tree: current — nothing to sweep, nothing to push", () => {
        expect(
            botReplayPlan({
                headerBotHash: "sha256:a",
                treeBotHash: "sha256:a",
                openRegression: 7,
            })
        ).toEqual({ kind: "current" });
    });

    it("header != tree: a sweep — unless this Bot's regression issue is already open", () => {
        expect(
            botReplayPlan({
                headerBotHash: "sha256:a",
                treeBotHash: "sha256:b",
                openRegression: null,
            })
        ).toEqual({ kind: "sweep" });
        expect(
            botReplayPlan({
                headerBotHash: "sha256:a",
                treeBotHash: "sha256:b",
                openRegression: 6464,
            })
        ).toEqual({ kind: "filed", issue: 6464 });
    });

    // The fixture the issue asks for: a Bot change that FREEZES a card.
    const ready = (
        id: string,
        name: string,
        botReach = "played"
    ): ReplayRow => ({
        oracleId: id,
        name,
        state: "ready",
        botReach,
    });
    const frozen = (id: string, name: string): ReplayRow => ({
        oracleId: id,
        name,
        state: "quarantine",
        botReach: "frozen",
        botGap: "no-legal-move › Instant target:any",
    });

    it("a card the replay froze is `lost`, with the verdict that did it — and nothing is committed for it", () => {
        const before = [ready("b", "Bolt"), ready("s", "Stasis", "ignored")];
        const after = [frozen("b", "Bolt"), ready("s", "Stasis")];
        expect(botReplayOutcome(before, after)).toEqual({
            lost: [
                {
                    oracleId: "b",
                    name: "Bolt",
                    to: "quarantine",
                    verdict: "frozen — no-legal-move › Instant target:any",
                },
            ],
            gained: [],
        });
    });

    it("a card the replay unfroze is `gained` (it owes a card-index row); a verdict change inside `ready` is neither", () => {
        const before = [frozen("b", "Bolt"), ready("s", "Stasis", "ignored")];
        const after = [ready("b", "Bolt"), ready("s", "Stasis")];
        expect(botReplayOutcome(before, after)).toEqual({
            lost: [],
            gained: ["Bolt"],
        });
    });

    it("a `ready` row that vanished is lost too — a re-pin dropping rows is not 'no change'", () => {
        expect(botReplayOutcome([ready("b", "Bolt")], []).lost).toEqual([
            {
                oracleId: "b",
                name: "Bolt",
                to: "absent",
                verdict: "(row gone)",
            },
        ]);
    });

    it("the regression issue: one title per Bot hash, the cards with their verdicts, the range, the filing stamp", () => {
        const title = botRegressionTitle("sha256:0123456789abcdef0123");
        expect(title).toContain("0123456789ab");
        expect(title).not.toContain("sha256:");
        const body = renderBotRegressionIssue({
            sha: "e50c18c83abcdef",
            headerBotHash: "sha256:22a30b",
            treeBotHash: "sha256:271c7a",
            range: "a315a384d..HEAD",
            commits: ["bea399bb4 Bot: value sacrifice (#6447)"],
            lost: botReplayOutcome([ready("b", "Bolt")], [frozen("b", "Bolt")])
                .lost,
        });
        expect(body).toContain(
            "**Bolt** (`b`) → `quarantine`: frozen — no-legal-move"
        );
        expect(body).toContain("`a315a384d..HEAD`");
        expect(body).toContain("bea399bb4 Bot: value sacrifice (#6447)");
        expect(body).toContain("`sha256:22a30b`");
        expect(body).toContain("`sha256:271c7a`");
        expect(body).toMatch(/\n## Band\n\nP1 — /);
        expect(body).toContain("Nothing was committed");
    });

    it("the replay commit owns the derived paths plus the card index (the compiler's pool projection), under its own subject; derive:sync still refuses the index", () => {
        // The card index the replay may carry is the one `oracle:index`
        // writes and the compiler's `poolHash` reads.
        const entry = {
            path: POOL_PROJECTION_SOURCE,
            committed: "a",
            regenerated: "b",
        };
        expect(derivePlan([entry], BOT_REPLAY_PATHS)).toEqual({
            kind: "commit",
            paths: [CARD_INDEX_PATH],
        });
        expect(
            derivePlan(
                DERIVED_PATHS.map((path) => ({
                    path,
                    committed: "a",
                    regenerated: "b",
                })),
                BOT_REPLAY_PATHS
            )
        ).toEqual({ kind: "commit", paths: DERIVED_PATHS });
        expect(() => derivePlan([entry])).toThrow(
            /owns .* — not data\/card-index\.json/
        );
        // `land` tells the two pushes apart by subject AND files.
        expect(BOT_REPLAY_COMMIT_SUBJECT).not.toBe(DERIVE_SYNC_COMMIT_SUBJECT);
        expect(BOT_REGRESSION_LABELS).toEqual(["bug", "area:game-bot"]);
    });
});

describe("derive-sync.ts — the five derived paths are their owners' (ADR 0157)", () => {
    it("pins the leaf's literals to the constants the generators write", () => {
        expect(LOCKFILE_PATH).toBe(CHECK_GAPS_LOCKFILE_PATH);
        expect([...DERIVED_PATHS]).toEqual([
            LOCKFILE_PATH,
            join(CATALOGUE_DIR, SOURCE_HASH_FILE),
            PACKED_CORPUS_PATH,
            DEFINITION_INDEX_PATH,
            SEARCH_INDEX_PATH,
        ]);
    });
});

describe("derivePlan — tip state → commit / no-op", () => {
    const same = (path: string) => ({
        path,
        committed: `blob-${path}`,
        regenerated: `blob-${path}`,
    });

    it("is a no-op when every regenerated blob equals the tip's", () => {
        expect(derivePlan(DERIVED_PATHS.map(same))).toEqual({ kind: "no-op" });
        expect(derivePlan([])).toEqual({ kind: "no-op" });
    });

    it("commits exactly the paths that differ — a missing path included, an unchanged one never", () => {
        const entries = DERIVED_PATHS.map(same).map((e, i) =>
            i === 0
                ? { ...e, regenerated: "new-header" }
                : i === 2
                  ? { ...e, committed: null }
                  : e
        );
        expect(derivePlan(entries)).toEqual({
            kind: "commit",
            paths: [DERIVED_PATHS[0], DERIVED_PATHS[2]],
        });
    });

    it("refuses a path the writer does not own", () => {
        expect(() =>
            derivePlan([
                {
                    path: "data/card-index.json",
                    committed: "a",
                    regenerated: "b",
                },
            ])
        ).toThrow(/owns/);
    });
});

describe("pushOutcome — coalescing (ADR 0157 § Option 1b)", () => {
    it("landed when pushed; coalesced when refused and the base moved; failed when refused and the base stood", () => {
        expect(pushOutcome({ pushed: true, remoteMoved: false })).toBe(
            "landed"
        );
        expect(pushOutcome({ pushed: true, remoteMoved: true })).toBe("landed");
        expect(pushOutcome({ pushed: false, remoteMoved: true })).toBe(
            "coalesced"
        );
        expect(pushOutcome({ pushed: false, remoteMoved: false })).toBe(
            "failed"
        );
    });
});

describe("derivedFreshness — sync's derived-fresh predicate", () => {
    const catalogue = [
        { path: PACKED_CORPUS_PATH, committed: "packed", expected: "packed" },
        { path: SEARCH_INDEX_PATH, committed: "search", expected: "search" },
    ];

    it("a fresh fixture: no header drift, every catalogue file what the tree generates", () => {
        expect(derivedFreshness({ hashDrift: null, catalogue })).toEqual({
            fresh: true,
        });
    });

    it("a stale fixture: header drift is stale, naming the drift's first line", () => {
        const f = derivedFreshness({
            hashDrift:
                "compilerHash drift — the compiler source changed\n    header: a\n    tree: b",
            catalogue,
        });
        expect(f.fresh).toBe(false);
        expect(f).toMatchObject({
            why: "lockfile header: compilerHash drift — the compiler source changed",
        });
    });

    it("a stale fixture: a catalogue file that is not what the tree generates, or is missing", () => {
        expect(
            derivedFreshness({
                hashDrift: null,
                catalogue: [
                    ...catalogue,
                    {
                        path: DEFINITION_INDEX_PATH,
                        committed: "old",
                        expected: "new",
                    },
                ],
            })
        ).toEqual({
            fresh: false,
            why: `${DEFINITION_INDEX_PATH} is not what the tree generates`,
        });
        expect(
            derivedFreshness({
                hashDrift: null,
                catalogue: [
                    { path: SEARCH_INDEX_PATH, committed: null, expected: "s" },
                ],
            })
        ).toEqual({ fresh: false, why: `${SEARCH_INDEX_PATH} is missing` });
    });
});

describe("commitOnScratchIndex — a commit the checkout never sees (real git)", () => {
    let repo: string;
    const run = (args: string[], opts: { env?: NodeJS.ProcessEnv } = {}) => {
        const r = spawnSync("git", args, {
            cwd: repo,
            encoding: "utf8",
            env: opts.env,
        });
        return {
            status: r.status,
            stdout: r.stdout ?? "",
            stderr: r.stderr ?? "",
        };
    };
    const git = (...args: string[]): string => {
        const r = run(args);
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout.trim();
    };

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "commit-tree-"));
        git("init", "-q", "-b", "main");
        git("config", "user.email", "t@example.com");
        git("config", "user.name", "t");
        git("config", "commit.gpgsign", "false");
        mkdirSync(join(repo, "data", "catalogue"), { recursive: true });
        writeFileSync(join(repo, "keep.txt"), "keep\n");
        writeFileSync(join(repo, DERIVED_PATHS[0]!), "old lockfile\n");
        writeFileSync(join(repo, DERIVED_PATHS[1]!), "old hash\n");
        git("add", ".");
        git("commit", "-q", "-m", "seed");
    });
    afterEach(() =>
        rmSync(repo, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("records the given blobs over the base tree, parented on it, and leaves the checkout's index and tree untouched", () => {
        const head = git("rev-parse", "HEAD");
        const write = (text: string): string => {
            const r = spawnSync("git", ["hash-object", "-w", "--stdin"], {
                cwd: repo,
                encoding: "utf8",
                input: text,
            });
            return r.stdout.trim();
        };
        const built = commitOnScratchIndex(
            run,
            head,
            [
                { path: DERIVED_PATHS[0]!, blob: write("new lockfile\n") },
                { path: DERIVED_PATHS[2]!, blob: write("new packed\n") },
            ],
            DERIVE_SYNC_COMMIT_SUBJECT
        );
        expect("sha" in built).toBe(true);
        const sha = (built as { sha: string }).sha;
        expect(git("log", "-1", "--format=%P", sha)).toBe(head);
        expect(git("log", "-1", "--format=%s", sha)).toBe(
            DERIVE_SYNC_COMMIT_SUBJECT
        );
        expect(
            git("diff-tree", "--no-commit-id", "--name-only", "-r", sha)
                .split("\n")
                .sort()
        ).toEqual([DERIVED_PATHS[0], DERIVED_PATHS[2]].sort());
        expect(git("show", `${sha}:${DERIVED_PATHS[0]}`)).toBe("new lockfile");
        expect(git("show", `${sha}:${DERIVED_PATHS[1]}`)).toBe("old hash");
        expect(git("show", `${sha}:keep.txt`)).toBe("keep");
        // The checkout: HEAD, index and tree exactly as before.
        expect(git("rev-parse", "HEAD")).toBe(head);
        expect(git("status", "--porcelain")).toBe("");
    });

    it("reports the failing git step instead of a sha", () => {
        const built = commitOnScratchIndex(
            run,
            "not-a-commit",
            [{ path: "x", blob: "0".repeat(40) }],
            "s"
        );
        expect("error" in built).toBe(true);
        expect((built as { error: string }).error).toMatch(/not-a-commit/);
    });
});

describe("pushDerivedCommit — landed / coalesced / failed against a bare remote (real git)", () => {
    let dir: string;
    const sh = (cwd: string, args: string[], input?: string): string => {
        const r = spawnSync("git", args, { cwd, encoding: "utf8", input });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout.trim();
    };
    const runner =
        (cwd: string): GitRun =>
        (args, opts) => {
            const r = spawnSync("git", args, {
                cwd,
                encoding: "utf8",
                timeout: opts?.timeout,
            });
            return {
                status: r.status,
                stdout: r.stdout ?? "",
                stderr: r.stderr ?? "",
                timedOut:
                    r.error !== undefined &&
                    (r.error as { code?: string }).code === "ETIMEDOUT",
            };
        };
    /** A commit on `parent` in `cwd` with `file` = `text`, not checked out. */
    const commitOn = (
        cwd: string,
        parent: string,
        file: string,
        text: string
    ): string => {
        const blob = sh(cwd, ["hash-object", "-w", "--stdin"], text);
        const built = commitOnScratchIndex(
            (args, opts) => runner(cwd)(args, opts) as never,
            parent,
            [{ path: file, blob }],
            `change ${file}`
        );
        if ("error" in built) throw new Error(built.error);
        return built.sha;
    };
    const input = (sha: string, head: string) => ({
        sha,
        head,
        baseBranch: BASE_BRANCH,
        originBase: `origin/${BASE_BRANCH}`,
        netTimeoutMs: 10_000,
    });
    let clone: string;
    let bare: string;
    let head: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "derive-push-"));
        bare = join(dir, "origin.git");
        clone = join(dir, "clone");
        mkdirSync(bare);
        sh(bare, ["init", "-q", "--bare", "-b", BASE_BRANCH]);
        sh(dir, ["clone", "-q", bare, clone]);
        sh(clone, ["config", "user.email", "t@example.com"]);
        sh(clone, ["config", "user.name", "t"]);
        sh(clone, ["config", "commit.gpgsign", "false"]);
        sh(clone, ["checkout", "-q", "-B", BASE_BRANCH]);
        writeFileSync(join(clone, "a.txt"), "a\n");
        sh(clone, ["add", "a.txt"]);
        sh(clone, ["commit", "-q", "-m", "seed"]);
        sh(clone, ["push", "-q", "origin", `HEAD:refs/heads/${BASE_BRANCH}`]);
        head = sh(clone, ["rev-parse", "HEAD"]);
    });
    afterEach(() =>
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("landed: the base tip is the derive commit", () => {
        const sha = commitOn(clone, head, "d.txt", "derived\n");
        const r = pushDerivedCommit(runner(clone), input(sha, head));
        expect(r.outcome).toBe("landed");
        expect(sh(bare, ["rev-parse", BASE_BRANCH])).toBe(sha);
    });

    it("coalesced: the base moved between build and push — refused, dropped, the moved tip named", () => {
        const sha = commitOn(clone, head, "d.txt", "derived\n");
        // Somebody else lands on the base first.
        const theirs = commitOn(clone, head, "b.txt", "theirs\n");
        sh(clone, [
            "push",
            "-q",
            "origin",
            `${theirs}:refs/heads/${BASE_BRANCH}`,
        ]);
        const r = pushDerivedCommit(runner(clone), input(sha, head));
        expect(r.outcome).toBe("coalesced");
        expect(r.remoteTip).toBe(theirs);
        expect(r.why).toMatch(/rejected/);
        expect(sh(bare, ["rev-parse", BASE_BRANCH])).toBe(theirs);
    });

    it("landed, not coalesced, when the refusal is the client's and the remote tip IS our commit", () => {
        const sha = commitOn(clone, head, "d.txt", "derived\n");
        // The push landed (a timed-out client), then the runner reports it refused.
        sh(clone, ["push", "-q", "origin", `${sha}:refs/heads/${BASE_BRANCH}`]);
        const real = runner(clone);
        const lying: GitRun = (args, opts) =>
            args[0] === "push"
                ? { status: 1, stdout: "", stderr: "", timedOut: true }
                : real(args, opts);
        const r = pushDerivedCommit(lying, input(sha, head));
        expect(r.outcome).toBe("landed");
        expect(r.why).toMatch(/no answer within 10s/);
    });

    it("failed: refused with the base unmoved", () => {
        const sha = commitOn(clone, head, "d.txt", "derived\n");
        const real = runner(clone);
        const refusing: GitRun = (args, opts) =>
            args[0] === "push"
                ? { status: 1, stdout: "", stderr: "fatal: unable to access\n" }
                : real(args, opts);
        const r = pushDerivedCommit(refusing, input(sha, head));
        expect(r.outcome).toBe("failed");
        expect(r.why).toBe("fatal: unable to access");
        expect(sh(bare, ["rev-parse", BASE_BRANCH])).toBe(head);
    });
});
