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
import { staleVerdicts } from "../check-oracle-lockfile";
import {
    buildLockfile as buildLockfileRaw,
    type BuildLockfileOptions,
} from "../oracle-compile";
import type { CorpusCard } from "../oracle-corpus";
import {
    DERIVED_GRACE_MS,
    derivePredicateAnswer,
    derivedTipVerdict,
} from "../lib/health-step";
import {
    carriedBotReach,
    playingBotReach,
    type BotPlayer,
} from "../lib/oracle-bot-reach";
import { serializeLockfile, type Lockfile } from "../lib/oracle-lockfile";
import { emptyRetirementLedger } from "../lib/oracle-retirements";
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
    DERIVE_SYNC_PATHS,
    LOCKFILE_PATH,
    botRegressionTitle,
    botReplayOutcome,
    botReplayPlan,
    derivePlan,
    derivedFreshness,
    derivedStaleLine,
    pushDerivedCommit,
    pushOutcome,
    renderBotRegressionIssue,
    runDriftSweep,
    verdictCurrency,
    type DriftSweepIo,
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

    it("a freeze acknowledged in data/oracle-state-regressions.json is not lost — check:oracle accepts the commit, so does the replay", () => {
        const before = [ready("b", "Bolt"), ready("s", "Stasis")];
        const after = [frozen("b", "Bolt"), frozen("s", "Stasis")];
        expect(
            botReplayOutcome(before, after, new Set(["b"])).lost.map(
                (c) => c.name
            )
        ).toEqual(["Stasis"]);
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

    it("the replay commit owns the derived paths plus the card index (the compiler's pool projection), under its own subject; the derive commit owns the same (issue #6687), a bare derivePlan still refuses the index", () => {
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
        expect([...DERIVE_SYNC_PATHS]).toEqual([...BOT_REPLAY_PATHS]);
        // `land` tells the two pushes apart by subject AND files.
        expect(BOT_REPLAY_COMMIT_SUBJECT).not.toBe(DERIVE_SYNC_COMMIT_SUBJECT);
        expect(BOT_REGRESSION_LABELS).toEqual(["bug", "area:game-bot"]);
    });
});

// ── The drift sweep on the base (ADR 0158 § 2b, issue #6687) ─────────────

// SYNTHETIC corpus only — never stamped against the committed retirement
// ledger (issue #4027, as in `oracle-bot-reach.test.ts`).
function buildLockfile(
    corpus: readonly CorpusCard[],
    options: BuildLockfileOptions = {}
): Lockfile {
    return buildLockfileRaw(corpus, {
        retirements: emptyRetirementLedger(),
        ...options,
    });
}

/** `staleVerdicts` on the synthetic corpus, same ledger rule. */
const staleOf = (lock: Lockfile, corpus: readonly CorpusCard[]) =>
    staleVerdicts(lock, corpus, { retirements: emptyRetirementLedger() });

const vanilla = (n: number, power = "2"): CorpusCard => ({
    oracleId: `00000000-0000-0000-0000-00000000d${String(n).padStart(3, "0")}`,
    name: `Drift Bear ${n}`,
    manaCost: "{1}{G}",
    typeLine: "Creature — Bear",
    oracleText: "",
    power,
    toughness: "2",
    layout: "normal",
    legalIn: ["premodern"],
    poolIn: ["premodern"],
});

const BOT = "sha256:bot-of-the-tip";

/** A player that records every card it is asked to play. */
function spyPlayer(): { calls: string[]; play: BotPlayer } {
    const calls: string[] = [];
    return {
        calls,
        play: (oracleId) => {
            calls.push(oracleId);
            return { outcome: "played" };
        },
    };
}

/**
 * The base after a merge: four cards played on the base before it; the merge
 * moved two definitions (power 2 → 3) and left a third `ready` row with no
 * verdict at all (a draft regenerated `--carry-bot`). The fourth is current.
 */
