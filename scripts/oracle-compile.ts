#!/usr/bin/env bun
/**
 * `bun run oracle:compile` — compile the pinned Oracle corpus into
 * `data/oracle-compiled.json`.
 *
 * Deterministic by construction: the corpus rows are sorted by oracle id when
 * the cache is written, the fragment table is sorted by
 * (text asc, reason asc, attribution asc) — the full intern key, so the order
 * is total and never rests on sort stability — a row cites its fragments by
 * content-derived Fragment Key, and the serializer emits one
 * row per line with a fixed key order. Two runs on
 * the same tree and the same corpus are byte-identical — asserted in
 * `scripts/__tests__/oracle-compile.test.ts`.
 *
 * Usage:
 *   bun scripts/oracle-compile.ts            # regenerate the lockfile
 *   bun scripts/oracle-compile.ts --check    # regenerate into memory and diff
 *   bun scripts/oracle-compile.ts --replay-bot   # re-play every `ready` card
 *   bun scripts/oracle-compile.ts --carry-bot    # write, never play (`land`)
 *   bun scripts/oracle-compile.ts --carry-bot --replay-card <name>
 *                                    # carry, play only <name> (repeatable)
 *
 * The write path also runs the Bot-play sweep (ADR 0105 § 7.2, issue #3830):
 * every card that compiles `ready` is played by the Bot at both seats
 * (`convex/gre/ai/botReach.ts`), incrementally — a verdict is reused while its
 * definition is unchanged (`lib/oracle-bot-reach.ts`). A bare run is
 * SESSION-SCOPED: it plays only the definition misses (a
 * changed definition, a card newly `ready`, a `ready` card with no verdict)
 * and keeps the committed Bot hash in the header; a Bot hash that moved is
 * never a reason to replay the catalogue here — that whole replay is
 * `--replay-bot`, run on the base by `derive:sync --replay-bot` once per Bot
 * change. `--check` never plays; it carries the committed verdicts forward.
 * A bare run first counts its cache misses with no lock: zero
 * misses → it writes the carried lockfile and never queues; up to
 * `LOCK_FREE_MISSES` → it plays them in place, like `--replay-card` does
 * (seconds, not a sweep); more → it takes the heavy gate's mutex (`gate.ts
 * job`) and plays only the misses. `--replay-bot` always takes
 * the mutex; `--check` and `--carry-bot` take nothing.
 *
 * A card the sweep turns `frozen` moves out of `ready`, and the `ready` set is
 * what `data/oracle-compiled-pool.json` and `data/card-index.json` are built
 * from — so a run whose `frozen` count CHANGES owes `bun run oracle:pool` and
 * a green `bun run check:index` before it lands (review of PR #4057,
 * finding 10).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileCard } from "../convex/oracle/compile";
import type {
    CompileState,
    Gap,
    OracleCard,
    QuarantineReason,
} from "../convex/oracle/types";
import { GRAMMAR_VERSION } from "../convex/oracle/version";
import type { CardDefinition } from "../convex/cards/types";
// PURE over a definition, and free of the search — see its header for why the
// gate may import it and why the Bot hash excludes it.
import { castShape } from "../convex/gre/ai/botReachForm";
import { readCorpus, readPin, type CorpusCard } from "./oracle-corpus";
import {
    compareFragmentContent,
    compilerHash,
    fragmentIdentity,
    fragmentKey,
    fragmentRow,
    LOCKFILE_GENERATOR,
    POOL_PROJECTION_SOURCE,
    poolHash,
    registryHash,
    serializeLockfile,
    type CardRow,
    type FragmentContent,
    type FragmentRow,
    type Lockfile,
} from "./lib/oracle-lockfile";
import { deriveCounts } from "./lib/oracle-tally";
import {
    botGapKey,
    botHash,
    carriedBotReach,
    playingBotReach,
    probingBotReach,
    rankBotGaps,
    replayingCardsBotReach,
    resolveReplayCards,
    type BotReachSource,
} from "./lib/oracle-bot-reach";
import { runUnderHeavyAdmission } from "./lib/heavy-admission";
import { createBotPlayer } from "./lib/bot-reach-player";
import { playMisses, sweepWorkerCount } from "./lib/bot-reach-shard";
import {
    emptyRetirementLedger,
    parseRetirementLedger,
    retirementMarkers,
    validateRetirementLedger,
    RETIREMENT_LEDGER_PATH,
    type RetirementLedger,
} from "./lib/oracle-retirements";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
export const LOCKFILE_PATH = join(ROOT, "data", "oracle-compiled.json");
const CARD_INDEX_PATH = join(ROOT, POOL_PROJECTION_SOURCE);

/** Oracle ids already covered by a hand-written definition (the current
 *  pool) — feeds the committed per-format `pool` metric (PRD #2693 M1
 *  progress). A `source: "compiled"` row is this very compiler's own output
 *  (#2702), not a hand-written implementation; counting it here would let
 *  the compiler inflate its own progress metric on every re-run. Exported
 *  (pure, over an in-memory index) so that guarantee has a unit test. */
