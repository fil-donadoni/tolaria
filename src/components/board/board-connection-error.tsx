// The board's escalation surface (issue #3266).
//
// Reached only after `useResilientQuery` has spent its retry budget, or on a
// failure that no retry can fix. What it replaces is the router's catch
// boundary — a raw stack trace over a blank board, with the whole game tree
// torn down under it. The player gets one sentence and a button instead, and
// "Retry" re-subscribes in place rather than reloading the route.

import { Button } from "~/components/ui/button";
import ErrorState from "~/components/ui/error-state";

export default function BoardConnectionError({
    onRetry,
}: {
    onRetry: () => void;
}) {
    return (
        <div className="flex h-full items-center justify-center p-4">
            <ErrorState
                className="max-w-sm"
                message={
                    <span className="flex flex-col gap-1">
                        <span>Lost contact with the game.</span>
                        {/* The engine state is server-side and untouched: the
                            subscription failed, the GAME did not. Say so — a
                            player who thinks the match is gone closes the tab. */}
                        <span className="text-xs text-text-muted">
                            The game itself is safe — only this view stopped
                            updating.
                        </span>
                    </span>
                }
                action={
                    <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={onRetry}
                    >
                        Retry
                    </Button>
                }
            />
        </div>
    );
}
