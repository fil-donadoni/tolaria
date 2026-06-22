import { FORMAT_IDS, FORMAT_RULES } from "@convex/formats";
import type { DeckFormatFilter as DeckFormatFilterValue } from "~/lib/session";

interface DeckFormatFilterProps {
    value: DeckFormatFilterValue;
    onChange: (filter: DeckFormatFilterValue) => void;
}

/**
 * The deck-list Format filter (PRD #509, ADR 0036, issue #513). A reusable
 * select that narrows a browsed deck list by Format: `All` plus the three
 * registered Formats (labels sourced from the code-side `FORMAT_RULES`
 * registry). Navigation only — it never gates play and never sets a deck's
 * Format. Distinct from the creation select (`FormatSelect`, #510), which has
 * no `All` option and is the authoritative immutable picker.
 */
export default function DeckFormatFilter({
    value,
    onChange,
}: DeckFormatFilterProps) {
    return (
        <label className="flex items-center gap-2 text-xs">
            <span className="text-label tracking-wide text-text-muted">
                Format
            </span>
            <select
                value={value}
                onChange={(e) =>
                    onChange(e.target.value as DeckFormatFilterValue)
                }
                className="input-field px-2 py-1 text-xs"
                aria-label="Filter decks by format"
            >
                <option value="all">All</option>
                {FORMAT_IDS.map((id) => (
                    <option key={id} value={id}>
                        {FORMAT_RULES[id].label}
                    </option>
                ))}
            </select>
        </label>
    );
}
