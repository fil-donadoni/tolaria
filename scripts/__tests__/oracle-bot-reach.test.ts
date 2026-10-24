/**
 * The Bot-play sweep's lockfile side (ADR 0105 § 7.2, issue #3830): the
 * verdict cache, the carry-forward the drift guard uses, the `bot-unreachable`
 * quarantine, the Bot Gap table — and that no gate ever plays.
 *
 * The sweep's verdicts themselves are the bot suite's
 * (`convex/gre/ai/__tests__/botReach.bot.test.ts`); here every player is a
 * stub, so this stays an application test and never imports the Bot.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BotReachVerdict } from "../../convex/gre/ai/botReach";
import type { CompiledDefinition } from "../../convex/oracle/types";
import {
    buildLockfile as buildLockfileRaw,
    LOCK_FREE_MISSES,
    sessionSweep,
    sweepAdmits,
    sweepMode,
    sweepWhenMissing,
    type BuildLockfileOptions,
} from "../oracle-compile";
import type { CorpusCard } from "../oracle-corpus";
import {
    botGapKey,
    botSourceFiles,
    carriedBotReach,
    carriedOrPlayed,
    classifyVerdict,
    isBotSourceFile,
    playingBotReach,
    probingBotReach,
    rankBotGaps,
    replayingCardsBotReach,
    resolveReplayCards,
    type BotReachSource,
} from "../lib/oracle-bot-reach";
import {
    serializeLockfile,
    type CardRow,
    type Lockfile,
} from "../lib/oracle-lockfile";
import { REGENERATED_ARTIFACTS } from "../lib/generated-artifacts";
import { deriveCounts, deriveFormats } from "../lib/oracle-tally";
import { readyDelta, verdictDelta } from "../lib/oracle-ready-delta";
import { emptyRetirementLedger } from "../lib/oracle-retirements";

const ROOT = join(import.meta.dirname, "..", "..");

// SYNTHETIC corpora only — must not stamp against the real, committed
// `data/oracle-retirements.json` (issue #4027): a globally-retired card's
// oracle id is absent from these fixtures by construction, and
// `stampRetirements`'s own unguarded-row refusal would fire on every build.
function buildLockfile(
    corpus: readonly CorpusCard[],
    options: BuildLockfileOptions = {}
) {
    return buildLockfileRaw(corpus, {
        retirements: emptyRetirementLedger(),
        ...options,
    });
}

const BEAR_ID = "00000000-0000-0000-0000-00000000b0a1";
const BOLT_ID = "00000000-0000-0000-0000-00000000b0a2";

const BEAR_DEF = {
    name: "Test Bear",
    types: ["Creature"],
} as unknown as CompiledDefinition;

function lockWith(rows: CardRow[], botHash: string): Lockfile {
    return {
        header: { botHash },
        cards: rows,
    } as unknown as Lockfile;
}

function row(overrides: Partial<CardRow>): CardRow {
    return {
        oracleId: BEAR_ID,
        name: "Test Bear",
        state: "ready",
        definition: BEAR_DEF,
        botReach: "played",
        ...overrides,
    };
}

/** A player that records every card it is asked to play. */
function spyPlayer(verdict: BotReachVerdict = { outcome: "played" }) {
    const calls: string[] = [];
    return {
        calls,
        play: (oracleId: string): BotReachVerdict => {
            calls.push(oracleId);
            return verdict;
        },
    };
}

