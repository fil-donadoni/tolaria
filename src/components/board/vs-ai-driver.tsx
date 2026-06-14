// Mount point for the vs-AI Bot driver (ADR 0001, issue #109). Renders nothing;
// it just runs the driver hook with the bot's current decision view. Board
// conditionally mounts it only for vs-AI games, so the hook itself stays
// unconditional inside the component.

import type { Id } from "@convex/_generated/dataModel";
import type { BotView } from "~/lib/ai/brain";
import { useVsAiDriver } from "~/hooks/useVsAiDriver";

export default function VsAiDriver({
    gameId,
    view,
}: {
    gameId: Id<"games">;
    view: BotView | null;
}) {
    useVsAiDriver(gameId, view);
    return null;
}
