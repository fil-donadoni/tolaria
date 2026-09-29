/**
 * Bot Findings — derived state, blade-card join and Classes ranking (ADR 0141
 * § 3, PRD #4174, issue #4177). Pure, and imported by both `convex/botFindings.ts`
 * (the read queries) and the admin page (status labels/tones) — one definition
 * of what a row's status means, never a second copy of the table.
 *
 * The state is derived from two independent facts, never stored and never set
 * by a click: whether the finding's CLASS carries a `must`-tier blade entry
 * (its proof), and what the CARD's own last measurement says.
 */
import { v, type Infer } from "convex/values";

export const findingStatusValidator = v.union(
    v.literal("open"),
    v.literal("class-fixed"),
    v.literal("played-unproven"),
    v.literal("resolved"),
    v.literal("harness-bound")
);
export type FindingStatus = Infer<typeof findingStatusValidator>;

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
    open: "Open",
    "class-fixed": "Class fixed, card still stuck",
    "played-unproven": "Played, unproven",
    resolved: "Resolved",
    "harness-bound": "Harness-bound",
};

/** Causes that mean the SWEEP's harness owes a better position, never the Bot
 *  a fix (`BOT_CAUSE_TEXT`, `scripts/lib/gap-kinds.ts`) — short-circuits the
 *  other two facts (ADR 0141 § 3's table reads "—" in both columns for this
 *  row). Restated as strings rather than importing `BotReachCause`: that type
 *  lives in `botReach.ts`, which drags the search engine into a module this
 *  admin page's client bundle also imports (ADR 0074). */
const HARNESS_BOUND_CAUSES: ReadonlySet<string> = new Set([
    "no-progress",
    "position-unmodelled",
]);

/**
 * ADR 0141 § 3's table, literally: `class-fixed` is the evidence a class fix
 * did NOT generalise to this card — the failure mode ADR 0102 exists to
 * catch. There is no sixth state and no "mark as resolved" button; every
 * input here is either the last sweep's verdict or the blade registry itself.
 */
export function computeFindingStatus(input: {
    readonly outcome: "played" | "ignored" | "frozen";
    readonly cause?: string;
    readonly classHasMustBladeEntry: boolean;
}): FindingStatus {
    // `played` FIRST: a row the sweep now plays keeps its STALE `cause` from
    // before it played (`planFindingWrites`'s played branch patches `outcome`
    // and stamps only — never `cause`), and both harness causes describe a
    // measurement the sweep never produces for a card that plays (a
    // `no-progress` follow-through or an unposeable position cannot end in
    // `played`). Checking the cause first would read a genuinely fixed,
    // playing card as permanently harness-bound off a value the sweep no
    // longer stands behind.
    if (input.outcome === "played")
        return input.classHasMustBladeEntry ? "resolved" : "played-unproven";
    if (input.cause !== undefined && HARNESS_BOUND_CAUSES.has(input.cause))
        return "harness-bound";
    return input.classHasMustBladeEntry ? "class-fixed" : "open";
}

/** One blade entry a card name resolves to — `scripts/build-blade-card-index.ts`'s
 *  output shape, read back by the Convex query as the committed JSON artifact
 *  it is (the `oracleLegalityData` / `compiledPool` precedent). */
export interface BladeCardIndexEntry {
    readonly label: string;
    readonly tier: "must" | "stretch";
    /** Whether the entry's position exists only after `setup`/`revisit` steps
     *  walk the board forward — a card whose every entry needs one has no
     *  plain-board reproducer to launch, only a copy-command (PRD #4174,
     *  user story 35). */
    readonly needsSetup: boolean;
}
export type BladeCardIndex = Readonly<
    Record<string, readonly BladeCardIndexEntry[]>
>;

/**
 * The `must` blade entry proving a class fixed, or `undefined` when none of
 * its cards' names appear in a `must` entry. A `must` entry is BLOCKING CI
 * (`convex/gre/ai/blade/types.ts`): "never land an entry here red" — so its
 * mere presence in the committed registry IS the "green" proof of ADR 0141
 * § 3; there is no separate pass/fail flag to read per entry.
 */
export function mustBladeEntryFor(
    cardNames: readonly string[],
    index: BladeCardIndex
): string | undefined {
    for (const name of cardNames) {
        const must = (index[name] ?? []).find((e) => e.tier === "must");
        if (must !== undefined) return must.label;
    }
    return undefined;
}

/** One Bot Gap class as the ranking needs to see it — `FindingClass`
 *  restated as a structural type so this module never imports
 *  `botFindingsCore.ts` (the SEED-side contract) for a READ-side concern. */
export interface RankableFindingClass {
    readonly key: string;
    readonly cardCount: number;
    readonly targetCounts: readonly {
        readonly target: string;
        readonly count: number;
    }[];
}

/**
 * Classes ranked by per-Target leverage, in Target PRIORITY order, corpus
 * count as the tie-break — the same ranking `gap-kinds.ts`'s `rank()` gives
 * the Grammar Gaps (issue #3869), restated here because a class row carries
 * its per-Target counts already resolved but not the priority ORDER the
 * artifact writes them in (`buildBotFindingsPayload` sorts `targetCounts` by
 * target id, not by priority — the caller supplies `priorityTargets`, read
 * off `data/targets.json`, for that).
 */
export function rankFindingClasses<T extends RankableFindingClass>(
    classes: readonly T[],
    priorityTargets: readonly string[]
): T[] {
    const countOf = (cls: T, target: string): number =>
        cls.targetCounts.find((t) => t.target === target)?.count ?? 0;
    return [...classes].sort((a, b) => {
        for (const target of priorityTargets) {
            const d = countOf(b, target) - countOf(a, target);
            if (d !== 0) return d;
        }
        return (
            b.cardCount - a.cardCount ||
            (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        );
    });
}