export function poolOracleIdsFromIndex(
    index: readonly { oracleId?: string; source?: string }[]
): Set<string> {
    return new Set(
        index
            .filter((e) => e.source !== "compiled")
            .map((e) => e.oracleId)
            .filter((id): id is string => typeof id === "string")
    );
}

/**
 * The pool projection as the compiler sees it, read from disk.
 *
 * Exported so `check-oracle-lockfile.ts` reads the card index through THIS
 * reader rather than a second copy of it: the guard compares a hash of this
 * value against the header, and two readers that can disagree about the path
 * or the filter make that comparison meaningless (issue #3068).
 */
export function poolOracleIds(): Set<string> {
    if (!existsSync(CARD_INDEX_PATH)) return new Set();
    const index = JSON.parse(readFileSync(CARD_INDEX_PATH, "utf8")) as {
        oracleId?: string;
        source?: string;
    }[];
    return poolOracleIdsFromIndex(index);
}

const RETIREMENTS_PATH = join(ROOT, RETIREMENT_LEDGER_PATH);

function readRetirementLedger(): RetirementLedger {
    if (!existsSync(RETIREMENTS_PATH)) return emptyRetirementLedger();
    const ledger = parseRetirementLedger(
        readFileSync(RETIREMENTS_PATH, "utf8")
    );
    const problems = validateRetirementLedger(ledger);
    if (problems.length > 0) {
        throw new Error(
            `${RETIREMENT_LEDGER_PATH} is malformed — a marker nobody can trust is worse than no marker:\n` +
                problems.map((p) => `  - ${p}`).join("\n")
        );
    }
    return ledger;
}

/**
 * Stamp the retirement markers onto the rows they name, fail-closed on an
 * entry that names no row.
 *
 * A ledger entry whose `oracleId` is absent from the corpus (a typo, a card
 * dropped by a re-pin) would otherwise stamp NOTHING: the author sees a green
 * compile, believes the card is marked, and the gate that is supposed to make
 * a change to that row reviewed never fires. The name check catches the other
 * half of the same mistake — a real oracle id copied from the wrong card.
 *
 * Pure over the two inputs so both refusals are testable without a corpus.
 */
