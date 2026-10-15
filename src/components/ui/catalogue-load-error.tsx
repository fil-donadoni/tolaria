import AmbientPageGround from "@/components/ui/ambient-page-ground";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/** A card-data load that failed, offered a retry rather than swallowed (ADR
 *  0113 §3): the catalogue gate's packed corpus or whole-catalogue load, and
 *  the game route's Definition Manifest gate alike (issue #5615). A catalogue
 *  that never arrives is an app with no cards at all, and the alternative to
 *  a named error is a white screen. */
export default function CatalogueLoadError({
    error,
    onRetry,
}: {
    error: Error;
    onRetry: () => void;
}) {
    return (
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-base text-text">
            <AmbientPageGround ring />
            <Panel className="relative z-10 flex max-w-md flex-col items-center gap-4 text-center">
                <p className="text-sm">Could not load the card catalogue.</p>
                <p className="text-xs text-text-muted">{error.message}</p>
                <Button onClick={onRetry}>Retry</Button>
            </Panel>
        </div>
    );
}
