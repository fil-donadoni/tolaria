import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";

import { cn } from "@/lib/utils";
import { ChevronRightIcon, CheckIcon } from "lucide-react";

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
    return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuPortal({ ...props }: ContextMenuPrimitive.Portal.Props) {
    return (
        <ContextMenuPrimitive.Portal
            data-slot="context-menu-portal"
            {...props}
        />
    );
}

// Base UI's Trigger opens on a real `contextmenu` (right-click) and on touch
// long-press. In this app both gestures belong to the CARD PREVIEW (Arena click
// model — right button / long-press peek the card; see card-preview.tsx). The
// menu is a LEFT-click affordance instead: the `onClick` below synthesizes a
// `contextmenu` MouseEvent to open it. So we let ONLY that self-synthesized
// contextmenu through and stop Base UI from opening on a genuine right-click or
// on touch long-press, leaving both to the preview.
type PreventableEvent = { preventBaseUIHandler?: () => void };

function ContextMenuTrigger({
    className,
    onClick,
    onContextMenu,
    onTouchStart,
    ...props
}: ContextMenuPrimitive.Trigger.Props) {
    // True only for the synchronous window of our own synthesized dispatch
    // below — the one `contextmenu` a left click is allowed to open the menu
    // with. Any other `contextmenu` is a genuine right-click and belongs to the
    // preview. (`dispatchEvent` runs the handler synchronously, so a boolean
    // flag cleanly brackets the self-triggered event.)
    const synthesizingRef = React.useRef(false);
    return (
        <ContextMenuPrimitive.Trigger
            data-slot="context-menu-trigger"
            className={cn("select-none", className)}
            onClick={(e) => {
                onClick?.(e);
                if (e.defaultPrevented) return;
                synthesizingRef.current = true;
                e.currentTarget.dispatchEvent(
                    new MouseEvent("contextmenu", {
                        bubbles: true,
                        clientX: e.clientX,
                        clientY: e.clientY,
                    })
                );
                synthesizingRef.current = false;
            }}
            onContextMenu={(e) => {
                // Genuine right-click is the preview gesture — block Base UI's
                // open. Our self-synthesized left-click contextmenu falls
                // through and opens the menu.
                if (!synthesizingRef.current)
                    (e as typeof e & PreventableEvent).preventBaseUIHandler?.();
                onContextMenu?.(e);
            }}
            onTouchStart={(e) => {
                // Touch long-press is the preview gesture — block Base UI's
                // long-press-to-open. Touch TAP is routed to the menu/action
                // sheet by the consumer's own handler, unaffected here.
                (e as typeof e & PreventableEvent).preventBaseUIHandler?.();
                onTouchStart?.(e);
            }}
            {...props}
        />
    );
}

function ContextMenuContent({
    className,
    align = "start",
    alignOffset = 4,
    side = "right",
    sideOffset = 0,
    ...props
}: ContextMenuPrimitive.Popup.Props &
    Pick<
        ContextMenuPrimitive.Positioner.Props,
        "align" | "alignOffset" | "side" | "sideOffset"
    >) {
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Positioner
                className="isolate z-modal outline-none"
                align={align}
                alignOffset={alignOffset}
                side={side}
                sideOffset={sideOffset}
            >
                <ContextMenuPrimitive.Popup
                    data-slot="context-menu-content"
                    className={cn(
                        // v4 (ADR 0103 §5, issue #2731): a hairline frame at
                        // the panel radius, not the legacy accent ring, and a
                        // `--menu-row-gap` flex column so rows get REAL
                        // spacing instead of touching edge-to-edge.
                        "z-modal flex w-fit max-h-(--available-height) min-w-36 origin-(--transform-origin) flex-col gap-[var(--menu-row-gap)] overflow-x-hidden overflow-y-auto rounded-[var(--panel-radius)] border border-[var(--hairline)] bg-popover p-1 text-popover-foreground shadow-md duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                        className
                    )}
                    {...props}
                />
            </ContextMenuPrimitive.Positioner>
        </ContextMenuPrimitive.Portal>
    );
}

function ContextMenuGroup({ ...props }: ContextMenuPrimitive.Group.Props) {
    return (
        <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
    );
}

