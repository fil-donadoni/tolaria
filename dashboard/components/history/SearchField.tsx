import { useId } from "react";
import { FIELD_CLASS } from "../../lib/controls";

/**
 * A table's free-text search box (PRD #3148 S3).
 *
 * `type="search"` is load bearing twice over. The keyboard layer's `/` focuses
 * the FIRST `input[type="search"]` inside the visible view (#2635), so this is
 * the selector that shortcut resolves; and `isTypingTarget` (`shortcuts.ts`)
 * treats it as a text field, which is what stops typing `1` into it from
 * jumping to the Now view.
 */
export function SearchField({
    value,
    placeholder,
    onChange,
}: {
    value: string;
    placeholder: string;
    onChange: (next: string) => void;
}) {
    const id = useId();
    return (
        <div className="flex items-center gap-1.5">
            <label
                htmlFor={id}
                className="text-muted-foreground text-xs whitespace-nowrap"
            >
                search
            </label>
            <input
                id={id}
                type="search"
                className={`${FIELD_CLASS} min-w-[12rem]`}
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}
