import { useEffect, useRef } from "react";
import ControllerPhaseList from "./controller-phase-list";
import { BESIDE_CONTROLLER_STRIP } from "~/lib/controller-bar-metrics";

/** Every controller surface that OWNS this panel's open/close toggle. A
 *  pointerdown inside one of them is left alone so the surface's own CTA
 *  performs the toggle, instead of the click-away closing the panel a tick
 *  before the button reopens it. The landscape-compact strip (#1769) is the
 *  second such owner — omitting it made the strip's phase button one-way. */
const TOGGLE_OWNER_SELECTOR =
    "[data-controller-pod],[data-controller-landscape-strip]";

/** Non-modal wrapper for the expanded phase list (#333). The list is anchored
 *  to the board's right edge and vertically centered. There is NO blocking
 *  overlay: the game stays fully interactive behind the panel, so a click on
 *  the board both reaches the board AND dismisses the list. Click-away is
 *  detected with a document `pointerdown` listener — a press anywhere outside
 *  the list (and outside the surface whose CTA owns the toggle) closes it.
 *
 *  It is also the landscape-compact phase surface (#1769): the portrait bottom
 *  sheet is `md:hidden` (invisible on a ≥768px-wide landscape phone) and
 *  `max-h-[70vh]` (70% of the dimension that mode is short of), whereas this
 *  panel is right-edge and vertically centred already. It anchors LEFT of the
 *  landscape strip via {@link BESIDE_CONTROLLER_STRIP}, which falls back to the
 *  panel's historical `right-3` whenever no strip is mounted — so the desktop
 *  pod's panel does not move. */
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
            // Inside the controller surface (whose CTA owns open/close): let
            // that surface handle the toggle so we don't
            // double-close-then-reopen.
            if (
                target instanceof Element &&
                target.closest(TOGGLE_OWNER_SELECTOR)
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
            className={`fixed top-1/2 z-sheet -translate-y-1/2 ${BESIDE_CONTROLLER_STRIP}`}
        >
            <ControllerPhaseList onClose={onClose} />
        </div>
    );
}
