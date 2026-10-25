// The frame every Immersive-mode bar draws inside (issue #3682): the
// safe-area-aware band, the top-inset padding, the `short-viewport:` compact
// band and the surface styling. `AppContextBar` and the Draft Room bar both
// render through it, so the two cannot drift apart again.
//
// `min-h`, not `h`, and the inset folded INTO the min-height (issues #2594,
// #2662): the element is `border-box`, so a bare band min-height lets the
// inset be absorbed by the band's own slack instead of adding to it. The floor
// is `band + inset`; `SHELL_CONTEXTUAL_BAND_PX` /
// `SHELL_CONTEXTUAL_COMPACT_BAND_PX` (`shellLayout.ts`) are the zero-inset
// heights and must keep matching the 2.75rem / 2.25rem below. Controls inside
// take `--control-h`, and `--control-h-xs` under `short-viewport:`.
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export default function ContextualBarFrame({
    slot,
    className,
    children,
}: {
    /** The bar's own `data-slot`. */
    slot: string;
    /** Layout additions only — never band height or surface styling. */
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            data-slot={slot}
            className={cn(
                "flex min-h-[calc(2.75rem_+_env(safe-area-inset-top))] shrink-0 items-center border-b border-border-subtle bg-surface-raised px-2 pt-[env(safe-area-inset-top)] short-viewport:min-h-[calc(2.25rem_+_env(safe-area-inset-top))]",
                className
            )}
        >
            {children}
        </div>
    );
}