describe("playingBotReach — the incremental cache (ADR 0105 § 7.2)", () => {
    it("a cache hit (same definition, same Bot hash) skips the play", () => {
        const spy = spyPlayer();
        const source = playingBotReach(
            lockWith([row({})], "sha256:bot"),
            "sha256:bot",
            spy.play
        );
        expect(source.verdictFor(BEAR_ID, BEAR_DEF)).toEqual({
            outcome: "played",
        });
        expect(spy.calls).toEqual([]);
        expect(source.played()).toBe(0);
    });

    it("a changed definition is played again", () => {
        const spy = spyPlayer();
        const source = playingBotReach(
            lockWith([row({})], "sha256:bot"),
            "sha256:bot",
            spy.play
        );
        source.verdictFor(BEAR_ID, {
            ...BEAR_DEF,
            power: 3,
        } as CompiledDefinition);
        expect(spy.calls).toEqual([BEAR_ID]);
    });

    // Issue #6463: a bare run is session-scoped — a Bot hash that moved is
    // never a reason to replay the catalogue. The verdicts are carried on
    // their definitions, the header keeps the hash they were played under.
    it("a changed Bot hash carries every verdict and keeps the committed header hash", () => {
        const spy = spyPlayer({ outcome: "frozen", cause: "no-legal-move" });
        const source = playingBotReach(
            lockWith([row({})], "sha256:old-bot"),
            "sha256:new-bot",
            spy.play
        );
        expect(source.verdictFor(BEAR_ID, BEAR_DEF)).toEqual({
            outcome: "played",
        });
        expect(spy.calls).toEqual([]);
        expect(source.hash).toBe("sha256:old-bot");
    });

    it("on a changed Bot hash plays exactly the definition misses: a changed definition, a card with no verdict", () => {
        const spy = spyPlayer();
        const source = playingBotReach(
            lockWith(
                [row({}), row({ oracleId: BOLT_ID, botReach: undefined })],
                "sha256:old-bot"
            ),
            "sha256:new-bot",
            spy.play
        );
        source.verdictFor(BEAR_ID, BEAR_DEF);
        source.verdictFor(BOLT_ID, BEAR_DEF);
        source.verdictFor("newly-ready", BEAR_DEF);
        source.verdictFor(BEAR_ID, {
            ...BEAR_DEF,
            power: 3,
        } as CompiledDefinition);
        expect(spy.calls).toEqual([BOLT_ID, "newly-ready", BEAR_ID]);
        expect(source.played()).toBe(3);
        expect(source.hash).toBe("sha256:old-bot");
    });

    it("with no lockfile to carry, every card is played and the tree's hash is recorded", () => {
        const spy = spyPlayer();
        const source = playingBotReach(null, "sha256:new-bot", spy.play);
        source.verdictFor(BEAR_ID, BEAR_DEF);
        expect(spy.calls).toEqual([BEAR_ID]);
        expect(source.hash).toBe("sha256:new-bot");
    });

    it("`--replay-bot` ignores a valid cache and writes the tree's Bot hash", () => {
        const spy = spyPlayer();
        const source = playingBotReach(
            lockWith([row({})], "sha256:old-bot"),
            "sha256:new-bot",
            spy.play,
            {
                replay: true,
            }
        );
        source.verdictFor(BEAR_ID, BEAR_DEF);
        expect(spy.calls).toEqual([BEAR_ID]);
        expect(source.hash).toBe("sha256:new-bot");
    });

    it("the probe carries on a changed Bot hash too, so zero misses is --carry-bot's lockfile", () => {
        const probe = probingBotReach(
            lockWith([row({})], "sha256:old-bot"),
            "sha256:new-bot"
        );
        expect(probe.verdictFor(BEAR_ID, BEAR_DEF)).toEqual({
            outcome: "played",
        });
        expect([...probe.misses()]).toEqual([]);
        expect(probe.hash).toBe("sha256:old-bot");
    });

    it("a cached non-played verdict comes back with its cause and form", () => {
        const verdict: BotReachVerdict = {
            outcome: "frozen",
            cause: "no-legal-move",
            form: "Instant target:Planeswalker",
        };
        const cached = row({
            botReach: "frozen",
            botGap: botGapKey(verdict, []),
        });
        const source = playingBotReach(
            lockWith([cached], "sha256:bot"),
            "sha256:bot",
            spyPlayer().play
        );
        expect(source.verdictFor(BEAR_ID, BEAR_DEF)).toEqual(verdict);
    });
});

describe("carriedBotReach — the drift guard's source never plays", () => {
    it("carries a verdict forward whatever the Bot hash, and keeps the header's", () => {
        const source = carriedBotReach(lockWith([row({})], "sha256:committed"));
        expect(source.hash).toBe("sha256:committed");
        expect(source.verdictFor(BEAR_ID, BEAR_DEF)).toEqual({
            outcome: "played",
        });
    });

    // ADR 0158 § 2a (issue #6688): a drift row's verdict is carried marked
    // stale — exactly what a session's bare run wrote, so tier 3 regenerates
    // the PR's rows byte-identical.
    it("carries a drift row's verdict marked stale onto a changed definition", () => {
        const source = carriedBotReach(lockWith([row({})], "sha256:x"));
        expect(
            source.verdictFor(BEAR_ID, {
                ...BEAR_DEF,
                power: 3,
            } as CompiledDefinition)
        ).toEqual({ outcome: "played", stale: true });
    });

    it("has nothing for a graduation — a card not `ready` with a verdict before", () => {
        const source = carriedBotReach(
            lockWith(
                [row({ state: "quarantine", botReach: undefined })],
                "sha256:x"
            )
        );
        expect(source.verdictFor(BEAR_ID, BEAR_DEF)).toBeUndefined();
        expect(source.verdictFor("absent", BEAR_DEF)).toBeUndefined();
    });
});

