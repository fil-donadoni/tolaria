#!/usr/bin/env bun
/**
 * `bun run oracle:report` — the per-format state of the Oracle compiler.
 *
 * Reads the LOCKFILE, never the corpus. That is deliberate: the lockfile is the
 * committed artefact, so the report is reproducible on a clean checkout with no
 * network and no 24 MB cache, and two people quoting a number are quoting the
 * same run (PRD #2693 user story 6).
 *
 * Usage:
 *   bun scripts/oracle-report.ts               # per-format table + corpus Grammar Gaps
 *   bun scripts/oracle-report.ts --gaps 50     # more of the ranked backlog
 *   bun scripts/oracle-report.ts --set apc     # Grammar Gaps ranked for one set
 *   bun scripts/oracle-report.ts --pool premodern  # … for one format pool
 *   bun scripts/oracle-report.ts --decks       # per-deck, per-card state (M1),
 *                                  # Tier 1 lists + the pinned metagame import
 *   bun scripts/oracle-report.ts --targets [<id>]
 *                                  # every registered Target List (data/targets.json),
 *                                  # card by card in its coverage state, + playable
 *   bun scripts/oracle-report.ts --delta [<ref>]
 *                                  # ready delta per set + corpus against
 *                                  # <ref>'s lockfile (default: origin/<base>)
 *
 * `--set` reads `data/json/<SET>.json` (MTGJSON, committed like the rest of
 * that directory — the file `/new-set` already reads) for the set's oracle
 * ids; `--pool` reads the lockfile's own `poolIn`. Both are offline.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPORTED_FORMATS } from "./oracle-corpus";
import { poolOracleIds } from "./oracle-compile";
import { parseLockfile, type Lockfile } from "./lib/oracle-lockfile";
import { ORIGIN_BASE } from "./lib/branches";
import {
    formatReadyDelta,
    readyDelta,
    type SetMembership,
} from "./lib/oracle-ready-delta";
import {
    CARD_LEVEL,
    poolTarget,
    rankGrammarGaps,
    setTargetFromMtgjson,
    type RankedGap,
} from "./lib/grammar-gaps";
import {
    readTier1Decks,
    summaryLine,
    tier1Reports,
    TIER1_DECKS_PATH,
    type DeckCardRow,
    type DeckCardState,
    PLAYABLE_STATES,
} from "./lib/tier1-decks";
import { readMetagameDecks } from "./premodern-metagame-import";
import {
    COVERAGE_STATES,
    readTargetRegistry,
    resolveContext,
    resolveTarget,
    targetCoverage,
    TARGETS_PATH,
    type CoverageContext,
    type TargetCoverage,
} from "./lib/targets";
import { buildCoverageContext, closureOracleIds } from "./lib/coverage-context";
import { corpusNameIndex } from "./lib/card-names";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const LOCKFILE_PATH = join(ROOT, "data", "oracle-compiled.json");

function pct(n: number, total: number): string {
    return total === 0
        ? "  0.0%"
        : `${((n / total) * 100).toFixed(1).padStart(5)}%`;
}

const BLOCKER_COLUMN = 54;

/** `unparsed  3x  Gempalm Incinerator   Cycling {2}{R} (…)` */
function cardLine(card: DeckCardRow): string {
    const slot = card.slot === "both" ? " (main+side)" : "";
    const head =
        `  ${card.state.padEnd(11)}${`${card.copies}x`.padStart(3)}  ` +
        `${card.name}${slot}`;
    if (card.blocker === undefined) return head;
    const blocker =
        card.blocker.length > 60
            ? `${card.blocker.slice(0, 57)}...`
            : card.blocker;
    return `${head.padEnd(BLOCKER_COLUMN)}${blocker}`;
}

/**
 * The per-deck section (PRD #2693 user story 8): M1's "done" as a checklist,
 * one line per card, so a deck that is not 100% names exactly what is missing.
 */
