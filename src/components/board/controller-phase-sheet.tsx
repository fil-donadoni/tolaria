import { useEffect } from "react";
import ControllerPhaseList from "./controller-phase-list";

/** Portrait bottom sheet (#335) holding the full phase list. Slides up from the
 *  bottom edge with a dimmed backdrop and comfortable (large) touch targets,
 *  coherent with the ADR-0009 action-sheet pattern. It mounts the SAME
 *  {@link ControllerPhaseList} the desktop panel uses, so the YOU/OPP stop
 *  toggles route through the identical `useSkipPhasePreferences` path — only the
 *  shell (bottom sheet vs. right-edge panel) and the touch sizing differ. The
 *  `[data-phase-sheet]` flag scopes the larger hit targets via a sibling
 *  stylesheet rule without forking the list component. */
export default function ControllerPhaseSheet({
    onClose,
}: {
    onClose: () => void;
}) {
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    return (
        <div
            data-phase-sheet
            className="fixed inset-0 z-sheet flex flex-col justify-end md:hidden"
        >
            {/* Dimmed backdrop — tap to dismiss (touch + mouse both fire click). */}
            <button
                type="button"
                aria-label="Close phase list"
                onClick={onClose}
                className="absolute inset-0 bg-black/50"
            />
            <div className="relative max-h-[70vh] w-full animate-[sheetUp_0.2s_ease-out] overflow-hidden rounded-t-2xl border-t border-border-subtle bg-surface shadow-2xl backdrop-blur-md">
                {/* Grab handle affordance. */}
                <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-border-accent" />
                <ControllerPhaseList onClose={onClose} />
            </div>
        </div>
    );
}
