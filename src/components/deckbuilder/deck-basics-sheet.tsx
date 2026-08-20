import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * The basic-lands BOTTOM SHEET (issue #2584, PRD #2405 slice 5).
 *
 * `PoolBasicLandsBar` is the ONE basics bar both builders already share
 * (#1627/#1629) and it stays that — this only changes WHERE it is mounted on a
 * phone. Inline, it is a permanent band of five steppers plus an art picker
 * competing with the card panes for a 844px-tall screen; behind the bottom
 * bar's `Lands` button it costs nothing until asked for.
 *
 * Modal, unlike the Peek Panel: adding lands is a deliberate detour, not the
 * "tap the next card" flow the panel has to stay out of the way of. A tap on
 * the scrim closes it.
 */
export default function DeckBasicsSheet({
    open,
    onClose,
    children,
}: {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
}) {
    if (!open) return null;
    return createPortal(
        <div
            data-basics-sheet
            role="dialog"
            aria-modal="true"
            aria-label="Basic lands"
            className="z-modal modal-scrim fixed inset-0 flex items-end"
            onClick={onClose}
        >
            <div
                className="max-h-[70dvh] w-full overflow-y-auto rounded-t-lg border-t border-accent bg-surface pb-[max(0.5rem,env(safe-area-inset-bottom))]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-3 pt-2">
                    <span className="font-beleren text-sm text-parchment">
                        Basic lands
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close basic lands"
                        style={{
                            minHeight: "var(--control-h)",
                            minWidth: "var(--control-h)",
                        }}
                        className="flex items-center justify-center rounded-full text-text-muted hover:text-parchment"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body
    );
}
