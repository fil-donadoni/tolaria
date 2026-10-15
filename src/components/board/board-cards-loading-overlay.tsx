import { Button } from "~/components/ui/button";

/** Covers the board while the Sets a new snapshot names are installing
 *  (issue #5615): the board keeps showing the LAST snapshot it could
 *  resolve, so nothing below is unmounted — but that snapshot is stale, and
 *  a click on one of its controls would carry a stale `seq`. The overlay
 *  takes the pointer until the live snapshot shows; a failed install is
 *  named here, with a retry, never hidden behind the stale board. A fixed
 *  layer above the board's own stacking: the stale controls all live in the
 *  board's `<main>`. */
export default function BoardCardsLoadingOverlay({
    error,
    onRetry,
}: {
    error: Error | null;
    onRetry: () => void;
}) {
    return (
        <div
            role={error ? "alert" : "status"}
            aria-live="polite"
            data-board-cards-loading
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-surface-base/60 text-white backdrop-blur-[1px]"
        >
            {error ? (
                <>
                    <p className="text-sm">
                        Could not load the card catalogue.
                    </p>
                    <p className="text-xs text-text-muted">{error.message}</p>
                    <Button onClick={onRetry}>Retry</Button>
                </>
            ) : (
                "Loading cards..."
            )}
        </div>
    );
}
