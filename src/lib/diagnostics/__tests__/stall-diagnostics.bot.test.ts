// The diagnostics a vs-AI stall hand-off carries (issue #9003): the bug-report
// collector's payload plus only the NEWEST decision traces, read without
// clearing anything.
import { afterEach, describe, expect, it } from "vitest";
import {
    clearAiEscalations,
    clearAiTraces,
    getAiTraces,
    pushAiTrace,
    recordAiEscalation,
} from "~/lib/ai/trace-store";
import {
    STALL_TRACE_LIMIT,
    collectStallDiagnostics,
} from "../stall-diagnostics";

afterEach(() => {
    clearAiTraces();
    clearAiEscalations();
});

describe("collectStallDiagnostics (issue #9003)", () => {
    it("carries the escalation ring and only the newest traces, clearing nothing", () => {
        recordAiEscalation({ rung: 5, expectedKind: "priority", action: "x" });
        for (let i = 0; i < STALL_TRACE_LIMIT + 2; i++) {
            pushAiTrace({ marker: i } as never, "worker");
        }

        const diagnostics = collectStallDiagnostics();
        expect(diagnostics.build).toBeDefined();
        expect(diagnostics.ai?.escalations).toHaveLength(1);
        expect(diagnostics.traces?.map((t) => t.trace)).toEqual(
            [2, 3, 4].map((marker) => ({ marker }))
        );
        expect(getAiTraces()).toHaveLength(STALL_TRACE_LIMIT + 2);
    });

    it("omits the traces section when there are none", () => {
        expect(collectStallDiagnostics().traces).toBeUndefined();
    });
});