export function stampRetirements(
    rows: readonly CardRow[],
    ledger: RetirementLedger
): CardRow[] {
    const byId = new Map(rows.map((row) => [row.oracleId, row]));
    for (const entry of ledger.retirements) {
        const row = byId.get(entry.oracleId);
        if (row === undefined) {
            throw new Error(
                `${RETIREMENT_LEDGER_PATH}: no card in the corpus has oracle id ${entry.oracleId} ` +
                    `(${entry.name}) — the retirement marks nothing, so the retired card's row would be unguarded`
            );
        }
        if (row.name !== entry.name) {
            throw new Error(
                `${RETIREMENT_LEDGER_PATH}: oracle id ${entry.oracleId} is "${row.name}" in the corpus, ` +
                    `but the ledger calls it "${entry.name}" — the entry names a different card than it marks`
            );
        }
    }
    const markers = retirementMarkers(ledger);
    return rows.map((row) => {
        const marker = markers.get(row.oracleId);
        return marker === undefined ? row : { ...row, retired: marker };
    });
}

function toOracleCard(card: CorpusCard): OracleCard {
    return {
        oracleId: card.oracleId,
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        power: card.power,
        toughness: card.toughness,
        loyalty: card.loyalty,
        layout: card.layout,
        // CR 715 / 722 (ADR 0120 §5) — the corpus reducer has produced
        // `card_faces` since before anything consumed it. Threading it here is
        // what makes `SUPPORTED_INSET_LAYOUTS` reachable from the corpus rather
        // than only from the gold harness's synthetic input.
        ...(card.faces ? { faces: card.faces } : {}),
    };
}

/** The card's `poolIn`, as a row fragment — omitted when empty. */
function poolOf(card: CorpusCard): {
    poolIn?: CorpusCard["poolIn"];
    bannedIn?: CorpusCard["poolIn"];
} {
    const bannedIn = card.poolIn.filter((f) => !card.legalIn.includes(f));
    return {
        ...(card.poolIn.length > 0 ? { poolIn: card.poolIn } : {}),
        ...(bannedIn.length > 0 ? { bannedIn } : {}),
    };
}

export interface BuildLockfileOptions {
    /**
     * Where a `ready` card's Bot-play verdict comes from (ADR 0105 § 7.2,
     * issue #3830). Omitted, no row carries one and the header's Bot hash is
     * empty — the compiler alone. The write path passes a source that PLAYS
     * (`playingBotReach`); the drift guard passes one that only carries the
     * committed verdicts forward (`carriedBotReach`), so the gate never plays.
     */
    readonly botReach?: BotReachSource;
    /**
     * The retirement ledger `stampRetirements` marks rows against. Omitted,
     * reads the committed `data/oracle-retirements.json` — the real write and
     * drift-guard paths. A test building a SYNTHETIC corpus passes
     * `emptyRetirementLedger()` (or its own fixture ledger) so a real,
     * globally-retired card's oracle id — absent from the synthetic corpus by
     * construction — cannot fail `stampRetirements`'s unguarded-row refusal
     * (issue #4027 exposed this: the ledger was empty until that PR).
     */
    readonly retirements?: RetirementLedger;
    /**
     * The Fragment Key function. Omitted, `fragmentKey` — the only value the
     * write and drift-guard paths use. A test passes a coarser one to reach
     * the collision refusal below, which 48 bits never reach on a real
     * corpus (issue #6169).
     */
    readonly fragmentKey?: (fragment: FragmentContent) => string;
}