describe("the Bot hash covers what decides a verdict", () => {
    it("hashes every DIRECT import of the verdict function", () => {
        const files = botSourceFiles(ROOT);
        for (const file of [
            // `getLegalActions` — the frozen / position-unmodelled
            // discriminator itself.
            "convex/gre/rules.ts",
            "convex/gre/search.ts",
            "convex/gre/moves.ts",
            "convex/gre/applyMove.ts",
            "convex/cards/colors.ts",
            "convex/gre/ai/botReach.ts",
        ])
            expect(files, file).toContain(file);
        // Label-only, and excluded on purpose: changing a gap key must not
        // replay 3,400 cards.
        expect(files).not.toContain("convex/gre/ai/botReachForm.ts");
    });

    // `deny-guard.sh` § 7 asks the predicate about a diff's PATHS, the hash
    // walks the TREE: both must be the one set (issue #4942).
    it("isBotSourceFile names exactly the files the hash walks", () => {
        for (const file of botSourceFiles(ROOT))
            expect(isBotSourceFile(file), file).toBe(true);
        for (const file of [
            "convex/gre/ai/botReachForm.ts",
            "convex/gre/ai/__tests__/botReach.bot.test.ts",
            "convex/gre/ai/verdicts/coverage.ts",
            "convex/gre/ai/blade/registry.ts",
            "convex/gre/combat.ts",
            "scripts/oracle-compile.ts",
        ])
            expect(isBotSourceFile(file), file).toBe(false);
        expect(isBotSourceFile("convex/gre/ai/blade/baseState.ts")).toBe(true);
    });
});

describe("Bot Gaps", () => {
    it("aggregate by form — never-chosen also by the card's Ops", () => {
        expect(
            botGapKey(
                { outcome: "ignored", cause: "never-chosen", form: "Sorcery" },
                ["destroy", "draw"]
            )
        ).toBe("never-chosen › Sorcery › destroy+draw");
        expect(
            botGapKey(
                {
                    outcome: "frozen",
                    cause: "unanswerable-input",
                    form: "choice:discard",
                },
                ["discard"]
            )
        ).toBe("unanswerable-input › choice:discard");
        expect(botGapKey({ outcome: "played" }, ["draw"])).toBeUndefined();
    });

    it("a recomputed cast shape overrides a cast-shape form — and NOTHING else", () => {
        expect(
            botGapKey(
                { outcome: "ignored", cause: "never-chosen", form: "stale" },
                [],
                "Creature [flash]"
            )
        ).toBe("never-chosen › Creature [flash] › (no Ops)");
        // The choice kind is the only actionable field on a follow-through
        // row; the cast shape may not eat it.
        expect(
            botGapKey(
                {
                    outcome: "frozen",
                    cause: "unanswerable-input",
                    form: "choice:divide-piles",
                },
                [],
                "Creature [flash]"
            )
        ).toBe("unanswerable-input › choice:divide-piles");
    });

    it("a row whose cause this tree does not produce is a cache MISS", () => {
        const spy = spyPlayer();
        const source = playingBotReach(
            lockWith(
                [
                    row({
                        botReach: "ignored",
                        botGap: "retired-cause › Sorcery",
                    }),
                ],
                "sha256:bot"
            ),
            "sha256:bot",
            spy.play
        );
        expect(source.verdictFor(BEAR_ID, BEAR_DEF)).toEqual({
            outcome: "played",
        });
        expect(spy.calls).toEqual([BEAR_ID]);
    });

    it("rank by blast radius, then key — a total order", () => {
        const rows = [
            row({ oracleId: "a", botReach: "ignored", botGap: "k2" }),
            row({ oracleId: "b", botReach: "frozen", botGap: "k1" }),
            row({ oracleId: "c", botReach: "ignored", botGap: "k2" }),
            row({ oracleId: "d", botReach: "ignored", botGap: "k0" }),
            row({ oracleId: "e" }),
        ];
        expect(rankBotGaps(rows)).toEqual([
            { key: "k2", outcome: "ignored", cards: 2 },
            { key: "k0", outcome: "ignored", cards: 1 },
            { key: "k1", outcome: "frozen", cards: 1 },
        ]);
    });
});

function corpusCard(overrides: Partial<CorpusCard>): CorpusCard {
    return {
        oracleId: BEAR_ID,
        name: "Test Bear",
        manaCost: "{1}{G}",
        typeLine: "Creature — Bear",
        oracleText: "",
        power: "2",
        toughness: "2",
        layout: "normal",
        legalIn: ["premodern"],
        poolIn: ["premodern"],
        ...overrides,
    };
}

const CORPUS: CorpusCard[] = [
    corpusCard({}),
    corpusCard({
        oracleId: BOLT_ID,
        name: "Test Bolt",
        oracleText: "Test Bolt deals 3 damage to any target.",
        typeLine: "Instant",
        manaCost: "{R}",
        power: undefined,
        toughness: undefined,
    }),
];

/** A source with a fixed verdict per card — no Bot involved. */
function fixedSource(
    verdicts: Record<string, BotReachVerdict>
): BotReachSource {
    return {
        hash: "sha256:fixed",
        verdictFor: (oracleId) => verdicts[oracleId],
    };
}

