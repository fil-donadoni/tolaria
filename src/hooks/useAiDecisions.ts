// Subscribe to the bot's decision breadcrumbs pushed by the vs-AI driver
// (issue #2470).
//
// Read-only client view used by the Debug panel's AI section. Unlike
// `useAiEscalations`, this one is NOT empty in the healthy case — every
// decision leaves a record, because a wall of successful decisions is what
// tells a reader the Brain was working and the bot meant its passes.

import { useSyncExternalStore } from "react";
import { subscribeAiDecisions, getAiDecisions } from "~/lib/ai/trace-store";

export function useAiDecisions() {
    return useSyncExternalStore(
        subscribeAiDecisions,
        getAiDecisions,
        getAiDecisions
    );
}
