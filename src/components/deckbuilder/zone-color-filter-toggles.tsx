import type { Color } from "@convex/cards/types";
import { cn } from "~/lib/utils";
import ManaSymbol from "~/components/cards/mana-symbol";

/** WUBRG, then colourless — the same order `deckLayout.ts`'s `color`
 *  Grouping generates its columns in. */
const COLOR_TOGGLES: Color[] = ["W", "U", "B", "R", "G", "C"];

export interface ZoneColorFilterTogglesProps {
    value: ReadonlySet<Color>;
    onToggle: (color: Color) => void;
    /** The zone's displayed name — see `ZoneGroupingSelect`'s identical
     *  parameter. */
    zoneLabel: string;
}

/**
 * Per-Zone WUBRG + colourless toggle row (PRD #1617, issue #1625, ADR 0075 §
 * "Filter is momentary"). The colour axis of the Zone build-time filter,
 * combined with {@link ZoneCreatureFilterSelect} by AND. An empty selection
 * means "no colour filter" — every toggle off is not the same as "match
 * nothing".
 */
export default function ZoneColorFilterToggles({
    value,
    onToggle,
    zoneLabel,
}: ZoneColorFilterTogglesProps) {
    return (
        <div
            className="flex items-center gap-0.5"
            role="group"
            aria-label={`${zoneLabel} colour filter`}
        >
            {COLOR_TOGGLES.map((color) => {
                const active = value.has(color);
                return (
                    <button
                        key={color}
                        type="button"
                        onClick={() => onToggle(color)}
                        className={cn(
                            "flex size-6 items-center justify-center rounded-full transition",
                            active
                                ? "filter-chip-active"
                                : "filter-chip-inactive"
                        )}
                        aria-pressed={active}
                        aria-label={`${zoneLabel} colour ${color}`}
                    >
                        <ManaSymbol symbol={color} className="size-4" />
                    </button>
                );
            })}
        </div>
    );
}
