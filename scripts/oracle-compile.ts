#!/usr/bin/env bun
/**
 * `bun run oracle:compile` — compile the pinned Oracle corpus into
 * `data/oracle-compiled.json`.
 *
 * Deterministic by construction: the corpus rows are sorted by oracle id when
 * the cache is written, the fragment table is sorted by
 * (cards desc, text asc, reason asc, attribution asc) — the full intern key, so the order is
 * total and never rests on sort stability — and the serializer emits one row
 * per line with a fixed key order. Two runs on
 * the same tree and the same corpus are byte-identical — asserted in
 * `scripts/__tests__/oracle-compile.test.ts`.
 *
 * Usage:
 *   bun scripts/oracle-compile.ts            # regenerate the lockfile
 *   bun scripts/oracle-compile.ts --check    # regenerate into memory and diff
 *   bun scripts/oracle-compile.ts --replay-bot   # re-play every `ready` card
 *
 * The write path also runs the Bot-play sweep (ADR 0105 § 7.2, issue #3830):
 * every card that compiles `ready` is played by the Bot at both seats
 * (`convex/gre/ai/botReach.ts`), incrementally — a verdict is reused while its
 * definition and the Bot hash are unchanged (`lib/oracle-bot-reach.ts`).
 * `--check` never plays; it carries the committed verdicts forward.
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
    Attribution,
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
import {
    readCorpus,
    readPin,
    REPORTED_FORMATS,
    type CorpusCard,
} from "./oracle-corpus";
import {
    compilerHash,
    LOCKFILE_GENERATOR,
    POOL_PROJECTION_SOURCE,
    poolHash,
    registryHash,
    serializeLockfile,
    type CardRow,
    type FragmentRow,
    type Lockfile,
} from "./lib/oracle-lockfile";
import {
    botGapKey,
    botHash,
    carriedBotReach,
    playingBotReach,
    rankBotGaps,
    type BotReachSource,
} from "./lib/oracle-bot-reach";
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

/** An attribution as one intern/sort key — `""` when there is none. */
function attributionKey(attribution: Attribution | undefined): string {
    return attribution === undefined
        ? ""
        : [attribution.slot, ...attribution.path, attribution.span].join(
              "\u0001"
          );
}

/** The card's `poolIn`, as a row fragment — omitted when empty. */
function poolOf(card: CorpusCard): { poolIn?: CorpusCard["poolIn"] } {
    return card.poolIn.length > 0 ? { poolIn: card.poolIn } : {};
}

interface MutableFormatRow {
    total: number;
    ready: number;
    quarantine: number;
    unparsed: number;
    pool: number;
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
}

