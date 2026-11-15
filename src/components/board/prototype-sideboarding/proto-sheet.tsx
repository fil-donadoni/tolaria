// PROTOTYPE — throwaway. The dialog shell all three variants share.
//
// The ring fix under test: the CURRENT GameDialog renders a transparent
// base-ui Popup sized to `90vw` with the visible Panel centred inside it. The
// Popup is the element that receives initial focus, and the unlayered global
// `:focus-visible { outline }` (index.css) beats its `outline-none` utility —
// so after any keyboard interaction the outline traces the INVISIBLE popup
// box, not the panel: "a ring around an ill-defined contour".
//
// Here the Popup IS the visible panel (no transparent wrapper), its own
// outline is suppressed inline (inline style outranks the unlayered rule),
// and initial focus lands on the title (tabIndex -1), so no button lights up
// on open and Enter can't fire Ready by accident.
import { useRef } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "~/lib/utils";

export default function ProtoSheet({
    title,
    subtitle,
    headerRight,
    footer,
    footerClassName,
    size = "full",
    children,
}: {
    title: string;
    subtitle?: React.ReactNode;
    headerRight?: React.ReactNode;
    footer: React.ReactNode;
    footerClassName?: string;
    /** full = play-area sheet; wide = large centred dialog. */
    size?: "full" | "wide";
    children: React.ReactNode;
}) {
    const titleRef = useRef<HTMLHeadingElement>(null);
    return (
        <DialogPrimitive.Root open modal>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Backdrop className="z-modal modal-scrim fixed inset-0" />
                <DialogPrimitive.Popup
                    initialFocus={titleRef}
                    style={{ outline: "none" }}
                    className={cn(
                        "panel-physical hairline z-modal fixed flex flex-col overflow-hidden rounded-[var(--panel-radius)] text-text",
                        size === "full"
                            ? "inset-2 sm:inset-4 sm:right-[calc(var(--right-piles-w,0px)+1rem)]"
                            : "inset-2 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(46rem,calc(100dvh-2rem))] sm:w-[min(72rem,calc(100vw-var(--right-piles-w,0px)-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2"
                    )}
                >
                    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle/60 px-4 py-3 sm:px-5">
                        <div className="min-w-0 flex-1">
                            <DialogPrimitive.Title
                                ref={titleRef}
                                tabIndex={-1}
                                style={{ outline: "none" }}
                                className="heading-panel !text-left !text-lg"
                            >
                                {title}
                            </DialogPrimitive.Title>
                            {subtitle && (
                                <div className="mt-0.5 text-xs text-text-muted">
                                    {subtitle}
                                </div>
                            )}
                        </div>
                        {headerRight}
                    </header>
                    <DialogPrimitive.Description className="sr-only">
                        Move cards between your Maindeck and Sideboard before
                        the next game.
                    </DialogPrimitive.Description>
                    <div className="flex min-h-0 flex-1 flex-col">
                        {children}
                    </div>
                    <footer
                        className={cn(
                            "shrink-0 border-t border-border-subtle/60 px-4 py-3 sm:px-5",
                            footerClassName
                        )}
                    >
                        {footer}
                    </footer>
                </DialogPrimitive.Popup>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
