import type { PendingChoice } from "~/types/game";
import { Button } from "~/components/ui/button";
import ManaSymbol from "~/components/cards/mana-symbol";
import SubtypeOptionCombobox from "~/components/board/subtype-option-combobox";
import { formatOracleText } from "~/lib/oracle-text";

/** True when the option list IS an as-enters `{ kind: "subtypes" }` choice —
 *  the engine tags every such option with `subtype` (`PendingChoice.options`
 *  doc in `gre/state.ts`) and no other option-pick family sets it. The one
 *  option-pick whose list is two orders of magnitude wider than a mode list,
 *  so it gets the searchable combobox instead of the button grid. */
export function isSubtypeOptionList(
    options: NonNullable<PendingChoice["options"]>
): boolean {
    return options.length > 0 && options.every((o) => o.subtype !== undefined);
}

/** Option buttons for an `option-pick` pending choice (CR 614.12 — "as it
 *  enters, choose …"). Each author-supplied option renders one button; the
 *  chooser picks exactly one, which submits immediately. Used by the
 *  choose-body-on-entry creatures (Primal Clay's 3 body modes, Shapeshifter's
 *  number 0–7, no `color`) AND the color-choice family (Mother/Giver of
 *  Runes, Blind Seer et al. — CR 105.1) — QA: a color option used to be a
 *  plain text button ("Protection from white"), indistinguishable at a
 *  glance from the other four; `color` (set by `colorChoiceModes` /
 *  `protectionColorModes`) draws the matching `ManaSymbol` inline so the
 *  choice reads visually, same as every other color affordance in the app.
 *  `label` also runs through `formatOracleText` (not raw text) so an option
 *  embedding a mana token in its own text (Burnt Offering's "0 {B}, 3 {R}"
 *  mana-split picker) renders the symbol instead of a literal "{R}". A
 *  subtype list (Conspiracy's creature type, issue #3323) renders the
 *  searchable `SubtypeOptionCombobox` instead, through the same `onPick`.
 *  Stateless — the parent owns the submit + pending state. */
export default function PendingChoiceOptions({
    options,
    disabled,
    onPick,
}: {
    options: NonNullable<PendingChoice["options"]>;
    disabled: boolean;
    onPick: (id: string) => void;
}) {
    if (isSubtypeOptionList(options)) {
        return (
            <SubtypeOptionCombobox
                options={options}
                disabled={disabled}
                onPick={onPick}
            />
        );
    }
    return (
        <div className="flex flex-wrap justify-center gap-2 mt-1">
            {options.map((opt) => (
                <Button
                    key={opt.id}
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onPick(opt.id)}
                >
                    {opt.color && (
                        <ManaSymbol symbol={opt.color} className="size-4" />
                    )}
                    {formatOracleText(opt.label)}
                </Button>
            ))}
        </div>
    );
}