function reportDecks(lock: ReturnType<typeof parseLockfile>): void {
    const file = readTier1Decks(ROOT);
    const reports = tier1Reports(file, lock, poolOracleIds());

    process.stdout.write(
        `\nPremodern Tier 1 — per-deck card state\n` +
            `lists supplied by the ${file.source.supplier} ${file.source.suppliedOn}, ` +
            `stored verbatim in ${TIER1_DECKS_PATH}\n\n`
    );
    for (const report of reports) {
        process.stdout.write(`${summaryLine(report)}\n`);
    }

    const presets = file.shippedPresets
        .map((p) => `${p.slug} (${p.name})`)
        .join(", ");
    process.stdout.write(
        `\nAlready shipped as Preset Decks, every card hand-written by construction: ${presets}\n` +
            `Their lists live in the \`presetDecks\` table (ADR 0033) and are referenced by slug only —\n` +
            `copying them here would be a second source of truth for a deck an Admin can edit.\n`
    );

    for (const report of reports) {
        process.stdout.write(
            `\n${`${report.slug} — ${report.name}`.padEnd(BLOCKER_COLUMN)}` +
                `${report.playable}/${report.total} ready\n`
        );
        for (const card of report.cards) {
            process.stdout.write(`${cardLine(card)}\n`);
        }
    }
    process.stdout.write("\n");
}

/**
 * The metagame section (issue #3855): the same per-card checklist as the
 * Tier 1 section, over the 25 pinned mtgtop8 archetype lists, plus the
 * UNIQUE-CARD UNION and its ready percentage — the v1 exit threshold's
 * denominator (roadmap map #3846).
 */
function reportMetagame(lock: ReturnType<typeof parseLockfile>): void {
    const file = readMetagameDecks(ROOT);
    const reports = tier1Reports(file, lock, poolOracleIds());

    process.stdout.write(
        `\nPremodern metagame — per-deck card state\n` +
            `25 archetypes pinned from ${file.source.supplier}, stored in data/premodern-metagame-decks.json ` +
            `(provenance: data/premodern-metagame-decks.pin.json)\n\n`
    );
    for (const report of reports) {
        process.stdout.write(`${summaryLine(report)}\n`);
    }

    const union = new Map<string, DeckCardState>();
    for (const report of reports) {
        for (const card of report.cards) union.set(card.oracleId, card.state);
    }
    const unionCounts: Record<DeckCardState, number> = {
        ours: 0,
        ready: 0,
        quarantine: 0,
        unparsed: 0,
    };
    for (const state of union.values()) unionCounts[state] += 1;
    const unionPlayable = PLAYABLE_STATES.reduce(
        (sum, s) => sum + unionCounts[s],
        0
    );
    process.stdout.write(
        `\nunique-card union: ${union.size} cards, ${unionPlayable} ready ` +
            `(${pct(unionPlayable, union.size).trim()}) — ` +
            `${unionCounts.ours} ours, ${unionCounts.ready} ready, ` +
            `${unionCounts.quarantine} quarantine, ${unionCounts.unparsed} unparsed\n`
    );

    for (const report of reports) {
        process.stdout.write(
            `\n${`${report.slug} — ${report.name}`.padEnd(BLOCKER_COLUMN)}` +
                `${report.playable}/${report.total} ready\n`
        );
        for (const card of report.cards) {
            process.stdout.write(`${cardLine(card)}\n`);
        }
    }
    process.stdout.write("\n");
}

/** Every COMMITTED MTGJSON set (`data/json/<SET>.json`), by oracle id — an
 *  untracked snapshot in the working tree would make the rows depend on the
 *  checkout. */
function vendoredSets(): SetMembership[] {
    return execFileSync("git", ["ls-files", "--", "data/json/*.json"], {
        cwd: ROOT,
        encoding: "utf8",
    })
        .split("\n")
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => {
            const set = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as {
                data: {
                    code: string;
                    cards: { identifiers?: { scryfallOracleId?: string } }[];
                };
            };
            const oracleIds = new Set<string>();
            for (const card of set.data.cards) {
                const id = card.identifiers?.scryfallOracleId;
                if (id !== undefined) oracleIds.add(id);
            }
            return { code: set.data.code, oracleIds };
        });
}

