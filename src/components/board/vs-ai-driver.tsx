// Mount point for the vs-AI Bot driver (ADR 0000, issues #109/#110/#113). Runs
// the driver hook for the bot seat and surfaces its "thinking" state as a small
// indicator. The hook queries the bot's own viewpoint and drives its moves;
// Board conditionally mounts this only for vs-AI games, so the hook itself stays
// unconditional inside the component. Beside it, the human half of the
// consult path (issue #10470): what the human decides between two of the
// Bot's consults, so the Brain Worker can continue from the tree it kept.

import type { Id } from "@convex/_generated/dataModel";
import { useVsAiDriver } from "~/hooks/useVsAiDriver";
import { useConsultPathCapture } from "~/hooks/useConsultPathCapture";
import BotThinkingIndicator from "./bot-thinking-indicator";
import BotStuckNotice from "./bot-stuck-notice";
import BotConnectionNotice from "./bot-connection-notice";

export default function VsAiDriver({
    gameId,
    botId,
    humanId,
}: {
    gameId: Id<"games">;
    botId: string | null;
    /** The human's seat: the viewer's own, against the Bot. */
    humanId: string;
}) {
    const { thinking, skipped, subscriptionError, retrySubscription } =
        useVsAiDriver(gameId, botId);
    useConsultPathCapture(gameId, botId, botId ? humanId : null);
    return (
        <>
            <BotThinkingIndicator thinking={thinking} />
            {/* issue #9003 — rung 5: the ladder found no legal automatic exit,
                so the server advanced the window and filed the fault. A
                transient notice, never a control. */}
            <BotStuckNotice skipped={skipped} />
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
