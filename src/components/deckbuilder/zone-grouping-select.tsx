import type { GroupingKind } from "@convex/deckLayout";

/** In render/option order — mirrors the ladder `generateColumns` produces for
 *  each Grouping (`convex/deckLayout.ts`): Mana Value first (today's default),
 *  then colour, then type, then no grouping at all. */
const GROUPING_OPTIONS: readonly { value: GroupingKind; label: string }[] = [
    { value: "mv", label: "Mana Value" },
    { value: "color", label: "Colour" },
    { value: "type", label: "Type" },
    { value: "none", label: "None" },
];

export interface ZoneGroupingSelectProps {
    /** The Zone's current Grouping — read straight off `ColumnLayout.grouping`
     *  (`convex/deckLayout.ts`), never a locally-tracked copy. */
    value: GroupingKind;
    onChange: (grouping: GroupingKind) => void;
    /** The zone's displayed name (`DeckZoneSurface`'s own `title`), used only
     *  to keep the Maindeck and Sideboard controls distinguishable to screen
     *  readers and to the mounted tests (`aria-label`, e.g. "Maindeck grouping"). */
    zoneLabel: string;
}

/**
 * Per-Zone Grouping control (PRD #1617, issue #1624) — decides which
 * **Columns** a `DeckZoneSurface` generates (Mana Value / colour / type /
 * none). Orthogonal to {@link ZoneOrderingSelect}, which only reorders cards
 * *inside* a column: this control never touches ordering, and changing it
 * never erases a Card Pin (ADR 0075 §3 — `setGrouping` only ever changes the
 * `grouping` field, `pins` survive untouched).
 */
export default function ZoneGroupingSelect({
    value,
    onChange,
    zoneLabel,
}: ZoneGroupingSelectProps) {
    return (
        <label className="flex items-center gap-1 text-xs text-text-muted">
            <span className="tracking-wide">Group</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as GroupingKind)}
                className="input-field px-1 py-0.5 text-xs"
                aria-label={`${zoneLabel} grouping`}
            >
                {GROUPING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
