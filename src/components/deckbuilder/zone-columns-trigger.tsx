import { useState } from "react";
import type { ColumnId } from "@convex/deckLayout";
import { Button } from "~/components/ui/button";
import ZoneColumnsSheet from "./zone-columns-sheet";
import type { ZoneColumnEntry } from "./zoneColumnEntries";

export interface ZoneColumnsTriggerProps {
    zoneLabel: string;
    columns: ZoneColumnEntry[];
    onAdd?: (label: string) => void;
    onRename?: (columnId: ColumnId, label: string) => void;
    onDelete?: (columnId: ColumnId) => void;
}

/**
 * The ONE Zone-header control that manages a Zone's Columns on `phone` and
 * `roomy-coarse` surfaces (issue #3677) — the coarse-pointer twin of the
 * per-Column glyphs plus `ZoneAddColumnControl`. A `Button` sized by
 * `--control-h` (44px on a coarse pointer), opening `ZoneColumnsSheet`.
 */
export default function ZoneColumnsTrigger({
    zoneLabel,
    columns,
    onAdd,
    onRename,
    onDelete,
}: ZoneColumnsTriggerProps) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                style={{ minHeight: "var(--control-h)" }}
                aria-haspopup="dialog"
                aria-label={`Manage ${zoneLabel} columns`}
                onClick={() => setOpen(true)}
            >
                Columns
            </Button>
            <ZoneColumnsSheet
                open={open}
                onClose={() => setOpen(false)}
                zoneLabel={zoneLabel}
                columns={columns}
                onAdd={onAdd}
                onRename={onRename}
                onDelete={onDelete}
            />
        </>
    );
}
