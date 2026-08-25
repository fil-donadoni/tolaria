import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The multi-line sibling of `Input`, on the same v4 field recipe (ADR 0103,
 * issue #2723): dark field, control-edge border, accent focus ring.
 *
 * It used to be the last unconverted shadcn default in the primitive set —
 * `border-input` / `ring-ring` / `dark:bg-input/30`, i.e. the shadcn remap
 * rather than the semantic palette, plus a `rounded-lg` corner no other
 * control in the app used. Two text fields side by side (the bug-report
 * dialog's name input and its description) painted two different edges and two
 * different focus rings. Same tokens as `Input` now, so they read as one
 * control family.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
    return (
        <textarea
            data-slot="textarea"
            className={cn(
                "flex field-sizing-content min-h-16 w-full rounded-sm border border-border-strong bg-surface-base px-2.5 py-2 text-base text-text transition-colors outline-none placeholder:text-text-disabled focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface disabled:text-text-disabled aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/40 md:text-sm",
                className
            )}
            {...props}
        />
    );
}

export { Textarea };