function mergedTip(): { lock: Lockfile; corpus: CorpusCard[] } {
    const before = [1, 2, 3, 4].map((n) => vanilla(n));
    const played = buildLockfile(before, {
        botReach: playingBotReach(null, BOT, spyPlayer().play),
    });
    const corpus = [vanilla(1, "3"), vanilla(2, "3"), vanilla(3), vanilla(4)];
    const unverdicted = vanilla(3).oracleId;
    return {
        lock: {
            ...played,
            cards: played.cards.map((row) =>
                row.oracleId === unverdicted
                    ? { ...row, botReach: undefined }
                    : row
            ),
        },
        corpus,
    };
}

/** The write path's step 1 over an in-memory lockfile: the generators are
 *  the compile driver's own sources, nothing spawned. */
function fixtureIo(
    tip: { lock: Lockfile; corpus: CorpusCard[] },
    player: { play: BotPlayer }
): {
    io: DriftSweepIo;
    disk: () => Lockfile;
    calls: { carry: number; play: number; index: number };
    reports: { line: string; summary: string }[];
    warnings: string[];
} {
    let disk = tip.lock;
    const calls = { carry: 0, play: 0, index: 0 };
    const reports: { line: string; summary: string }[] = [];
    const warnings: string[] = [];
    let clock = 0;
    const io: DriftSweepIo = {
        head: "abcdef0123456789",
        readRows: () => disk.cards,
        misses: () => new Set(staleOf(disk, tip.corpus).map((c) => c.oracleId)),
        carry: () => {
            calls.carry += 1;
            disk = buildLockfile(tip.corpus, {
                botReach: carriedBotReach(disk),
            });
            return true;
        },
        play: () => {
            calls.play += 1;
            disk = buildLockfile(tip.corpus, {
                botReach: playingBotReach(disk, BOT, player.play),
            });
            return true;
        },
        index: () => {
            calls.index += 1;
            return true;
        },
        acknowledged: new Set(),
        now: () => (clock += 1500),
        report: (r) => reports.push(r),
        warn: (line) => warnings.push(line),
    };
    return { io, disk: () => disk, calls, reports, warnings };
}