export function buildLockfile(
    corpus: readonly CorpusCard[],
    options: BuildLockfileOptions = {}
): Lockfile {
    const { botReach } = options;
    const keyOf = options.fragmentKey ?? fragmentKey;
    const pin = readPin();
    if (pin === null) {
        throw new Error(
            "data/oracle-corpus.pin.json missing — run: bun run oracle:corpus"
        );
    }
    const pool = poolOracleIds();
    const retirements = options.retirements ?? readRetirementLedger();

    // Fragment table: dedupe by the unconsumed line, count the CARDS it blocks.
    // A row cites each fragment by its Fragment Key (issue #6169), never by
    // its place in the table — see `lib/oracle-lockfile.ts`.
    const contentOf = (gap: Gap): FragmentContent => ({
        text: gap.fragment,
        reason: gap.reason,
        ...(gap.attribution !== undefined
            ? { attribution: gap.attribution }
            : {}),
    });
    const gapKey = (gap: Gap): string => fragmentIdentity(contentOf(gap));
    const fragmentsByKey = new Map<
        string,
        {
            key: string;
            identity: string;
            row: FragmentContent & { cards: number };
        }
    >();
    /** Callers MUST call this at most once per (card, fragment) — see below. */
    const internFragment = (gap: Gap): string => {
        const content = contentOf(gap);
        const identity = fragmentIdentity(content);
        const key = keyOf(content);
        const seen = fragmentsByKey.get(key);
        if (seen === undefined) {
            fragmentsByKey.set(key, {
                key,
                identity,
                row: { ...content, cards: 1 },
            });
        } else if (seen.identity === identity) {
            seen.row.cards += 1;
        } else {
            // Two fragments, one key: citing it would credit one fragment's
            // cards to the other. Never merge them — lengthen the key.
            throw new Error(
                `oracle:compile: fragments ${JSON.stringify(seen.row.text)} and ${JSON.stringify(content.text)} ` +
                    `share the Fragment Key ${key} — raise FRAGMENT_KEY_HEX in scripts/lib/oracle-lockfile.ts`
            );
        }
        return key;
    };

    const rawRows: CardRow[] = [];

    for (const card of corpus) {
        const outcome = compileCard(toOracleCard(card));
        // ADR 0105 § 7.2 — every card that reaches `ready` is played by the
        // Bot; a `frozen` one is withheld (`bot-unreachable`), an `ignored`
        // one ships and counts toward a Bot Gap. Decided BEFORE the tallies,
        // because a withheld card is a quarantined card in every count.
        const verdict =
            outcome.state === "ready"
                ? botReach?.verdictFor(card.oracleId, outcome.definition)
                : undefined;
        const gap =
            verdict !== undefined && outcome.state !== "unparsed"
                ? botGapKey(
                      verdict,
                      outcome.opsUsed,
                      castShape({
                          ...outcome.definition,
                          id: card.oracleId,
                          rarity: "common",
                      } as CardDefinition)
                  )
                : undefined;
        const state: CompileState =
            verdict?.outcome === "frozen" ? "quarantine" : outcome.state;
        if (outcome.state === "unparsed") {
            // `cards` is the blast radius that ranks the grammar backlog (PRD
            // #2693 user story 9, and #2697–#2700 are prioritised off it), so a
            // card tripping the SAME fragment on two lines must count ONCE.
            // Dedupe BEFORE interning: the counter lives in `internFragment`,
            // so deduping the row afterwards leaves the count overstated while
            // the row itself looks right — the shape that shipped 3 wrong rows,
            // one declaring 5 cards blocked where it blocks 3.
            const distinctGaps = new Map<string, Gap>();
            for (const gap of outcome.gaps) distinctGaps.set(gapKey(gap), gap);
            rawRows.push({
                oracleId: card.oracleId,
                name: card.name,
                state: "unparsed",
                ...poolOf(card),
                // Sorted by key: content-derived, so the row's bytes move
                // only when its own fragments do.
                gaps: [...distinctGaps.values()].map(internFragment).sort(),
            });
        } else {
            const reasons: readonly QuarantineReason[] | undefined =
                outcome.state === "quarantine"
                    ? outcome.reasons
                    : state === "quarantine"
                      ? [{ kind: "bot-unreachable", detail: gap ?? "" }]
                      : undefined;
            rawRows.push({
                oracleId: card.oracleId,
                name: card.name,
                state,
                ...poolOf(card),
                slots: outcome.slots,
                opsUsed: outcome.opsUsed,
                ...(reasons !== undefined
                    ? { quarantineReasons: reasons }
                    : {}),
                definition: outcome.definition,
                ...(verdict !== undefined ? { botReach: verdict.outcome } : {}),
                ...(gap !== undefined ? { botGap: gap } : {}),
            });
        }
    }

    // Sorted by CONTENT, never by blast radius (issue #6169): a fragment's
    // line then stays where it is when its `cards` moves, so a grammar PR's
    // diff is the rows whose meaning changed. The backlog's rank order is
    // `compareFragmentRank`, which every reader meets through
    // `indexFragments`.
    const fragments: FragmentRow[] = [...fragmentsByKey.values()]
        .map(({ key, row }) => fragmentRow(row, key))
        .sort(compareFragmentContent);
    // Last, so `retired` is the final key of every marked row and marking a
    // card touches exactly that one row's bytes.
    const cards: CardRow[] = stampRetirements(rawRows, retirements);

    return {
        generator: LOCKFILE_GENERATOR,
        header: {
            grammarVersion: GRAMMAR_VERSION,
            compilerHash: compilerHash(ROOT),
            registryHash: registryHash(),
            botHash: botReach?.hash ?? "",
            poolHash: poolHash(pool),
            corpus: pin,
        },
        fragments,
        botGaps: rankBotGaps(cards),
        cards,
    };
}

