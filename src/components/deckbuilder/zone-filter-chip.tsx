export interface ZoneFilterChipProps {
    /** From `zoneFilterSummary` — the caller only renders this chip while
     *  `isZoneFilterActive` is true, so `summary` is never empty in
     *  practice. */
    summary: string;
    onClear: () => void;
    /** The zone's displayed name — see `ZoneGroupingSelect`'s identical
     *  parameter. */
    zoneLabel: string;
}

/**
 * The "an obvious clearable chip shows what is filtered" guarantee (issue
 * #1625 AC, ADR 0075 § "Filter is momentary"). Hiding is dangerous in an
 * editor, so a filtered Zone never leaves the player to rediscover the
 * Grouping/Ordering row to find out why cards vanished — this chip names the
 * filter and clears it in one click.
 */
export default function ZoneFilterChip({
    summary,
    onClear,
    zoneLabel,
}: ZoneFilterChipProps) {
    return (
        <button
            type="button"
            onClick={onClear}
            className="filter-chip-active flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            aria-label={`Clear ${zoneLabel} filter: ${summary}`}
            title={`Clear filter: ${summary}`}
        >
            <span>{summary}</span>
            <span aria-hidden="true">✕</span>
        </button>
    );
}
