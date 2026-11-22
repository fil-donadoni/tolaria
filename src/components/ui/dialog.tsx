"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";
import { withSymbols } from "~/lib/oracle-text";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
    return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
    return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
    return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
    className,
    ...props
}: DialogPrimitive.Backdrop.Props) {
    return (
        <DialogPrimitive.Backdrop
            data-slot="dialog-overlay"
            className={cn(
                "z-modal fixed inset-0 isolate modal-scrim duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
                className
            )}
            {...props}
        />
    );
}

function DialogContent({
    className,
    children,
    showCloseButton = true,
    ...props
}: DialogPrimitive.Popup.Props & {
    showCloseButton?: boolean;
}) {
    return (
        <DialogPortal>
            <DialogOverlay />
            <DialogPrimitive.Popup
                data-slot="dialog-content"
                className={cn(
                    // Centering (issue #10008): NOT a `-50%` translate. Half a
                    // fractional popup size is a fractional translate, and WebKit
                    // rasterises a translated composited layer off the pixel grid
                    // (text and art blur). The popup is instead an absolutely
                    // positioned box with `inset-y-0` + `m-auto` + `h-fit`/`w-fit`,
                    // whose layout position paints pixel-snapped in every engine.
                    // In-game the board publishes `--right-piles-w` (the right
                    // pile-column strip width) to documentElement; the shared
                    // `.play-area-center-box` utility (index.css) insets the
                    // containing box by that strip on the right, so the popup
                    // centers over the play area, not the full viewport. The
                    // transform stays free for the zoom/fade enter-exit animation.
                    // Lobby: var absent ⇒ 0px ⇒ full-viewport centering.
                    //
                    // `max-h-[calc(100dvh-2rem)]` (issue #2666): this popup used
                    // to carry NO height constraint at all — it centers via
                    // `inset-y-0 m-auto` (was a translate) and sizes to its child's
                    // natural height, so a tall child (a form, a long dialog
                    // body) simply ran off both the top and bottom of the
                    // viewport with nothing to scroll it back into view. `dvh`,
                    // not `vh`/`100vh`: with a mobile browser's URL/toolbar
                    // showing, `vh` resolves against the LARGE viewport (the
                    // size once the chrome has scrolled away), so a cap
                    // expressed in `vh` still overflows the SMALL viewport the
                    // page is actually laid out in right now — `dvh` tracks the
                    // viewport as it actually is. `2rem` is a flat top+bottom
                    // margin (1rem each), not a percentage, so it holds at any
                    // viewport height instead of degrading at short ones the
                    // way a `vh`/`dvh` PERCENTAGE cap does.
                    //
                    // This is a backstop for every `DialogContent` consumer —
                    // `GameDialog`'s own `Panel` (game-dialog.tsx) carries the
                    // SAME cap and is what actually splits a tall dialog into a
                    // pinned header, a scrolling body and a pinned footer; this
                    // cap alone does not add that internal scroll region, it
                    // only guarantees the popup itself can never exceed the
                    // dynamic viewport (so a consumer that manages its own
                    // internal scrolling, like `GameDialog`, never conflicts
                    // with it — the popup simply never needs to shrink below
                    // its already-capped child).
                    "play-area-center-box z-modal fixed inset-y-0 grid m-auto h-fit max-h-[calc(100dvh-2rem)] w-fit gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-border-accent/40 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                    className
                )}
                {...props}
            >
                {children}
                {showCloseButton && (
                    <DialogPrimitive.Close
                        data-slot="dialog-close"
                        render={
                            <Button
                                variant="ghost"
                                className="absolute top-2 right-2"
                                size="icon-sm"
                            />
                        }
                    >
                        <XIcon />
                        <span className="sr-only">Close</span>
                    </DialogPrimitive.Close>
                )}
            </DialogPrimitive.Popup>
        </DialogPortal>
    );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="dialog-header"
            className={cn("flex flex-col gap-2", className)}
            {...props}
        />
    );
}

function DialogFooter({
    className,
    showCloseButton = false,
    children,
    ...props
}: React.ComponentProps<"div"> & {
    showCloseButton?: boolean;
}) {
    return (
        <div
            data-slot="dialog-footer"
            className={cn(
                "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
                className
            )}
            {...props}
        >
            {children}
            {showCloseButton && (
                <DialogPrimitive.Close render={<Button variant="secondary" />}>
                    Close
                </DialogPrimitive.Close>
            )}
        </div>
    );
}

function DialogTitle({
    className,
    children,
    ...props
}: DialogPrimitive.Title.Props) {
    // String titles render through the symbol parser (issue #9834).
    return (
        <DialogPrimitive.Title
            data-slot="dialog-title"
            className={cn("text-base leading-none font-medium", className)}
            {...props}
        >
            {withSymbols(children)}
        </DialogPrimitive.Title>
    );
}

function DialogDescription({
    className,
    children,
    ...props
}: DialogPrimitive.Description.Props) {
    return (
        <DialogPrimitive.Description
            data-slot="dialog-description"
            className={cn(
                "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
                className
            )}
            {...props}
        >
            {withSymbols(children)}
        </DialogPrimitive.Description>
    );
}

export {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
    DialogTrigger,
};