export function buildLockfile(
    corpus: readonly CorpusCard[],
    options: BuildLockfileOptions = {}
): Lockfile {
    const { botReach } = options;
    const pin = readPin();
    if (pin === null) {
        throw new Error(
            "data/oracle-corpus.pin.json missing — run: bun run oracle:corpus"
        );
    }
    const pool = poolOracleIds();
    const retirements = readRetirementLedger();

    // Fragment table: dedupe by the unconsumed line, count the CARDS it blocks.
    //
    // U+0000 as the join: it cannot occur in Oracle text, so the key is
    // unambiguous. Escaped rather than literal — a raw control byte in source
    // makes the whole FILE binary to git and grep, which took this driver out
    // of `gh pr diff` entirely.
    //
    // The attribution is part of the key: the same line can fail at a
    // different place on a different card (the slot guards read the type
    // line), and folding the two would credit one card's gap to the other.
    const gapKey = (gap: Gap): string =>
        `${gap.fragment}\u0000${gap.reason}\u0000${attributionKey(gap.attribution)}`;
    const fragmentIndex = new Map<string, number>();
    const fragmentOrder: {
        text: string;
        reason: string;
        cards: number;
        attribution?: Attribution;
    }[] = [];
    /** Callers MUST call this at most once per (card, fragment) — see below. */
    const internFragment = (gap: Gap): number => {
        const key = gapKey(gap);
        const seen = fragmentIndex.get(key);
        if (seen !== undefined) {
            fragmentOrder[seen]!.cards += 1;
            return seen;
        }
        const index = fragmentOrder.length;
        fragmentOrder.push({
            text: gap.fragment,
            reason: gap.reason,
            cards: 1,
            ...(gap.attribution !== undefined
                ? { attribution: gap.attribution }
                : {}),
        });
        fragmentIndex.set(key, index);
        return index;
    };

    const rawRows: CardRow[] = [];
    const counts: Record<CompileState, number> = {
        ready: 0,
        quarantine: 0,
        unparsed: 0,
    };
    const formats: Record<string, MutableFormatRow> = Object.fromEntries(
        REPORTED_FORMATS.map((f) => [
            f,
            { total: 0, ready: 0, quarantine: 0, unparsed: 0, pool: 0 },
        ])
    );

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
        counts[state] += 1;
        for (const format of card.legalIn) {
            const row = formats[format]!;
            row.total += 1;
            row[state] += 1;
            if (pool.has(card.oracleId)) row.pool += 1;
        }
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
                gaps: [...distinctGaps.values()].map(internFragment),
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

    // The fragment table is sorted by blast radius — this IS the backlog that
    // ranks the next grammar rule (PRD #2693 user story 9). Ties break on the
    // rest of the INTERN KEY — text, then reason — so the order is total. Text
    // alone is not: a row is (text, reason), and 12 texts in the shipped corpus
    // carry two reasons, 7 of those pairs tying on `cards` as well. Their order
    // would otherwise rest on `Array.prototype.sort` stability over insertion
    // order, which is an accidental guarantee, not a deterministic one.
    const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    const sortedFragments = fragmentOrder
        .map((f, index) => ({ ...f, index }))
        .sort(
            (a, b) =>
                b.cards - a.cards ||
                cmp(a.text, b.text) ||
                cmp(a.reason, b.reason) ||
                cmp(
                    attributionKey(a.attribution),
                    attributionKey(b.attribution)
                )
        );
    const remap = new Map<number, number>();
    sortedFragments.forEach((f, newIndex) => remap.set(f.index, newIndex));
    const fragments: FragmentRow[] = sortedFragments.map((f) => ({
        text: f.text,
        reason: f.reason,
        cards: f.cards,
        ...(f.attribution !== undefined ? { attribution: f.attribution } : {}),
    }));
    // No dedupe here: the row's gap indexes are already distinct (deduped at
    // intern time) and `remap` is a bijection. Deduping again would only hide a
    // regression in the counting from the rows that are supposed to prove it.
    const remapped: CardRow[] = rawRows.map((row) =>
        row.gaps === undefined
            ? row
            : {
                  ...row,
                  gaps: row.gaps
                      .map((g) => remap.get(g)!)
                      .sort((a, b) => a - b),
              }
    );
    // Last, so `retired` is the final key of every marked row and marking a
    // card touches exactly that one row's bytes.
    const cards: CardRow[] = stampRetirements(remapped, retirements);

    return {
        generator: LOCKFILE_GENERATOR,
        header: {
            grammarVersion: GRAMMAR_VERSION,
            compilerHash: compilerHash(ROOT),
            registryHash: registryHash(),
            botHash: botReach?.hash ?? "",
            poolHash: poolHash(pool),
            corpus: pin,
            counts: { ...counts, total: corpus.length },
        },
        formats: formats as Lockfile["formats"],
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
 * The write path's Bot-play source (ADR 0105 § 7.2). The Bot is imported
 * HERE, dynamically, and nowhere else in this file: `buildLockfile` is also
 * the drift guard's regenerator (`check-oracle-lockfile.ts`, inside
 * `check:pr` / `land`), and a static import would put the whole search in
 * the gate's module graph for a path that must never play.
 */
async function sweepingBotReach(
    previous: Lockfile | null,
    replay: boolean
): Promise<ReturnType<typeof playingBotReach>> {
    const { playBotReach } = await import("../convex/gre/ai/botReach");
    const { preloadDefinitions } = await import("../convex/cards/registry");
    const started = Date.now();
    return playingBotReach(
        previous,
        botHash(ROOT),
        (oracleId, definition) => {
            // A compiled definition is not a catalogue card: registered by id
            // for the play, through the batch seam so an inset or split
            // card's twins are registered with it.
            const def = {
                ...definition,
                id: `oracle-bot-reach:${oracleId}`,
                rarity: "common",
            } as CardDefinition;
            preloadDefinitions([def]);
            try {
                return playBotReach(def);
            } catch (error) {
                // A throw here is the SWEEP failing, never the card: without
                // this catch it unwinds through `buildLockfile` to `main`,
                // nothing is written, and the whole 21-minute run is lost
                // with every verdict it had already earned (review of
                // PR #4057, finding 7). Ship the card, rank the shape.
                return {
                    outcome: "ignored",
                    cause: "harness-error",
                    form:
                        error instanceof Error
                            ? error.message.slice(0, 120)
                            : String(error).slice(0, 120),
                };
            }
        },
        {
            replay,
            onPlay: () => {
                const s = Math.round((Date.now() - started) / 1000);
                process.stderr.write(`\roracle:compile — bot-play sweep ${s}s`);
            },
        }
    );
}

async function main(): Promise<void> {
    const check = process.argv.includes("--check");
    const replay = process.argv.includes("--replay-bot");
    const previous = readCommittedLockfile();
    // `--check` never plays: it is the drift guard's question, asked from a
    // script (ADR 0105 § 7.2 — the sweep never runs inside a gate).
    const sweep = check ? null : await sweepingBotReach(previous, replay);
    const source = sweep ?? carriedBotReach(previous);
    const text = serializeLockfile(
        buildLockfile(readCorpus(), { botReach: source })
    );
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
    const playedNow = sweep?.played() ?? 0;
    process.stderr.write(
        `\noracle:compile — ${lock.header.counts.total} cards: ` +
            `${lock.header.counts.ready} ready, ${lock.header.counts.quarantine} quarantine, ` +
            `${lock.header.counts.unparsed} unparsed -> data/oracle-compiled.json\n` +
            `oracle:compile — bot reach: ${reach.played} played, ${reach.ignored} ignored, ` +
            `${reach.frozen} frozen (${playedNow} played this run, the rest cached); ` +
            `${lock.botGaps.length} Bot Gaps\n`
    );
}

if (import.meta.main) {
    await main();
}
