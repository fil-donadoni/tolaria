import { cn } from "~/lib/utils";
import type { ZoneCreatureFilter } from "./deckZoneFilter";

/** In render order — the default first, mirroring every other Zone control's
 *  no-op-first convention (`ZoneGroupingSelect`, `ZoneOrderingSelect`). */
const CREATURE_FILTER_LABELS: Record<ZoneCreatureFilter, string> = {
    all: "All",
    creatures: "Creatures",
    "non-creatures": "Non-creatures",
};
const CREATURE_FILTER_ORDER: ZoneCreatureFilter[] = [
    "all",
    "creatures",
    "non-creatures",
];

export interface ZoneCreatureFilterSelectProps {
    value: ZoneCreatureFilter;
    onChange: (value: ZoneCreatureFilter) => void;
    /** The zone's displayed name — see `ZoneGroupingSelect`'s identical
     *  parameter (keeps the Maindeck and Sideboard controls distinguishable
     *  to screen readers and to the mounted tests). */
    zoneLabel: string;
}

/**
 * Per-Zone creature/non-creature segmented control (PRD #1617, issue #1625,
 * ADR 0075 § "Filter is momentary"). One of the two axes of the Zone build-
 * time filter, combined with {@link ZoneColorFilterToggles} by AND — a card
 * must match BOTH to stay visible. Purely a view narrowing: it never touches
 * the Column Layout, a Card Pin, or anything persisted.
 */
export default function ZoneCreatureFilterSelect({
    value,
    onChange,
    zoneLabel,
}: ZoneCreatureFilterSelectProps) {
    return (
        <div
            className="flex items-center gap-1 rounded-sm border border-border-subtle/40 bg-surface-elevated/20 p-0.5 text-[11px]"
            role="group"
            aria-label={`${zoneLabel} creature filter`}
        >
            {CREATURE_FILTER_ORDER.map((option) => (
                <button
                    key={option}
                    type="button"
                    onClick={() => onChange(option)}
                    className={cn(
                        "segment-pill",
                        value === option ? "segment-active" : "segment-inactive"
                    )}
                    aria-pressed={value === option}
                >
                    {CREATURE_FILTER_LABELS[option]}
                </button>
            ))}
        </div>
    );
}
