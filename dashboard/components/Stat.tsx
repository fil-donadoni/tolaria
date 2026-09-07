import { cn } from "@/lib/utils";
import { toneRuleClass, type Tone } from "../lib/tones";
import { Term } from "./Term";
import type { TermId } from "../glossary";

/**
 * A stat box (issue #3135, ported in PRD #3148 S2): a big rounded figure, a
 * caption that IS a glossary term, and an optional note.
 *
 * The CAPTION carries the term, not the figure — before #3135 these sections
 * were `·`-joined sentences of raw engine tokens (`pct 28.0302… ·
 * claims-held`) with no hint on the page of what any of them meant. What makes
 * this a stat box rather than a number is that the caption is a word and the
 * word can explain itself.
 *
 * `tone` paints the left rule only. Colour is never the sole carrier: the
 * caption says what the figure is, and the figure stays in the text colour.
 */
export function Stat({
    term,
    label,
    value,
    note,
    tone,
}: {
    term: TermId;
    /** Overrides the glossary's own label where the surface needs a more
     *  specific wording ("missing session markers", "busiest hour"). */
    label?: string;
    value: string;
    note?: string;
    tone?: Tone;
}) {
    return (
        <div
            className={cn(
                "bg-card rounded-md border p-2.5",
                tone && `border-l-2 ${toneRuleClass(tone)}`
            )}
        >
            <div className="text-lg leading-tight font-semibold tabular-nums">
                {value}
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs">
                <Term id={term}>{label}</Term>
            </div>
            {note ? (
                <div className="text-muted-foreground/80 mt-0.5 text-[11px]">
                    {note}
                </div>
            ) : null}
        </div>
    );
}
