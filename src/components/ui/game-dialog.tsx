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
    /** Panel padding passthrough (issue #1817, opus review round 2). Opt-in
     *  override — omitted (the default for the ~30 other call sites) forwards
     *  `undefined` to `Panel`, which then inherits the ambient `[data-density]`
     *  rung from `<html>` (the user's Settings density preference, issue
     *  #2595) instead of a hard-coded rung. The pile browser passes
     *  `"comfortable"` so its grid gets more room on a phone regardless of
     *  that preference. See `Panel`'s `PanelDensity` doc for the v2 → v3
     *  rename. */
    density?: PanelDensity;
    /** Opt in to the rich corner filigree instead of the v3 brackets
     *  (ADR 0101 §2). Allowed only in waiting states — Game Over / Match
     *  Result — and the Panel additionally gates it to viewports above
     *  844x390. Every other dialog leaves it off and gets v3 brackets. */
    ornament?: boolean;
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
 * Padding keeps the frame clear of content — the Panel adds its density's
 * padding all round, the title carries `.panel-title-clear`, and the footer
 * carries extra bottom spacing (`pb-1`) so no decoration overlaps the actions,
 * especially at the bottom corners. Footer actions stack full-width on a phone
 * and right-align from `sm` up (ADR 0101 §2).
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
    density,
    ornament = false,
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
                    ornament={ornament}
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

                        <div
                            // 80vh caps only THIS column, not the chrome
                            // around it — DialogContent itself carries no
                            // padding here (`p-0`, set on DialogContent's
                            // className above; tailwind-merge wins over any
                            // default), so it's only the Panel's `roomy`
                            // padding (`p-6`, 24px top + 24px bottom = 48px
                            // total) that sits outside this max-height. At
                            // the cap the rendered popup already exceeds a
                            // 48px-larger viewport than 80vh implies.
                            // DialogContent centers via `top-1/2
                            // -translate-y-1/2` with no height clamp of its
                            // own, so any overshoot strands the top and
                            // clips the bottom equally (issue #2586:
                            // measured at 844x390, the Stats dialog).
                            // `short-viewport:` (`max-height: 500px`,
                            // src/index.css) reserves `6rem` (96px) of
                            // chrome explicitly instead of relying on 80vh
                            // headroom that stops existing below ~500px
                            // tall — deliberately more than the 48px actually
                            // spent, so the reserve stays safe even if a
                            // future Panel density adds padding back.
                            // `100dvh`, not `100vh` (issue #2594): `vh` is
                            // the LARGE viewport, so on a short mobile
                            // landscape viewport with retracting browser
                            // chrome the 96px reserve is measured against a
                            // taller-than-actual box and can still overflow;
                            // `dvh` tracks the viewport as it actually is.
                            className="flex max-h-[80vh] short-viewport:max-h-[calc(100dvh-6rem)] w-full min-w-0 flex-1 flex-col"
                        >
                            <DialogTitle
                                className={cn(
                                    // `.panel-title-clear` keeps the title
                                    // out of the top-left corner bracket at
                                    // every density (ADR 0101 §2): the
                                    // dialog builds its own header instead of
                                    // using PanelHeader's full-bleed band, so
                                    // it must pay the clearance itself.
                                    "heading-panel panel-title-clear shrink-0 text-left",
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
                        <div className="mt-5 flex flex-col items-stretch gap-2 pb-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
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
