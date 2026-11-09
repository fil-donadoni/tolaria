import { describe, it, expect } from "vitest";
import { planWorkflowBand } from "../issue-workflow-band";

// A workflow bug is P0 (issue #6902): open, `bug` and `area:workflow`.
describe("issue:workflow-band (issue #6902)", () => {
    const bug = ["bug", "area:workflow", "ready-for-agent"];

    it("an open workflow bug below P0 is raised to P0", () => {
        for (const priority of [null, "P1", "P3"] as const)
            expect(
                planWorkflowBand({ state: "OPEN", labels: bug, priority })
            ).toEqual({ kind: "write" });
    });

    it("needs both labels", () => {
        expect(
            planWorkflowBand({
                state: "OPEN",
                labels: ["bug", "area:mechanics"],
                priority: null,
            })
        ).toMatchObject({ kind: "none" });
        expect(
            planWorkflowBand({
                state: "OPEN",
                labels: ["enhancement", "area:workflow"],
                priority: null,
            })
        ).toMatchObject({ kind: "none" });
    });

    // issue #9000: a system-filed Bot fault (`bug` + `bot-fault`) is P0 too.
    it("an open Bot fault below P0 is raised to P0, and needs `bug`", () => {
        const fault = ["bug", "area:game-bot", "bot-fault", "ready-for-agent"];
        for (const priority of [null, "P1", "P2"] as const)
            expect(
                planWorkflowBand({ state: "OPEN", labels: fault, priority })
            ).toEqual({ kind: "write" });
        expect(
            planWorkflowBand({
                state: "OPEN",
                labels: ["enhancement", "bot-fault"],
                priority: null,
            })
        ).toMatchObject({ kind: "none" });
        expect(
            planWorkflowBand({ state: "OPEN", labels: fault, priority: "P0" })
        ).toEqual({ kind: "none", reason: "already P0" });
    });

    it("leaves a closed issue and an existing P0 alone", () => {
        expect(
            planWorkflowBand({ state: "CLOSED", labels: bug, priority: null })
        ).toEqual({ kind: "none", reason: "closed" });
        expect(
            planWorkflowBand({ state: "OPEN", labels: bug, priority: "P0" })
        ).toEqual({ kind: "none", reason: "already P0" });
    });
});
