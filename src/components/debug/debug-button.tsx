import { cn } from "@/lib/utils";
import { Button } from "~/components/ui/button";

/** The debug API's three tones, onto the design system's (ADR 0007). */
const DEBUG_TONE = {
    default: "secondary",
    primary: "primary",
    danger: "destructive",
} as const;

/**
 * Debug-panel button: a thin adapter over the shared `Button` (ADR 0007 — one
 * button system, forged-plate tones from the semantic palette). Keeps the
 * `default` / `danger` API the debug call sites already use, mapping them onto
 * the design-system `secondary` / `destructive` tones at the compact `xs` size
 * the dev overlays need.
 *
 * `primary` is the third tone (issue #3494): the scenario surface's real CTAs
 * — Load a scenario, Save/Update one — read exactly like the one-glyph ★/✎/×
 * toggles beside them while every control was `secondary`, so nothing on the
 * surface told an admin which button was the verb of the row. `size` is its
 * companion: `sm` is the rung that gives a CTA a real 32/44px touch target
 * (`--control-h-sm`) while the glyph toggles stay at `xs`.
 *
 * `className` exists for ONE thing (issue #3403): letting a label-bearing row
 * button shrink and truncate. `btn-base` is `shrink-0 whitespace-nowrap`, which
 * is right for a verb ("Load", "×") and wrong for a scenario label — inside the
 * 293px-wide debug sheet a long label rendered a 523px button and pushed its own
 * ✎/× controls out of the row. Merged through `cn` so the override actually
 * wins instead of racing the base class.
 */
export default function DebugButton({
    onClick,
    children,
    variant = "default",
    size = "xs",
    disabled = false,
    className,
    title,
}: {
    onClick: () => void;
    children: React.ReactNode;
    variant?: "default" | "primary" | "danger";
    /** `sm` for a real CTA, `xs` (the default) for a glyph toggle. */
    size?: "xs" | "sm";
    disabled?: boolean;
    className?: string;
    title?: string;
}) {
    return (
        <Button
            variant={DEBUG_TONE[variant]}
            size={size}
            title={title}
            onClick={onClick}
            disabled={disabled}
            className={cn("font-sans tracking-normal", className)}
        >
            {children}
        </Button>
    );
}
