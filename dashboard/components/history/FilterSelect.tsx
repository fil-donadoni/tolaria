import { useId } from "react";
import { FIELD_CLASS } from "../../lib/controls";

/**
 * One row-filter dropdown (PRD #3148 S3) — a caption, a native `<select>`, and
 * an `all` option that means "no filter".
 *
 * The Issues card renders three of these and the Sessions card one; before the
 * port each was a fragment of `innerHTML` with its own `<label>` markup, and
 * only one of the four actually associated the label with its control. `useId`
 * makes that association structural rather than remembered.
 *
 * The option VALUES are the raw field values — the filter compares against the
 * row, not against what the option renders — so an empty string is the "all"
 * sentinel and cannot collide with a real value the way a literal `"all"`
 * could.
 */
export function FilterSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    /** The distinct values present in the rows, already collapsed to their
     *  filter form ("(none)" for a missing family, a model TIER rather than a
     *  model id). Rendered in sorted order. */
    options: readonly string[];
    onChange: (next: string) => void;
}) {
    const id = useId();
    return (
        <div className="flex items-center gap-1.5">
            <label
                htmlFor={id}
                className="text-muted-foreground text-xs whitespace-nowrap"
            >
                {label}
            </label>
            <select
                id={id}
                className={FIELD_CLASS}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                <option value="">all</option>
                {[...options].sort().map((o) => (
                    <option key={o} value={o}>
                        {o}
                    </option>
                ))}
            </select>
        </div>
    );
}
