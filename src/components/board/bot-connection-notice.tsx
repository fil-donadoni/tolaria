// The vs-AI driver's own subscriptions gave up (issue #3266 review).
//
// `<Board>` has its own error surface, but it cannot cover this: the tick and
// the bot's public-state query are private to `useVsAiDriver`, and a parked
// subscription never un-parks by itself. Without this the failure is entirely
// silent — the human's side of the board keeps working and the AI simply never
// moves again, which reads as a hung game rather than a lost connection.
//
// Same shape and the same reasoning as `BotStuckNotice` next to it: say what
// happened in plain English, and offer the one control that undoes it.

import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";

export default function BotConnectionNotice({
    error,
    onRetry,
}: {
    /** `null` while the driver's subscriptions are live or still retrying. */
    error: Error | null;
    onRetry: () => void;
}) {
    if (!error) return null;

    return (
        <div className="pointer-events-auto fixed bottom-20 left-1/2 z-50 -translate-x-1/2">
            <Banner
                tone="danger"
                role="alert"
                className="flex-row items-center gap-3"
            >
                <span>The AI lost contact with the game.</span>
                <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={onRetry}
                >
                    Reconnect
                </Button>
            </Banner>
        </div>
    );
}
