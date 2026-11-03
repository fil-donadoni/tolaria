import type { AlternativeCost } from "@convex/cards/types";
import AnchoredPicker, {
    AnchoredPickerRow,
} from "@/components/ui/anchored-picker";
import type { LibraryTopCastChoice } from "~/lib/card-utils";
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
    /** CR 601.2b / 118.9 (issue #7525) — the printed cast off the top of the
     *  library may ride EITHER covering permission: the one that replaces the
     *  mana cost with life (Bolas's Citadel) or one that keeps it (Mystic
     *  Forge). The printed row then reads as the life payment and a second
     *  row pays the mana cost. Server-projected
     *  (`castManaCostReplacementDeclinable`), never re-derived here. */
    replacementDeclinable?: boolean;
    /** CR 119.4 (issue #7570) — the printed row pays life rather than mana
     *  (Bolas's Citadel), with or without a second row. */
    printedPaysLife?: boolean;
    /** CR 601.2b / 118.9 (issue #7570) — how each `altCosts` entry may be paid
     *  off the top of the library, one row per choice: Petty Theft for life,
     *  and for mana under a second grant keeping its cost. Absent = one plain
     *  row each. */
    altCostChoices?: Record<string, LibraryTopCastChoice[]>;
    cardName: string;
    /** Anchor position (client px) — the picker opens next to the cast card. */
    position: { x: number; y: number };
    /** Called with the chosen alternative-cost id, or `undefined` to pay the
     *  normal mana cost; the second argument is `true` for the
     *  row that declines the replacement and pays the mana cost. */
    onSelect: (
        altCostId: string | undefined,
        declineManaCostReplacement?: true
    ) => void;
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
    replacementDeclinable = false,
    printedPaysLife = false,
    altCostChoices,
    cardName,
    position,
    onSelect,
    onCancel,
}: AltCostPickerProps) {
    const altRows = altCosts.flatMap((alt) =>
        (altCostChoices?.[alt.id] ?? [{ paysLife: false }]).map((choice) => ({
            alt,
            choice,
        }))
    );
    return (
        <AnchoredPicker
            position={position}
            rowCount={
                altRows.length +
                (printedCostAvailable ? 1 : 0) +
                (replacementDeclinable ? 1 : 0)
            }
            onCancel={onCancel}
            title={cardName}
        >
            {printedCostAvailable ? (
                <AnchoredPickerRow onSelect={() => onSelect(undefined)}>
                    <span className="text-display text-sm text-text">
                        {replacementDeclinable || printedPaysLife
                            ? "Pay life equal to its mana value"
                            : "Pay mana cost"}
                    </span>
                </AnchoredPickerRow>
            ) : null}
            {replacementDeclinable ? (
                <AnchoredPickerRow onSelect={() => onSelect(undefined, true)}>
                    <span className="text-display text-sm text-text">
                        Pay mana cost
                    </span>
                </AnchoredPickerRow>
            ) : null}
            {altRows.map(({ alt, choice }) => (
                <AnchoredPickerRow
                    key={`${alt.id}:${choice.decline ? "mana" : "default"}`}
                    onSelect={() => onSelect(alt.id, choice.decline)}
                >
                    <span className="text-display text-sm text-text">
                        {formatOracleText(alt.description)}
                    </span>
                    <span className="text-xs text-text-disabled">
                        {/* CR 702.109a — Dash still pays MANA, just a
                            DIFFERENT amount (`alt.mana`), unlike every other
                            alt cost here (Gush/evoke give up a
                            permanent/life/hand card instead of mana). */}
                        {choice.decline
                            ? "Pay its mana cost"
                            : choice.paysLife
                              ? "Pay life equal to its mana value"
                              : alt.mana
                                ? "Alternative cost — a different mana cost"
                                : "Alternative cost — instead of paying mana"}
                    </span>
                </AnchoredPickerRow>
            ))}
        </AnchoredPicker>
    );
}
