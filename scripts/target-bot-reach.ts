/**
 * Whole-Target Bot-play measurement (issue #4149).
 *
 * `oracle:compile`'s Bot-play sweep (issue #3830, ADR 0105 § 7.2) plays only
 * compiled `ready` rows, so on a Target made mostly of HAND-WRITTEN cards it
 * leaves most of the Target unmeasured. This one-off plays the definition that
 * actually SHIPS for every card of a Target — the hand-written one when the
 * catalogue carries it (it wins the merge, `lib/catalogue-merge.ts`), the
 * compiled one when the row is `ready` — through the very same
 * `playBotReach`, and keys each non-`played` verdict with the same
 * `botGapKey`. A card with neither is `unplayable`: there is nothing to play.
 *
 * Measures only. It touches no lockfile and files no issue: fixing a gap is
 * `gaps:sync`'s `bot` kind, never this script.
 *
 * What it DOES write is its own measurement artifact (ADR 0141 §4, issue
 * #4175) — `data/bot-reach-findings.json`, one row per measured card, with a
 * header naming the commit, the Bot hash and the moment the verdicts were
 * produced. The committed artifact IS the verdict cache: a run whose
 * definitions and Bot hash are unchanged replays nothing and finishes in
 * seconds instead of 265 s, and reproduces the file byte for byte.
 *
 *   bun run bot:reach [--target <id>]... [--replay]
 *                     [--json <path>] [--findings <path>]
 *
 * `--replay` ignores the cache and plays every card. `--json` is the legacy
 * per-Target report (`oracle:report`'s input, issue #4149), unrelated to the
 * artifact. A run narrowed by `--target` would measure a SUBSET of the
 * committed scope, so it refuses to write the committed artifact — by any
 * spelling of its path — and asks for an explicit `--findings <path>`
 * elsewhere instead. It still READS the committed artifact as its cache.
 *
 * Default Targets: `premodern-metagame`, `vintage-cube` (the v1 pair,
 * issue #3846).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CardDefinition } from "../convex/cards/types";
import type {
    BotReachOutcome,
    BotReachVerdict,
} from "../convex/gre/ai/botReach";
import { castShape } from "../convex/gre/ai/botReachForm";
import { collectOps } from "../convex/oracle/gates";
import type { CompiledDefinition } from "../convex/oracle/types";
import {
    botGapKey,
    botHash,
    botVerdictOf,
    buildFindings,
    definitionHash,
    findingRow,
    findingsCache,
    findingsCachePath,
    findingsHeader,
    findingsOutputPath,
    parseFindings,
    serializeFindings,
    type FindingRow,
    type FindingsArtifact,
    type MeasuredVerdict,
    type ShippedSource,
} from "./lib/oracle-bot-reach";
import {
    parseLockfile,
    POOL_PROJECTION_SOURCE,
    type CardRow,
} from "./lib/oracle-lockfile";
import {
    readTargetRegistry,
    resolveContext,
    resolveTarget,
} from "./lib/targets";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_TARGETS = ["premodern-metagame", "vintage-cube"];

/** Which definition a Target card ships with — the one that gets played.
 *  Defined beside the artifact that records it. */
export type { ShippedSource };

export interface CardMeasure {
    readonly name: string;
    readonly oracleId: string;
    /** Absent when the card ships no definition at all. */
    readonly source?: ShippedSource;
    readonly outcome: BotReachOutcome | "unplayable";
    readonly gap?: string;
}

export interface TargetMeasure {
    readonly id: string;
    readonly total: number;
    /** Outcome counts, split by the definition played. */
    readonly counts: Record<
        ShippedSource | "all",
        Record<BotReachOutcome, number>
    > & { unplayable: number };
    /** Bot Gap key → card names, most cards first. */
    readonly gaps: ReadonlyArray<{
        key: string;
        outcome: BotReachOutcome;
        cards: string[];
    }>;
}

const zero = (): Record<BotReachOutcome, number> => ({
    played: 0,
    ignored: 0,
    frozen: 0,
});

/** Aggregate one Target's per-card measures. Pure. */
export function aggregate(
    id: string,
    cards: readonly CardMeasure[]
): TargetMeasure {
    const counts = {
        "hand-written": zero(),
        compiled: zero(),
        all: zero(),
        unplayable: 0,
    };
    const gaps = new Map<
        string,
        { outcome: BotReachOutcome; cards: string[] }
    >();
    for (const card of cards) {
        if (card.outcome === "unplayable" || card.source === undefined) {
            counts.unplayable += 1;
            continue;
        }
        counts[card.source][card.outcome] += 1;
        counts.all[card.outcome] += 1;
        if (card.gap === undefined) continue;
        const seen = gaps.get(card.gap);
        if (seen) seen.cards.push(card.name);
        else gaps.set(card.gap, { outcome: card.outcome, cards: [card.name] });
    }
    return {
        id,
        total: cards.length,
        counts,
        gaps: [...gaps.entries()]
            .map(([key, v]) => ({ key, ...v }))
            .sort(
                (a, b) =>
                    b.cards.length - a.cards.length ||
                    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
            ),
    };
}

