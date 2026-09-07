import { CHIP_CLASS } from "../../lib/controls";

/**
 * One value of the current split, on or off (PRD #3148 S3).
 *
 * `aria-pressed` is the state — not a class the eye reads and a screen reader
 * does not. The fill follows it, and so does the border, because colour is
 * never the only carrier on this page.
 */
export function FilterChip({
    value,
    active,
    onToggle,
}: {
    value: string;
    active: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            className={CHIP_CLASS}
            aria-pressed={active}
            onClick={onToggle}
        >
            {value}
        </button>
    );
}
