import type { AlternativeCost } from "@convex/cards/types";
import AnchoredPicker, {
    AnchoredPickerRow,
} from "@/components/ui/anchored-picker";
import { formatOracleText } from "~/lib/oracle-text";

type AltCostPickerProps = {
    /** The card's alternative casting costs (CR 118.9). */
    altCosts: AlternativeCost[];
    /** CR 601.3c / 118.9b (issue #3280) — whether paying the PRINTED mana cost
     *  is a legal announcement right now. `false` when a board permission that
     *  waives the mana cost is the only thing licensing the cast (Aluren, off
     *  the caster's sorcery window): the permission's free cast is MANDATORY,
     *  so the "Pay mana cost" row would be a click the mutation is guaranteed
     *  to refuse and is not rendered. Server-projected
     *  (`printedCostCastUnavailable`), never re-derived here. */
    printedCostAvailable: boolean;
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
    printedCostAvailable,
    cardName,
    position,
    onSelect,
    onCancel,
}: AltCostPickerProps) {
    return (
        <AnchoredPicker
            position={position}
            rowCount={altCosts.length + (printedCostAvailable ? 1 : 0)}
            onCancel={onCancel}
            title={cardName}
        >
            {printedCostAvailable ? (
                <AnchoredPickerRow onSelect={() => onSelect(undefined)}>
                    <span className="text-display text-sm text-text">
                        Pay mana cost
                    </span>
                </AnchoredPickerRow>
            ) : null}
            {altCosts.map((alt) => (
                <AnchoredPickerRow
                    key={alt.id}
                    onSelect={() => onSelect(alt.id)}
                >
                    <span className="text-display text-sm text-text">
                        {formatOracleText(alt.description)}
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
