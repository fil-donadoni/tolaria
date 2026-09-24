/**
 * `targetCompleted()` — is this Target List done? The v1 gate's three clauses
 * (ADR 0143 § The v1 gate), computed as one verdict so nobody combines
 * three reports by hand (issue #4208, PRD #4207).
 *
 *   1. `playable` — every card `ready` or hand-written (the hand tail
 *      declared by name — never 100% grammar). A Target with
 *      `completion: "ready"` (issue #4519) has the `ready` clause instead:
 *      every card `ready`, a hand-written card listed as missing;
 *   2. `coverage-invariant` — the Coverage Invariant green on the Target
 *      (`coverageReds`, the one definition `check:targets` reds on);
 *   3. `bot-play` — `frozen` = 0; every `never-chosen` card fixed or covered
 *      by a `must` Test Position; harness-bound cards listed by name and
 *      never blocking on their own.
 *
 * Pure: the Target's coverage (`targetCoverage`, already folded over the
 * lockfile rows through `CoverageContext`) and a Bot-play verdict source in,
 * the clauses and the boolean out — no `gh`, no network, no filesystem.
 * The clause reasons are plain strings, so `oracle:report` prints them as
 * they stand.
 */

import type {
    BotReachCause,
    BotReachOutcome,
} from "../../convex/gre/ai/botReach";
import { coverageReds, type TargetCoverage } from "./targets";

export const COMPLETION_CLAUSES = [
    "playable",
    "ready",
    "coverage-invariant",
    "bot-play",
] as const;
export type CompletionClause = (typeof COMPLETION_CLAUSES)[number];

/**
 * The causes that are limits of the sweep's harness (`convex/gre/ai/botReach.ts`),
 * never a claim about the Bot, the engine or the compiler — ADR 0143 names
 * exactly these two. They are listed, and never block the clause.
 */
/**
 * Every cause `botGapKey` (`scripts/lib/oracle-bot-reach.ts`) can lead a key
 * with. That file is a hashed input of the Oracle lockfile (`check:oracle`),
 * so this reader parses the key's first field itself rather than adding an
 * export there and regenerating the lockfile for it.
 */
const BOT_REACH_CAUSES: ReadonlySet<string> = new Set([
    "no-legal-move",
    "position-unmodelled",
    "unanswerable-input",
    "no-progress",
    "harness-error",
    "never-chosen",
] satisfies BotReachCause[]);

const GAP_KEY_SEPARATOR = " › ";

/** The cause a Bot Gap key leads with, or `null` for a key this tree does not produce. */
function botGapCause(key: string): BotReachCause | null {
    const cause = key.split(GAP_KEY_SEPARATOR)[0]!;
    return BOT_REACH_CAUSES.has(cause) ? (cause as BotReachCause) : null;
}

export const HARNESS_BOUND_CAUSES: ReadonlySet<BotReachCause> = new Set([
    "position-unmodelled",
    "no-progress",
]);

/** One card's Bot-play verdict — structurally a `target-bot-reach` `CardMeasure`. */
export interface BotPlayCard {
    readonly name: string;
    readonly outcome: BotReachOutcome | "unplayable";
    /** The Bot Gap key (`<cause> › <form>[ › <ops>]`) of a non-`played` card. */
    readonly gap?: string;
}

/** The Bot-play verdicts for one Target. */
export interface BotPlayVerdicts {
    readonly cards: readonly BotPlayCard[];
    /** Names of the cards a `must` Test Position shows the Bot playing. */
    readonly mustCovered: ReadonlySet<string>;
}

/** No verdicts to read — the clause cannot be proved, and says why. */
export interface BotPlayUnavailable {
    readonly missing: string;
}

export interface HarnessBoundCard {
    readonly name: string;
    readonly cause: BotReachCause;
}

export interface BotPlayClause {
    readonly green: boolean;
    /** Set when there were no verdicts to read — the clause cannot be proved. */
    readonly missing?: string;
    /** `frozen` cards — a freeze breaks a stranger's game, hard. */
    readonly frozen: readonly string[];
    /** `never-chosen` cards neither fixed nor covered by a `must` Test Position. */
    readonly neverChosen: readonly string[];
    /** Target cards with no verdict, or one whose cause the ADR does not classify. */
    readonly unmeasured: readonly string[];
    /** `never-chosen` cards closed by a `must` Test Position — declared by
     *  name, never a silent discharge (ADR 0143). */
    readonly coveredByMust: readonly string[];
    /** Listed by name, never blocking. */
    readonly harnessBound: readonly HarnessBoundCard[];
}

