import { useId } from "react";
import { FIELD_CLASS } from "../../lib/controls";

/**
 * One end of the date range (PRD #3148 S3).
 *
 * A native `<input type="date">`: the platform ships the picker, the locale
 * formatting and the keyboard model, and the value it exchanges is already the
 * `YYYY-MM-DD` the store's `from` / `to` parameters take — no parsing between
 * the control and the query.
 */
export function DateField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (next: string) => void;
}) {
    const id = useId();
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-muted-foreground text-xs">
                {label}
            </label>
            <input
                id={id}
                type="date"
                className={FIELD_CLASS}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}