describe("buildLockfile with a Bot-play verdict (ADR 0105 § 7.2)", () => {
    const lock = buildLockfile(CORPUS, {
        botReach: fixedSource({
            [BEAR_ID]: {
                outcome: "frozen",
                cause: "no-legal-move",
                form: "Creature",
            },
            [BOLT_ID]: {
                outcome: "ignored",
                cause: "never-chosen",
                form: "Instant target:any",
            },
        }),
    });
    const bear = lock.cards.find((c) => c.oracleId === BEAR_ID)!;
    const bolt = lock.cards.find((c) => c.oracleId === BOLT_ID)!;

    it("frozen withholds the card: quarantine, reason bot-unreachable", () => {
        expect(bear.state).toBe("quarantine");
        expect(bear.botReach).toBe("frozen");
        expect(bear.quarantineReasons).toEqual([
            { kind: "bot-unreachable", detail: "no-legal-move › Creature" },
        ]);
        expect(deriveCounts(lock.cards).quarantine).toBe(1);
        expect(deriveFormats(lock.cards, new Set()).premodern.quarantine).toBe(
            1
        );
    });

    it("ignored ships the card and yields a Bot Gap row", () => {
        expect(bolt.state).toBe("ready");
        expect(bolt.botReach).toBe("ignored");
        expect(bolt.quarantineReasons).toBeUndefined();
        expect(deriveCounts(lock.cards).ready).toBe(1);
        expect(lock.botGaps).toContainEqual({
            key: `never-chosen › Instant target:any › ${bolt.opsUsed!.join("+")}`,
            outcome: "ignored",
            cards: 1,
        });
    });

    it("records the source's Bot hash in the header", () => {
        expect(lock.header.botHash).toBe("sha256:fixed");
    });

    it("without a source, no row carries a verdict and nothing is withheld", () => {
        const bare = buildLockfile(CORPUS);
        expect(bare.cards.every((c) => c.botReach === undefined)).toBe(true);
        expect(deriveCounts(bare.cards).ready).toBe(2);
        expect(bare.botGaps).toEqual([]);
    });
});

describe("--carry-bot --replay-card: play only the named cards (issue #4957)", () => {
    const previous = buildLockfile(CORPUS, {
        botReach: fixedSource({
            [BEAR_ID]: { outcome: "played" },
            [BOLT_ID]: {
                outcome: "ignored",
                cause: "never-chosen",
                form: "Instant target:any",
            },
        }),
    });
    const spy = spyPlayer({ outcome: "played" });
    const next = buildLockfile(CORPUS, {
        botReach: replayingCardsBotReach(
            previous,
            new Set([BOLT_ID]),
            spy.play
        ),
    });
    const rowOf = (lock: Lockfile, id: string) =>
        JSON.stringify(lock.cards.find((c) => c.oracleId === id));

    it("plays exactly the named card, even on a valid cache", () => {
        expect(spy.calls).toEqual([BOLT_ID]);
        expect(next.cards.find((c) => c.oracleId === BOLT_ID)!.botReach).toBe(
            "played"
        );
    });

    it("carries every other row byte-identical", () => {
        expect(rowOf(next, BEAR_ID)).toBe(rowOf(previous, BEAR_ID));
    });

    it("leaves the header — the committed Bot hash — unchanged", () => {
        expect(next.header).toEqual(previous.header);
        expect(next.header.botHash).toBe("sha256:fixed");
    });

    it("resolves names case-insensitively and names every unknown one", () => {
        const resolved = resolveReplayCards(CORPUS, [
            "test bolt",
            "No Such Card",
        ]);
        expect([...resolved.ids]).toEqual([BOLT_ID]);
        expect(resolved.unknown).toEqual(["No Such Card"]);
    });

    it("a name several oracle ids share replays every one of them", () => {
        const twin = corpusCard({ oracleId: "twin-bear" });
        const resolved = resolveReplayCards([...CORPUS, twin], ["Test Bear"]);
        expect([...resolved.ids].sort()).toEqual([BEAR_ID, "twin-bear"].sort());
    });
});