/** The committed lockfile — the Bot-play cache — or null on a first run. */
export function readCommittedLockfile(): Lockfile | null {
    return existsSync(LOCKFILE_PATH)
        ? (JSON.parse(readFileSync(LOCKFILE_PATH, "utf8")) as Lockfile)
        : null;
}

/**
 * The Bot-play player (ADR 0105 § 7.2): `lib/bot-reach-player.ts`, whose
 * dynamic import of the Bot keeps it out of `buildLockfile`'s module graph —
 * the drift guard's regenerator must never be able to play. Used in place by
 * `--replay-card`; the sweep plays through the shard pool.
 */
const botPlayer = createBotPlayer;

/**
 * The write path's sweep (issue #6686, ADR 0158 § 1): a collecting pass
 * learns which definitions miss the cache, the shard pool plays them over `W`
 * worker threads, and the source handed back reads their verdicts — through
 * {@link playingBotReach}, so the cache rules, the header hash and the
 * `played` count are the in-process sweep's own. The lockfile is built by
 * walking the corpus, never the verdict map: its bytes do not depend on `W`.
 */
async function sweepingBotReach(
    previous: Lockfile | null,
    replay: boolean,
    build: (source: BotReachSource) => unknown,
    options: { workers?: number; playerModule?: string } = {}
): Promise<ReturnType<typeof playingBotReach>> {
    const started = Date.now();
    const currentBotHash = botHash(ROOT);
    const probe = probingBotReach(previous, currentBotHash, replay);
    build(probe);
    const verdicts = await playMisses(probe.missDefinitions(), {
        workers: options.workers ?? sweepWorkerCount(process.env),
        playerModule: options.playerModule,
        onPlay: () => {
            const s = Math.round((Date.now() - started) / 1000);
            process.stderr.write(`\roracle:compile — bot-play sweep ${s}s`);
        },
    });
    return playingBotReach(
        previous,
        currentBotHash,
        (oracleId) => verdicts.get(oracleId)!,
        { replay }
    );
}

/**
 * How many definition misses a bare run plays WITHOUT the heavy mutex (issue
 * #6463). A play is hundreds of ms (6,500 cards in 20–40 min ≈ 0.2–0.4 s
 * each), so 25 misses are 5–10 s — the cost of a light gate step, and the
 * shape `--carry-bot --replay-card` already runs lock-free. A grammar
 * session's bare compile today is 0–20 misses (the cards its rule
 * graduated); a re-pin or a rule graduating a whole form goes over, and
 * queues like a sweep.
 */
export const LOCK_FREE_MISSES = 25;

