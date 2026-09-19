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
 * Measures only. It writes nothing but its report: the lockfile, the cache
 * and the Bot Gap table stay `oracle:compile`'s (fixing a gap is `gaps:sync`'s
 * `bot` kind, never this script).
 *
 *   bun scripts/target-bot-reach.ts [--target <id>]... [--json <path>]
 *
 * Default Targets: `premodern-metagame`, `vintage-cube` (the v1 pair,
 * issue #3846).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CardDefinition } from "../convex/cards/types";
import type {
    BotReachOutcome,
    BotReachVerdict,
} from "../convex/gre/ai/botReach";
import { castShape } from "../convex/gre/ai/botReachForm";
import { botGapKey } from "./lib/oracle-bot-reach";
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

/** Which definition a Target card ships with — the one that gets played. */
export type ShippedSource = "hand-written" | "compiled";

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

/** Every Op name a definition's scripts use — `opsUsed` for a hand-written
 *  card, which has no compile outcome to carry one. */
export function opsOf(def: unknown): string[] {
    const ops = new Set<string>();
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (node !== null && typeof node === "object") {
            const rec = node as Record<string, unknown>;
            if (typeof rec.op === "string") ops.add(rec.op);
            Object.values(rec).forEach(walk);
        }
    };
    walk(def);
    return [...ops].sort();
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

function argValues(flag: string): string[] {
    const out: string[] = [];
    process.argv.forEach((arg, i) => {
        if (arg === flag && process.argv[i + 1] !== undefined)
            out.push(process.argv[i + 1]!);
    });
    return out;
}

async function main(): Promise<void> {
    const targetIds = argValues("--target");
    const jsonPath = argValues("--json")[0];
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

    const verdictCache = new Map<string, CardMeasure>();
    const measure = (row: CardRow): CardMeasure => {
        const hit = verdictCache.get(row.oracleId);
        if (hit) return hit;
        const printId = handWritten.get(row.oracleId);
        let def: CardDefinition | undefined;
        let source: ShippedSource | undefined;
        let opsUsed: readonly string[] = [];
        if (printId !== undefined) {
            def = getDefinition(printId);
            source = "hand-written";
            opsUsed = opsOf(def);
        } else if (row.state === "ready" && row.definition !== undefined) {
            def = {
                ...row.definition,
                id: `oracle-bot-reach:${row.oracleId}`,
                rarity: "common",
            } as CardDefinition;
            preloadDefinitions([def]);
            source = "compiled";
            opsUsed = row.opsUsed ?? [];
        }
        let result: CardMeasure;
        if (def === undefined || source === undefined) {
            result = {
                name: row.name,
                oracleId: row.oracleId,
                outcome: "unplayable",
            };
        } else {
            let verdict: BotReachVerdict;
            try {
                verdict = playBotReach(def);
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
            const gap = botGapKey(verdict, opsUsed, castShape(def));
            result = {
                name: row.name,
                oracleId: row.oracleId,
                source,
                outcome: verdict.outcome,
                ...(gap !== undefined ? { gap } : {}),
            };
        }
        verdictCache.set(row.oracleId, result);
        return result;
    };

    const started = Date.now();
    const report: TargetMeasure[] = [];
    const perCard: Record<string, CardMeasure[]> = {};
    for (const id of targetIds.length > 0 ? targetIds : DEFAULT_TARGETS) {
        const row = registry.targets.find((t) => t.id === id);
        if (row === undefined) throw new Error(`unknown Target \`${id}\``);
        const target = resolveTarget(row, ctx);
        const cards = target.cards.map((c, i) => {
            process.stderr.write(
                `\r${id} ${i + 1}/${target.cards.length} ` +
                    `(${Math.round((Date.now() - started) / 1000)}s)`
            );
            return measure(ctx.byOracleId.get(c.oracleId)!);
        });
        perCard[id] = cards;
        report.push(aggregate(id, cards));
    }
    process.stderr.write("\n");

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
}

if (import.meta.main) {
    await main();
}
