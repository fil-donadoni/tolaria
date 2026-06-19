import { Minus } from "lucide-react";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";

/** Minimize affordance shared by the blocking choice dialog surfaces (the
 *  `PendingChoicePrompt` banner and the library-pick modal — issue #315).
 *  Collapses the dialog to the board indicator; a pure view toggle that
 *  leaves the Pending Choice and its buffered selection untouched. */
export default function MinimizeChoiceButton({
    className = "",
}: {
    className?: string;
}) {
    const { minimize } = useMinimizedChoice();

    return (
        <button
            type="button"
            onClick={(e) => {
                // The banner host is a drag handle (`cursor-move`); don't let
                // the click start a drag.
                e.stopPropagation();
                minimize();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Minimize choice dialog"
            title="Minimize"
            className={`flex h-6 w-6 items-center justify-center rounded-sm text-text-disabled hover:text-text-muted transition-colors cursor-pointer ${className}`}
        >
            <Minus className="h-4 w-4" />
        </button>
    );
}