/**
 * The bare / `--replay-bot` write path (issue #6069): the heavy mutex only
 * when there is enough to play. A bare run probes the cache first — a
 * compile, seconds, no lock — and with zero misses returns the probe's
 * lockfile, which is the one the sweep would write. Up to `lockFreeMisses`
 * misses are played in place (issue #6463); more (or a replay, which ignores
 * the cache) wait on `admit`; a non-null code means the run was re-executed
 * under the mutex and that child's exit code is the run's. The child probes
 * again after acquiring, so a lockfile that moved during the wait is read
 * fresh, and the sweep plays exactly the misses.
 */
export async function sweepWhenMissing(options: {
    readonly previous: Lockfile | null;
    readonly currentBotHash: string;
    readonly replay: boolean;
    readonly build: (source: BotReachSource) => string;
    readonly admit: () => Promise<number | null>;
    readonly sweep: () => Promise<BotReachSource & { played: () => number }>;
    readonly lockFreeMisses?: number;
}): Promise<{ exit: number } | { text: string; played: number }> {
    let misses = Number.POSITIVE_INFINITY;
    if (!options.replay) {
        const probe = probingBotReach(options.previous, options.currentBotHash);
        const text = options.build(probe);
        misses = probe.misses().size;
        if (misses === 0) return { text, played: 0 };
    }
    if (misses > (options.lockFreeMisses ?? LOCK_FREE_MISSES)) {
        const code = await options.admit();
        if (code !== null) return { exit: code };
    }
    const sweep = await options.sweep();
    return { text: options.build(sweep), played: sweep.played() };
}

/**
 * `--replay-card`'s source over the corpus: refuses an unknown name before
 * anything plays, and — once the lockfile is built — a named card the build
 * never offered to the Bot (it did not compile `ready`), so a replay never
 * reports success for a card it did not play.
 */
async function replayingNamedCards(
    previous: Lockfile | null,
    corpus: readonly CorpusCard[],
    names: readonly string[]
): Promise<{
    source: ReturnType<typeof replayingCardsBotReach>;
    refuseUnplayed: () => void;
}> {
    const { ids, unknown } = resolveReplayCards(corpus, names);
    if (unknown.length > 0) {
        process.stderr.write(
            `oracle:compile — --replay-card: no corpus card named ${unknown
                .map((n) => JSON.stringify(n))
                .join(", ")}\n`
        );
        process.exit(1);
    }
    const source = replayingCardsBotReach(previous, ids, await botPlayer());
    const nameOf = new Map(corpus.map((c) => [c.oracleId, c.name]));
    return {
        source,
        refuseUnplayed: () => {
            const unplayed = [...ids].filter(
                (id) => !source.playedIds().has(id)
            );
            if (unplayed.length === 0) return;
            process.stderr.write(
                `oracle:compile — --replay-card: did not compile ready, ` +
                    `nothing to play: ${unplayed
                        .map((id) => JSON.stringify(nameOf.get(id)))
                        .join(", ")} (lockfile not written)\n`
            );
            process.exit(1);
        },
    };
}

/** Every `--replay-card <name>` / `--replay-card=<name>` value, in argv
 *  order (issue #4957). A spelling it cannot read is refused, never dropped:
 *  a dropped name would carry everything and exit 0 having played nothing. */
function replayCardNames(argv: readonly string[]): string[] {
    const names: string[] = [];
    const refuse = (why: string): never => {
        process.stderr.write(`oracle:compile — --replay-card ${why}\n`);
        process.exit(2);
    };
    argv.forEach((arg, i) => {
        if (arg === "--replay-card") {
            const name = argv[i + 1];
            if (name === undefined || name.startsWith("--"))
                refuse("needs a card name");
            names.push(name!);
        } else if (arg.startsWith("--replay-card=")) {
            const name = arg.slice("--replay-card=".length);
            if (name === "") refuse("needs a card name");
            names.push(name);
        } else if (arg.startsWith("--replay-card")) {
            refuse(`— unknown flag ${JSON.stringify(arg)}`);
        }
    });
    return names;
}

