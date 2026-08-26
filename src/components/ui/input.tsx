import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

/**
 * The shadcn text input, on the v4 field recipe (ADR 0103, issue #2723): the
 * DARK FIELD (`surface-base` — a hole cut in the panel, not a plate raised off
 * it), a control-edge border and the accent focus ring.
 *
 * The edge is `border-strong`, not the decorative `--hairline` pair: ivory/30
 * is 2.37:1 on `surface` and an input's only boundary must clear WCAG 1.4.11's
 * 3:1 — the invariant `design-tokens.test.ts` holds with "border-strong is
 * brighter than the strong hairline (a control edge is not decoration)".
 *
 * Height stays on `--control-h`. The v4 40/48 rungs are a BUTTON change
 * (issue #2723's plate rungs); raising input heights app-wide is the measured
 * deferral recorded on `.input-field` in `src/index.css` and owned by #2585.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
    return (
        <InputPrimitive
            type={type}
            data-slot="input"
            className={cn(
                "h-[var(--control-h)] w-full min-w-0 rounded-sm border border-border-strong bg-surface-base px-2.5 py-1 text-base text-text transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-text-disabled focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface disabled:text-text-disabled aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/40 md:text-sm",
                className
            )}
            {...props}
        />
    );
}

export { Input };
