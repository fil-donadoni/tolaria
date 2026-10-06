import { describe, expect, it } from "vitest";
import { isPipelineCommand } from "../lib/pipeline-command.ts";
import { isNextIssue } from "../lib/telemetry-latency.ts";
import { isNextIssueCommand } from "../lib/telemetry-budget.ts";

describe("isPipelineCommand (issue #5105)", () => {
    it("reads the former and the current skill name as one pipeline", () => {
        expect(isPipelineCommand("/next-issue 3080")).toBe(true);
        expect(isPipelineCommand("/next-ticket 5105")).toBe(true);
        expect(isPipelineCommand("/next-tickets 5105")).toBe(false);
        expect(isPipelineCommand("/to-tickets 5105")).toBe(false);
        expect(isPipelineCommand(null)).toBe(false);
    });

    it("gives every telemetry reader one population over an old-name and a new-name row", () => {
        const rows = [
            { session: "old", cmd: "/next-issue 3079", prs: [1] },
            { session: "new", cmd: "/next-ticket 5105", prs: [2] },
        ];
        const lat = rows.map((r) => ({ ...r, prs: r.prs.length })) as never[];
        expect(lat.filter(isNextIssue as never)).toHaveLength(2);
        expect(rows.filter((r) => isNextIssueCommand(r.cmd))).toHaveLength(2);
    });
});
