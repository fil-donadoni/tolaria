import { useState } from "react";
import type { Color, ModeOption } from "@convex/cards/types";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import MultiModeRow from "~/components/cards/multi-mode-row";
import {
    canAddModePick,
    canConfirmModePicks,
    chosenModeIdsFromCounts,
    modePickerHeading,
    modePickerShortfallNote,
    type ModePickerConstraint,
} from "~/lib/mode-picker-constraint";

type MultiModePickerProps = {
    modes: ReadonlyArray<ModeOption & { color?: Color }>;
    cardName: string;
    constraint: ModePickerConstraint;
    /** The chosen ids in printed order, repeats consecutive (CR 700.2d). */
    onConfirm: (modeIds: string[]) => void;
    onCancel: () => void;
};

/** CR 700.2a / 700.2d (ADR 0094, issue #2264) — the mode picker for a mode
 *  list that declares a `ModeSelection`. Unlike the single-mode picker it does
 *  not commit on the first click: the player builds the pick (a counter per
 *  mode when repeats are allowed), the header states the declared count, and
 *  Confirm stays disabled until the count is met — or, under a CR 609.3
 *  shortfall, until every mode that CAN be chosen has been. */
export default function MultiModePicker({
    modes,
    cardName,
    constraint,
    onConfirm,
    onCancel,
}: MultiModePickerProps) {
    const [counts, setCounts] = useState<Record<string, number>>({});
    const step = (modeId: string, delta: number) =>
        setCounts((prev) => ({
            ...prev,
            [modeId]: Math.max(0, (prev[modeId] ?? 0) + delta),
        }));
    const shortfallNote = modePickerShortfallNote(constraint);
    const canConfirm = canConfirmModePicks(constraint, counts);

    return (
        <GameDialog
            open
            onOpenChange={(open) => {
                if (!open) onCancel();
            }}
            title={cardName}
            subtitle={
                constraint.repeats
                    ? `${modePickerHeading(constraint)} — you may choose the same mode more than once`
                    : modePickerHeading(constraint)
            }
            dismissable
            footer={
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        disabled={!canConfirm}
                        onClick={() =>
                            onConfirm(chosenModeIdsFromCounts(modes, counts))
                        }
                    >
                        Confirm
                    </Button>
                </div>
            }
        >
            <div className="mt-2 flex flex-col gap-1.5">
                {shortfallNote && (
                    <p data-mode-shortfall className="text-xs text-text-muted">
                        {shortfallNote}
                    </p>
                )}
                {modes.map((mode) => (
                    <MultiModeRow
                        key={mode.id}
                        mode={mode}
                        count={counts[mode.id] ?? 0}
                        repeats={constraint.repeats}
                        legal={constraint.legalModeIds.includes(mode.id)}
                        canAdd={canAddModePick(constraint, counts, mode.id)}
                        onAdd={() => step(mode.id, 1)}
                        onRemove={() => step(mode.id, -1)}
                    />
                ))}
            </div>
        </GameDialog>
    );
}
