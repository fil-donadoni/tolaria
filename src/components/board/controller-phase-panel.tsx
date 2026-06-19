import ControllerPhaseList from "./controller-phase-list";

/** Non-modal wrapper for the expanded phase list (#331): a transparent
 *  click-away layer closes it on outside click; the list is anchored to the
 *  right edge and vertically centered. While open it momentarily covers the
 *  stack/piles column — a deliberate reveal, dismissed on click-away. */
export default function ControllerPhasePanel({
    onClose,
}: {
    onClose: () => void;
}) {
    return (
        <>
            <div className="fixed inset-0 z-40" aria-hidden onClick={onClose} />
            <div className="fixed right-3 top-1/2 z-50 -translate-y-1/2">
                <ControllerPhaseList onClose={onClose} />
            </div>
        </>
    );
}
