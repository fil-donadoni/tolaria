import { SORT_OPTIONS, type SortKey } from "./cardSort";

interface SortSelectProps {
    /** Current sort key. */
    value: SortKey;
    onChange: (sort: SortKey) => void;
}

/**
 * Result ordering dropdown (single-select) for the deck-builder card search.
 * Orders the matched cards by mana value (default), name, set, or colour — the
 * colour ordering follows WUBRG combinatorial order with lands last (see
 * `cardSort.ts`). Purely a view concern: it never changes which cards match.
 */
export default function SortSelect({ value, onChange }: SortSelectProps) {
    return (
        <label className="flex items-center gap-2 text-sm">
            <span className="text-label tracking-wide text-text-muted">
                Sort
            </span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as SortKey)}
                className="input-field px-2 py-1"
                aria-label="Sort cards"
            >
                {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
