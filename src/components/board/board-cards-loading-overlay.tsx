/** Covers the board while the Sets a new snapshot names are installing
 *  (issue #5615): the board keeps showing the LAST snapshot it could
 *  resolve, so nothing below is unmounted — but that snapshot is stale, and
 *  a click on one of its controls would carry a stale `seq` (a Pass refused
 *  server-side, then thirty seconds of priority timeout). The overlay takes
 *  the pointer until the live snapshot shows. A fixed layer, above the
 *  board's own stacking, below nothing it needs to be: the stale controls
 *  all live in the board's `<main>`. */
export default function BoardCardsLoadingOverlay() {
    return (
        <div
            role="status"
            aria-live="polite"
            data-board-cards-loading
            className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-base/60 text-white backdrop-blur-[1px]"
        >
            Loading cards...
        </div>
    );
}
