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

/** Header alignment. `start` (the default) is the v3 engraved-header language:
 *  title left, rule beneath, body left. `center` is for the terminal/waiting
 *  dialogs whose BODY is centred — Coin toss, Game Over, Match Result — where
 *  a left title over a centred body reads as a layout accident. Alignment is
 *  a per-call-site decision, never inferred: the two families are told apart
 *  by what the body does, which the dialog cannot see. */
type GameDialogAlign = "start" | "center";

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
    /** See `GameDialogAlign`. Drives the title, the subtitle and the icon
     *  placement (beside the title when `start`, above it when `center`). */
    align?: GameDialogAlign;
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
    align = "start",
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
                    // `flex flex-col` + `max-h-[calc(100dvh-2rem)]` (issue
                    // #2666): the cap lives HERE, on the whole visible dialog
                    // surface (header + scrolling body + footer), not on the
                    // inner column alone — it used to cap only the column
                    // below (title + body), leaving Panel and DialogContent
                    // itself unbounded, so the footer — a SIBLING of the
                    // capped column, not inside it — was exactly what got
                    // pushed off the bottom of a short viewport (a landscape
                    // phone with the browser toolbar showing: the Submit
                    // button in the bug-report dialog). Now Panel is the
                    // bounded box, the column below is a flex item that
                    // shrinks to whatever height is left after the
                    // `shrink-0` footer, and the column's own scroll region
                    // (`data-slot="game-dialog-column"`'s child, `overflow-
                    // auto` + `min-h-0`) absorbs that shrinkage — so the
                    // title row and the footer both stay pinned and visible,
                    // and only the body scrolls. `dvh`, not `vh`/`80vh`: with
                    // the browser toolbar shown `vh` is the LARGE viewport
                    // and a percentage cap still overflows; `dvh` tracks the
                    // viewport as it actually is, and the flat `2rem` margin
                    // (matching `DialogContent`'s own cap, dialog.tsx) holds
                    // at any height instead of degrading at short ones the
                    // way a percentage does. Matches `DialogContent`'s cap
                    // exactly on purpose (dialog.tsx) — Popup's own height is
                    // just Panel's rendered height (its sole child), already
                    // <= this value, so the two caps never fight; the outer
                    // one is a backstop for every OTHER `DialogContent`
                    // consumer, not a second constraint on this one.
                    className="flex max-h-[calc(100dvh-2rem)] max-w-full min-w-64 flex-col overflow-hidden sm:min-w-80"
                >
                    {/* ONE full-width column. The icon used to be a sibling
                        COLUMN, which shrank the body to the remaining width —
                        so a centred body (Game Over's result treatment) sat
                        off-centre inside the panel by half the icon well. The
                        icon now lives in the header row (or above the title
                        when `align="center"`), and the body always spans the
                        panel. */}
                    <div
                        // No max-h of its own any more (issue #2666) — Panel
                        // above owns the cap on the WHOLE box, footer
                        // included. `min-h-0` is what lets this column shrink
                        // past its natural content height when Panel's cap
                        // bites: flex items default to `min-height: auto`,
                        // which floors shrinkage at the content's own
                        // intrinsic size and would otherwise defeat the cap
                        // entirely. Every direct child here except the body
                        // scroller is `shrink-0` (title row, rule, subtitle,
                        // stats), so 100% of any deficit lands on the body
                        // scroller below, which is the one with `overflow-
                        // auto` — exactly the "scrolls the body, not the
                        // page (or the title, or the footer)" contract.
                        data-slot="game-dialog-column"
                        className="flex min-h-0 w-full min-w-0 flex-col"
                    >
                        {/* Header row: icon BESIDE the title when the body is
                            left-aligned, ABOVE it when the body is centred —
                            an icon pinned left over a centred body is the
                            asymmetry the Match Over screen showed. */}
                        <div
                            className={cn(
                                "flex shrink-0 gap-3",
                                align === "center"
                                    ? "flex-col items-center"
                                    : "items-center sm:gap-4"
                            )}
                        >
                            {icon && <SunburstIcon>{icon}</SunburstIcon>}

                            <DialogTitle
                                className={cn(
                                    // `.panel-title-clear` keeps the title
                                    // out of the top-left corner bracket at
                                    // every density (ADR 0101 §2): the
                                    // dialog builds its own header instead of
                                    // using PanelHeader's full-bleed band, so
                                    // it must pay the clearance itself. A
                                    // centred title is already inset far past
                                    // the bracket and the extra inline-start
                                    // padding would shift it off centre, so
                                    // it is paid only by the left-aligned
                                    // header.
                                    "heading-panel min-w-0",
                                    align === "center"
                                        ? "text-center"
                                        : "panel-title-clear flex-1 text-left",
                                    // keep the title clear of the absolute
                                    // close/minimize controls (top-right)
                                    (showCloseButton || onMinimize) && "pr-8"
                                )}
                            >
                                {title}
                            </DialogTitle>
                        </div>

                        {/* full-width gold underline rule */}
                        <span className="panel-rule mt-2 block h-px w-full shrink-0" />

                        {subtitle && (
                            <p
                                className={cn(
                                    "mt-2 shrink-0 text-sm text-text-muted",
                                    align === "center"
                                        ? "text-center"
                                        : "text-left"
                                )}
                            >
                                {subtitle}
                            </p>
                        )}

                        {stats && (
                            <div
                                className={cn(
                                    "mt-3 flex shrink-0 flex-wrap items-center gap-3",
                                    align === "center" && "justify-center"
                                )}
                            >
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

                    {footer && (
                        <div
                            className={cn(
                                // `shrink-0` (issue #2666): Panel above is now
                                // the capped flex column, and this footer is
                                // its OTHER flex item alongside the column —
                                // without `shrink-0` the flexbox squeeze that
                                // enforces Panel's cap would shrink both
                                // proportionally, which is exactly how the
                                // Submit button used to get clipped. Pinning
                                // this to its natural height forces the WHOLE
                                // deficit onto the column (whose own
                                // `min-h-0` scroll region is built to absorb
                                // it), so the footer is always fully visible.
                                "mt-5 flex shrink-0 flex-col items-stretch gap-2 pb-1 sm:flex-row sm:flex-wrap sm:items-center",
                                // A centred dialog's actions stay centred from
                                // `sm` up; the left-aligned language keeps the
                                // right-aligned action row (ADR 0101 §2).
                                align === "center"
                                    ? "sm:justify-center"
                                    : "sm:justify-end"
                            )}
                        >
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
