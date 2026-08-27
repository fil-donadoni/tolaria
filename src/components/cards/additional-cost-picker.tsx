import type { AdditionalCostLeg } from "@convex/cards/types";
import AnchoredPicker, {
    AnchoredPickerRow,
} from "@/components/ui/anchored-picker";

type AdditionalCostPickerProps = {
    /** The PAYABLE legs of the card's caster-chosen additional cost
     *  (CR 601.2b) — already filtered by `payableAdditionalCostLegsForCard`,
     *  so every row here is one `announceCast` accepts. */
    legs: ReadonlyArray<AdditionalCostLeg>;
    cardName: string;
    /** Anchor position (client px) — the picker opens next to the cast card. */
    position: { x: number; y: number };
    /** Called with the chosen `AdditionalCostLeg.id`. */
    onSelect: (legId: string) => void;
    onCancel: () => void;
};

/** Cast-time picker for a CASTER-CHOSEN additional cost (CR 601.2b / 118.8 —
 *  Bitter Triumph's "As an additional cost to cast this spell, discard a card
 *  or pay 3 life"). The choice is made at ANNOUNCEMENT, before targets
 *  (CR 601.2c) and before any mana is paid (CR 601.2h), so it is collected here
 *  and dispatched as `announceCast`'s `additionalCostLegId` — the same
 *  plain-argument shape `ModePicker` (CR 700.2) and `AltCostPicker` (CR 118.9)
 *  use, never a server-raised pending choice.
 *
 *  Unlike `AltCostPicker` there is NO "pay the normal cost" row: an additional
 *  cost is paid ALONGSIDE the mana cost (CR 118.8), never instead of it, and a
 *  disjunction obliges exactly one leg. Shares its popover shell with the
 *  other cast-time pickers via `AnchoredPicker` (issue #2731). */
export default function AdditionalCostPicker({
    legs,
    cardName,
    position,
    onSelect,
    onCancel,
}: AdditionalCostPickerProps) {
    return (
        <AnchoredPicker
            position={position}
            rowCount={legs.length}
            onCancel={onCancel}
            title={cardName}
        >
            {legs.map((leg) => (
                <AnchoredPickerRow
                    key={leg.id}
                    onSelect={() => onSelect(leg.id)}
                    data-testid={`additional-cost-leg-${leg.id}`}
                >
                    <span className="text-display text-sm text-text">
                        {leg.label}
                    </span>
                    <span className="text-xs text-text-disabled">
                        Additional cost — paid as well as the mana cost
                    </span>
                </AnchoredPickerRow>
            ))}
        </AnchoredPicker>
    );
}
