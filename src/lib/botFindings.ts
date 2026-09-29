// View helpers for `/admin/bot-findings` (ADR 0141, issue #4176). The page's
// rows come from `botFindings.listFindings`, the class prose from
// `botFindings.listClasses` — seeded from the filer's own text
// (`botCauseText`, `scripts/lib/gap-kinds.ts`), never written here.
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { isStaleMeasurement } from "@convex/botFindingsCore";
import type { EvalTerms, PositionBreakdown } from "@convex/gre";
import {
    comparePositions,
    MECHANISM_SENTENCES,
} from "@/lib/ai/decision-phrases";
import { EVAL_TERM_LABELS, EVAL_TERM_ORDER } from "@/lib/ai/eval-term-labels";
import type { FindingStatus } from "@convex/gre/ai/botFindingState";

export type BotFindingRow = FunctionReturnType<
    typeof api.botFindings.listFindings
>[number];
export type BotFindingClassRow = FunctionReturnType<
    typeof api.botFindings.listClasses
>[number];
export type BotFindingMeasurement = NonNullable<
    FunctionReturnType<typeof api.botFindings.latestMeasurement>
>;

// ── Staleness and the per-class delta (issue #4181) ───────────────────────

/** Is the finding's verdict stale — measured under a Bot hash other than the
 *  current one? Marks the row; never removes it. The rule is
 *  `isStaleMeasurement`, shared with the seed that stamps the current hash. */
export function isStaleFinding(
    finding: Pick<BotFindingRow, "botHash">,
    measurement: BotFindingMeasurement
): boolean {
    return isStaleMeasurement(finding.botHash, measurement);
}

export type StalenessFilter = "all" | "current" | "stale";

export const STALENESS_FILTERS: readonly {
    value: StalenessFilter;
    label: string;
}[] = [
    { value: "all", label: "All" },
    { value: "current", label: "Current" },
    { value: "stale", label: "Stale" },
];

/** Narrow rows by staleness. Without a measurement nothing can be judged
 *  stale, so every row passes — a filter never hides what it cannot judge. */
export function filterByStaleness<T extends Pick<BotFindingRow, "botHash">>(
    rows: readonly T[],
    filter: StalenessFilter,
    measurement: BotFindingMeasurement | null
): T[] {
    if (filter === "all" || measurement === null) return [...rows];
    return rows.filter(
        (row) => isStaleFinding(row, measurement) === (filter === "stale")
    );
}

/** The header line naming how current the page is: when the measurement ran
 *  and, when the Bot has moved since, how many rows that leaves stale. */
export function stalenessSummary(
    rows: readonly Pick<BotFindingRow, "botHash">[],
    measurement: BotFindingMeasurement
): string | null {
    const stale = rows.filter((r) => isStaleFinding(r, measurement)).length;
    if (stale === 0) return null;
    return (
        `${stale} of ${rows.length} rows were measured under an older Bot ` +
        `than the current one — treat them as stale until the next health ` +
        `batch that touches the Bot re-measures.`
    );
}

/**
 * A class's size now against its size at the measurement before the current
 * one — the effect of a landed Bot fix, read off the page instead of inferred.
 * Absent baseline (the first measurement) is said, not rendered as `0`.
 */
export function classDeltaText(cls: BotFindingClassRow): string {
    const now = `${cls.cardCount} ${cls.cardCount === 1 ? "card" : "cards"} now`;
    if (cls.previousCardCount === undefined)
        return `${now}, no earlier measurement to compare`;
    const delta = cls.cardCount - cls.previousCardCount;
    const change =
        delta === 0
            ? "no change"
            : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
    return `${now}, ${cls.previousCardCount} at the previous measurement (${change})`;
}

/**
 * The header's honesty line: how many cards were measured out of how many
 * the measured Targets hold, and the hand-written cards no Target measures —
 * so the page's count is never read as "every Bot problem" (ADR 0141,
 * Consequences).
 */
export function measurementSummary(m: BotFindingMeasurement): string {
    const unplayable = m.targetCardCount - m.measuredCount;
    return (
        `Measured ${m.measuredCount} of ${m.targetCardCount} cards in ` +
        `${m.targets.join(" + ")}` +
        (unplayable > 0 ? ` (${unplayable} ship no definition)` : "") +
        `. ${m.unmeasuredHandWrittenCount} hand-written cards sit outside ` +
        `every measured Target and were never played by the Bot.`
    );
}

