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
    type BuildLockfileOptions,
} from "../oracle-compile";
import type { CorpusCard } from "../oracle-corpus";
import {
    botGapKey,
    botSourceFiles,
    carriedBotReach,
    playingBotReach,
    rankBotGaps,
    type BotReachSource,
} from "../lib/oracle-bot-reach";
import type { CardRow, Lockfile } from "../lib/oracle-lockfile";
import { REGENERATED_ARTIFACTS } from "../lib/generated-artifacts";
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

    it("a changed Bot hash re-plays every card", () => {
        const spy = spyPlayer();
        const source = playingBotReach(
            lockWith([row({})], "sha256:old-bot"),
            "sha256:new-bot",
            spy.play
        );
        source.verdictFor(BEAR_ID, BEAR_DEF);
        expect(spy.calls).toEqual([BEAR_ID]);
        expect(source.hash).toBe("sha256:new-bot");
    });

    it("`--replay-bot` ignores a valid cache", () => {
        const spy = spyPlayer();
        playingBotReach(
            lockWith([row({})], "sha256:bot"),
            "sha256:bot",
            spy.play,
            {
                replay: true,
            }
        ).verdictFor(BEAR_ID, BEAR_DEF);
        expect(spy.calls).toEqual([BEAR_ID]);
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

    it("has nothing for a changed definition — the lockfile is stale", () => {
        const source = carriedBotReach(lockWith([row({})], "sha256:x"));
        expect(
            source.verdictFor(BEAR_ID, {
                ...BEAR_DEF,
                power: 3,
            } as CompiledDefinition)
        ).toBeUndefined();
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
        expect(lock.header.counts.quarantine).toBe(1);
        expect(lock.formats.premodern.quarantine).toBe(1);
    });

    it("ignored ships the card and yields a Bot Gap row", () => {
        expect(bolt.state).toBe("ready");
        expect(bolt.botReach).toBe("ignored");
        expect(bolt.quarantineReasons).toBeUndefined();
        expect(lock.header.counts.ready).toBe(1);
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
        expect(bare.header.counts.ready).toBe(2);
        expect(bare.botGaps).toEqual([]);
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
        expect(driver).toContain('await import("../convex/gre/ai/botReach")');
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
        const driver = readFileSync(
            join(ROOT, "scripts", "oracle-compile.ts"),
            "utf8"
        );
        expect(driver).toMatch(
            /check \|\| carry \? null : await sweepingBotReach/
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
