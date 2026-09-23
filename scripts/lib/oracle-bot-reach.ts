/**
 * The Bot-play sweep's side of the Oracle lockfile (ADR 0105 § 7.2, issue
 * #3830) — the cache, the Bot hash, and the Bot Gap table.
 *
 * `oracle:compile` hands every `ready` card to `playBotReach`
 * (`convex/gre/ai/botReach.ts`) and records the verdict on its row. Playing
 * is expensive (hundreds of ms a card, thousands of cards), so a verdict is
 * REUSED whenever it cannot have changed: same compiled definition, same Bot.
 * The committed lockfile IS the cache — its rows carry the verdicts, its
 * header the Bot hash they were played under — so the cache travels with the
 * branch, needs no gitignored side file, and a clean checkout has it.
 *
 * ── Two sources, and why the gate only ever uses one ───────────────────
 *
 *  - {@link playingBotReach} (`oracle:compile`, the write path): a cache hit
 *    needs the definition AND the Bot hash to match; a miss PLAYS the card.
 *  - {@link carriedBotReach} (`oracle:compile --check`, `check:oracle`'s
 *    tier 3): never plays. It carries the committed verdict forward on a
 *    matching definition whatever the Bot hash says, and the header's Bot
 *    hash with it.
 *
 * The drift guard asks "does the compiler still produce this file?", and a
 * Bot edit does not change what the compiler produces — it changes what the
 * NEXT sweep would conclude. Folding the Bot hash into the drift guard would
 * red every engine PR on a lockfile only a 20-minute sweep can regenerate,
 * which is the sweep running inside `check:pr` / `land` by another name —
 * exactly what ADR 0105 § 7.2 forbids. So a stale Bot verdict is not drift;
 * it is refreshed by the next `oracle:compile`.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
    BotReachCause,
    BotReachOutcome,
    BotReachVerdict,
} from "../../convex/gre/ai/botReach";
import type { CompiledDefinition } from "../../convex/oracle/types";
import {
    indentBlock,
    rowsOf,
    type BotGapRow,
    type CardRow,
    type Lockfile,
} from "./oracle-lockfile";

/**
 * The sources whose edit can change a Bot-play verdict — what the Bot hash
 * covers. The Bot's own modules (the search, its evaluation, the Move model
 * and its application, the owed-input computation) plus the position the
 * sweep builds and this driver.
 *
 * Deliberately NOT the whole engine: `applyMove` runs the real GRE, so in
 * principle any rules edit can move a verdict, but hashing `convex/gre/**`
 * would replay every `ready` card on nearly every landing. A rules edit that
 * does move one is caught by the next edit to a file here, or by
 * `oracle:compile --replay-bot`, which ignores the cache.
 *
 * The blade REGISTRY is excluded for the same reason — it is a list of
 * positions, edited by every Bot PR, read by nothing the sweep runs — while
 * the blade base state the sweep's position is built on is included.
 */
const BOT_SOURCE_FILES = [
    "convex/gre/search.ts",
    "convex/gre/evaluate.ts",
    "convex/gre/greedy.ts",
    "convex/gre/determinize.ts",
    "convex/gre/moves.ts",
    "convex/gre/applyMove.ts",
    "convex/gre/expectedInput.ts",
    "convex/gre/scenarioBuilder.ts",
    // DIRECT imports of the verdict function, not transitive engine (review
    // of PR #4057, finding 5). `rules.ts` carries `getLegalActions`, the sole
    // discriminator between a `frozen` card (withheld) and a
    // `position-unmodelled` one (shipped); the other three decide what the
    // generated position contains.
    "convex/gre/rules.ts",
    "convex/gre/constants.ts",
    "convex/gre/state.ts",
    "convex/cards/colors.ts",
] as const;

/**
 * Inside {@link BOT_SOURCE_DIR} and still NOT hashed: it decides the Bot Gap
 * KEY, which `buildLockfile` recomputes from the definition on every run, and
 * never a verdict. Hashing it would replay 3,400 cards to change a label.
 */
const BOT_SOURCE_EXCLUDED_FILES = new Set(["botReachForm.ts"]);
const BOT_SOURCE_DIR = "convex/gre/ai";
const BOT_SOURCE_EXCLUDED_DIRS = new Set(["__tests__", "verdicts"]);
const BOT_BLADE_INCLUDED = new Set(["baseState.ts"]);

