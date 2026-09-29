// View helpers for `/admin/bot-findings` (ADR 0141, issue #4176). The page's
// rows come from `botFindings.listFindings`, the class prose from
// `botFindings.listClasses` — seeded from the filer's own text
// (`botCauseText`, `scripts/lib/gap-kinds.ts`), never written here.
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import type { EvalTerms, PositionBreakdown } from "@convex/gre";
import {
    comparePositions,
    MECHANISM_SENTENCES,
} from "@/lib/ai/decision-phrases";
import { EVAL_TERM_LABELS, EVAL_TERM_ORDER } from "@/lib/ai/eval-term-labels";

export type BotFindingRow = FunctionReturnType<
    typeof api.botFindings.listFindings
>[number];
export type BotFindingClassRow = FunctionReturnType<
    typeof api.botFindings.listClasses
>[number];
export type BotFindingMeasurement = NonNullable<
    FunctionReturnType<typeof api.botFindings.latestMeasurement>
>;

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
    pruned: "Its move was pruned before the search: dominance proved casting it changes nothing.",
    collapsed:
        "Its move was folded into an interchangeable copy before the search.",
    unexpanded:
        "Its move was offered to the search but never expanded inside the budget.",
    weighed: "The search weighed its move and preferred another.",
};

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
 *  helpers read — a term the projection dropped for being zero reads zero. */
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
        lines.push("No search ran: a single move was left to make.");
        return lines.join("\n");
    }
    lines.push(
        `Search: ${search.iterations} iterations, ${search.weighed} root moves weighed, mechanism \`${search.mechanism}\` — ${traceMechanismSentence(search.mechanism)}`
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