/** `  gap-pending   12: Name, Name, …` */
function coverageLines(coverage: TargetCoverage): string {
    const head =
        `${coverage.id}  (${coverage.kind}` +
        (coverage.priority === undefined
            ? ""
            : `, priority ${coverage.priority}`) +
        (coverage.enforced ? ", enforced" : "") +
        `)  ${coverage.total} cards\n` +
        `  ${"playable".padEnd(12)}${`${coverage.playable}/${coverage.total}`.padStart(12)}  ` +
        `${pct(coverage.playable, coverage.total).trim()} — ready or hand-written, the v1 gate\n`;
    const states = COVERAGE_STATES.map((state) => {
        const names = coverage.byState[state];
        return (
            `  ${state.padEnd(12)}${String(names.length).padStart(12)}` +
            (names.length === 0 ? "" : `: ${names.join(", ")}`)
        );
    }).join("\n");
    const migrable =
        coverage.migrable.length === 0
            ? "none"
            : coverage.migrable.map((m) => `${m.name} (${m.why})`).join("; ");
    // Why each card is unclaimed, by the kind of claim it lacks — the
    // difference between "the grammar owes an issue" and "nobody decided".
    const lacking = new Map<string, number>();
    for (const { why } of coverage.unclaimed) {
        const kind = /`(grammar|mechanic|scenario)` claim/.exec(why)?.[1];
        const bucket = kind === undefined ? "hand-tail" : kind;
        lacking.set(bucket, (lacking.get(bucket) ?? 0) + 1);
    }
    const unclaimedWhy =
        lacking.size === 0
            ? ""
            : `  unclaimed, by the claim missing: ${[...lacking]
                  .map(([kind, n]) => `${kind} ${n}`)
                  .join(", ")}\n`;
    const closure =
        coverage.closureCompiles.length === 0
            ? "none"
            : coverage.closureCompiles.join(", ");
    return (
        `${head}${states}\n${unclaimedWhy}` +
        `  hand-tail cards now migrable: ${migrable}\n` +
        `  closure cards whose Oracle text now compiles — compare behaviour by hand: ${closure}\n`
    );
}

/**
 * The Target List section (issue #3867): every registered Target, every card
 * in exactly one coverage state, by name — reporting only; `check:targets`
 * turns `unclaimed` red.
 */
function reportTargets(lock: Lockfile, only: string | undefined): void {
    const registry = readTargetRegistry(ROOT);
    const rows =
        only === undefined
            ? registry.targets
            : registry.targets.filter((row) => row.id === only);
    if (rows.length === 0) {
        process.stderr.write(
            `oracle:report — no Target \`${only}\` in ${TARGETS_PATH} (one of: ` +
                `${registry.targets.map((row) => row.id).join(", ")})\n`
        );
        process.exit(1);
    }
    const resolve = resolveContext(ROOT, lock);
    let ctx: CoverageContext;
    try {
        ctx = buildCoverageContext(ROOT, lock, registry, resolve);
    } catch (err) {
        process.stderr.write(
            `oracle:report --targets — ${(err as Error).message}\n`
        );
        process.exit(1);
    }
    process.stdout.write(
        `\nTarget Lists — ${TARGETS_PATH}, hand-tail floor ${registry.handTailFloor} corpus cards\n` +
            `states: ${COVERAGE_STATES.join(", ")}; playable is a separate figure; ` +
            `check:targets reds only the enforced Targets\n\n`
    );
    for (const row of rows) {
        process.stdout.write(
            `${coverageLines(targetCoverage(resolveTarget(row, resolve), ctx))}\n`
        );
    }
}

function reportDelta(
    lock: ReturnType<typeof parseLockfile>,
    ref: string
): void {
    const baseline = parseLockfile(
        execFileSync("git", ["show", `${ref}:data/oracle-compiled.json`], {
            cwd: ROOT,
            encoding: "utf8",
            maxBuffer: 256 * 1024 * 1024,
        })
    );
    const rows = readyDelta(baseline.cards, lock.cards, vendoredSets());
    process.stdout.write(`\n${formatReadyDelta(rows, ref)}`);
    const corpus = rows[rows.length - 1]!;
    if (corpus.lost.length > 0)
        process.stdout.write(
            `\nno longer ready (${corpus.lost.length}): ${corpus.lost.join(", ")}\n`
        );
    process.stdout.write("\n");
}

/** `--flag value`, or `undefined` when the flag is absent. */
function flag(name: string): string | undefined {
    const at = process.argv.indexOf(name);
    if (at === -1) return undefined;
    const value = process.argv[at + 1];
    // A flag with no value must not fall back to a corpus run: the reader
    // would take the corpus ranking for the Target they named.
    if (value === undefined || value.startsWith("--")) {
        process.stderr.write(`oracle:report — ${name} needs a value\n`);
        process.exit(1);
    }
    return value;
}

