import type { OrderingKind } from "@convex/deckLayout";

/** In render/option order. `name` is the engine's own default
 *  (`createColumnLayout`, `convex/deckLayout.ts`). */
const ORDERING_OPTIONS: readonly { value: OrderingKind; label: string }[] = [
    { value: "name", label: "Name" },
    { value: "mv", label: "Mana Value" },
    { value: "color", label: "Colour" },
    { value: "rarity", label: "Rarity" },
];

export interface ZoneOrderingSelectProps {
    /** The Zone's current Ordering — read straight off `ColumnLayout.ordering`
     *  (`convex/deckLayout.ts`), never a locally-tracked copy. */
    value: OrderingKind;
    onChange: (ordering: OrderingKind) => void;
    /** The zone's displayed name (`DeckZoneSurface`'s own `title`) — see
     *  {@link ZoneGroupingSelect}'s identical parameter. */
    zoneLabel: string;
}

/**
 * Per-Zone Ordering control (PRD #1617, issue #1624) — decides the sequence
 * cards appear in *inside* each Column a `DeckZoneSurface` renders. Orthogonal
 * to {@link ZoneGroupingSelect}, which decides which Columns exist: changing
 * Ordering re-sorts every Column in place and never moves a card to a
 * different one.
 */
export default function ZoneOrderingSelect({
    value,
    onChange,
    zoneLabel,
}: ZoneOrderingSelectProps) {
    return (
        <label className="flex items-center gap-1 text-xs text-text-muted">
            <span className="tracking-wide">Order</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as OrderingKind)}
                className="input-field px-1 py-0.5 text-xs"
                aria-label={`${zoneLabel} ordering`}
            >
                {ORDERING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
