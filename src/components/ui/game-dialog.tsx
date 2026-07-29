import * as React from "react";
import { Minus } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Panel, SunburstIcon, type PanelDensity } from "@/components/ui/panel";

type GameDialogSize = "default" | "wide";

type GameDialogProps = {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    /** Optional stat row under the title rule (e.g. life or count
     *  before/after). Render small chip atoms here; omit for none. */
    stats?: React.ReactNode;
    /** Optional footer action row, kept clear of the corner filigree with
     *  generous bottom padding. When omitted, render actions inside `children`
     *  (existing call-sites do this and keep working). */
    footer?: React.ReactNode;
    size?: GameDialogSize;
    dismissable?: boolean;
    showCloseButton?: boolean;
    /** Minimize affordance (issue #315). When provided, a minimize control is
     *  shown in the top-right; clicking it invokes this callback. Used by the
     *  blocking library-pick modal so the chooser can collapse it to the board
     *  indicator without dismissing the underlying Pending Choice. */
    onMinimize?: () => void;
    /** Panel padding passthrough (issue #1817, opus review round 2). Opt-in —
     *  defaults to `"default"` (`p-6` at every width, unchanged for the ~10
     *  other `size="wide"` dialogs). The pile browser passes
     *  `"compact-mobile"` so its grid gets more room on a phone without
     *  touching anyone else. See `Panel`'s `PanelDensity` doc. */
    density?: PanelDensity;
    className?: string;
    children: React.ReactNode;
};

// The in-game dialog centers on the PLAY AREA (viewport minus the right piles
// strip), not the viewport — via `.play-area-center-x` (`left: calc(50% -
// --right-piles-w/2)`). A width measured against the full `100vw` centered on
// that offset point overflows the left edge, so the available width is the play
// area, i.e. `100vw - --right-piles-w`. The var resolves to 0px off-board (lobby)
// ⇒ plain full-viewport sizing.
const sizeClasses: Record<GameDialogSize, string> = {
    default: "max-w-md w-[calc(100vw-var(--right-piles-w,0px)-2rem)]",
    wide: "max-w-[90vw] w-[calc(100vw-var(--right-piles-w,0px)-2rem)]",
};

/**
 * Gameplay dialog in the Zelda-TotK item-panel shape (issue #597): sunburst icon
 * well, bold Beleren title + full-width gold underline rule, optional stat
 * row, body, footer actions, and the Panel's subtle SVG corner filigree.
 *
 * Padding keeps the ornament clear of content — the Panel adds `p-6` all round
 * and the footer carries extra bottom spacing (`pb-1`) so no decoration overlaps
 * the actions, especially at the bottom corners.
 */
export default function GameDialog({
    open,
    onOpenChange,
    title,
    subtitle,
    icon,
    stats,
    footer,
    size = "default",
    dismissable = true,
    showCloseButton = false,
    onMinimize,
    density = "default",
    className,
    children,
}: GameDialogProps) {
    const handleOpenChange = (next: boolean) => {
        if (!next && !dismissable) return;
        onOpenChange?.(next);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                showCloseButton={false}
                onClick={(e) => {
                    // The popup spans ~the whole play area to center the
                    // Panel, so the dialog backdrop behind it is unreachable
                    // and overlay clicks never dismiss (QA: pile browse
                    // dialogs). Emulate backdrop dismissal: a click landing
                    // on the popup CONTAINER itself (not the Panel inside)
                    // closes the dialog, like every other dialog in the app.
                    if (e.target === e.currentTarget && dismissable) {
                        onOpenChange?.(false);
                    }
                }}
                className={cn(
                    "flex items-center justify-center overflow-hidden border-none bg-transparent p-0 shadow-none ring-0",
                    sizeClasses[size],
                    className
                )}
            >
                <Panel
                    tone="neutral"
                    density={density}
                    className="max-w-full min-w-64 overflow-hidden sm:min-w-80"
                >
                    <div
                        className={cn(
                            "flex gap-4 sm:gap-6",
                            icon
                                ? "flex-col items-center sm:flex-row sm:items-start"
                                : "flex-col"
                        )}
                    >
                        {icon && <SunburstIcon>{icon}</SunburstIcon>}

                        <div className="flex max-h-[80vh] w-full min-w-0 flex-1 flex-col">
                            <DialogTitle
                                className={cn(
                                    "heading-panel shrink-0",
                                    icon && "sm:text-left",
                                    // keep the title clear of the absolute
                                    // close/minimize controls (top-right)
                                    (showCloseButton || onMinimize) && "pr-8"
                                )}
                            >
                                {title}
                            </DialogTitle>

                            {/* full-width gold underline rule */}
                            <span className="panel-rule mt-2 block h-px w-full shrink-0" />

                            {subtitle && (
                                <p className="mt-2 shrink-0 text-center text-sm text-text-muted">
                                    {subtitle}
                                </p>
                            )}

                            {stats && (
                                <div className="mt-3 flex shrink-0 flex-wrap items-center gap-3">
                                    {stats}
                                </div>
                            )}

                            <DialogDescription className="sr-only">
                                {subtitle ?? title}
                            </DialogDescription>

                            {/* p-[0.2rem]: the buttons' focus outline draws
                                OUTSIDE the border box — without this breathing
                                room the overflow clips it at the container
                                edge. */}
                            <div className="mt-3 min-h-0 overflow-auto p-[0.2rem]">
                                {children}
                            </div>
                        </div>
                    </div>

                    {footer && (
                        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 pb-1">
                            {footer}
                        </div>
                    )}

                    {onMinimize && (
                        <button
                            type="button"
                            onClick={onMinimize}
                            aria-label="Minimize choice dialog"
                            title="Minimize"
                            className={cn(
                                "absolute top-3 flex h-6 w-6 cursor-pointer items-center justify-center text-text-disabled transition-colors hover:text-text-muted",
                                showCloseButton ? "right-10" : "right-3"
                            )}
                        >
                            <Minus className="h-4 w-4" />
                        </button>
                    )}

                    {showCloseButton && (
                        <button
                            type="button"
                            onClick={() => onOpenChange?.(false)}
                            className="absolute top-3 right-3 flex h-6 w-6 cursor-pointer items-center justify-center text-text-disabled transition-colors hover:text-text-muted"
                        >
                            ✕
                        </button>
                    )}
                </Panel>
            </DialogContent>
        </Dialog>
    );
}

export { SunburstIcon };
