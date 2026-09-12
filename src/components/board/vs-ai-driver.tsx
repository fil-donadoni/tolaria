// Mount point for the vs-AI Bot driver (ADR 0001, issues #109/#110/#113). Runs
// the driver hook for the bot seat and surfaces its "thinking" state as a small
// indicator. The hook queries the bot's own viewpoint and drives its moves;
// Board conditionally mounts this only for vs-AI games, so the hook itself stays
// unconditional inside the component.

import type { Id } from "@convex/_generated/dataModel";
import { useVsAiDriver } from "~/hooks/useVsAiDriver";
import BotThinkingIndicator from "./bot-thinking-indicator";
import BotStuckNotice from "./bot-stuck-notice";
import BotConnectionNotice from "./bot-connection-notice";

export default function VsAiDriver({
    gameId,
    botId,
}: {
    gameId: Id<"games">;
    botId: string | null;
}) {
    const {
        thinking,
        stuck,
        resolveStuck,
        subscriptionError,
        retrySubscription,
    } = useVsAiDriver(gameId, botId);
    return (
        <>
            <BotThinkingIndicator thinking={thinking} />
            {/* issue #2284 — rung 5: the ladder found no legal automatic exit,
                so the player gets one. Never a silent no-op. */}
            <BotStuckNotice stuck={stuck} onResolve={resolveStuck} />
            {/* issue #3266 review — the driver's OWN subscriptions gave up.
                A bot that stopped because its queries are parked looks exactly
                like a bot that is thinking, forever. */}
            <BotConnectionNotice
                error={subscriptionError}
                onRetry={retrySubscription}
            />
        </>
    );
}
