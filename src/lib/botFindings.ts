// View helpers for `/admin/bot-findings` (ADR 0141, issue #4176). The page's
// rows come from `botFindings.listFindings`, the class prose from
// `botFindings.listClasses` — seeded from the filer's own text
// (`botCauseText`, `scripts/lib/gap-kinds.ts`), never written here.
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

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