interface Target {
    readonly label: string;
    readonly ids: ReadonlySet<string>;
}

/** The Target named on the command line, or `null` for the corpus. */
function readTarget(lock: Lockfile): Target | null {
    const set = flag("--set");
    const pool = flag("--pool");
    if (set !== undefined && pool !== undefined) {
        process.stderr.write(
            "oracle:report — pass --set or --pool, not both\n"
        );
        process.exit(1);
    }
    if (set !== undefined) {
        const code = set.toUpperCase();
        const path = join(ROOT, "data", "json", `${code}.json`);
        if (!existsSync(path)) {
            process.stderr.write(
                `data/json/${code}.json missing — fetch it: curl -s -A "Mozilla/5.0" ` +
                    `-o data/json/${code}.json https://mtgjson.com/api/v5/${code}.json\n`
            );
            process.exit(1);
        }
        const ids = setTargetFromMtgjson(
            JSON.parse(readFileSync(path, "utf8"))
        );
        return { label: `set ${code}`, ids };
    }
    if (pool !== undefined) {
        if (!(REPORTED_FORMATS as readonly string[]).includes(pool)) {
            process.stderr.write(
                `oracle:report — unknown pool "${pool}" (one of: ${REPORTED_FORMATS.join(", ")})\n`
            );
            process.exit(1);
        }
        return { label: `${pool} pool`, ids: poolTarget(lock, pool) };
    }
    return null;
}

/** `set APC — 143 cards: 12 ready, 3 quarantine, 128 unparsed` */
function reportTargetState(lock: Lockfile, target: Target): void {
    const counts = { ready: 0, quarantine: 0, unparsed: 0 };
    let found = 0;
    for (const card of lock.cards) {
        if (!target.ids.has(card.oracleId)) continue;
        found += 1;
        counts[card.state] += 1;
    }
    const missing = target.ids.size - found;
    process.stdout.write(
        `\n${target.label} — ${found} cards: ${counts.ready} ready (${pct(counts.ready, found).trim()}), ` +
            `${counts.quarantine} quarantine, ${counts.unparsed} unparsed\n` +
            (missing > 0
                ? `(${missing} oracle id(s) of the Target are not in the pinned corpus)\n`
                : "")
    );
}

const SHAPE_WIDTH = 78;

function clip(text: string, width: number): string {
    return text.length > width ? `${text.slice(0, width - 3)}...` : text;
}

/**
 * The ranked backlog. Each gap prints on three lines: counts and attribution,
 * the unconsumed span's shape, and one real line that fails there.
 */
function reportGaps(
    ranked: readonly RankedGap[],
    count: number,
    targetLabel: string | null
): void {
    const shown = ranked.slice(0, count);
    process.stdout.write(
        `\nTop ${shown.length} of ${ranked.length} Grammar Gaps` +
            (targetLabel === null
                ? " across the corpus"
                : ` for the ${targetLabel}, corpus count beside each`) +
            ` (the grammar backlog)\n` +
            `compiles = cards that compile the day this rule lands (it is their only gap); refuses = cards it refuses\n\n`
    );
    const head =
        targetLabel === null
            ? `${"rank".padStart(4)}  ${"compiles".padStart(8)} ${"refuses".padStart(7)}  slot › sub-grammar\n`
            : `${"rank".padStart(4)}  ${"compiles".padStart(8)} ${"refuses".padStart(7)}  ` +
              `${"corpus c/r".padStart(11)}  slot › sub-grammar\n`;
    process.stdout.write(head);
    shown.forEach((gap, i) => {
        const where = [gap.slot, ...gap.path].join(" › ");
        const counts =
            `${String(i + 1).padStart(4)}  ${String(gap.target.compiles).padStart(8)} ` +
            `${String(gap.target.refuses).padStart(7)}  ` +
            (targetLabel === null
                ? ""
                : `${`${gap.corpus.compiles}/${gap.corpus.refuses}`.padStart(11)}  `);
        // A card-level gap has no span: its "shape" is the refusal's reason.
        const shapeLabel = gap.slot === CARD_LEVEL ? "why:" : "span:";
        process.stdout.write(
            `${counts}${where}\n` +
                `${"".padStart(6)}${shapeLabel} ${clip(gap.shape, SHAPE_WIDTH)}\n` +
                `${"".padStart(6)}e.g.: ${clip(`${gap.example.card} — ${gap.example.line}`, SHAPE_WIDTH)}\n`
        );
    });
    process.stdout.write("\n");
}

