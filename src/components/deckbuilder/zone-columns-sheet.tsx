import { useState } from "react";
import { MANUAL_COLUMN_LABEL_MAX, type ColumnId } from "@convex/deckLayout";
import BottomSheet from "~/components/ui/bottom-sheet";
import { Button } from "~/components/ui/button";
import ZoneColumnsSheetRow from "./zone-columns-sheet-row";
import type { ZoneColumnEntry } from "./zoneColumnEntries";

export interface ZoneColumnsSheetProps {
    open: boolean;
    onClose: () => void;
    /** The zone's displayed name — names the sheet and its add controls. */
    zoneLabel: string;
    columns: ZoneColumnEntry[];
    /** Same seam and RAW-label contract as `ZoneAddColumnControl.onAdd`: the
     *  engine normalises the label and mints the id. */
    onAdd?: (label: string) => void;
    onRename?: (columnId: ColumnId, label: string) => void;
    onDelete?: (columnId: ColumnId) => void;
}

/**
 * The Zone's Column manager on coarse-pointer surfaces (issue #3677): one
 * row per Column, an add form pinned in the footer. It replaces the per-Column
 * glyphs and the inline add control, whose targets sat far below the 44px rung
 * (ADR 0101 §2) and could not grow without starving every pile's header.
 */
export default function ZoneColumnsSheet({
    open,
    onClose,
    zoneLabel,
    columns,
    onAdd,
    onRename,
    onDelete,
}: ZoneColumnsSheetProps) {
    const [label, setLabel] = useState("");

    const footer = onAdd && (
        <form
            className="flex items-center gap-2 border-t border-[var(--hairline)] px-3 pt-2"
            onSubmit={(e) => {
                e.preventDefault();
                onAdd(label);
                setLabel("");
            }}
        >
            <input
                value={label}
                maxLength={MANUAL_COLUMN_LABEL_MAX}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Column name"
                style={{ minHeight: "var(--control-h)" }}
                className="input-field min-w-0 flex-1 px-2 text-sm"
                aria-label={`New ${zoneLabel} column name`}
            />
            <Button
                type="submit"
                variant="secondary"
                aria-label={`Create ${zoneLabel} column`}
            >
                Add
            </Button>
        </form>
    );

    return (
        <BottomSheet
            open={open}
            onClose={onClose}
            title={`${zoneLabel} columns`}
            marker="data-columns-sheet"
            footer={footer}
        >
            <ul className="py-1">
                {columns.map((entry) => (
                    <ZoneColumnsSheetRow
                        key={entry.id}
                        entry={entry}
                        onRename={onRename}
                        onDelete={onDelete}
                    />
                ))}
            </ul>
        </BottomSheet>
    );
}