describe("the base's --play-misses queues for the heavy mutex only past a handful of misses (issues #6069, #6687)", () => {
    const previous = buildLockfile(CORPUS, {
        botReach: fixedSource({
            [BEAR_ID]: { outcome: "played" },
            [BOLT_ID]: {
                outcome: "ignored",
                cause: "never-chosen",
                form: "Instant target:any",
            },
        }),
    });
    const build = (source: BotReachSource) =>
        serializeLockfile(buildLockfile(CORPUS, { botReach: source }));
    /** `previous` with the Bolt row's definition moved — one miss. */
    const bolted: Lockfile = {
        ...previous,
        cards: previous.cards.map((c) =>
            c.oracleId === BOLT_ID
                ? {
                      ...c,
                      definition: {
                          ...c.definition!,
                          name: "Stale Bolt",
                      } as CompiledDefinition,
                  }
                : c
        ),
    };

    /** Records admission and plays in call order; `admitCode` is the
     *  re-executed child's exit code (null = already under the hold). */
    function run(
        prev: Lockfile,
        replay = false,
        admitCode: number | null = null,
        lockFreeMisses?: number
    ) {
        const events: string[] = [];
        const spy = spyPlayer({ outcome: "played" });
        const result = sweepWhenMissing({
            previous: prev,
            currentBotHash: "sha256:fixed",
            replay,
            build,
            lockFreeMisses,
            admit: async () => {
                events.push("admit");
                return admitCode;
            },
            sweep: async () =>
                playingBotReach(prev, "sha256:fixed", spy.play, {
                    replay,
                    onPlay: (id) => events.push(`play:${id}`),
                }),
        });
        return { events, result };
    }

    it("zero misses never reaches admission and writes the --carry-bot lockfile", async () => {
        const { events, result } = run(previous);
        const done = await result;
        expect(events).toEqual([]);
        expect(done).toEqual({
            text: build(carriedBotReach(previous)),
            played: 0,
        });
    });

    it("a Bot hash that moved is zero misses: the --carry-bot lockfile, no admission, nothing played (issue #6463)", async () => {
        const moved = {
            ...previous,
            header: { ...previous.header, botHash: "sha256:older-bot" },
        };
        const { events, result } = run(moved);
        const done = await result;
        expect(events).toEqual([]);
        expect(done).toEqual({
            text: build(carriedBotReach(moved)),
            played: 0,
        });
        expect(JSON.parse((done as { text: string }).text).header.botHash).toBe(
            "sha256:older-bot"
        );
    });

    it("a handful of misses is played in place, never queued (issue #6463)", async () => {
        const probe = probingBotReach(bolted, "sha256:fixed");
        build(probe);
        expect([...probe.misses()]).toEqual([BOLT_ID]);
        const { events, result } = run(bolted);
        expect(await result).toMatchObject({ played: 1 });
        expect(events).toEqual([`play:${BOLT_ID}`]);
    });

    it("more misses than LOCK_FREE_MISSES take the mutex BEFORE playing, and play exactly the misses", async () => {
        const { events, result } = run(bolted, false, null, 0);
        expect(await result).toMatchObject({ played: 1 });
        expect(events).toEqual(["admit", `play:${BOLT_ID}`]);
        expect(LOCK_FREE_MISSES).toBe(25);
    });

    it("the boundary is inclusive: exactly the threshold plays in place, one more admits", async () => {
        /** Both definitions moved — two misses. */
        const bothMoved: Lockfile = {
            ...bolted,
            cards: bolted.cards.map((c) =>
                c.oracleId === BEAR_ID
                    ? {
                          ...c,
                          definition: {
                              ...c.definition!,
                              name: "Stale Bear",
                          } as CompiledDefinition,
                      }
                    : c
            ),
        };
        const one = run(bolted, false, null, 1);
        await one.result;
        expect(one.events).toEqual([`play:${BOLT_ID}`]);
        const two = run(bothMoved, false, null, 1);
        await two.result;
        expect(two.events).toEqual([
            "admit",
            `play:${BEAR_ID}`,
            `play:${BOLT_ID}`,
        ]);
    });

    it("a run re-executed under the mutex returns the child's code and plays nothing here", async () => {
        const { events, result } = run(bolted, false, 3, 0);
        expect(await result).toEqual({ exit: 3 });
        expect(events).toEqual(["admit"]);
    });

    it("--replay-bot takes the mutex even with a valid cache", async () => {
        const { events, result } = run(previous, true);
        await result;
        expect(events).toEqual(["admit", `play:${BEAR_ID}`, `play:${BOLT_ID}`]);
    });
});

