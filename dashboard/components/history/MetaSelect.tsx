import { useId } from "react";
import { FIELD_CLASS } from "../../lib/controls";
import { DynamicTerm } from "../DynamicTerm";
import { labelFor } from "../../glossary";

/**
 * One picker of the shared filter bar (PRD #3148 S3) — dataset, metric or
 * split.
 *
 * EVERY OPTION RENDERS THE GLOSSARY LABEL, never the raw column name (#2633):
 * `agent_runs` reads "subagent runs", `cmd_bucket` reads "command family". The
 * option VALUE stays the raw key, because that is what the query layer and the
 * URL round trip both key on — only the visible text changes.
 *
 * The options are looked up QUALIFIED by the current dataset first, because
 * the same name can mean something different per table (`agent_runs.messages`
 * is `sum(msgs)`, `llm.messages` is `count(*)`); `lookupTerm` falls back to the
 * bare term when no qualified entry exists.
 *
 * The CAPTION carries the tooltip for the CURRENT selection, which is what
 * makes "Metric" hoverable and useful rather than a word nobody needs
 * explained. In the vanilla bar that was a `data-term` attribute the tooltip
 * engine had to be told to re-read after a metric-only change
 * (`syncMetricLabelTerm`); here the caption re-renders with the value, so the
 * two cannot fall out of step.
 */
export function MetaSelect({
    caption,
    value,
    options,
    scope,
    onChange,
}: {
    caption: string;
    value: string;
    options: readonly string[];
    /** The dataset that qualifies the glossary lookup. `undefined` for the
     *  dataset picker itself, whose options ARE the datasets. */
    scope?: string;
    onChange: (next: string) => void;
}) {
    const id = useId();
    return (
        <div className="flex flex-col gap-1">
            <label
                htmlFor={id}
                className="text-muted-foreground text-xs whitespace-nowrap"
            >
                <DynamicTerm term={scope ? `${scope}.${value}` : value}>
                    {caption}
                </DynamicTerm>
            </label>
            <select
                id={id}
                className={FIELD_CLASS}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                {options.map((o) => (
                    <option key={o} value={o}>
                        {labelFor(o, scope)}
                    </option>
                ))}
            </select>
        </div>
    );
}
