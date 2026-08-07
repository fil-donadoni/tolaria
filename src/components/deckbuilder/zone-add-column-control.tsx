import { useState } from "react";
import { MANUAL_COLUMN_LABEL_MAX } from "@convex/deckLayout";

export interface ZoneAddColumnControlProps {
    /** Receives the RAW label — the Column Layout engine normalises it and
     *  mints the collision-free `custom:` id (`manualColumnIdForLabel`), so
     *  this control never invents an id of its own. */
    onAdd: (label: string) => void;
    /** The zone's displayed name (`DeckZoneSurface`'s own `title`), used only
     *  to keep the Maindeck and Sideboard controls distinguishable to screen
     *  readers and to the mounted tests — the same parameter every other
     *  control in this row takes. */
    zoneLabel: string;
}

/**
 * The "add column" affordance (ADR 0075 §2, PRD #1617 story 17, issue #1626) —
 * creates a **manual Column** in this Zone: a label with no predicate, so
 * nothing ever lands in it except by a drag or a pin, and it exists under
 * EVERY Grouping of its Zone.
 *
 * A disclosed inline input rather than a modal: naming a column is a workbench
 * gesture made while looking at the board, and a dialog would cover the very
 * columns the player is deciding between. The input is uncontrolled-by-parent
 * (its draft label is this control's own state) so typing a name never
 * re-renders the zone's cards.
 */
export default function ZoneAddColumnControl({
    onAdd,
    zoneLabel,
}: ZoneAddColumnControlProps) {
    const [open, setOpen] = useState(false);
    const [label, setLabel] = useState("");

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="filter-chip-inactive shrink-0 rounded-full px-2 py-0.5 text-[11px] transition"
                aria-label={`Add ${zoneLabel} column`}
                title="Add a column you can drag cards into"
            >
                + Column
            </button>
        );
    }

    const submit = () => {
        onAdd(label);
        setLabel("");
        setOpen(false);
    };

    return (
        <form
            className="flex shrink-0 items-center gap-1"
            onSubmit={(e) => {
                e.preventDefault();
                submit();
            }}
        >
            <input
                autoFocus
                value={label}
                maxLength={MANUAL_COLUMN_LABEL_MAX}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        setLabel("");
                        setOpen(false);
                    }
                }}
                placeholder="Column name"
                className="input-field w-28 px-1.5 py-0.5 text-xs"
                aria-label={`New ${zoneLabel} column name`}
            />
            <button
                type="submit"
                className="filter-chip-inactive rounded-full px-2 py-0.5 text-[11px] transition"
                aria-label={`Create ${zoneLabel} column`}
            >
                Add
            </button>
            <button
                type="button"
                onClick={() => {
                    setLabel("");
                    setOpen(false);
                }}
                className="filter-chip-inactive rounded-full px-1.5 py-0.5 text-[11px] transition"
                aria-label={`Cancel new ${zoneLabel} column`}
            >
                ✕
            </button>
        </form>
    );
}
