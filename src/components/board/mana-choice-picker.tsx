import type { Color, ManaCost } from "~/types/cards";
import { colors } from "~/types/cards";
import { getColorOverrideDisplay } from "~/lib/color-override";
import AnchoredPicker, {
    AnchoredPickerRow,
} from "@/components/ui/anchored-picker";

type ManaChoicePickerProps = {
    choices: ManaCost[];
    /** Anchor point (mouse coords). Omitted when the picker is opened without a
     *  pointer event (e.g. from the ability menu) — `AnchoredPicker` then
     *  centres it on screen instead of pinning to the top-left corner. */
    position?: { x: number; y: number };
    onSelect: (index: number) => void;
    onCancel: () => void;
};

// A choice may be a single pip ({B:2}) or a multi-colour combination
// ({U:1,B:1}). Expand every coloured pip so the row shows the full mana it
// produces, not just the first.
function expandPips(cost: ManaCost): Color[] {
    return colors.flatMap((c) => Array.from({ length: cost[c] ?? 0 }, () => c));
}

// Visible label for a set of pips — "White", "Blue + Black", collapsing a
// repeated colour ("White x2") so a fixed {W}{W} option reads as one clause
// instead of a stutter. Issue #2920: this used to be the ONLY string the
// picker produced, and it lived solely in a `title` attribute — duplicated as
// both the button's accessible name and its hover tooltip, with no visible
// text at all. `getColorOverrideDisplay` is the same colour-name primitive
// `preview-body.ts` already uses for the card-preview panel.
function optionLabel(pips: Color[]): string {
    if (!pips.length) return "No mana";
    const names = pips.map((c) => getColorOverrideDisplay([c])?.name ?? c);
    const counted = new Map<string, number>();
    for (const n of names) counted.set(n, (counted.get(n) ?? 0) + 1);
    return [...counted.entries()]
        .map(([n, count]) => (count > 1 ? `${n} x${count}` : n))
        .join(" + ");
}

export default function ManaChoicePicker({
    choices,
    position,
    onSelect,
    onCancel,
}: ManaChoicePickerProps) {
    return (
        <AnchoredPicker
            position={position}
            rowCount={choices.length}
            onCancel={onCancel}
        >
            {choices.map((cost, i) => {
                const pips = expandPips(cost);
                const label = optionLabel(pips);
                return (
                    <AnchoredPickerRow
                        key={i}
                        onSelect={() => onSelect(i)}
                        className="flex-row items-center gap-2"
                    >
                        <span className="flex shrink-0 items-center gap-0.5">
                            {pips.length ? (
                                pips.map((c, p) => (
                                    <img
                                        key={p}
                                        src={`/img/symbols/${c}.svg`}
                                        alt={c}
                                        className="size-6 shrink-0"
                                    />
                                ))
                            ) : (
                                <span className="flex size-6 items-center justify-center text-xs font-semibold text-text/80">
                                    0
                                </span>
                            )}
                        </span>
                        <span className="text-display text-sm text-text">
                            {label}
                        </span>
                    </AnchoredPickerRow>
                );
            })}
        </AnchoredPicker>
    );
}