/** A row `oracle:compile` compiled and then withheld ONLY because the sweep
 *  froze on it (`bot-unreachable`) — its definition is still the one the
 *  sweep played, and the measurement must count it `frozen`, not
 *  `unplayable`. A grammar quarantine never reached the Bot. */
function botWithheld(row: CardRow): boolean {
    const reasons = row.quarantineReasons ?? [];
    return (
        row.state === "quarantine" &&
        reasons.length > 0 &&
        reasons.every((r) => r.kind === "bot-unreachable")
    );
}

function argValues(flag: string): string[] {
    const out: string[] = [];
    process.argv.forEach((arg, i) => {
        if (arg === flag && process.argv[i + 1] !== undefined)
            out.push(process.argv[i + 1]!);
    });
    return out;
}

/** The commit the verdicts were produced at — the header's provenance. */
function commitSha(root: string): string {
    try {
        return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
            encoding: "utf8",
        }).trim();
    } catch {
        return "unknown";
    }
}

/** One card's measurement, held until every Target it belongs to is known. */
interface Measured {
    readonly measure: CardMeasure;
    readonly verdict: MeasuredVerdict;
    readonly opsUsed: readonly string[];
    readonly castShape?: string;
    readonly targets: Set<string>;
}

async function main(): Promise<void> {
    const targetIds = argValues("--target");
    const jsonPath = argValues("--json")[0];
    const findingsOut = argValues("--findings")[0];
    /** Where the artifact is written, and why not — a narrowed run may never
     *  write the committed artifact, by any spelling of its path. */
    const output = findingsOutputPath(
        ROOT,
        process.cwd(),
        targetIds,
        findingsOut
    );
    const lock = parseLockfile(
        readFileSync(join(ROOT, "data", "oracle-compiled.json"), "utf8")
    );
    const ctx = resolveContext(ROOT, lock);
    const registry = readTargetRegistry(ROOT);

    // The Bot and the catalogue are imported here, dynamically, like
    // `oracle-compile.ts` does: nothing above this line plays.
    const { playBotReach } = await import("../convex/gre/ai/botReach");
    const { preloadDefinitions, getDefinition } =
        await import("../convex/cards/registry");
    const { getAllRawCards } = await import("../convex/cards/catalogue");

    /** Play one card. A throw is the SWEEP failing, never the card, so it is
     *  recorded as a `harness-error` verdict rather than ending the run. */
    const play = (
        definition: CardDefinition,
        source: ShippedSource,
        defHash: string
    ): MeasuredVerdict => {
        let verdict: BotReachVerdict;
        try {
            verdict = playBotReach(definition);
        } catch (error) {
            verdict = {
                outcome: "ignored",
                cause: "harness-error",
                form: (error instanceof Error
                    ? error.message
                    : String(error)
                ).slice(0, 120),
            };
        }
        return {
            source,
            defHash,
            outcome: verdict.outcome,
            ...(verdict.cause !== undefined ? { cause: verdict.cause } : {}),
            ...(verdict.form !== undefined ? { form: verdict.form } : {}),
        };
    };

    // Hand-written definition by oracle id — joined through the card index's
    // first print id, as `catalogue-artifact.ts` joins the merge.
    const index = JSON.parse(
        readFileSync(join(ROOT, POOL_PROJECTION_SOURCE), "utf8")
    ) as Array<{ oracleId?: string; firstPrintId?: string; source?: string }>;
    const oracleIdByPrintId = new Map(
        index
            .filter((e) => e.source !== "compiled" && e.oracleId)
            .map((e) => [e.firstPrintId, e.oracleId!] as const)
    );
    const handWritten = new Map<string, string>();
    for (const raw of getAllRawCards()) {
        const oracleId = oracleIdByPrintId.get(raw.id);
        if (oracleId !== undefined && !handWritten.has(oracleId))
            handWritten.set(oracleId, raw.id);
    }

    // The committed artifact IS the cache (ADR 0141 § 4): a verdict survives
    // while the definition AND the Bot hash are unchanged.
    const cachePath = findingsCachePath(ROOT, process.cwd(), findingsOut);
    const previous: FindingsArtifact | null = existsSync(cachePath)
        ? parseFindings(readFileSync(cachePath, "utf8"))
        : null;
    const currentBotHash = botHash(ROOT);
    const cache = findingsCache(previous, currentBotHash, {
        replay: process.argv.includes("--replay"),
    });

    const measured = new Map<string, Measured>();
    const measure = (row: CardRow, targetId: string): CardMeasure => {
        const hit = measured.get(row.oracleId);
        if (hit) {
            hit.targets.add(targetId);
            return hit.measure;
        }
        const printId = handWritten.get(row.oracleId);
        let def: CardDefinition | undefined;
        /** What the hash is taken over — the compiled row's own definition,
         *  not the copy this script gives a synthetic id. */
        let hashed: unknown;
        let source: ShippedSource | undefined;
        let opsUsed: readonly string[] = [];
        if (printId !== undefined) {
            def = getDefinition(printId);
            hashed = def;
            source = "hand-written";
            // The compiler's own Op census, so a hand-written card keys its
            // Bot Gap exactly as a compiled one would (an `if` predicate's
            // comparator is not an Op).
            opsUsed = collectOps(def as unknown as CompiledDefinition);
        } else if (
            row.definition !== undefined &&
            (row.state === "ready" || botWithheld(row))
        ) {
            hashed = row.definition;
            def = {
                ...row.definition,
                id: `oracle-bot-reach:${row.oracleId}`,
                rarity: "common",
            } as CardDefinition;
            preloadDefinitions([def]);
            source = "compiled";
            opsUsed = row.opsUsed ?? [];
        }
        let entry: Measured;
        if (def === undefined || source === undefined) {
            // Through the cache like every other card, though there is
            // nothing to play: a card LOSING its definition is a row that
            // changed, and a change the run never counts is a header that
            // keeps a provenance the file no longer matches (review of
            // PR #4410, finding 3).
            const verdict = cache.verdictFor(row.oracleId, {}, () => ({
                outcome: "unplayable" as const,
            }));
            entry = {
                measure: {
                    name: row.name,
                    oracleId: row.oracleId,
                    outcome: verdict.outcome,
                },
                verdict,
                opsUsed: [],
                targets: new Set([targetId]),
            };
        } else {
            const played = def;
            const shape = castShape(played);
            const defHash = definitionHash(hashed);
            const verdict = cache.verdictFor(
                row.oracleId,
                { source, defHash },
                () => play(played, source, defHash)
            );
            const gap = botGapKey(botVerdictOf(verdict), opsUsed, shape);
            entry = {
                measure: {
                    name: row.name,
                    oracleId: row.oracleId,
                    source,
                    outcome: verdict.outcome,
                    ...(gap !== undefined ? { gap } : {}),
                },
                verdict,
                opsUsed,
                castShape: shape,
                targets: new Set([targetId]),
            };
        }
        measured.set(row.oracleId, entry);
        return entry.measure;
    };

    const started = Date.now();
    const report: TargetMeasure[] = [];
    const perCard: Record<string, CardMeasure[]> = {};
    const scope = targetIds.length > 0 ? targetIds : DEFAULT_TARGETS;
    for (const id of scope) {
        const row = registry.targets.find((t) => t.id === id);
        if (row === undefined) throw new Error(`unknown Target \`${id}\``);
        const target = resolveTarget(row, ctx);
        const cards = target.cards.map((c, i) => {
            process.stderr.write(
                `\r${id} ${i + 1}/${target.cards.length} ` +
                    `(${Math.round((Date.now() - started) / 1000)}s)`
            );
            return measure(ctx.byOracleId.get(c.oracleId)!, id);
        });
        perCard[id] = cards;
        report.push(aggregate(id, cards));
    }
    process.stderr.write(
        `\n${measured.size} cards — ${cache.replayed()} measured, ` +
            `${measured.size - cache.replayed()} reused ` +
            `(${Math.round((Date.now() - started) / 1000)}s)\n`
    );

    for (const t of report) {
        const { all, unplayable } = { ...t.counts, all: t.counts.all };
        process.stdout.write(
            `\n## ${t.id} — ${t.total} cards\n` +
                `played ${all.played} / ignored ${all.ignored} / frozen ${all.frozen} / unplayable ${unplayable}\n` +
                `  hand-written: ${JSON.stringify(t.counts["hand-written"])}\n` +
                `  compiled:     ${JSON.stringify(t.counts.compiled)}\n` +
                `Bot Gaps (${t.gaps.length}):\n` +
                t.gaps
                    .map(
                        (g) =>
                            `  ${g.cards.length}\t${g.outcome}\t${g.key}\t— ${g.cards.join(", ")}`
                    )
                    .join("\n") +
                "\n"
        );
    }
    if (jsonPath !== undefined)
        writeFileSync(jsonPath, JSON.stringify({ report, perCard }, null, 2));

    if (output.path === undefined) {
        process.stdout.write(
            `\nno findings artifact written — ${output.refusal ?? ""}\n`
        );
        return;
    }
    const findings: FindingRow[] = [...measured.values()].map((m) =>
        findingRow(
            {
                oracleId: m.measure.oracleId,
                name: m.measure.name,
                targets: [...m.targets],
            },
            m.verdict,
            m.opsUsed,
            m.castShape
        )
    );
    const header = findingsHeader(
        previous,
        {
            sha: commitSha(ROOT),
            botHash: currentBotHash,
            measuredAt: new Date().toISOString(),
        },
        cache.replayed()
    );
    writeFileSync(
        output.path,
        serializeFindings(buildFindings(header, scope, findings))
    );
    process.stdout.write(
        `\n${output.path}: ${findings.length} findings, ` +
            `measured ${header.measuredAt} @ ${header.sha.slice(0, 9)}\n`
    );
}

if (import.meta.main) {
    await main();
}
