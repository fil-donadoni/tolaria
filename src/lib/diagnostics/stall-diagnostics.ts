import { getAiTraces, type AiTraceRecord } from "~/lib/ai/trace-store";
import {
    collectClientDiagnostics,
    type ClientDiagnostics,
} from "./client-diagnostics";

/** How many of the newest Bot decision traces a stall hand-off carries. Each
 *  holds a full candidate list with a per-term breakdown, and the report row
 *  also holds the frozen board: the newest few explain the stall, the rest
 *  only spend the row's size budget. */
export const STALL_TRACE_LIMIT = 3;

/** What the vs-AI driver sends with `botLiveness.reportStall` (issue #9003):
 *  the bug-report collector's payload — build, the Bot's decision and
 *  escalation rings, the console ring — plus the newest decision traces. */
export type StallDiagnostics = ClientDiagnostics & {
    traces?: AiTraceRecord[];
};

/** A pure read, like `collectClientDiagnostics`: nothing is cleared, so the
 *  Debug panel and a later bug report still see what the hand-off took. */
export function collectStallDiagnostics(): StallDiagnostics {
    const diagnostics: StallDiagnostics = collectClientDiagnostics();
    const traces = getAiTraces().slice(-STALL_TRACE_LIMIT);
    if (traces.length > 0) diagnostics.traces = traces;
    return diagnostics;
}
