import { useEffect, useRef } from "react";
import ControllerPhaseList from "./controller-phase-list";

/** Non-modal wrapper for the expanded phase list (#333). The list is anchored
 *  to the board's right edge and vertically centered. There is NO blocking
 *  overlay: the game stays fully interactive behind the panel, so a click on
 *  the board both reaches the board AND dismisses the list. Click-away is
 *  detected with a document `pointerdown` listener — a press anywhere outside
 *  the list (and outside the pod, whose CTA owns the toggle) closes it. */
export default function ControllerPhasePanel({
    onClose,
}: {
    onClose: () => void;
}) {
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onPointerDown(e: PointerEvent) {
            const target = e.target as Node | null;
            if (!target) return;
            // Inside the list: keep it open (toggles, scroll, close button).
            if (listRef.current?.contains(target)) return;
            // Inside the pod (the CTA that owns open/close): let the pod handle
            // the toggle so we don't double-close-then-reopen.
            if (
                target instanceof Element &&
                target.closest("[data-controller-pod]")
            ) {
                return;
            }
            onClose();
        }
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, [onClose]);

    return (
        <div
            ref={listRef}
            className="fixed right-3 top-1/2 z-sheet -translate-y-1/2"
        >
            <ControllerPhaseList onClose={onClose} />
        </div>
    );
}
