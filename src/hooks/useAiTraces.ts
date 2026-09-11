// Subscribe to the ring of AI DecisionTraces pushed by the vs-AI driver.
//
// Read-only client view used by the Debug panel's AI section. Re-renders when a
// new bot decision is traced; empty before the bot has thought (and in games
// without a bot). Oldest first — the panel reverses for display.

import { useSyncExternalStore } from "react";
import { subscribeAiTrace, getAiTraces } from "~/lib/ai/trace-store";

export function useAiTraces() {
    return useSyncExternalStore(subscribeAiTrace, getAiTraces, getAiTraces);
}
