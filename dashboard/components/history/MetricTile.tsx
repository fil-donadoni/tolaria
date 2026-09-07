import { DynamicTerm } from "../DynamicTerm";

/**
 * One History tile (PRD #3148 S3) — a figure, the glossary term that names it,
 * and an optional note under it.
 *
 * A sibling of `<Stat>` rather than a use of it, for one reason: every key
 * here is composed at RUNTIME from the current dataset (`agent_runs.cost`,
 * `llm.messages`), so it cannot be a `TermId` and cannot go through the typed
 * door. Same narrow exception the Now view's `<DynamicStat>` carves out, for
 * the same reason and no wider.
 */
export function MetricTile({
    term,
    label,
    value,
    note,
}: {
    /** The QUALIFIED glossary key — `"<dataset>.<metric>"`. `lookupTerm`
     *  falls back to the bare term when no qualified entry exists, so the
     *  caller always declares the most specific form it knows. */
    term: string;
    label: string;
    value: string;
    note?: string;
}) {
    return (
        <div className="bg-card rounded-md border p-2.5">
            <div className="text-lg leading-tight font-semibold tabular-nums">
                {value}
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs">
                <DynamicTerm term={term}>{label}</DynamicTerm>
            </div>
            {note ? (
                <div className="text-muted-foreground/80 mt-0.5 text-[11px]">
                    {note}
                </div>
            ) : null}
        </div>
    );
}