async function main(): Promise<void> {
    const check = process.argv.includes("--check");
    const replay = process.argv.includes("--replay-bot");
    // `--carry-bot` WRITES the lockfile without playing: the committed
    // verdicts are carried forward on unchanged definitions, a changed one is
    // left unswept. What `land`'s artifact resolver runs (ADR 0105 § 7.2).
    const carry = process.argv.includes("--carry-bot");
    // `--carry-bot --replay-card <name>` (repeatable, issue #4957): carry
    // every verdict, PLAY only the named cards. A handful of plays, not a
    // sweep, so it does not queue for the heavy mutex either.
    const replayNames = replayCardNames(process.argv.slice(2));
    if (replayNames.length > 0 && (!carry || check || replay)) {
        process.stderr.write(
            "oracle:compile — --replay-card runs only with --carry-bot " +
                "(and without --check / --replay-bot)\n"
        );
        process.exit(2);
    }
    const previous = readCommittedLockfile();
    // Read on first use: a `--replay-bot` run queues for the mutex before it
    // touches the corpus, as it did before the probe existed (issue #6069).
    let corpusRead: readonly CorpusCard[] | null = null;
    const corpus = () => (corpusRead ??= readCorpus());
    const build = (source: BotReachSource) =>
        serializeLockfile(buildLockfile(corpus(), { botReach: source }));
    // The sweep is heavy work (mean 28 min, issue #4941): a run that will play
    // waits for the heavy gate's mutex instead of racing a `land` — but only
    // once it knows it has more than a handful of misses to play (issues
    // #6069, #6463). `--check` never plays: it is the drift guard's question,
    // asked from a script (ADR 0105 § 7.2 — the sweep never runs inside a
    // gate); `--carry-bot` never queues.
    const swept =
        check || carry
            ? null
            : await sweepWhenMissing({
                  previous,
                  currentBotHash: botHash(ROOT),
                  replay,
                  build,
                  admit: () =>
                      runUnderHeavyAdmission(
                          process.argv[1],
                          process.argv.slice(2)
                      ),
                  sweep: () =>
                      sweepingBotReach(previous, replay, (source) =>
                          buildLockfile(corpus(), { botReach: source })
                      ),
              });
    if (swept !== null && "exit" in swept) process.exit(swept.exit);
    const narrowed =
        replayNames.length > 0
            ? await replayingNamedCards(previous, corpus(), replayNames)
            : null;
    const text =
        swept?.text ?? build(narrowed?.source ?? carriedBotReach(previous));
    if (narrowed !== null) narrowed.refuseUnplayed();
    if (check) {
        const current = existsSync(LOCKFILE_PATH)
            ? readFileSync(LOCKFILE_PATH, "utf8")
            : "";
        if (current !== text) {
            process.stderr.write(
                "oracle:compile --check — lockfile is stale\n"
            );
            process.exit(1);
        }
        process.stderr.write("oracle:compile --check — lockfile is current\n");
        return;
    }
    writeFileSync(LOCKFILE_PATH, text);
    const lock = JSON.parse(text) as Lockfile;
    const reach = { played: 0, ignored: 0, frozen: 0 };
    for (const row of lock.cards) if (row.botReach) reach[row.botReach] += 1;
    const playedNow = swept?.played ?? narrowed?.source.playedIds().size ?? 0;
    const counts = deriveCounts(lock.cards);
    process.stderr.write(
        `\noracle:compile — ${counts.total} cards: ` +
            `${counts.ready} ready, ${counts.quarantine} quarantine, ` +
            `${counts.unparsed} unparsed -> data/oracle-compiled.json\n` +
            `oracle:compile — bot reach: ${reach.played} played, ${reach.ignored} ignored, ` +
            `${reach.frozen} frozen (${playedNow} played this run, the rest cached); ` +
            `${lock.botGaps.length} Bot Gaps\n`
    );
}

if (import.meta.main) {
    await main();
}