/** Who owes the fix, in words (`BotReachBlame`). */
export const BLAME_LABEL: Record<
    NonNullable<BotFindingRow["blame"]>,
    string
> = {
    bot: "Bot owes a fix",
    harness: "Sweep harness owes a better position",
};

export interface ProseSegment {
    readonly text: string;
    readonly code: boolean;
}

/**
 * The filer prose is GitHub markdown (it is an issue body first). The page
 * renders its two constructs — `code` spans and **bold** — as a code span and
 * plain text respectively, without a markdown dependency: the words are the
 * filer's, only the markup is dropped.
 */
export function proseSegments(prose: string): ProseSegment[] {
    return prose
        .replace(/\*\*/g, "")
        .split("`")
        .map((text, i) => ({ text, code: i % 2 === 1 }))
        .filter((s) => s.text !== "");
}

// ── The decision behind a refusal (issue #4179) ───────────────────────────

/** A `never-chosen` finding's recorded search decision (`BotReachTrace`,
 *  `convex/gre/ai/botReachTrace.ts`, as the query returns it). */
export type BotFindingTrace = NonNullable<BotFindingRow["trace"]>;
export type BotFindingTraceSearch = NonNullable<BotFindingTrace["search"]>;
export type BotFindingTraceCandidate =
    BotFindingTraceSearch["candidates"][number];

/** What happened to the card's own move, in words (`BotReachCardMove`). */
export const CARD_MOVE_SENTENCE: Record<BotFindingTrace["cardMove"], string> = {
    pruned: "Its move was pruned before the search: dominance proved using it changes nothing.",
    collapsed:
        "Its move was folded into an interchangeable copy before the search.",
    unexpanded:
        "Its move was offered to the search but never expanded inside the budget.",
    weighed: "The search weighed its move and preferred another.",
};

/** A refusal with no search behind it: pruning left one move to make. */
export const NO_SEARCH_SENTENCE =
    "No search ran: a single move was left to make.";

/** Why the root rule picked what it picked — the SAME sentence the in-game
 *  decision box shows (`MECHANISM_SENTENCES`), so a finding and a live trace
 *  never explain one mechanism two ways. The stored mechanism is a plain
 *  string (the validator does not restate the union); one this build does not
 *  know is shown by name rather than dropped. */
export function traceMechanismSentence(mechanism: string): string {
    return (
        (MECHANISM_SENTENCES as Record<string, string | undefined>)[
            mechanism
        ] ?? `Settled by \`${mechanism}\`.`
    );
}

function sideTerms(c: BotFindingTraceCandidate, side: 0 | 1): EvalTerms {
    const out = {} as EvalTerms;
    for (const key of EVAL_TERM_ORDER) out[key] = c.terms?.[key]?.[side] ?? 0;
    return out;
}

/** The candidate's recorded terms as the `PositionBreakdown` the phrase
 *  helpers read — a term the projection dropped for being zero reads zero.
 *  Only `self`, `opp` and `total` are MEASURED: `margin` is the unweighted sum
 *  of the rounded terms and `danger` is not recorded at all (0). Sound for
 *  `comparePositions`, which reads the per-term deltas and `total` only; a
 *  reader of `margin` or `danger` would be reading numbers nobody measured. */
export function traceBreakdown(c: BotFindingTraceCandidate): PositionBreakdown {
    const self = sideTerms(c, 0);
    const opp = sideTerms(c, 1);
    const sum = (t: EvalTerms) =>
        EVAL_TERM_ORDER.reduce((acc, k) => acc + t[k], 0);
    return {
        self,
        opp,
        margin: sum(self) - sum(opp),
        danger: 0,
        total: c.total,
    };
}

/** The terse per-term line — `EVAL_TERM_LABELS`' glyphs, `self/opp`. */
export function traceTermLine(c: BotFindingTraceCandidate): string {
    if (c.terms === undefined) return "terms unavailable";
    return EVAL_TERM_ORDER.filter((k) => c.terms?.[k] !== undefined)
        .map((k) => {
            const [self, opp] = c.terms![k]!;
            return `${EVAL_TERM_LABELS[k].short}${self}/${opp}`;
        })
        .join(" ");
}

/** How a non-chosen candidate would have differed from the chosen move, in
 *  words (`comparePositions`). Empty for the chosen move itself, and for a
 *  candidate whose breakdown is unavailable on either side — no evidence is
 *  not a difference. */
