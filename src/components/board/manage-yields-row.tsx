import type { ReactNode } from "react";
import { XIcon } from "lucide-react";

/** One removable entry in the "Manage yields" box (issue #3629) — a **Yield**
 *  or a remembered **Auto-order**. The remove control is a real `<button>`
 *  sized to `--control-h`, so it clears the touch-target floor on a coarse
 *  pointer the same way the stack row's yield toggle does. */
export default function ManageYieldsRow({
    title,
    detail,
    removeLabel,
    onRemove,
}: {
    title: string;
    detail?: ReactNode;
    removeLabel: string;
    onRemove: () => void;
}) {
    return (
        <li
            data-manage-yields-row
            className="flex items-start gap-2 rounded-sm border border-border-subtle py-1 pr-1 pl-2"
        >
            <div className="min-w-0 flex-1 py-1">
                <div className="text-sm break-words text-text">{title}</div>
                {detail && (
                    <div className="line-clamp-2 text-xs text-text-muted">
                        {detail}
                    </div>
                )}
            </div>
            <button
                type="button"
                data-manage-yields-remove
                aria-label={removeLabel}
                title={removeLabel}
                onClick={onRemove}
                className="flex h-[var(--control-h)] w-[var(--control-h)] shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-accent-soft/20 hover:text-text"
            >
                <XIcon aria-hidden className="h-4 w-4" />
            </button>
        </li>
    );
}
