// Mount point for the vs-AI Bot driver (ADR 0001, issues #109/#110/#113). Runs
// the driver hook for the bot seat and surfaces its "thinking" state as a small
// indicator. The hook queries the bot's own viewpoint and drives its moves;
// Board conditionally mounts this only for vs-AI games, so the hook itself stays
// unconditional inside the component.

import type { Id } from "@convex/_generated/dataModel";
import { useVsAiDriver } from "~/hooks/useVsAiDriver";
import BotThinkingIndicator from "./bot-thinking-indicator";

export default function VsAiDriver({
    gameId,
    botId,
}: {
    gameId: Id<"games">;
    botId: string | null;
}) {
    const { thinking } = useVsAiDriver(gameId, botId);
    return <BotThinkingIndicator thinking={thinking} />;
}