describe("a session plays only its graduations; drift verdicts are carried (ADR 0158 § 2a, issue #6688)", () => {
    /** A compiler change touching one field of every definition. */
    const NEW_DEF = { ...BEAR_DEF, power: 3 } as CompiledDefinition;
    const driftId = (n: number) => `drift-${String(n).padStart(4, "0")}`;
    const DRIFT = Array.from({ length: 1000 }, (_, n) => driftId(n));
    const GRADUATIONS = [
        "graduation-absent",
        "graduation-unparsed",
        "graduation-unverdicted",
    ];
    /** 1,000 rows `ready` and played on the old definition; one unparsed,
     *  one `ready` with no verdict; `graduation-absent` has no row. */
    const committed = lockWith(
        [
            ...DRIFT.map((oracleId) => row({ oracleId })),
            row({
                oracleId: "graduation-unparsed",
                state: "unparsed",
                definition: undefined,
                botReach: undefined,
            }),
            row({ oracleId: "graduation-unverdicted", botReach: undefined }),
        ],
        "sha256:committed-bot"
    );
    /** Walks this tree — every card `ready` on the new definition — as
     *  `buildLockfile` does, and records each verdict. */
    const build = (source: BotReachSource) =>
        JSON.stringify(
            [...DRIFT, ...GRADUATIONS].map((id) => [
                id,
                source.verdictFor(id, NEW_DEF) ?? null,
            ])
        );

    it("1,000 drifted definitions and 3 graduations: the bare run plays exactly the 3 and carries the 1,000", async () => {
        const asked: string[] = [];
        const result = await sessionSweep({
            previous: committed,
            baseline: committed,
            currentBotHash: "sha256:tree-bot",
            build,
            play: async (graduations) => {
                asked.push(...graduations.keys());
                return new Map(
                    [...graduations.keys()].map((id) => [
                        id,
                        { outcome: "played" } as BotReachVerdict,
                    ])
                );
            },
        });
        expect(asked.sort()).toEqual(GRADUATIONS);
        expect(result.played).toBe(3);
        expect(result.carried).toBe(1000);
        const verdicts = new Map(
            JSON.parse(result.text) as [string, unknown][]
        );
        expect(verdicts.get(driftId(0))).toEqual({
            outcome: "played",
            stale: true,
        });
        expect(verdicts.get("graduation-absent")).toEqual({
            outcome: "played",
        });
    });

    // Review of issue #6688: the disk file is the CACHE, the base's lockfile
    // the baseline. After a first run the disk holds the graduations `ready`
    // with a verdict; a rule fixed between two runs must replay them.
    it("a second run after a rule fix replays the branch's graduations — classified against the base, not the disk", async () => {
        const firstRun = lockWith(
            [
                ...DRIFT.map((oracleId) => row({ oracleId, botStale: true })),
                ...GRADUATIONS.map((oracleId) => row({ oracleId })),
            ],
            "sha256:committed-bot"
        );
        const asked: string[] = [];
        const result = await sessionSweep({
            previous: firstRun,
            baseline: committed,
            currentBotHash: "sha256:tree-bot",
            build,
            play: async (graduations) => {
                asked.push(...graduations.keys());
                return new Map(
                    [...graduations.keys()].map((id) => [
                        id,
                        { outcome: "played" } as BotReachVerdict,
                    ])
                );
            },
        });
        expect(asked.sort()).toEqual(GRADUATIONS);
        expect(result.carried).toBe(1000);
    });

    it("a carried row keeps the Bot Gap key it was committed with, never one recomputed from the new definition", () => {
        const previous = buildLockfile(CORPUS, {
            botReach: fixedSource({
                [BEAR_ID]: { outcome: "played" },
                [BOLT_ID]: {
                    outcome: "ignored",
                    cause: "never-chosen",
                    form: "Instant target:any",
                },
            }),
        });
        const OLD_KEY = "never-chosen › Sorcery target:creature › destroy";
        const moved: Lockfile = {
            ...previous,
            cards: previous.cards.map((c) =>
                c.oracleId === BOLT_ID
                    ? {
                          ...c,
                          botGap: OLD_KEY,
                          definition: {
                              ...c.definition!,
                              name: "Old Bolt",
                          } as CompiledDefinition,
                      }
                    : c
            ),
        };
        const session = buildLockfile(CORPUS, {
            botReach: carriedOrPlayed(moved, "sha256:x", spyPlayer().play),
        });
        const bolt = session.cards.find((c) => c.oracleId === BOLT_ID)!;
        expect(bolt).toMatchObject({
            botReach: "ignored",
            botGap: OLD_KEY,
            botStale: true,
        });
        expect(
            serializeLockfile(
                buildLockfile(CORPUS, { botReach: carriedBotReach(session) })
            )
        ).toBe(serializeLockfile(session));
    });

    it("a frozen row is not `ready`: a moved definition graduates (played), an unchanged one is current", () => {
        const frozen = row({
            state: "quarantine",
            botReach: "frozen",
            botGap: "no-legal-move › Creature",
        });
        expect(classifyVerdict(frozen, NEW_DEF).kind).toBe("graduation");
        expect(classifyVerdict(frozen, BEAR_DEF).kind).toBe("current");
    });

    it("the carried row is marked botStale, regenerates byte-identical under the gate's carry, and is a miss for the base", () => {
        const previous = buildLockfile(CORPUS, {
            botReach: fixedSource({
                [BEAR_ID]: { outcome: "played" },
                [BOLT_ID]: {
                    outcome: "ignored",
                    cause: "never-chosen",
                    form: "Instant target:any",
                },
            }),
        });
        /** The committed Bear row was played on a definition the tree no
         *  longer compiles. */
        const moved: Lockfile = {
            ...previous,
            cards: previous.cards.map((c) =>
                c.oracleId === BEAR_ID
                    ? {
                          ...c,
                          definition: {
                              ...c.definition!,
                              name: "Old Bear",
                          } as CompiledDefinition,
                      }
                    : c
            ),
        };
        const spy = spyPlayer();
        const session = buildLockfile(CORPUS, {
            botReach: carriedOrPlayed(moved, "sha256:tree-bot", spy.play),
        });
        expect(spy.calls).toEqual([]);
        const bear = session.cards.find((c) => c.oracleId === BEAR_ID)!;
        expect(bear).toMatchObject({ botReach: "played", botStale: true });
        // `check:oracle`'s tier 3 on the PR: the carry reproduces the rows.
        expect(
            serializeLockfile(
                buildLockfile(CORPUS, { botReach: carriedBotReach(session) })
            )
        ).toBe(serializeLockfile(session));
        // The probe (`staleVerdicts`) reads the marked row as a drift miss
        // although its definition is the tree's …
        const probe = probingBotReach(session, "sha256:tree-bot");
        buildLockfile(CORPUS, { botReach: probe });
        expect([...probe.misses()]).toEqual([BEAR_ID]);
        expect([...probe.drift()]).toEqual([BEAR_ID]);
        expect([...probe.graduations().keys()]).toEqual([]);
        // … so the base's `--play-misses` plays it and drops the marker.
        const base = spyPlayer();
        const replayed = buildLockfile(CORPUS, {
            botReach: playingBotReach(session, "sha256:tree-bot", base.play),
        });
        expect(base.calls).toEqual([BEAR_ID]);
        expect(
            replayed.cards.find((c) => c.oracleId === BEAR_ID)!.botStale
        ).toBeUndefined();
    });

    it("oracle:report --delta reads the same classification: a frozen graduation is named, carried rows counted", () => {
        const previous = buildLockfile(CORPUS, {
            botReach: fixedSource({ [BEAR_ID]: { outcome: "played" } }),
        });
        const baseline: Lockfile = {
            ...previous,
            cards: previous.cards.map((c) =>
                c.oracleId === BEAR_ID
                    ? {
                          ...c,
                          definition: {
                              ...c.definition!,
                              name: "Old Bear",
                          } as CompiledDefinition,
                      }
                    : c
            ),
        };
        const session = buildLockfile(CORPUS, {
            botReach: carriedOrPlayed(
                baseline,
                "sha256:tree-bot",
                spyPlayer({
                    outcome: "frozen",
                    cause: "no-legal-move",
                    form: "Instant target:any",
                }).play
            ),
        });
        expect(verdictDelta(baseline.cards, session.cards)).toEqual({
            graduated: 1,
            frozen: ["Test Bolt"],
            carried: 1,
        });
        // Against itself the frozen Bolt is `current`, never a graduation.
        expect(verdictDelta(session.cards, session.cards)).toEqual({
            graduated: 0,
            frozen: [],
            carried: 1,
        });
    });

    it("no bare run reaches the heavy mutex: only the base's two sweeps admit", () => {
        expect(sweepMode([])).toBe("session");
        expect(sweepAdmits("session")).toBe(false);
        expect(sweepMode(["--play-misses"])).toBe("misses");
        expect(sweepMode(["--replay-bot"])).toBe("replay");
        expect(sweepAdmits("misses")).toBe(true);
        expect(sweepAdmits("replay")).toBe(true);
        const driver = readFileSync(
            join(ROOT, "scripts", "oracle-compile.ts"),
            "utf8"
        );
        // One admission call site, on the `sweepAdmits` branch only.
        expect(driver.match(/runUnderHeavyAdmission\(/g)).toHaveLength(1);
        expect(driver).toMatch(
            /sweepAdmits\(mode\)\s*\?\s*await sweepWhenMissing\(\{[^}]*admit: \(\) => runUnderHeavyAdmission\(/
        );
    });
});

describe("a session's `ready` delta never carries a Bot-hash move it did not make (issue #6463)", () => {
    // The committed lockfile froze Bolt under one Bot; this tree's Bot would
    // play it — and the other way round. A bare build on either tree carries
    // the committed verdict, so `oracle:report --delta` reads no `lost` (and
    // no gained) that the session did not cause.
    const frozenBolt: BotReachVerdict = {
        outcome: "frozen",
        cause: "no-legal-move",
        form: "Instant target:any",
    };
    const committed = (bolt: BotReachVerdict) =>
        buildLockfile(CORPUS, {
            botReach: {
                hash: "sha256:committed-bot",
                verdictFor: (id) =>
                    id === BOLT_ID ? bolt : { outcome: "played" },
            },
        });
    const bareBuild = (previous: Lockfile, treeVerdict: BotReachVerdict) =>
        buildLockfile(CORPUS, {
            botReach: playingBotReach(
                previous,
                "sha256:tree-bot",
                spyPlayer(treeVerdict).play
            ),
        });

    it("a card the committed sweep froze stays quarantined, not `gained`", () => {
        const previous = committed(frozenBolt);
        const lock = bareBuild(previous, { outcome: "played" });
        const corpus = readyDelta(previous.cards, lock.cards, [])[0]!;
        expect(corpus.lost).toEqual([]);
        expect(corpus.gained).toEqual([]);
        expect(lock.header.botHash).toBe("sha256:committed-bot");
    });

    it("a card the committed sweep played stays `ready`, not `lost`", () => {
        const previous = committed({ outcome: "played" });
        const lock = bareBuild(previous, frozenBolt);
        const corpus = readyDelta(previous.cards, lock.cards, [])[0]!;
        expect(corpus.lost).toEqual([]);
        expect(serializeLockfile(lock)).toBe(serializeLockfile(previous));
    });
});

describe("the sweep never runs inside a gate (ADR 0105 § 7.2)", () => {
    const pkg = JSON.parse(
        readFileSync(join(ROOT, "package.json"), "utf8")
    ) as {
        scripts: Record<string, string>;
    };

    it("every script but `oracle:compile` runs the compiler with --check only", () => {
        for (const [name, command] of Object.entries(pkg.scripts)) {
            if (name === "oracle:compile") continue;
            const runs = command.match(/oracle-compile\.ts[^&|;']*/g) ?? [];
            for (const run of runs) expect(run, name).toContain("--check");
            expect(command, name).not.toMatch(
                /bun run oracle:compile(?! --check)/
            );
        }
    });

    it("the gate's regenerator carries verdicts forward and cannot play", () => {
        const guard = readFileSync(
            join(ROOT, "scripts", "check-oracle-lockfile.ts"),
            "utf8"
        );
        expect(guard).toContain("carriedBotReach(");
        expect(guard).not.toMatch(/playingBotReach|gre\/ai\/botReach/);
    });

    it("the compiler driver imports the Bot only dynamically, on the write path", () => {
        const driver = readFileSync(
            join(ROOT, "scripts", "oracle-compile.ts"),
            "utf8"
        );
        // `botReachForm` is the one allowed static import: pure over a
        // definition, no search in its graph (asserted below), and the gate
        // needs it to recompute a Bot Gap key.
        expect(driver).not.toMatch(
            /^import (?!type)[^;]*from "\.\.\/convex\/gre\/ai\/(?!botReachForm)/m
        );
        // The dynamic import lives in the player module the driver and the
        // sweep's workers share (issue #6686); the driver reaches it only
        // through `createBotPlayer`.
        const player = readFileSync(
            join(ROOT, "scripts", "lib", "bot-reach-player.ts"),
            "utf8"
        );
        expect(player).toMatch(
            /await import\("\.\.\/\.\.\/convex\/gre\/ai\/botReach"\)/
        );
        expect(player).not.toMatch(
            /^import (?!type)[^;]*from "\.\.\/\.\.\/convex\/gre\/ai\//m
        );
        expect(driver).toContain("createBotPlayer");
        const form = readFileSync(
            join(ROOT, "convex", "gre", "ai", "botReachForm.ts"),
            "utf8"
        );
        expect(form).not.toMatch(/^import (?!type)/m);
        // The two `scripts/lib` modules the GATE imports: a value import of
        // the sweep in either one puts the whole search in the gate's module
        // graph, and the guard's own text assertions would stay green.
        for (const lib of ["oracle-bot-reach.ts", "oracle-lockfile.ts"]) {
            const text = readFileSync(
                join(ROOT, "scripts", "lib", lib),
                "utf8"
            );
            expect(text, lib).not.toMatch(
                /^import (?!type)[^;]*from "[^"]*gre\/ai\/botReach"/m
            );
        }
    });

    it("land's artifact resolver re-derives the lockfile WITHOUT playing", () => {
        // The hole the first `land` of this very PR fell into: the resolver
        // spawns `bun run oracle:compile` itself, and no gate script NAMES it,
        // so every text assertion around here stayed green while `land` swept
        // 3,400 cards under the machine mutex.
        const lockfile = REGENERATED_ARTIFACTS.find(
            (a) => a.path === "data/oracle-compiled.json"
        );
        expect(lockfile?.script).toBe("oracle:compile");
        expect(lockfile?.args ?? []).toContain("--carry-bot");
        expect(sweepMode(lockfile?.args ?? [])).toBe("carry");
        const driver = readFileSync(
            join(ROOT, "scripts", "oracle-compile.ts"),
            "utf8"
        );
        expect(driver).toMatch(
            /mode === "check" \|\| mode === "carry"\s*\?\s*null\s*:/
        );
    });

    it("the gate scripts never name the write path", () => {
        for (const file of [
            "land.ts",
            "check-lane.ts",
            "gate.ts",
            "health-main.ts",
            "release.ts",
        ]) {
            const text = readFileSync(join(ROOT, "scripts", file), "utf8");
            expect(text, file).not.toMatch(
                /oracle:compile(?! --check)|oracle-compile\.ts(?! --check)/
            );
        }
    });
});
