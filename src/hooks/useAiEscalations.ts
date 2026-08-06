// Subscribe to the bot's liveness escalations pushed by the vs-AI driver
// (issue #2284).
//
// Read-only client view used by the Debug panel's AI section. Re-renders when
// the driver escalates past rung 1; returns an empty list while the liveness
// invariant is being upheld normally (the common case, and the point).

import { useSyncExternalStore } from "react";
import { subscribeAiEscalations, getAiEscalations } from "~/lib/ai/trace-store";

export function useAiEscalations() {
    return useSyncExternalStore(
        subscribeAiEscalations,
        getAiEscalations,
        getAiEscalations
    );
}
