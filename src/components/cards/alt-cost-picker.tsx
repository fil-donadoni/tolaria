import type { AlternativeCost } from "@convex/cards/types";
import AnchoredPicker, {
    AnchoredPickerRow,
} from "@/components/ui/anchored-picker";

type AltCostPickerProps = {
    /** The card's alternative casting costs (CR 118.9). */
    altCosts: AlternativeCost[];
    cardName: string;
    /** Anchor position (client px) — the picker opens next to the cast card. */
    position: { x: number; y: number };
    /** Called with the chosen alternative-cost id, or `undefined` to pay the
     *  normal mana cost. */
    onSelect: (altCostId: string | undefined) => void;
    onCancel: () => void;
};

/** Cast-option picker for a spell with alternative casting costs (CR 118.9 —
 *  Gush / Thwart return Islands, Fireblast sacrifices Mountains). Offers the
 *  normal mana cost plus each declared alternative; selecting one dispatches
 *  `announceCast` with the matching `alternativeCostId`. Shares its popover
 *  shell with {@link ModePicker} and the other cast-time pickers via
 *  `AnchoredPicker` (issue #2731) so the four stay in lockstep instead of each
 *  hand-rolling its own portal/clamp/row markup. */
export default function AltCostPicker({
    altCosts,
    cardName,
    position,
    onSelect,
    onCancel,
}: AltCostPickerProps) {
    return (
        <AnchoredPicker
            position={position}
            rowCount={altCosts.length}
            onCancel={onCancel}
            title={cardName}
        >
            <AnchoredPickerRow onSelect={() => onSelect(undefined)}>
                <span className="text-display text-sm text-text">
                    Pay mana cost
                </span>
            </AnchoredPickerRow>
            {altCosts.map((alt) => (
                <AnchoredPickerRow
                    key={alt.id}
                    onSelect={() => onSelect(alt.id)}
                >
                    <span className="text-display text-sm text-text">
                        {alt.description}
                    </span>
                    <span className="text-xs text-text-disabled">
                        {/* CR 702.109a — Dash still pays MANA, just a
                            DIFFERENT amount (`alt.mana`), unlike every other
                            alt cost here (Gush/evoke give up a
                            permanent/life/hand card instead of mana). */}
                        {alt.mana
                            ? "Alternative cost — a different mana cost"
                            : "Alternative cost — instead of paying mana"}
                    </span>
                </AnchoredPickerRow>
            ))}
        </AnchoredPicker>
    );
}
