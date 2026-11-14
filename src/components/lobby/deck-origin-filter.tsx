import type {
    DeckOriginFilter as DeckOriginFilterValue,
    DeckOriginOption,
} from "~/lib/deckOriginFilter";

interface DeckOriginFilterProps {
    value: DeckOriginFilterValue;
    options: readonly DeckOriginOption[];
    onChange: (origin: DeckOriginFilterValue) => void;
}

/**
 * The deck list's second-level filter (issue #2818, ADR 0106): `All` plus the
 * Limited Origins the player's own decks carry. Shown by the Decks section
 * only while the Format filter is on Limited. Navigation only.
 */
export default function DeckOriginFilter({
    value,
    options,
    onChange,
}: DeckOriginFilterProps) {
    return (
        <label className="flex items-center gap-2 text-xs">
            <span className="text-label tracking-wide text-text-muted">
                Origin
            </span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="input-field px-2 py-1 text-xs"
                aria-label="Filter Limited decks by origin"
            >
                <option value="all">All</option>
                {options.map((o) => (
                    <option key={o.key} value={o.key}>
                        {o.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