function ContextMenuLabel({
    className,
    inset,
    ...props
}: ContextMenuPrimitive.GroupLabel.Props & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.GroupLabel
            data-slot="context-menu-label"
            data-inset={inset}
            className={cn(
                "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
                className
            )}
            {...props}
        />
    );
}

function ContextMenuItem({
    className,
    inset,
    variant = "default",
    ...props
}: ContextMenuPrimitive.Item.Props & {
    inset?: boolean;
    variant?: "default" | "destructive";
}) {
    return (
        <ContextMenuPrimitive.Item
            data-slot="context-menu-item"
            data-inset={inset}
            data-variant={variant}
            className={cn(
                // v4 (ADR 0103 §5, issue #2731): "Popovers and menus get 44px
                // rows" — `min-h`, not `h`, so a wrapping label still grows
                // the row instead of clipping.
                "group/context-menu-item relative flex min-h-[var(--menu-row-h)] cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus:*:[svg]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive",
                className
            )}
            {...props}
        />
    );
}

function ContextMenuSub({ ...props }: ContextMenuPrimitive.SubmenuRoot.Props) {
    return (
        <ContextMenuPrimitive.SubmenuRoot
            data-slot="context-menu-sub"
            {...props}
        />
    );
}

function ContextMenuSubTrigger({
    className,
    inset,
    children,
    ...props
}: ContextMenuPrimitive.SubmenuTrigger.Props & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.SubmenuTrigger
            data-slot="context-menu-sub-trigger"
            data-inset={inset}
            className={cn(
                "flex min-h-[var(--menu-row-h)] cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className
            )}
            {...props}
        >
            {children}
            <ChevronRightIcon className="ml-auto" />
        </ContextMenuPrimitive.SubmenuTrigger>
    );
}

function ContextMenuSubContent({
    ...props
}: React.ComponentProps<typeof ContextMenuContent>) {
    return (
        <ContextMenuContent
            data-slot="context-menu-sub-content"
            className="shadow-lg"
            side="right"
            {...props}
        />
    );
}

function ContextMenuCheckboxItem({
    className,
    children,
    checked,
    inset,
    ...props
}: ContextMenuPrimitive.CheckboxItem.Props & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.CheckboxItem
            data-slot="context-menu-checkbox-item"
            data-inset={inset}
            className={cn(
                "relative flex min-h-[var(--menu-row-h)] cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className
            )}
            checked={checked}
            {...props}
        >
            <span className="pointer-events-none absolute right-2">
                <ContextMenuPrimitive.CheckboxItemIndicator>
                    <CheckIcon />
                </ContextMenuPrimitive.CheckboxItemIndicator>
            </span>
            {children}
        </ContextMenuPrimitive.CheckboxItem>
    );
}

function ContextMenuRadioGroup({
    ...props
}: ContextMenuPrimitive.RadioGroup.Props) {
    return (
        <ContextMenuPrimitive.RadioGroup
            data-slot="context-menu-radio-group"
            {...props}
        />
    );
}

function ContextMenuRadioItem({
    className,
    children,
    inset,
    ...props
}: ContextMenuPrimitive.RadioItem.Props & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.RadioItem
            data-slot="context-menu-radio-item"
            data-inset={inset}
            className={cn(
                "relative flex min-h-[var(--menu-row-h)] cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className
            )}
            {...props}
        >
            <span className="pointer-events-none absolute right-2">
                <ContextMenuPrimitive.RadioItemIndicator>
                    <CheckIcon />
                </ContextMenuPrimitive.RadioItemIndicator>
            </span>
            {children}
        </ContextMenuPrimitive.RadioItem>
    );
}

function ContextMenuSeparator({
    className,
    ...props
}: ContextMenuPrimitive.Separator.Props) {
    return (
        <ContextMenuPrimitive.Separator
            data-slot="context-menu-separator"
            className={cn("-mx-1 my-1 h-px bg-[var(--hairline)]", className)}
            {...props}
        />
    );
}

function ContextMenuShortcut({
    className,
    ...props
}: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="context-menu-shortcut"
            className={cn(
                "ml-auto text-xs tracking-widest text-muted-foreground group-focus/context-menu-item:text-accent-foreground",
                className
            )}
            {...props}
        />
    );
}

export {
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuCheckboxItem,
    ContextMenuRadioItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuGroup,
    ContextMenuPortal,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuRadioGroup,
};