export function traceComparison(
    search: BotFindingTraceSearch,
    c: BotFindingTraceCandidate
): string[] {
    const chosen = search.candidates.find((x) => x.role === "chosen");
    if (
        chosen === undefined ||
        c === chosen ||
        chosen.terms === undefined ||
        c.terms === undefined
    )
        return [];
    return comparePositions(traceBreakdown(chosen), traceBreakdown(c));
}

const ROLE_LABEL: Record<BotFindingTraceCandidate["role"], string> = {
    chosen: "chosen",
    card: "this card",
    alternative: "alternative",
};

export function traceRoleLabel(role: BotFindingTraceCandidate["role"]): string {
    return ROLE_LABEL[role];
}

/**
 * The trace as plain text — what the row shows, one line per fact, for the
 * copy-to-session payload (issue #4178) to include verbatim so a session
 * starts from the search's own evidence.
 */
export function findingTraceText(trace: BotFindingTrace): string {
    const lines = [CARD_MOVE_SENTENCE[trace.cardMove]];
    const { search } = trace;
    if (search === undefined) {
        lines.push(NO_SEARCH_SENTENCE);
        return lines.join("\n");
    }
    lines.push(
        `Search: ${search.iterations} iterations, ${search.weighed} root moves weighed, mechanism \`${search.mechanism}\`: ${traceMechanismSentence(search.mechanism)}`
    );
    for (const c of search.candidates) {
        const reading = traceComparison(search, c);
        lines.push(
            `- [${traceRoleLabel(c.role)}] ${c.label} — visits ${c.visits}, reward ${c.meanReward}, eval ${c.total}` +
                (reading.length > 0 ? `; vs chosen: ${reading.join(", ")}` : "")
        );
        lines.push(`  terms (self/opp): ${traceTermLine(c)}`);
    }
    return lines.join("\n");
}

/** Distinct, sorted values present in a column — the options an "all/…"
 *  filter select offers, so the list never names a Target/cause/blame this
 *  deployment's own rows do not carry. */
export function distinctSorted<T>(
    rows: readonly T[],
    pick: (row: T) => string | undefined
): string[] {
    return [
        ...new Set(rows.map(pick).filter((v): v is string => v !== undefined)),
    ].sort();
}

/** The Cards tab's filter state (issue #4177). Every field `""` means "all" —
 *  never a magic `"all"` string a real Target/cause/blame could collide with. */
export interface FindingFilterState {
    readonly target: string;
    readonly cause: string;
    readonly blame: string;
    readonly status: FindingStatus | "";
    readonly query: string;
}
export const EMPTY_FINDING_FILTERS: FindingFilterState = {
    target: "",
    cause: "",
    blame: "",
    status: "",
    query: "",
};

export function matchesFindingFilters(
    row: BotFindingRow,
    filters: FindingFilterState
): boolean {
    if (filters.target !== "" && !row.targets.includes(filters.target))
        return false;
    if (filters.cause !== "" && row.cause !== filters.cause) return false;
    if (filters.blame !== "" && row.blame !== filters.blame) return false;
    if (filters.status !== "" && row.status !== filters.status) return false;
    const q = filters.query.trim().toLowerCase();
    if (q !== "" && !row.name.toLowerCase().includes(q)) return false;
    return true;
}

/** The Classes tab's filter state. `query` searches the class KEY — the Ops
 *  and keywords a Bot Gap key carries (`never-chosen › Sorcery › draw`). */
export interface ClassFilterState {
    readonly target: string;
    readonly cause: string;
    readonly blame: string;
    readonly query: string;
}
export const EMPTY_CLASS_FILTERS: ClassFilterState = {
    target: "",
    cause: "",
    blame: "",
    query: "",
};

export function matchesClassFilters(
    row: BotFindingClassRow,
    filters: ClassFilterState
): boolean {
    if (
        filters.target !== "" &&
        !row.targetCounts.some(
            (t) => t.target === filters.target && t.count > 0
        )
    )
        return false;
    if (filters.cause !== "" && row.cause !== filters.cause) return false;
    if (filters.blame !== "" && row.blame !== filters.blame) return false;
    const q = filters.query.trim().toLowerCase();
    if (q !== "" && !row.key.toLowerCase().includes(q)) return false;
    return true;
}
