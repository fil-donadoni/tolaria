/**
 * `derive:sync` — the base writes its derived whole-file state (ADR 0157
 * § Option 1b, issue #6247): the decisions of `lib/derive-sync.ts`, the
 * scratch-index commit of `lib/commit-tree.ts` against a real repository,
 * and the pins that keep the leaf's literals equal to their owners'.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
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
    carriedOrPlayed,
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
    pushOutcome,
    renderBotRegressionIssue,
    renderDerivedLateIssue,
    runDriftSweep,
    transientPushFailure,
    verdictCurrency,
    type Currency,
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

    // Issue #6688's contract with this sweep: a session's bare compile pairs
    // the NEW definition with the OLD verdict on every drift row. Marked
    // `botStale`, the row is a miss whatever its definition — else it would
    // read as a cache hit here and never be replayed.
    it("a drift row a session carried (botStale) is stale though its definition is the tip's, and the sweep replays it current", () => {
        const before = [1, 2].map((n) => vanilla(n));
        const played = buildLockfile(before, {
            botReach: playingBotReach(null, BOT, spyPlayer().play),
        });
        const corpus = [vanilla(1, "3"), vanilla(2)];
        const session = spyPlayer();
        const merged = buildLockfile(corpus, {
            botReach: carriedOrPlayed(played, BOT, session.play),
        });
        expect(session.calls).toEqual([]);
        const bear1 = merged.cards.find((c) => c.name === "Drift Bear 1")!;
        expect(bear1).toMatchObject({ botReach: "played", botStale: true });
        expect(staleOf(merged, corpus).map((c) => c.name)).toEqual([
            "Drift Bear 1",
        ]);
        const player = spyPlayer();
        const run = fixtureIo({ lock: merged, corpus }, player);
        runDriftSweep(run.io);
        expect(player.calls).toEqual([bear1.oracleId]);
        expect(staleOf(run.disk(), corpus)).toEqual([]);
        expect(run.disk().cards.some((c) => c.botStale === true)).toBe(false);
    });

    it("the write path plays the misses through --play-misses, never a bare compile (which would carry them)", () => {
        const script = readFileSync(
            join(import.meta.dirname, "..", "derive-sync.ts"),
            "utf8"
        );
        expect(
            script.match(/"scripts\/oracle-compile\.ts", "--play-misses"\]/g)
        ).toHaveLength(2);
        expect(script).not.toMatch(/\["scripts\/oracle-compile\.ts"\]/);
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

describe("--settled — a late Bot state is reported on a GREEN verdict, never pending nor RED (ADR 0159, issue #6990)", () => {
    const t0 = 1_700_000_000_000;
    const SINCE = new Date(t0).toISOString();
    /** `--settled`'s answer on a tree as health reads it: the printed lines
     *  through `derivePredicateAnswer`, then `derivedTipVerdict` at `age`. */
    const judged = (verdict: Currency, age: number) => {
        const a = derivePredicateAnswer({
            status: 0,
            signal: null,
            output: verdict.current
                ? "derive:sync: this tree is derived-fresh and its Bot verdicts are current\n"
                : `${derivedLateLine(verdict.why, SINCE)}\nderive:sync: late by 5 min, within the 60-minute grace — not filed\n`,
        });
        if (a.kind !== "fresh") throw new Error(a.kind);
        return derivedTipVerdict({
            stale: null,
            late: a.late ?? null,
            committedAtMs: t0,
            nowMs: t0 + age,
        });
    };
    const AGES = [5 * 60_000, DERIVED_GRACE_MS, 24 * 3_600_000];

    it("stale rows are the drift sweep's lateness: fresh at ANY age, the line on the record — no pending, no RED (today: RED past the grace)", () => {
        const tip = mergedTip();
        const verdict = verdictCurrency({
            stale: staleOf(tip.lock, tip.corpus).map((c) => c.name),
            headerBotHash: BOT,
            treeBotHash: BOT,
            openRegression: null,
        });
        expect(verdict.current).toBe(false);
        if (verdict.current) return;
        expect(verdict.kind).toBe("drift");
        expect(verdict.why).toContain("3 `ready` row(s)");
        expect(verdict.why).toContain("Drift Bear 1");
        for (const age of AGES) {
            const v = judged(verdict, age);
            expect(v.kind).toBe("fresh");
            if (v.kind !== "fresh") return;
            expect(v.late).toBe(`stale since ${SINCE}: ${verdict.why}`);
        }
    });

    it("a header Bot hash that is not the tree's is the replay's lateness — fresh at any age; current when this Bot's regression issue is open", () => {
        const moved = {
            stale: [],
            headerBotHash: "sha256:old-bot",
            treeBotHash: BOT,
        };
        const late = verdictCurrency({ ...moved, openRegression: null });
        expect(late.current).toBe(false);
        if (late.current) return;
        expect(late.kind).toBe("bot-hash");
        expect(late.why).toContain("--replay-bot");
        for (const age of AGES) {
            const v = judged(late, age);
            expect(v.kind).toBe("fresh");
            if (v.kind !== "fresh") return;
            expect(v.late).toContain("stale since");
            expect(v.late).toContain("--replay-bot");
        }
        expect(verdictCurrency({ ...moved, openRegression: 4242 })).toEqual({
            current: true,
        });
    });

    it("current rows under the tree's Bot are current — a plain fresh verdict, no line", () => {
        const current = verdictCurrency({
            stale: [],
            headerBotHash: BOT,
            treeBotHash: BOT,
            openRegression: null,
        });
        expect(current).toEqual({ current: true });
        expect(judged(current, DERIVED_GRACE_MS)).toEqual({ kind: "fresh" });
        const many = verdictCurrency({
            stale: Array.from({ length: 8 }, (_, i) => `Card ${i}`),
            headerBotHash: BOT,
            treeBotHash: BOT,
            openRegression: null,
        });
        expect(many.current).toBe(false);
        if (many.current) return;
        expect(many.why).toContain("Card 4, … 3 more");
    });

    it("a derived-STALE tree — the header's compiler hash, the catalogue bytes — is still pending within the grace and RED past it: the tree disagrees with itself", () => {
        const stale = derivedStaleLine(
            "data/catalogue/source-hash.json is not what the tree generates"
        );
        const a = derivePredicateAnswer({
            status: 1,
            signal: null,
            output: stale,
        });
        expect(a.kind).toBe("stale");
        if (a.kind !== "stale") return;
        expect(
            derivedTipVerdict({
                stale: a.why,
                committedAtMs: t0,
                nowMs: t0 + 5 * 60_000,
            }).kind
        ).toBe("pending");
        const red = derivedTipVerdict({
            stale: a.why,
            committedAtMs: t0,
            nowMs: t0 + DERIVED_GRACE_MS,
        });
        expect(red.kind).toBe("red");
        if (red.kind !== "red") return;
        expect(red.reason).toContain("source-hash.json");
    });

    it("the late issue: one title per Bot hash for the replay (idempotent across runs), one standing title for the drift sweep; the body names the range, the runs, a push failure, the stamp", () => {
        expect(derivedLateTitle("bot-hash", BOT)).toBe(
            derivedLateTitle("bot-hash", BOT)
        );
        expect(derivedLateTitle("bot-hash", BOT)).toContain("Bot bot-of-the-t");
        expect(derivedLateTitle("bot-hash", "sha256:other")).not.toBe(
            derivedLateTitle("bot-hash", BOT)
        );
        expect(derivedLateTitle("drift", BOT)).toBe(
            derivedLateTitle("drift", "sha256:other")
        );
        // Not `bug`: `bug` + `area:workflow` is board P0 by rule (issue #6902).
        expect(DERIVED_LATE_LABELS).toEqual(["enhancement", "area:workflow"]);
        expect(
            derivedLateTitle("drift", BOT).startsWith(DERIVED_LATE_TITLE_PREFIX)
        ).toBe(true);
        expect(
            derivedLateTitle("bot-hash", BOT).startsWith(
                DERIVED_LATE_TITLE_PREFIX
            )
        ).toBe(true);
        const body = renderDerivedLateIssue({
            sha: "abcdef0123456789",
            kind: "bot-hash",
            why: "the lockfile header's Bot hash sha256:old-bot is not the tree's",
            sinceIso: SINCE,
            lateMinutes: 183,
            headerBotHash: "sha256:old-bot",
            treeBotHash: BOT,
            range: "1111111111..HEAD",
            commits: ["2222222 search: deeper horizon"],
            runs: ["2026-10-25T11:30:00Z push failure: https://x/runs/1"],
            pushFailure: "no answer within 120s (4 attempts)",
        });
        expect(body).toContain("## Agent Brief");
        expect(body).toContain("late by 183 min (stale since " + SINCE);
        expect(body).toContain("`bot-replay`");
        expect(body).toContain("`1111111111..HEAD`");
        expect(body).toContain("- 2222222 search: deeper horizon");
        expect(body).toContain("https://x/runs/1");
        expect(body).toContain("no answer within 120s (4 attempts)");
        expect(body).toContain("bot-replay-lockfile");
        expect(body).toContain("## Band");
        expect(body).toContain("nothing is blocked");
        const drift = renderDerivedLateIssue({
            sha: "abcdef0123456789",
            kind: "drift",
            why: "3 `ready` row(s) carry no Bot verdict",
            sinceIso: SINCE,
            lateMinutes: 61,
            headerBotHash: BOT,
            treeBotHash: BOT,
            range: "HEAD",
            commits: [],
            runs: [],
        });
        expect(drift).toContain("`housekeeping`'s drift sweep");
        expect(drift).toContain("no Bot-source commit found");
        expect(drift).toContain("could not list the runs");
        expect(drift).not.toContain("could not push");
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

    // Issue #7150 — on the Huawei, `origin/HEAD` named the base, so
    // `.husky/pre-push` ran the full gate on every derive push; it outlived
    // the 120 s deadline four times and `derive:sync` exited 1 after ~11 min.
    it("landed past a pre-push hook that refuses: the derive commit never runs the client's hooks", () => {
        const hooks = join(dir, "hooks");
        mkdirSync(hooks);
        writeFileSync(
            join(hooks, "pre-push"),
            "#!/bin/sh\necho 'pre-push: full gate' >&2\nexit 1\n"
        );
        chmodSync(join(hooks, "pre-push"), 0o755);
        sh(clone, ["config", "core.hooksPath", hooks]);
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

    // Issue #6765 — PR #6657 landed on a RED base this way: `derive:sync` run
    // on a feature branch rebased onto the base, its derive commit built on
    // the branch's HEAD, and a plain push fast-forwarded the base to it.
    it("off-base: a commit built on a branch AHEAD of the base is refused — the base keeps its tip", () => {
        const feature = commitOn(clone, head, "f.txt", "feature\n");
        const sha = commitOn(clone, feature, "d.txt", "derived\n");
        const r = pushDerivedCommit(runner(clone), input(sha, feature));
        expect(r.outcome).toBe("off-base");
        expect(r.remoteTip).toBe(head);
        expect(sh(bare, ["rev-parse", BASE_BRANCH])).toBe(head);
    });

    it("failed, never a force push: a commit not built on `head` is not sent", () => {
        const stray = commitOn(clone, head, "s.txt", "stray\n");
        const elsewhere = commitOn(clone, stray, "e.txt", "e\n");
        const sha = commitOn(clone, head, "d.txt", "derived\n");
        const r = pushDerivedCommit(runner(clone), input(sha, elsewhere));
        expect(r.outcome).toBe("failed");
        expect(r.why).toMatch(/not built on/);
        expect(sh(bare, ["rev-parse", BASE_BRANCH])).toBe(head);
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
        expect(r.attempts).toBe(1);
        expect(sh(bare, ["rev-parse", BASE_BRANCH])).toBe(head);
    });

    // ADR 0159 § 3 (issue #6990): on 2026-10-25 two 75-min sweeps were
    // discarded on one 120 s push timeout each.
    it("retries a transient refusal with backoff and lands: a push that times out twice then succeeds is one commit on the base, no discarded sweep", () => {
        const sha = commitOn(clone, head, "d.txt", "derived\n");
        const real = runner(clone);
        let pushes = 0;
        const flaky: GitRun = (args, opts) => {
            if (args[0] !== "push") return real(args, opts);
            pushes += 1;
            return pushes <= 2
                ? { status: null, stdout: "", stderr: "", timedOut: true }
                : real(args, opts);
        };
        const slept: number[] = [];
        const notes: string[] = [];
        const r = pushDerivedCommit(flaky, {
            ...input(sha, head),
            retry: {
                backoffMs: [1, 2, 3],
                sleep: (ms) => slept.push(ms),
                note: (line) => notes.push(line),
            },
        });
        expect(r.outcome).toBe("landed");
        expect(r.attempts).toBe(3);
        expect(slept).toEqual([1, 2]);
        expect(notes).toHaveLength(2);
        expect(notes[0]).toMatch(
            /no answer within 10s.*retrying in 0s \(1\/3\)/
        );
        expect(sh(bare, ["rev-parse", BASE_BRANCH])).toBe(sha);
    });

    it("gives the sweep up only once the backoff is spent — failed, the attempts counted; a refusal that is not transient is never retried", () => {
        const sha = commitOn(clone, head, "d.txt", "derived\n");
        const real = runner(clone);
        let pushes = 0;
        const down: GitRun = (args, opts) => {
            if (args[0] !== "push") return real(args, opts);
            pushes += 1;
            return {
                status: 128,
                stdout: "",
                stderr: "fatal: unable to access 'https://github.com/o/r/': Could not resolve host: github.com\n",
            };
        };
        const slept: number[] = [];
        const r = pushDerivedCommit(down, {
            ...input(sha, head),
            retry: {
                backoffMs: PUSH_RETRY_BACKOFF_MS,
                sleep: (ms) => slept.push(ms),
            },
        });
        expect(r.outcome).toBe("failed");
        expect(pushes).toBe(PUSH_RETRY_BACKOFF_MS.length + 1);
        expect(r.attempts).toBe(pushes);
        expect(slept).toEqual([...PUSH_RETRY_BACKOFF_MS]);
        expect(r.why).toMatch(/Could not resolve host.*\(4 attempts\)/);
        expect(sh(bare, ["rev-parse", BASE_BRANCH])).toBe(head);

        pushes = 0;
        const hook: GitRun = (args, opts) => {
            if (args[0] !== "push") return real(args, opts);
            pushes += 1;
            return {
                status: 1,
                stdout: "",
                stderr: "remote: declined\n ! [remote rejected] x -> staging (pre-receive hook declined)\n",
            };
        };
        const r2 = pushDerivedCommit(hook, {
            ...input(sha, head),
            retry: {
                backoffMs: PUSH_RETRY_BACKOFF_MS,
                sleep: () => {
                    throw new Error("slept on a refusal");
                },
            },
        });
        expect(r2.outcome).toBe("failed");
        expect(pushes).toBe(1);
        expect(r2.why).toBe(
            "! [remote rejected] x -> staging (pre-receive hook declined)"
        );
        // Without `retry` (the derive commit before ADR 0159), one attempt.
        pushes = 0;
        expect(pushDerivedCommit(down, input(sha, head)).attempts).toBe(1);
        expect(pushes).toBe(1);
    });

    it("transientPushFailure: a timeout or the network, never a refusal", () => {
        const answer = (stderr: string, timedOut?: boolean) => ({
            status: 1,
            stdout: "",
            stderr,
            timedOut,
        });
        expect(transientPushFailure(answer("", true))).toBe(true);
        expect(
            transientPushFailure(answer("error: RPC failed; HTTP 502 curl 22"))
        ).toBe(true);
        expect(
            transientPushFailure(
                answer("fatal: the remote end hung up unexpectedly")
            )
        ).toBe(true);
        expect(
            transientPushFailure(
                answer("ssh: connect to host: Connection timed out")
            )
        ).toBe(true);
        expect(
            transientPushFailure(
                answer(" ! [rejected] x -> staging (stale info)")
            )
        ).toBe(false);
        expect(
            transientPushFailure(answer("remote: Permission to o/r denied"))
        ).toBe(false);
        // Credentials and size refusals repeat: never retried.
        expect(
            transientPushFailure(
                answer(
                    "fatal: unable to access 'https://github.com/o/r/': The requested URL returned error: 403"
                )
            )
        ).toBe(false);
        expect(
            transientPushFailure(answer("error: RPC failed; HTTP 413 curl 22"))
        ).toBe(false);
        expect(
            transientPushFailure(
                answer(
                    "fatal: unable to access 'https://github.com/o/r/': The requested URL returned error: 502"
                )
            )
        ).toBe(true);
        expect(
            transientPushFailure(
                answer(
                    "fatal: unable to access 'https://github.com/o/r/': Failed to connect to github.com port 443"
                )
            )
        ).toBe(true);
    });
});