function main(): void {
    if (!existsSync(LOCKFILE_PATH)) {
        process.stderr.write(
            "data/oracle-compiled.json missing — run: bun run oracle:compile\n"
        );
        process.exit(1);
    }
    const lock = parseLockfile(readFileSync(LOCKFILE_PATH, "utf8"));
    if (process.argv.includes("--decks")) {
        reportDecks(lock);
        reportMetagame(lock);
        return;
    }
    const targetsAt = process.argv.indexOf("--targets");
    if (targetsAt !== -1) {
        const only = process.argv[targetsAt + 1];
        reportTargets(
            lock,
            only === undefined || only.startsWith("--") ? undefined : only
        );
        return;
    }
    const deltaAt = process.argv.indexOf("--delta");
    if (deltaAt !== -1) {
        const ref = process.argv[deltaAt + 1];
        reportDelta(
            lock,
            ref === undefined || ref.startsWith("--") ? ORIGIN_BASE : ref
        );
        return;
    }
    const gapsAt = process.argv.indexOf("--gaps");
    const requested = gapsAt === -1 ? NaN : Number(process.argv[gapsAt + 1]);
    const gapCount =
        Number.isFinite(requested) && requested > 0 ? requested : 20;

    const { corpus, counts, grammarVersion } = lock.header;
    process.stdout.write(
        `\nOracle compiler — grammar ${grammarVersion}\n` +
            `corpus ${corpus.downloadUri.split("/").pop()} (Scryfall updated_at ${corpus.updatedAt})\n`
    );

    const target = readTarget(lock);
    if (target !== null) {
        reportTargetState(lock, target);
        reportGaps(rankGrammarGaps(lock, target.ids), gapCount, target.label);
        return;
    }
    process.stdout.write("\n");

    process.stdout.write(
        `${"format".padEnd(12)}${"total".padStart(8)}${"ready".padStart(9)}${"quar".padStart(9)}` +
            `${"unparsed".padStart(11)}${"pool".padStart(9)}\n`
    );
    process.stdout.write(`${"-".repeat(58)}\n`);
    for (const format of REPORTED_FORMATS) {
        const row = lock.formats[format];
        if (row === undefined) continue;
        process.stdout.write(
            `${format.padEnd(12)}${String(row.total).padStart(8)}` +
                `${String(row.ready).padStart(9)}${String(row.quarantine).padStart(9)}` +
                `${String(row.unparsed).padStart(11)}${String(row.pool).padStart(9)}\n` +
                `${"".padEnd(12)}${"".padStart(8)}${pct(row.ready, row.total).padStart(9)}` +
                `${pct(row.quarantine, row.total).padStart(9)}${pct(row.unparsed, row.total).padStart(11)}` +
                `${pct(row.pool, row.total).padStart(9)}\n`
        );
    }
    process.stdout.write(
        `\ncorpus     ${counts.total} cards: ${counts.ready} ready, ` +
            `${counts.quarantine} quarantine, ${counts.unparsed} unparsed\n`
    );
    process.stdout.write(
        `\n"pool" is the cards already covered by a HAND-WRITTEN definition today.\n` +
            `It is the baseline the compiler is measured against, not part of its output.\n`
    );
    // The protocol cards' exit route (issue #3868): a report line, never a
    // red — equality with a closure is unproven, so a person compares.
    const closure = [...closureOracleIds(corpusNameIndex(lock))]
        .map((id) => lock.cards.find((c) => c.oracleId === id)!.name)
        .sort();
    process.stdout.write(
        `\nclosure cards whose Oracle text now compiles — compare behaviour by hand ` +
            `(${closure.length}): ${closure.length === 0 ? "none" : closure.join(", ")}\n`
    );

    reportGaps(rankGrammarGaps(lock, null), gapCount, null);
}

if (import.meta.main) {
    main();
}
