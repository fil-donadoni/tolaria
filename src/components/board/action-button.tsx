import { Button } from "@/components/ui/button";
import { Keycap } from "@/components/ui/keycap";
import { ariaKeyShortcuts, type Hotkey } from "~/lib/hotkeys";

type ActionButtonTone = "primary" | "secondary" | "destructive" | "ghost";

/** Board action button — thin domain wrapper over the unified ui/Button
 *  (phase-3): tone → variant, plus the hotkey's keycap after the label.
 *
 *  The keycap is `aria-hidden` (issue #9088: a text hint made Pass Turn read
 *  "Pass Turn [P]", breaking every exact-name lookup — check:ui game-board);
 *  the key reaches assistive tech through `aria-keyshortcuts`, both read from
 *  the one declaration in `~/lib/hotkeys` (issue #9833). */
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
    shortcut?: Hotkey;
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
            aria-keyshortcuts={
                shortcut ? ariaKeyShortcuts(shortcut) : undefined
            }
            className="px-5 py-2 text-sm"
        >
            <span className="inline-flex items-center gap-2">
                {label}
                {shortcut && (
                    <Keycap
                        hotkey={shortcut}
                        className="hidden md:inline-flex"
                    />
                )}
            </span>
        </Button>
    );
}
