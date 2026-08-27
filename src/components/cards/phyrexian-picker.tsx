import type { PhyrexianSplitChoice } from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import AnchoredPicker, {
    AnchoredPickerRow,
} from "@/components/ui/anchored-picker";

type PhyrexianPickerProps = {
    /** The affordable mana-vs-life split options (CR 107.4f). */
    choices: PhyrexianSplitChoice[];
    cardName: string;
    /** Anchor position (client px) — the picker opens next to the cast card. */
    position: { x: number; y: number };
    /** Called with the chosen number of `{C/P}` pips to pay with life. */
    onSelect: (lifePips: number) => void;
    onCancel: () => void;
};

/** Cast-time split picker for a Phyrexian-mana spell (CR 107.4f — each `{C/P}`
 *  pip is paid with the colour of mana OR 2 life, the caster's choice). Shown
 *  only when BOTH legs are affordable for at least one pip (the projection gates
 *  this via `phyrexianOptions`); each button pays a distinct number of pips with
 *  life, and selecting one dispatches `announceCast` with the matching
 *  `phyrexianLifePips`. Shares its popover shell with the other cast-time
 *  pickers via `AnchoredPicker` (issue #2731). */
export default function PhyrexianPicker({
    choices,
    cardName,
    position,
    onSelect,
    onCancel,
}: PhyrexianPickerProps) {
    return (
        <AnchoredPicker
            position={position}
            rowCount={choices.length}
            onCancel={onCancel}
            title={cardName}
            subtitle="Pay Phyrexian mana ({C/P} = colour or 2 life)"
        >
            {choices.map((choice) => (
                <AnchoredPickerRow
                    key={choice.lifePips}
                    onSelect={() => onSelect(choice.lifePips)}
                    className="flex-row items-center gap-1"
                >
                    <span className="text-display inline-flex items-center gap-1 text-sm text-text">
                        <span>Pay</span>
                        <span className="inline-flex items-center">
                            {formatOracleText(choice.label)}
                        </span>
                    </span>
                </AnchoredPickerRow>
            ))}
        </AnchoredPicker>
    );
}
