import { CornerDownLeft, Space } from "lucide-react";
import { Button } from "@/components/ui/button";

type ActionButtonTone = "primary" | "secondary" | "destructive" | "ghost";

/** The visible keyboard hint — presentation only. It is `aria-hidden` by its
 *  wrapper below, so it never joins the button's accessible name (issue
 *  #9088: a text hint made Pass Turn read "Pass Turn [P]"); the shortcut
 *  reaches assistive tech through the button's `aria-keyshortcuts`. */
function ShortcutHint({ shortcut }: { shortcut: string }) {
    const key = shortcut.toLowerCase();
    if (key === "space") {
        return <Space className="w-3.5 h-3.5 opacity-70" />;
    }
    if (key === "enter") {
        return <CornerDownLeft className="w-3.5 h-3.5 opacity-70" />;
    }
    return <span className="text-xs opacity-70">[{shortcut}]</span>;
}

/** `aria-keyshortcuts` value for a shortcut name (WAI-ARIA 1.2 § 6.7). */
function ariaKeyShortcut(shortcut: string): string {
    const key = shortcut.toLowerCase();
    if (key === "space") return "Space";
    if (key === "enter") return "Enter";
    return shortcut;
}

/** Board action button — thin domain wrapper over the unified ui/Button
 *  (phase-3): tone → variant, plus the keyboard-shortcut hint. */
export default function ActionButton({
    onClick,
    label,
    tone = "primary",
    disabled = false,
    shortcut,
    controllerPrimary,
}: {
    onClick: () => void;
    label: string;
    tone?: ActionButtonTone;
    disabled?: boolean;
    shortcut?: string;
    /** Marks the controller's centre-slot action (`data-controller-primary`,
     *  the seam `check:ui`'s game surfaces promise — issue #3651). */
    controllerPrimary?: "action" | "status";
}) {
    return (
        <Button
            data-controller-primary={controllerPrimary}
            variant={tone}
            disabled={disabled}
            onClick={onClick}
            aria-keyshortcuts={shortcut ? ariaKeyShortcut(shortcut) : undefined}
            className="px-5 py-2 text-sm"
        >
            <span className="inline-flex items-center gap-2">
                {label}
                {/* aria-hidden: the hint is a visual cue, not part of the
                    button's name — "Pass Turn [P]" broke every exact-name
                    lookup of the pod's Pass Turn (check:ui game-board). */}
                {shortcut && (
                    <span
                        aria-hidden
                        className="hidden md:inline-flex items-center"
                    >
                        <ShortcutHint shortcut={shortcut} />
                    </span>
                )}
            </span>
        </Button>
    );
}