export interface TargetCompletion {
    readonly id: string;
    readonly completed: boolean;
    /** The first clause — named `playable`, or `ready` for a `ready` Target
     *  (`failing` and the report line carry the same name). */
    readonly playable: {
        readonly clause: "playable" | "ready";
        readonly green: boolean;
        readonly missing: readonly string[];
    };
    readonly coverageInvariant: {
        readonly green: boolean;
        readonly reds: readonly string[];
    };
    readonly botPlay: BotPlayClause;
    /** The clauses that are red, in gate order; empty iff `completed`. */
    readonly failing: readonly CompletionClause[];
}

/**
 * Clause 3. Fail-closed on what it cannot prove: a Target card the source has
 * no verdict for is `unmeasured` (a stale or wrong report reads as red, never
 * as green), and so is an ignored card whose cause is neither `never-chosen`
 * nor one of the two harness-bound causes (`harness-error`: the sweep threw,
 * so nothing is proved either way). An `unplayable` card has no Bot verdict by
 * construction — the `playable` clause already owns it.
 */
function botPlayClause(
    cardNames: readonly string[],
    unplayable: ReadonlySet<string>,
    source: BotPlayVerdicts
): BotPlayClause {
    const verdicts = new Map(source.cards.map((c) => [c.name, c] as const));
    const frozen: string[] = [];
    const neverChosen: string[] = [];
    const coveredByMust: string[] = [];
    const unmeasured: string[] = [];
    const harnessBound: HarnessBoundCard[] = [];
    for (const name of cardNames) {
        const verdict = verdicts.get(name);
        if (verdict === undefined) {
            unmeasured.push(name);
            continue;
        }
        if (verdict.outcome === "played") continue;
        if (verdict.outcome === "unplayable") {
            // The `playable` clause owns a card coverage calls unplayable; one
            // the sweep could not play but coverage calls playable is a
            // disagreement between two readers, and proves nothing.
            if (!unplayable.has(name)) unmeasured.push(name);
            continue;
        }
        if (verdict.outcome === "frozen") {
            frozen.push(name);
            continue;
        }
        const cause =
            verdict.gap === undefined ? null : botGapCause(verdict.gap);
        if (cause === "never-chosen") {
            if (isMustCovered(name, source.mustCovered))
                coveredByMust.push(name);
            else neverChosen.push(name);
        } else if (cause !== null && HARNESS_BOUND_CAUSES.has(cause)) {
            harnessBound.push({ name, cause });
        } else unmeasured.push(name);
    }
    return {
        green:
            frozen.length === 0 &&
            neverChosen.length === 0 &&
            unmeasured.length === 0,
        frozen,
        neverChosen,
        unmeasured,
        coveredByMust,
        harnessBound,
    };
}

const FACE_SEPARATOR = " // ";

/** A blade entry names a card by its DEFINITION name — one face of a split or
 *  double-faced card — while the lockfile row carries `Front // Back`. */
function isMustCovered(name: string, covered: ReadonlySet<string>): boolean {
    return (
        covered.has(name) ||
        name.split(FACE_SEPARATOR).some((face) => covered.has(face))
    );
}

/** Every card of the Target — the coverage states partition it. */
function targetCardNames(coverage: TargetCoverage): string[] {
    return Object.values(coverage.byState).flat();
}

/**
 * The v1-gate verdict for one Target. `botPlay` is `{ missing }` when there
 * are no Bot-play verdicts to read: the third clause then fails, naming why,
 * because a Target cannot be declared complete without proof.
 */
export function targetCompleted(
    coverage: TargetCoverage,
    botPlay: BotPlayVerdicts | BotPlayUnavailable
): TargetCompletion {
    const cardNames = targetCardNames(coverage);
    const reds = coverageReds(coverage);
    const bot: BotPlayClause =
        "missing" in botPlay
            ? {
                  green: false,
                  missing: botPlay.missing,
                  frozen: [],
                  neverChosen: [],
                  unmeasured: [],
                  coveredByMust: [],
                  harnessBound: [],
              }
            : botPlayClause(cardNames, new Set(coverage.unplayable), botPlay);
    // Under `ready` a hand-written card is not green: everything that is not
    // `ready` is missing (issue #4519).
    const clause = coverage.completion === "ready" ? "ready" : "playable";
    const missing =
        clause === "ready" ? coverage.notReady : coverage.unplayable;
    const failing: CompletionClause[] = [];
    if (missing.length > 0) failing.push(clause);
    if (reds.length > 0) failing.push("coverage-invariant");
    if (!bot.green) failing.push("bot-play");
    return {
        id: coverage.id,
        completed: failing.length === 0,
        playable: { clause, green: missing.length === 0, missing },
        coverageInvariant: { green: reds.length === 0, reds },
        botPlay: bot,
        failing,
    };
}

