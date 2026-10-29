import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Restore indicator for a minimized `GameDialog` (issue #6984). Same HUD-chip
 *  shape as the board's `MinimizedChoiceIndicator` (pulsing amber dot, display
 *  label, restore glyph), but self-contained: it needs no board context, so a
 *  dialog outside a game (lobby, deck builder, admin…) collapses to an
 *  equivalent chip. Pinned top-centre and click-through around the chip, so
 *  the page underneath stays reachable. Restoring is a pure view toggle. */
export default function MinimizedDialogChip({
    label,
    onRestore,
}: {
    label: string;
    onRestore: () => void;
}) {
    return (
        <div
            data-minimized-dialog-chip
            className="pointer-events-none fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] z-modal flex justify-center px-3"
        >
            <button
                type="button"
                onClick={onRestore}
                aria-label={`Restore dialog: ${label}`}
                className={cn(
                    "pointer-events-auto inline-flex max-w-[22rem] cursor-pointer items-center justify-center gap-2 rounded-full border border-border-strong bg-surface/85 px-4 py-2 text-sm text-text backdrop-blur-md transition-colors hover:bg-surface-elevated"
                )}
            >
                <span
                    aria-hidden
                    className="dot-pulse-ring size-2.5 shrink-0 rounded-full bg-signal-pending"
                />
                <span className="text-display truncate">{label} — open</span>
                <Maximize2 className="h-3.5 w-3.5 shrink-0 opacity-80" />
            </button>
        </div>
    );
}
