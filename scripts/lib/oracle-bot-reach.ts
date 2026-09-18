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
import type { BotGapRow, CardRow, Lockfile } from "./oracle-lockfile";

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
    return {
        outcome: row.botReach,
        ...(row.botGap !== undefined ? splitGapKey(row.botGap) : {}),
    };
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
export function botGapKey(
    verdict: BotReachVerdict,
    opsUsed: readonly string[],
    /** The card's cast shape, recomputed from the definition — a cached
     *  verdict's own `form` is whatever the shape looked like when it was
     *  played, so the key is derived here and never read back from the row. */
    form: string = verdict.form ?? ""
): string | undefined {
    if (verdict.outcome === "played" || verdict.cause === undefined)
        return undefined;
    const parts: string[] = [verdict.cause, form];
    if (verdict.cause === "never-chosen")
        parts.push(opsUsed.length > 0 ? opsUsed.join("+") : "(no Ops)");
    return parts.join(GAP_SEPARATOR);
}

/** The inverse of {@link botGapKey}'s first two fields — enough to rebuild a
 *  cached verdict's cause and form from its row. */
function splitGapKey(key: string): { cause: BotReachCause; form: string } {
    const [cause, form] = key.split(GAP_SEPARATOR);
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
