import { useId, useState } from "react";
import { MANUAL_COLUMN_LABEL_MAX, type ColumnId } from "@convex/deckLayout";
import { Button } from "~/components/ui/button";
import { COLUMN_DELETE_BLOCKED_REASON } from "./deck-column-actions";
import type { ZoneColumnEntry } from "./zoneColumnEntries";

export interface ZoneColumnsSheetRowProps {
    entry: ZoneColumnEntry;
    onRename?: (columnId: ColumnId, label: string) => void;
    onDelete?: (columnId: ColumnId) => void;
}

const TOUCH_TARGET = { minHeight: "var(--control-h)" } as const;
const TOUCH_SQUARE = {
    minHeight: "var(--control-h)",
    minWidth: "var(--control-h)",
} as const;

/**
 * One Column in the `Columns` sheet (issue #3677): label + count, a 44px
 * Rename (manual Columns only) and a 44px Delete that is disabled — with the
 * reason as VISIBLE text under the row, not only in an `aria-label` a touch
 * user never hears — while the engine refuses the deletion.
 */
export default function ZoneColumnsSheetRow({
    entry,
    onRename,
    onDelete,
}: ZoneColumnsSheetRowProps) {
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(entry.label);
    const reasonId = useId();

    if (renaming && onRename) {
        return (
            <li className="px-3 py-1">
                <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        onRename(entry.id, draft);
                        setRenaming(false);
                    }}
                >
                    <input
                        autoFocus
                        value={draft}
                        maxLength={MANUAL_COLUMN_LABEL_MAX}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key !== "Escape") return;
                            // Cancels the rename only: the sheet's own
                            // document-level Escape would close it too.
                            e.stopPropagation();
                            setDraft(entry.label);
                            setRenaming(false);
                        }}
                        style={TOUCH_TARGET}
                        className="input-field min-w-0 flex-1 px-2 text-sm"
                        aria-label={`Rename column ${entry.label}`}
                    />
                    <Button
                        type="submit"
                        variant="secondary"
                        aria-label={`Save name for column ${entry.label}`}
                    >
                        Save
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                            setDraft(entry.label);
                            setRenaming(false);
                        }}
                        aria-label={`Cancel renaming column ${entry.label}`}
                    >
                        Cancel
                    </Button>
                </form>
            </li>
        );
    }

    return (
        <li className="px-3 py-1">
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-parchment">
                    {entry.label}
                </span>
                <span className="shrink-0 text-xs text-text-disabled">
                    {entry.count}
                </span>
                {entry.renameable && onRename && (
                    <Button
                        type="button"
                        variant="secondary"
                        style={TOUCH_SQUARE}
                        onClick={() => {
                            setDraft(entry.label);
                            setRenaming(true);
                        }}
                        aria-label={`Rename column ${entry.label}`}
                    >
                        Rename
                    </Button>
                )}
                {onDelete && (
                    <Button
                        type="button"
                        variant="destructive"
                        style={TOUCH_SQUARE}
                        disabled={!entry.deletable}
                        onClick={() => onDelete(entry.id)}
                        aria-label={`Delete column ${entry.label}`}
                        aria-describedby={
                            entry.deletable ? undefined : reasonId
                        }
                    >
                        Delete
                    </Button>
                )}
            </div>
            {onDelete && !entry.deletable && (
                <p id={reasonId} className="pt-1 text-xs text-text-muted">
                    {COLUMN_DELETE_BLOCKED_REASON}
                </p>
            )}
        </li>
    );
}
