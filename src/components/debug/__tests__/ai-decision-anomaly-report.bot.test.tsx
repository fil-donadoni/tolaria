// "Report anomaly": reporting a bug and judging a move are the same gesture
// (issue #3405, PRD #3397 user story 34).
//
// Two halves, and both are load-bearing. The box has to be able to OPEN the
// dialog — it lives in the debug sheet and the dialog is mounted once at the
// router root, so without the hand-off there is no way to reach it from a
// decision at all. And the report has to CARRY the decision: a bug report about
// the Bot that arrives with a board snapshot and nothing about what the Bot
// weighed is the exact shape of report that could not be root-caused before
// (#2450), which is why the payload's allowlist gains a field rather than the
// reporter being asked to paste a trace by hand.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("convex/react", () => ({
    useQuery: () => null,
    useMutation: () => vi.fn(),
    useAction: () => vi.fn(),
    useConvex: () => ({
        connectionState: () => ({
            isWebSocketConnected: true,
            hasEverConnected: true,
            connectionCount: 1,
            connectionRetries: 0,
            hasInflightRequests: false,
        }),
    }),
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        users: { currentUser: { _name: "currentUser" } },
        verdicts: { submit: { _name: "submit" } },
        bugReports: {
            generateUploadUrl: { _name: "generateUploadUrl" },
            submitBugReport: { _name: "submitBugReport" },
        },
    },
}));

import type { CandidateTrace, DecisionTrace, EvalTerms } from "@convex/gre";
import { pushAiTrace, clearAiTraces } from "~/lib/ai/trace-store";
import { clearAnomalyReport } from "~/lib/ai/anomaly-report";
import { collectAiDiagnostics } from "~/lib/ai/diagnostics";
import { describeClientDiagnostics } from "~/lib/diagnostics/client-diagnostics";
import AiDecisionTrace from "../ai-decision-trace";
import BugReportButton from "~/components/bug-report/bug-report-button";

const ZERO_TERMS: EvalTerms = {
    life: 0,
    hand: 0,
    creatures: 0,
    permanents: 0,
    mana: 0,
    manaDevelopment: 0,
    flexibility: 0,
    library: 0,
    graveyard: 0,
    graveyardReach: 0,
};

function candidate(label: string, visits: number): CandidateTrace {
    return {
        label,
        move: { kind: "pass" },
        visits,
        meanReward: 0.5,
        meanMargin: -2,
        avail: visits,
        eval: {
            self: ZERO_TERMS,
            opp: ZERO_TERMS,
            margin: 0,
            danger: 0,
            total: 0,
        },
    };
}

const TRACE: DecisionTrace = {
    botId: "p1",
    chosen: "attack with Grizzly Bears",
    iterationsCompleted: 400,
    iterationsRequested: 400,
    elapsedMs: 50,
    stoppedBy: "iterations",
    mechanism: "material-tiebreak",
    candidates: [
        candidate("attack with Grizzly Bears", 300),
        candidate("pass", 100),
    ],
};

beforeEach(() => {
    cleanup();
    clearAiTraces();
    clearAnomalyReport();
});

describe("Report anomaly, from the decision box (issue #3405)", () => {
    it("attaches the decision to the diagnostics payload the report sends", () => {
        pushAiTrace(TRACE, "worker");
        render(<AiDecisionTrace />);

        // Nothing before the tester asks — a payload is an allowlist, and a
        // field that filled itself would travel on every report from anywhere.
        expect(collectAiDiagnostics()?.reportedDecision).toBeUndefined();

        fireEvent.click(screen.getByRole("button", { name: "Report anomaly" }));

        const reported = collectAiDiagnostics()?.reportedDecision;
        expect(reported).toBeDefined();
        expect(reported!.chosen).toBe("attack with Grizzly Bears");
        expect(reported!.mechanism).toBe("material-tiebreak");
        expect(reported!.via).toBe("worker");
        // Every alternative it weighed, with the played one marked — the
        // question "was the search wrong or was the evaluation wrong" cannot be
        // asked without both.
        expect(reported!.candidates.map((c) => c.label)).toEqual([
            "attack with Grizzly Bears",
            "pass",
        ]);
        expect(reported!.candidates.map((c) => c.chosen)).toEqual([
            true,
            false,
        ]);
        expect(reported!.candidates[0].visits).toBe(300);
    });

    it("names the decision in the consent summary, since it is being sent", () => {
        // The gate's sentence is DERIVED from the payload (issue #3255): a
        // field that travels unnamed is a disclosure that lies by omission.
        pushAiTrace(TRACE, "worker");
        render(<AiDecisionTrace />);
        fireEvent.click(screen.getByRole("button", { name: "Report anomaly" }));

        const described = describeClientDiagnostics({
            build: {} as never,
            ai: collectAiDiagnostics()!,
        });
        expect(described).toContain("the Bot decision you are reporting");
    });

    it("opens the bug-report dialog, which is mounted in another subtree", () => {
        pushAiTrace(TRACE, "worker");
        render(
            <>
                <BugReportButton />
                <AiDecisionTrace />
            </>
        );
        expect(screen.queryByText("Report a bug")).toBe(null);

        fireEvent.click(screen.getByRole("button", { name: "Report anomaly" }));

        expect(screen.getByText("Report a bug")).toBeTruthy();
    });

    it("drops the decision when the dialog is closed, so it cannot ride the next report", () => {
        pushAiTrace(TRACE, "worker");
        render(
            <>
                <BugReportButton />
                <AiDecisionTrace />
            </>
        );
        fireEvent.click(screen.getByRole("button", { name: "Report anomaly" }));
        expect(collectAiDiagnostics()?.reportedDecision).toBeDefined();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(collectAiDiagnostics()?.reportedDecision).toBeUndefined();
    });
});