describe("the drift sweep — derive:sync plays the tip's Bot-verdict misses (ADR 0158 § 2b, issue #6687)", () => {
    it("staleVerdicts names every `ready` row with no verdict for the definition the tip compiles — a moved definition, a missing verdict — and nothing current", () => {
        const tip = mergedTip();
        expect(
            staleOf(tip.lock, tip.corpus)
                .map((c) => c.name)
                .sort()
        ).toEqual(["Drift Bear 1", "Drift Bear 2", "Drift Bear 3"]);
        // A tip a PR played whole is current — and tier 3 cannot tell the
        // two apart: the carried regeneration reproduces the stale bytes.
        const carried = buildLockfile(tip.corpus, {
            botReach: carriedBotReach(tip.lock),
        });
        expect(
            serializeLockfile(
                buildLockfile(tip.corpus, {
                    botReach: carriedBotReach(carried),
                })
            )
        ).toBe(serializeLockfile(carried));
        expect(staleOf(carried, tip.corpus)).toHaveLength(3);
    });

    it("on a tip with N misses it plays exactly those N, reports N played, and the rows it commits are current", () => {
        const tip = mergedTip();
        const player = spyPlayer();
        const run = fixtureIo(tip, player);
        expect(runDriftSweep(run.io)).toEqual({ ok: true, indexed: false });
        expect(run.calls).toEqual({ carry: 0, play: 1, index: 0 });
        expect(player.calls.sort()).toEqual(
            [1, 2, 3].map((n) => vanilla(n).oracleId).sort()
        );
        expect(staleOf(run.disk(), tip.corpus)).toEqual([]);
        // The header's Bot hash is the committed one: the replay alone moves it.
        expect(run.disk().header.botHash).toBe(tip.lock.header.botHash);
        expect(run.reports).toHaveLength(1);
        expect(run.reports[0]!.line).toContain(
            "drift sweep — 3 miss(es), 3 played, 2s"
        );
        expect(run.reports[0]!.summary).toContain("| 3 | 3 | 2s | 0 | 0 |");
        // The lockfile's rows changed: the derive commit carries it.
        expect(
            derivePlan([
                {
                    path: LOCKFILE_PATH,
                    committed: serializeLockfile(tip.lock),
                    regenerated: serializeLockfile(run.disk()),
                },
            ])
        ).toEqual({ kind: "commit", paths: [LOCKFILE_PATH] });
    });

    it("zero misses carries, as the write path always did — nothing played, reported as 0", () => {
        const tip = mergedTip();
        const current = buildLockfile(tip.corpus, {
            botReach: playingBotReach(tip.lock, BOT, spyPlayer().play),
        });
        const player = spyPlayer();
        const run = fixtureIo({ lock: current, corpus: tip.corpus }, player);
        expect(runDriftSweep(run.io)).toEqual({ ok: true, indexed: false });
        expect(run.calls).toEqual({ carry: 1, play: 0, index: 0 });
        expect(player.calls).toEqual([]);
        expect(run.reports.map((r) => r.line)).toEqual([
            "abcdef0123: drift sweep — 0 miss(es), 0 played, 0s",
        ]);
        expect(serializeLockfile(run.disk())).toBe(serializeLockfile(current));
    });

    it("a card the sweep freezes leaves `ready` and is reported; one it brings in is indexed", () => {
        const tip = mergedTip();
        const freezeOne: BotPlayer = (oracleId) =>
            oracleId === vanilla(1).oracleId
                ? { outcome: "frozen", cause: "never-chosen", form: "x" }
                : { outcome: "played" };
        const run = fixtureIo(tip, { play: freezeOne });
        expect(runDriftSweep(run.io)).toEqual({ ok: true, indexed: false });
        const row = run
            .disk()
            .cards.find((r) => r.oracleId === vanilla(1).oracleId)!;
        expect(row.state).not.toBe("ready");
        expect(run.reports[0]!.line).toContain("1 left `ready`: Drift Bear 1");
        expect(run.calls.index).toBe(0);

        // The frozen row's definition moves again: the next tip unfreezes it.
        const next = fixtureIo(
            {
                lock: run.disk(),
                corpus: [vanilla(1, "4"), ...tip.corpus.slice(1)],
            },
            spyPlayer()
        );
        expect(runDriftSweep(next.io)).toEqual({ ok: true, indexed: true });
        expect(next.calls.index).toBe(1);
        expect(next.reports[0]!.line).toContain("1 newly `ready`");
    });

    it("a failed play or index falls back to the carry: the header and catalogue still land, the misses stay stale", () => {
        const tip = mergedTip();
        const failing = fixtureIo(tip, spyPlayer());
        expect(runDriftSweep({ ...failing.io, play: () => false })).toEqual({
            ok: true,
            indexed: false,
        });
        expect(failing.calls.carry).toBe(1);
        expect(failing.warnings[0]).toContain("compile failed");
        expect(staleOf(failing.disk(), tip.corpus)).toHaveLength(3);

        const frozen = fixtureIo(tip, {
            play: (oracleId) =>
                oracleId === vanilla(1).oracleId
                    ? { outcome: "frozen", cause: "never-chosen", form: "x" }
                    : { outcome: "played" },
        });
        runDriftSweep(frozen.io);
        const unfreezing = fixtureIo(
            {
                lock: frozen.disk(),
                corpus: [vanilla(1, "4"), ...tip.corpus.slice(1)],
            },
            spyPlayer()
        );
        expect(runDriftSweep({ ...unfreezing.io, index: () => false })).toEqual(
            { ok: true, indexed: false }
        );
        expect(unfreezing.calls).toEqual({ carry: 1, play: 1, index: 0 });
        expect(unfreezing.warnings[0]).toContain("oracle:index");

        // Not even the carry wrote: the run's failure.
        expect(
            runDriftSweep({
                ...fixtureIo(tip, spyPlayer()).io,
                play: () => false,
                carry: () => false,
            }).ok
        ).toBe(false);
    });

    it("`lost` is the misses' only — a card a compiler change took out of `ready` is not the sweep's", () => {
        const tip = mergedTip();
        const run = fixtureIo(tip, spyPlayer());
        // A current row that leaves `ready` with the play: not a miss.
        const current = vanilla(4).oracleId;
        let rows = 0;
        const io: DriftSweepIo = {
            ...run.io,
            readRows: () =>
                rows++ === 0
                    ? run.disk().cards
                    : run
                          .disk()
                          .cards.map((r) =>
                              r.oracleId === current
                                  ? { ...r, state: "quarantine" as const }
                                  : r
                          ),
        };
        runDriftSweep(io);
        expect(run.reports[0]!.line).not.toContain("left `ready`");
    });
});

