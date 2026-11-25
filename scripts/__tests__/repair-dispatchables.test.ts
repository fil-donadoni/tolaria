import { describe, it, expect, vi } from "vitest";

const ghMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/gh", () => ({ gh: ghMock }));
vi.mock("../lib/repair-cap", () => ({
    cappedRepairPrs: () => new Map(),
    cappedUiReceiptPrs: () => new Map(),
    escalateCappedRepairs: () => {},
}));

import { repairDispatchables } from "../lib/repair-dispatchables";
import type { PlanConfig } from "../lib/queue-plan";

const CONFIG: PlanConfig = {
    batchCap: 1,
    staleClaimHours: 24,
    defaultImplModel: "sonnet",
    now: "2026-11-25T12:00:00Z",
};

/** Issue #10716: a `gh issue view` that FAILS (not a closed issue) must be
 *  reported as unreadable, so the stalled-PR rule keeps the PR occupying. */
describe("repairDispatchables unreadable issues (issue #10716)", () => {
    it("reports the PR of an issue whose read failed; a closed issue is not unreadable", () => {
        ghMock.mockImplementation((args: string[]) => {
            if (args[0] === "pr")
                return JSON.stringify([
                    {
                        number: 90,
                        headRefName: "fix/issue-1",
                        createdAt: "2026-11-25T00:00:00Z",
                    },
                    {
                        number: 91,
                        headRefName: "fix/issue-2",
                        createdAt: "2026-11-25T00:00:00Z",
                    },
                ]);
            if (args[0] === "api") return "";
            if (args[2] === "1") throw new Error("gh: HTTP 502");
            return JSON.stringify({ state: "CLOSED", labels: [], body: "" });
        });
        const unreadable = new Set<number>();
        const items = repairDispatchables("o/r", [], CONFIG, false, unreadable);
        expect(items).toEqual([]);
        expect([...unreadable]).toEqual([90]);
    });
});
