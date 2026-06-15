// Subscribe to the latest AI DecisionTrace pushed by the vs-AI driver.
//
// Read-only client view used by the Debug panel's AI section. Re-renders when a
// new bot decision is traced; returns null before the bot has thought (or in
// games without a bot).

import { useSyncExternalStore } from "react";
import { subscribeAiTrace, getLatestAiTrace } from "~/lib/ai/trace-store";

export function useLatestAiTrace() {
    return useSyncExternalStore(
        subscribeAiTrace,
        getLatestAiTrace,
        getLatestAiTrace
    );
}
