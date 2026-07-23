import { Button } from "~/components/ui/button";

/**
 * Debug-panel button: a thin adapter over the shared `Button` (ADR 0007 — one
 * button system, forged-plate tones from the semantic palette). Keeps the
 * two-tone `default` / `danger` API the debug call sites already use, mapping
 * them onto the design-system `secondary` / `destructive` tones at the compact
 * `xs` size the dev overlays need.
 */
export default function DebugButton({
    onClick,
    children,
    variant = "default",
    disabled = false,
}: {
    onClick: () => void;
    children: React.ReactNode;
    variant?: "default" | "danger";
    disabled?: boolean;
}) {
    return (
        <Button
            variant={variant === "danger" ? "destructive" : "secondary"}
            size="xs"
            onClick={onClick}
            disabled={disabled}
            className="font-sans tracking-normal"
        >
            {children}
        </Button>
    );
}