/** Coverage Invariant reds printed inline; `--targets` names every card above. */
const RED_LINES_SHOWN = 3;

/** `completed: yes`, or `completed: no` and one line per red clause. */
export function formatCompletion(completion: TargetCompletion): string {
    const listed = (names: readonly string[]): string => names.join(", ");
    const bound =
        completion.botPlay.harnessBound.length === 0
            ? ""
            : `  harness-bound, listed and not blocking (${completion.botPlay.harnessBound.length}): ` +
              completion.botPlay.harnessBound
                  .map((c) => `${c.name} (${c.cause})`)
                  .join(", ") +
              "\n";
    const covered =
        completion.botPlay.coveredByMust.length === 0
            ? ""
            : `  never-chosen, covered by a must Test Position (${completion.botPlay.coveredByMust.length}): ${listed(completion.botPlay.coveredByMust)}\n`;
    if (completion.completed) return `  completed: yes\n${covered}${bound}`;
    const lines: string[] = [];
    const reds = completion.coverageInvariant.reds.slice(0, RED_LINES_SHOWN);
    if (!completion.playable.green)
        lines.push(
            completion.playable.clause === "ready"
                ? `ready — ${completion.playable.missing.length} card(s) not ready (a hand-written card does not count): ${listed(completion.playable.missing)}`
                : `playable — ${completion.playable.missing.length} card(s) neither ready nor hand-written: ${listed(completion.playable.missing)}`
        );
    if (!completion.coverageInvariant.green)
        lines.push(
            `coverage-invariant — ${completion.coverageInvariant.reds.length} red(s)` +
                `${reds.length < completion.coverageInvariant.reds.length ? ", first " + reds.length : ""}: ${reds.join("; ")}` +
                (reds.length < completion.coverageInvariant.reds.length
                    ? "; …"
                    : "")
        );
    const bot = completion.botPlay;
    if (!bot.green) {
        const parts: string[] = [];
        if (bot.missing !== undefined) parts.push(bot.missing);
        if (bot.frozen.length > 0)
            parts.push(`frozen ${bot.frozen.length}: ${listed(bot.frozen)}`);
        if (bot.neverChosen.length > 0)
            parts.push(
                `never-chosen, no fix and no must Test Position ${bot.neverChosen.length}: ${listed(bot.neverChosen)}`
            );
        if (bot.unmeasured.length > 0)
            parts.push(
                `no classifiable verdict ${bot.unmeasured.length} (absent from the report, harness-error or another unclassified cause, or unplayable in the sweep only): ${listed(bot.unmeasured)}`
            );
        lines.push(`bot-play — ${parts.join("; ")}`);
    }
    return (
        `  completed: no — ${completion.failing.join(", ")}\n` +
        lines.map((l) => `    red: ${l}\n`).join("") +
        covered +
        bound
    );
}

/** The slice of a blade entry `mustCoveredCards` reads — structural, so this
 *  module stays pure and the caller alone decides to load the registry. */
export interface BladeEntryShape {
    readonly tier: string;
    readonly expect: {
        readonly moves?: ReadonlyArray<{
            readonly kind: string;
            readonly card?: string;
            readonly cards?: readonly string[];
        }>;
    };
}

/** The move kinds that PLAY a card — a matcher for any other kind (a pass, a
 *  block) says nothing about the Bot playing the card it names. */
const PLAYING_KINDS: ReadonlySet<string> = new Set([
    "cast-spell",
    "activate-ability",
    "activate-granted-ability",
    "play-land",
]);

/**
 * The card names a `must` Test Position covers (ADR 0143: "shows the Bot
 * playing it in a position where playing it is sensible"). A blade entry's
 * `expect.moves` is "the chosen move matches AT LEAST ONE matcher" (the
 * "these are all acceptable best plays" shape), so a card is proved played
 * only when EVERY alternative names it: the intersection over the matchers,
 * where a matcher of a kind that plays nothing (a pass, a block) names no
 * card. A `forbidden` or predicate expectation asserts nothing positive, and a
 * `stretch` entry is report-only.
 */
export function mustCoveredCards(
    scenarios: readonly BladeEntryShape[]
): Set<string> {
    const names = new Set<string>();
    for (const entry of scenarios) {
        if (entry.tier !== "must") continue;
        const matchers = entry.expect.moves ?? [];
        if (matchers.length === 0) continue;
        const named = matchers.map((matcher) =>
            PLAYING_KINDS.has(matcher.kind)
                ? new Set([
                      ...(matcher.card === undefined ? [] : [matcher.card]),
                      ...(matcher.cards ?? []),
                  ])
                : new Set<string>()
        );
        for (const card of named[0]!)
            if (named.every((set) => set.has(card))) names.add(card);
    }
    return names;
}