describe("--settled — health waits on stale Bot verdicts within the grace, reds past it (ADR 0158 § 2b, issue #6687)", () => {
    const t0 = 1_700_000_000_000;
    /** `--settled`'s answer on a tree as health reads it: the printed line
     *  through `derivePredicateAnswer`, then the grace. */
    const judged = (verdict: ReturnType<typeof verdictCurrency>, age: number) =>
        derivedTipVerdict({
            stale: (() => {
                const a = derivePredicateAnswer(
                    verdict.fresh
                        ? { status: 0, signal: null, output: "" }
                        : {
                              status: 1,
                              signal: null,
                              output: derivedStaleLine(verdict.why),
                          }
                );
                if (a.kind === "broken") throw new Error(a.why);
                return a.kind === "stale" ? a.why : null;
            })(),
            committedAtMs: t0,
            nowMs: t0 + age,
        });

    it("a tip with stale rows is pending within the grace and RED with cause derive:sync past it", () => {
        const tip = mergedTip();
        const verdict = verdictCurrency({
            stale: staleOf(tip.lock, tip.corpus).map((c) => c.name),
            headerBotHash: BOT,
            treeBotHash: BOT,
            openRegression: null,
        });
        expect(verdict.fresh).toBe(false);
        const pending = judged(verdict, 5 * 60_000);
        expect(pending.kind).toBe("pending");
        if (pending.kind !== "pending") return;
        expect(pending.reason).toContain("3 `ready` row(s)");
        expect(pending.reason).toContain("Drift Bear 1");
        const red = judged(verdict, DERIVED_GRACE_MS);
        expect(red.kind).toBe("red");
        if (red.kind !== "red") return;
        expect(red.reason).toContain("derive:sync");
    });

    it("a header Bot hash that is not the tree's is stale — unless this Bot's regression issue is open", () => {
        const moved = {
            stale: [],
            headerBotHash: "sha256:old-bot",
            treeBotHash: BOT,
        };
        const stale = verdictCurrency({ ...moved, openRegression: null });
        expect(stale.fresh).toBe(false);
        if (stale.fresh) return;
        expect(stale.why).toContain("--replay-bot");
        expect(judged(stale, 5 * 60_000).kind).toBe("pending");
        expect(verdictCurrency({ ...moved, openRegression: 4242 })).toEqual({
            fresh: true,
        });
    });

    it("current rows under the tree's Bot are settled — gated as ever", () => {
        expect(
            verdictCurrency({
                stale: [],
                headerBotHash: BOT,
                treeBotHash: BOT,
                openRegression: null,
            })
        ).toEqual({ fresh: true });
        const many = verdictCurrency({
            stale: Array.from({ length: 8 }, (_, i) => `Card ${i}`),
            headerBotHash: BOT,
            treeBotHash: BOT,
            openRegression: null,
        });
        expect(many.fresh).toBe(false);
        if (many.fresh) return;
        expect(many.why).toContain("Card 4, … 3 more");
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