/** Every file {@link botHash} covers, in a stable order. */
export function botSourceFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(join(root, dir)).sort()) {
            const rel = `${dir}/${entry}`;
            if (statSync(join(root, rel)).isDirectory()) {
                if (BOT_SOURCE_EXCLUDED_DIRS.has(entry)) continue;
                walk(rel);
            } else if (
                entry.endsWith(".ts") &&
                !BOT_SOURCE_EXCLUDED_FILES.has(entry) &&
                (!dir.endsWith("/blade") || BOT_BLADE_INCLUDED.has(entry))
            ) {
                out.push(rel);
            }
        }
    };
    walk(BOT_SOURCE_DIR);
    out.push(...BOT_SOURCE_FILES);
    return out;
}

/** sha256 over {@link botSourceFiles} — the second half of the cache key. */
export function botHash(root: string): string {
    const hash = createHash("sha256");
    for (const file of botSourceFiles(root)) {
        hash.update(file);
        hash.update(readFileSync(join(root, file)));
    }
    return `sha256:${hash.digest("hex")}`;
}

/** Plays one card — `playBotReach` over a registered definition. Injected so
 *  the driver never imports the Bot on a path that must not play. */
export type BotPlayer = (
    oracleId: string,
    definition: CompiledDefinition
) => BotReachVerdict;

/** What `buildLockfile` asks for a card that compiled `ready`. */
export interface BotReachSource {
    /** The Bot hash the header records. */
    readonly hash: string;
    /** The verdict, or `undefined` when there is none to record. */
    verdictFor(
        oracleId: string,
        definition: CompiledDefinition
    ): BotReachVerdict | undefined;
}

/** The committed verdict of a row whose definition is unchanged. */
function cachedVerdict(
    previous: ReadonlyMap<string, CardRow>,
    oracleId: string,
    definition: CompiledDefinition
): BotReachVerdict | undefined {
    const row = previous.get(oracleId);
    if (row?.botReach === undefined || row.definition === undefined)
        return undefined;
    if (JSON.stringify(row.definition) !== JSON.stringify(definition))
        return undefined;
    if (row.botGap === undefined) return { outcome: row.botReach };
    const split = splitGapKey(row.botGap);
    return split === null ? undefined : { outcome: row.botReach, ...split };
}

function rowsById(lock: Lockfile | null): Map<string, CardRow> {
    return new Map((lock?.cards ?? []).map((row) => [row.oracleId, row]));
}

/**
 * The write path's source: reuse a verdict when the definition AND the Bot
 * are unchanged, play the card otherwise. `replay` ignores the cache.
 * `onPlay` is told about every card actually played, for progress output.
 */
export function playingBotReach(
    previous: Lockfile | null,
    currentBotHash: string,
    play: BotPlayer,
    options: { replay?: boolean; onPlay?: (oracleId: string) => void } = {}
): BotReachSource & { readonly played: () => number } {
    const cache =
        !options.replay && previous?.header.botHash === currentBotHash
            ? rowsById(previous)
            : new Map<string, CardRow>();
    let played = 0;
    return {
        hash: currentBotHash,
        played: () => played,
        verdictFor(oracleId, definition) {
            const hit = cachedVerdict(cache, oracleId, definition);
            if (hit !== undefined) return hit;
            played += 1;
            options.onPlay?.(oracleId);
            return play(oracleId, definition);
        },
    };
}

/**
 * The gate's source: carry the committed verdicts forward, never play. The
 * header keeps the committed Bot hash, so a regeneration that changes no
 * definition reproduces the committed bytes whatever the Bot looks like now.
 */
export function carriedBotReach(previous: Lockfile | null): BotReachSource {
    const cache = rowsById(previous);
    return {
        hash: previous?.header.botHash ?? "",
        verdictFor: (oracleId, definition) =>
            cachedVerdict(cache, oracleId, definition),
    };
}

// ── Bot Gaps ──────────────────────────────────────────────────────────────

const GAP_SEPARATOR = " › ";

/**
 * The Bot Gap key a non-`played` verdict aggregates under: its cause and its
 * form — for `never-chosen`, also the Ops the card's script uses, because a
 * card the Bot ignores is ignored for what it DOES, and two cards of the same
 * cast shape doing different things are different valuation gaps.
 */
/** The causes whose FORM is the card's cast shape — the ones a recomputed
 *  shape may override. A follow-through cause names the pending choice's
 *  kind instead, which is the only actionable field on its row and which the
 *  cast shape would destroy (review of PR #4057, finding 6). */
const CAST_SHAPE_CAUSES: ReadonlySet<string> = new Set([
    "no-legal-move",
    "position-unmodelled",
    "never-chosen",
]);

/**
 * The FORM half of a Bot Gap key — the cast shape for the causes a missing
 * move is keyed by, the verdict's own form otherwise. `undefined` exactly
 * when the verdict carries no gap.
 *
 * Split out of {@link botGapKey} so a consumer that records the form on its
 * own row (the Bot Reach Findings artifact) reads it from HERE rather than
 * re-deriving the override rule — one authority for what a key is made of.
 */
