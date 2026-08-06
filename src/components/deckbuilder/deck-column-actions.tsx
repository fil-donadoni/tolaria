import { useState } from "react";
import { MANUAL_COLUMN_LABEL_MAX } from "@convex/deckLayout";

/** The one reason a Column can refuse to be deleted (ADR 0075 §2: "deletable
 *  only while empty"), shown to the player rather than left as a dead control.
 *  Exported so the mounted test asserts the SAME string the UI renders. */
export const COLUMN_DELETE_BLOCKED_REASON =
    "Move its cards out first — a column can only be deleted while it is empty.";

export interface DeckColumnActionsProps {
    columnId: string;
    label: string;
    /** Renaming is offered for MANUAL Columns only: a generated Column's label
     *  is derived from its Grouping (`MV 5`, `White`) and would be regenerated
     *  over on the next resolve, and the Catch-All's label is fixed. */
    onRename?: (columnId: string, label: string) => void;
    /** Absent = this Column can never be deleted (the Catch-All). Present with
     *  `deletable: false` = it could be, but is not empty right now — which is
     *  rendered as a disabled control carrying the reason, never as a missing
     *  one, so the rule is discoverable instead of mysterious. */
    onDelete?: (columnId: string) => void;
    deletable: boolean;
}

/**
 * The rename/delete controls in one Column's header (ADR 0075 §2, PRD #1617
 * stories 17–20, issue #1626).
 *
 * The delete rule is the whole point and is enforced by the ENGINE
 * (`canDeleteColumn`), computed over the column's UNFILTERED cards: a Zone
 * filter hides cards without emptying a Column, so judging deletability on
 * what is currently VISIBLE would let a filter authorise a deletion that
 * displaces the cards it is hiding — exactly the "a deletion can never lose a
 * card" guarantee the empty-only rule exists to give.
 */
export default function DeckColumnActions({
    columnId,
    label,
    onRename,
    onDelete,
    deletable,
}: DeckColumnActionsProps) {
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(label);

    if (renaming && onRename) {
        return (
            <form
                className="flex items-center gap-0.5"
                onSubmit={(e) => {
                    e.preventDefault();
                    onRename(columnId, draft);
                    setRenaming(false);
                }}
            >
                <input
                    autoFocus
                    value={draft}
                    maxLength={MANUAL_COLUMN_LABEL_MAX}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            setDraft(label);
                            setRenaming(false);
                        }
                    }}
                    className="input-field w-full min-w-0 px-1 py-0 text-[11px]"
                    aria-label={`Rename column ${label}`}
                />
                <button
                    type="submit"
                    className="shrink-0 px-0.5 text-[11px] text-text-muted hover:text-parchment"
                    aria-label={`Save name for column ${label}`}
                >
                    ✓
                </button>
            </form>
        );
    }

    return (
        <span className="flex shrink-0 items-center gap-0.5">
            {onRename && (
                <button
                    type="button"
                    onClick={() => {
                        setDraft(label);
                        setRenaming(true);
                    }}
                    className="px-0.5 text-[11px] text-text-muted hover:text-parchment"
                    aria-label={`Rename column ${label}`}
                    title={`Rename column ${label}`}
                >
                    ✎
                </button>
            )}
            {onDelete && (
                <button
                    type="button"
                    disabled={!deletable}
                    onClick={() => onDelete(columnId)}
                    className="px-0.5 text-[11px] text-text-muted enabled:hover:text-danger-strong disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={
                        deletable
                            ? `Delete column ${label}`
                            : `Cannot delete column ${label}. ${COLUMN_DELETE_BLOCKED_REASON}`
                    }
                    title={
                        deletable
                            ? `Delete column ${label}`
                            : COLUMN_DELETE_BLOCKED_REASON
                    }
                >
                    ✕
                </button>
            )}
        </span>
    );
}
