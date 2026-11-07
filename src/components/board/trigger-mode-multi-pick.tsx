import { useState } from "react";
import type { PendingChoice } from "~/types/game";
import { Button } from "~/components/ui/button";
import MultiModeRow from "~/components/cards/multi-mode-row";
import {
    canAddModePick,
    canConfirmModePicks,
    chosenModeIdsFromCounts,
    modePickerHeading,
    offeredModeConstraint,
} from "~/lib/mode-picker-constraint";

/** CR 603.3c / 700.2 — answers a modal triggered ability that can announce more
 *  than one mode. It lives inside the choice banner: the ability is already on
 *  the stack, so unlike the cast-time `MultiModePicker` there is nothing to
 *  cancel. Nothing is submitted until Confirm; the ids go in printed order. */
export default function TriggerModeMultiPick({
    choice,
    disabled,
    onConfirm,
}: {
    choice: PendingChoice;
    disabled: boolean;
    onConfirm: (modeIds: string[]) => void;
}) {
    const [counts, setCounts] = useState<Record<string, number>>({});
    const step = (modeId: string, delta: number) =>
        setCounts((prev) => ({
            ...prev,
            [modeId]: Math.max(0, (prev[modeId] ?? 0) + delta),
        }));
    const constraint = offeredModeConstraint(choice);
    const modes = (choice.options ?? []).map((option) => ({
        ...option,
        oracleText: option.oracleText ?? "",
    }));

    return (
        <div className="flex w-full flex-col gap-1.5 mt-1">
            <p className="text-text-disabled text-xs text-center">
                {modePickerHeading(constraint)}
                {constraint.repeats
                    ? " — you may choose the same mode more than once"
                    : ""}
            </p>
            {modes.map((mode) => (
                <MultiModeRow
                    key={mode.id}
                    mode={mode}
                    count={counts[mode.id] ?? 0}
                    repeats={constraint.repeats}
                    legal
                    canAdd={canAddModePick(constraint, counts, mode.id)}
                    onAdd={() => step(mode.id, 1)}
                    onRemove={() => step(mode.id, -1)}
                />
            ))}
            <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={disabled || !canConfirmModePicks(constraint, counts)}
                onClick={() =>
                    onConfirm(chosenModeIdsFromCounts(modes, counts))
                }
            >
                Confirm
            </Button>
        </div>
    );
}