export function botGapForm(
    verdict: BotReachVerdict,
    /** The card's cast shape, recomputed from the definition — a cached
     *  verdict's own `form` is whatever the shape looked like when it was
     *  played, so a cast-shape key is derived here and never read back from
     *  the row. Ignored for a follow-through cause. */
    castShape?: string
): string | undefined {
    if (verdict.outcome === "played" || verdict.cause === undefined)
        return undefined;
    return castShape !== undefined && CAST_SHAPE_CAUSES.has(verdict.cause)
        ? castShape
        : (verdict.form ?? "");
}

export function botGapKey(
    verdict: BotReachVerdict,
    opsUsed: readonly string[],
    castShape?: string
): string | undefined {
    const form = botGapForm(verdict, castShape);
    if (form === undefined || verdict.cause === undefined) return undefined;
    const parts: string[] = [verdict.cause, form];
    if (verdict.cause === "never-chosen")
        parts.push(opsUsed.length > 0 ? opsUsed.join("+") : "(no Ops)");
    return parts.join(GAP_SEPARATOR);
}

/**
 * Every cause a row may carry. A committed row whose cause is not one of
 * these was written by a vocabulary this tree no longer has (this very issue
 * renamed one mid-development), and carrying it forward would re-emit a
 * verdict no run ever produced — into `botGap` and, for a frozen row, into
 * the quarantine detail. So it is a cache MISS and the card is replayed
 * (review of PR #4057, finding 9).
 */
const BOT_REACH_CAUSES: ReadonlySet<string> = new Set([
    "no-legal-move",
    "position-unmodelled",
    "unanswerable-input",
    "no-progress",
    "harness-error",
    "never-chosen",
] satisfies BotReachCause[]);

/** The inverse of {@link botGapKey}'s first two fields — enough to rebuild a
 *  cached verdict's cause and form from its row. `null` when the row's cause
 *  is not one this tree produces. */
function splitGapKey(
    key: string
): { cause: BotReachCause; form: string } | null {
    const [cause, form] = key.split(GAP_SEPARATOR);
    if (cause === undefined || !BOT_REACH_CAUSES.has(cause)) return null;
    return { cause: cause as BotReachCause, form: form ?? "" };
}

/**
 * The Bot Gap table: one row per key, counting the cards that carry it,
 * ranked like the Grammar Gap fragment table — blast radius first, then the
 * key, so the order is total.
 */
