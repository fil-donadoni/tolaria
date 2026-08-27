import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

import { cn } from "@/lib/utils";

/**
 * THE checkbox — same forged-plate discipline as `Button`/`Input` (ADR 0007):
 * `@base-ui/react` supplies behaviour (keyboard, ARIA, hidden native input)
 * only, never colour. Colour/shape come from our own tone tokens so a
 * checkbox in a game dialog never reads as a bare browser default sitting
 * outside the rest of the chrome (hairline Panels, ivory focus rings,
 * forged-plate buttons — ADR 0103 §5).
 */
function Checkbox({
    className,
    ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
    return (
        <CheckboxPrimitive.Root
            data-slot="checkbox"
            className={cn(
                "peer flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-border-strong bg-surface-elevated/20 transition-colors outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 data-[checked]:border-accent data-[checked]:bg-accent disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface disabled:opacity-40",
                className
            )}
            {...props}
        >
            <CheckboxPrimitive.Indicator
                data-slot="checkbox-indicator"
                className="flex items-center justify-center text-black"
            >
                <svg
                    viewBox="0 0 12 12"
                    fill="none"
                    className="size-3"
                    aria-hidden="true"
                >
                    <path
                        d="M2 6.2 4.8 9 10 3"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
}

export { Checkbox };
