#!/usr/bin/env bun
/**
 * `bun run oracle:compile` — compile the pinned Oracle corpus into
 * `data/oracle-compiled.json`.
 *
 * Deterministic by construction: the corpus rows are sorted by oracle id when
 * the cache is written, the fragment table is sorted by
 * (cards desc, text asc, reason asc) — the full intern key, so the order is
 * total and never rests on sort stability — and the serializer emits one row
 * per line with a fixed key order. Two runs on
 * the same tree and the same corpus are byte-identical — asserted in
 * `scripts/__tests__/oracle-compile.test.ts`.
 *
 * Usage:
 *   bun scripts/oracle-compile.ts            # regenerate the lockfile
 *   bun scripts/oracle-compile.ts --check    # regenerate into memory and diff
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileCard } from "../convex/oracle/compile";
import type { CompileState, Gap, OracleCard } from "../convex/oracle/types";
import { GRAMMAR_VERSION } from "../convex/oracle/version";
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
    };
}

interface MutableFormatRow {
    total: number;
    ready: number;
    quarantine: number;
    unparsed: number;
    pool: number;
}

export function buildLockfile(corpus: readonly CorpusCard[]): Lockfile {
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
    const gapKey = (gap: Gap): string => `${gap.fragment}\u0000${gap.reason}`;
    const fragmentIndex = new Map<string, number>();
    const fragmentOrder: { text: string; reason: string; cards: number }[] = [];
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
        counts[outcome.state] += 1;
        for (const format of card.legalIn) {
            const row = formats[format]!;
            row.total += 1;
            row[outcome.state] += 1;
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
                gaps: [...distinctGaps.values()].map(internFragment),
            });
        } else {
            rawRows.push({
                oracleId: card.oracleId,
                name: card.name,
                state: outcome.state,
                slots: outcome.slots,
                opsUsed: outcome.opsUsed,
                ...(outcome.state === "quarantine"
                    ? { quarantineReasons: outcome.reasons }
                    : {}),
                definition: outcome.definition,
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
                cmp(a.reason, b.reason)
        );
    const remap = new Map<number, number>();
    sortedFragments.forEach((f, newIndex) => remap.set(f.index, newIndex));
    const fragments: FragmentRow[] = sortedFragments.map((f) => ({
        text: f.text,
        reason: f.reason,
        cards: f.cards,
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
            poolHash: poolHash(pool),
            corpus: pin,
            counts: { ...counts, total: corpus.length },
        },
        formats: formats as Lockfile["formats"],
        fragments,
        cards,
    };
}

async function main(): Promise<void> {
    const check = process.argv.includes("--check");
    const text = serializeLockfile(buildLockfile(readCorpus()));
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
    process.stderr.write(
        `oracle:compile — ${lock.header.counts.total} cards: ` +
            `${lock.header.counts.ready} ready, ${lock.header.counts.quarantine} quarantine, ` +
            `${lock.header.counts.unparsed} unparsed -> data/oracle-compiled.json\n`
    );
}

if (import.meta.main) {
    await main();
}
