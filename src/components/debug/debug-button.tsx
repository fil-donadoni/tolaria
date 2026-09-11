import { cn } from "@/lib/utils";
import { Button } from "~/components/ui/button";

/**
 * Debug-panel button: a thin adapter over the shared `Button` (ADR 0007 — one
 * button system, forged-plate tones from the semantic palette). Keeps the
 * two-tone `default` / `danger` API the debug call sites already use, mapping
 * them onto the design-system `secondary` / `destructive` tones at the compact
 * `xs` size the dev overlays need.
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
    disabled = false,
    className,
}: {
    onClick: () => void;
    children: React.ReactNode;
    variant?: "default" | "danger";
    disabled?: boolean;
    className?: string;
}) {
    return (
        <Button
            variant={variant === "danger" ? "destructive" : "secondary"}
            size="xs"
            onClick={onClick}
            disabled={disabled}
            className={cn("font-sans tracking-normal", className)}
        >
            {children}
        </Button>
    );
}