export function rankBotGaps(rows: readonly CardRow[]): BotGapRow[] {
    const byKey = new Map<
        string,
        { outcome: BotReachOutcome; cards: number }
    >();
    for (const row of rows) {
        if (row.botGap === undefined || row.botReach === undefined) continue;
        const seen = byKey.get(row.botGap);
        if (seen) seen.cards += 1;
        else byKey.set(row.botGap, { outcome: row.botReach, cards: 1 });
    }
    return [...byKey.entries()]
        .map(([key, { outcome, cards }]) => ({ key, outcome, cards }))
        .sort(
            (a, b) =>
                b.cards - a.cards ||
                (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        );
}

// ── Bot Reach Findings (ADR 0141 § 4, issue #4175) ────────────────────────

/**
 * The measurement artifact — `data/bot-reach-findings.json`, one row per card
 * of the measured Target Lists plus a header naming the commit, the Bot and
 * the moment the verdicts were produced.
 *
 * It is the lockfile's Bot side applied to a different scope. The lockfile
 * sweeps the cards the COMPILER produced; this sweeps the cards a TARGET
 * names, whichever definition ships for them — so the 1,712 hand-written
 * cards the lockfile never plays are measured here. Same reuse rule (a
 * verdict survives while the definition AND the Bot hash are unchanged), same
 * keying helpers ({@link botGapKey} / {@link botGapForm}), and the committed
 * file IS the cache.
 */

/** Which definition a Target card ships with — the one that gets played. */
export type ShippedSource = "hand-written" | "compiled";

/**
 * Who owes the fix a non-`played` row names, so no consumer re-derives the
 * distinction from a cause string.
 *
 * `bot` — the Bot's own enumeration or valuation refused a card the position
 * offered; `harness` — a bound of THIS sweep, whose own docs on
 * {@link BotReachCause} say so in as many words ("a limit of THIS sweep's
 * position, never a claim about the Bot"). A session must never spend itself
 * "fixing the Bot" for a card the generated position could not pose.
 */
export type BotReachBlame = "bot" | "harness";

/** Exhaustive by construction: a new cause reds `tsc` here. */
const BLAME_BY_CAUSE: Record<BotReachCause, BotReachBlame> = {
    "no-legal-move": "bot",
    "never-chosen": "bot",
    // The follow-through owed an input and no move the Bot enumerated
    // answered it — the Bot freezing the game, which ADR 0047 forbids.
    "unanswerable-input": "bot",
    "position-unmodelled": "harness",
    "no-progress": "harness",
    "harness-error": "harness",
};

export function blameFor(cause: BotReachCause): BotReachBlame {
    return BLAME_BY_CAUSE[cause];
}

/**
 * The provenance of the verdicts below it. Rewritten only when a card was
 * actually REPLAYED: a run that reused every verdict measured nothing, so it
 * has no new sha, no new Bot and no new moment to record — which is also what
 * makes a second run on an unchanged tree byte-identical to the first.
 */
export interface FindingsHeader {
    /** `git rev-parse HEAD` at the run that produced the verdicts. */
    readonly sha: string;
    /** {@link botHash} — the second half of the cache key. */
    readonly botHash: string;
    /** ISO 8601, UTC. */
    readonly measuredAt: string;
}

/** What a card's definition is keyed by — both halves must match to reuse. */
export interface MeasuredDefinition {
    /** Absent exactly when the card ships no definition at all. */
    readonly source?: ShippedSource;
    /** {@link definitionHash}; absent with {@link MeasuredDefinition.source}. */
    readonly defHash?: string;
}

/** The measured half of a row — the only part {@link findingsCache} reuses. */
export interface MeasuredVerdict extends MeasuredDefinition {
    /** `unplayable`: the card ships no definition, so nothing was played. */
    readonly outcome: BotReachOutcome | "unplayable";
    readonly cause?: BotReachCause;
    /** The verdict's own form, NOT the derived one — the cast-shape override
     *  is re-applied from the definition on every build. */
    readonly form?: string;
}

export interface FindingRow extends MeasuredVerdict {
    readonly oracleId: string;
    readonly name: string;
    /** The measured Targets this card belongs to, sorted. */
    readonly targets: readonly string[];
    /** {@link botGapKey} — absent iff the card was `played` or `unplayable`. */
    readonly gap?: string;
    readonly blame?: BotReachBlame;
}

export interface FindingsArtifact {
    readonly generator: string;
    readonly header: FindingsHeader;
    /** The Target ids the run measured, sorted — the artifact's SCOPE, always
     *  recomputed, never carried like the header. */
    readonly targets: readonly string[];
    readonly findings: readonly FindingRow[];
}

export const FINDINGS_GENERATOR =
    "generated by `bun run bot:reach` — never hand-edited " +
    "(see docs/adr/0141-bot-findings-measured-artifact-derived-state.md)";

export const FINDINGS_PATH = "data/bot-reach-findings.json";

/**
 * sha256 of the definition that was played.
 *
 * Function bodies are folded in: a hand-written card may carry `resolve()`,
 * which `JSON.stringify` drops, and a protocol card whose `resolve()` changed
 * is a card whose verdict may have changed too. The compiled half is pure
 * data, so this costs it nothing.
 */
export function definitionHash(definition: unknown): string {
    const text =
        JSON.stringify(definition, (_key, value: unknown) =>
            typeof value === "function" ? value.toString() : value
        ) ?? "";
    return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** Every outcome a row may carry — a row outside this vocabulary was written
 *  by a tree this one is not, so it is a cache MISS (the lockfile applies the
 *  same rule to its causes, review of PR #4057 finding 9). */
const FINDING_OUTCOMES: ReadonlySet<string> = new Set([
    "played",
    "ignored",
    "frozen",
    "unplayable",
]);

/** The committed verdict of a row whose definition is unchanged. */
function reusableVerdict(
    row: FindingRow | undefined,
    definition: MeasuredDefinition
): MeasuredVerdict | undefined {
    if (row === undefined) return undefined;
    if (row.source !== definition.source || row.defHash !== definition.defHash)
        return undefined;
    if (!FINDING_OUTCOMES.has(row.outcome)) return undefined;
    const played = row.outcome === "played" || row.outcome === "unplayable";
    if (played) {
        if (row.cause !== undefined) return undefined;
    } else if (row.cause === undefined || !BOT_REACH_CAUSES.has(row.cause)) {
        return undefined;
    }
    return {
        ...definition,
        outcome: row.outcome,
        ...(row.cause !== undefined ? { cause: row.cause } : {}),
        ...(row.form !== undefined ? { form: row.form } : {}),
    };
}

export interface FindingsCache {
    /** How many cards this run actually played. */
    readonly replayed: () => number;
    verdictFor(
        oracleId: string,
        definition: MeasuredDefinition,
        play: () => MeasuredVerdict
    ): MeasuredVerdict;
}

/**
 * Reuse a verdict while the definition AND the Bot are unchanged, play the
 * card otherwise. `replay` ignores the cache — {@link playingBotReach}'s rule,
 * over the findings artifact instead of the lockfile.
 */
export function findingsCache(
    previous: FindingsArtifact | null,
    currentBotHash: string,
    options: { replay?: boolean; onPlay?: (oracleId: string) => void } = {}
): FindingsCache {
    const rows = new Map<string, FindingRow>(
        !options.replay && previous?.header.botHash === currentBotHash
            ? previous.findings.map((row) => [row.oracleId, row] as const)
            : []
    );
    let replayed = 0;
    return {
        replayed: () => replayed,
        verdictFor(oracleId, definition, play) {
            const hit = reusableVerdict(rows.get(oracleId), definition);
            if (hit !== undefined) return hit;
            replayed += 1;
            options.onPlay?.(oracleId);
            return play();
        },
    };
}

/**
 * A measured verdict as the keying helpers take it — the ONE narrowing from
 * `unplayable`, so no caller writes a second one. A card that was never played
 * degrades to `played`, which carries no form and no gap: there is nothing to
 * key.
 */
export function botVerdictOf(verdict: MeasuredVerdict): BotReachVerdict {
    return verdict.outcome === "unplayable"
        ? { outcome: "played" }
        : {
              outcome: verdict.outcome,
              ...(verdict.cause !== undefined ? { cause: verdict.cause } : {}),
              ...(verdict.form !== undefined ? { form: verdict.form } : {}),
          };
}

/**
 * One row, with its Bot Gap key, its derived form and its blame computed from
 * the verdict — never read back from the previous row, exactly as
 * `buildLockfile` recomputes `botGap` on every run.
 */
export function findingRow(
    card: {
        readonly oracleId: string;
        readonly name: string;
        readonly targets: readonly string[];
    },
    verdict: MeasuredVerdict,
    opsUsed: readonly string[],
    castShape?: string
): FindingRow {
    const played = botVerdictOf(verdict);
    const form = botGapForm(played, castShape);
    const gap = botGapKey(played, opsUsed, castShape);
    const blame =
        gap !== undefined && verdict.cause !== undefined
            ? blameFor(verdict.cause)
            : undefined;
    return {
        oracleId: card.oracleId,
        name: card.name,
        targets: [...card.targets].sort(),
        ...(verdict.source !== undefined ? { source: verdict.source } : {}),
        outcome: verdict.outcome,
        ...(verdict.cause !== undefined ? { cause: verdict.cause } : {}),
        ...(form !== undefined ? { form } : {}),
        ...(gap !== undefined ? { gap } : {}),
        ...(blame !== undefined ? { blame } : {}),
        ...(verdict.defHash !== undefined ? { defHash: verdict.defHash } : {}),
    };
}

/**
 * The header the run records. A run that replayed NOTHING produced no new
 * measurement, so it keeps the one it reused — which is what makes two runs
 * on an unchanged tree byte-identical.
 */
export function findingsHeader(
    previous: FindingsArtifact | null,
    current: FindingsHeader,
    replayed: number
): FindingsHeader {
    return replayed === 0 && previous?.header.botHash === current.botHash
        ? previous.header
        : current;
}

/** Deterministic: rows sorted by oracle id, one per line. */
export function buildFindings(
    header: FindingsHeader,
    targets: readonly string[],
    findings: readonly FindingRow[]
): FindingsArtifact {
    return {
        generator: FINDINGS_GENERATOR,
        header,
        targets: [...targets].sort(),
        findings: [...findings].sort((a, b) =>
            a.oracleId < b.oracleId ? -1 : a.oracleId > b.oracleId ? 1 : 0
        ),
    };
}

/** Deterministic serializer — `serializeLockfile`'s shape, same reasons. */
export function serializeFindings(artifact: FindingsArtifact): string {
    return (
        [
            "{",
            `    "generator": ${JSON.stringify(artifact.generator)},`,
            `    "header": ${indentBlock(JSON.stringify(artifact.header, null, 4), 4)},`,
            `    "targets": ${JSON.stringify(artifact.targets)},`,
            `    "findings": [`,
            ...rowsOf(artifact.findings),
            `    ]`,
            "}",
        ].join("\n") + "\n"
    );
}

export function parseFindings(text: string): FindingsArtifact {
    return JSON.parse(text) as FindingsArtifact;
}
