// What a bug report carries about the bot (issue #2470).
//
// The rings live only in the reporter's tab (ADR 0074), so this collector is
// the single place that decides what survives into a report. Two properties
// matter: empty means ABSENT (a report from the lobby must not carry empty
// scaffolding that reads as "the bot was fine"), and collecting must not clear
// — the Debug panel still shows what the report took.

import { describe, expect, it, beforeEach } from "vitest";
import { collectAiDiagnostics } from "../diagnostics";
import {
    clearAiDecisions,
    clearAiEscalations,
    recordAiDecision,
    recordAiEscalation,
    getAiDecisions,
} from "../trace-store";

beforeEach(() => {
    clearAiDecisions();
    clearAiEscalations();
});

describe("collectAiDiagnostics (issue #2470)", () => {
    it("is absent when the bot never decided anything", () => {
        expect(collectAiDiagnostics()).toBeUndefined();
    });

    it("carries both rings once the bot has decided", () => {
        recordAiDecision({
            outcome: "worker-error",
            expectedKind: "priority",
            phase: "PRECOMBAT_MAIN",
            seq: 12,
            message: "Script error",
        });
        recordAiEscalation({
            rung: 4,
            expectedKind: "priority",
            action: "pass",
        });

        const out = collectAiDiagnostics();
        expect(out?.decisions).toHaveLength(1);
        expect(out?.decisions[0]).toMatchObject({
            outcome: "worker-error",
            seq: 12,
            message: "Script error",
        });
        expect(out?.escalations).toHaveLength(1);
        expect(out?.escalations[0]).toMatchObject({ rung: 4 });
    });

    it("is present when only the escalation ring has anything", () => {
        recordAiEscalation({
            rung: 5,
            expectedKind: "priority",
            action: "no legal automatic exit — awaiting the player",
        });
        expect(collectAiDiagnostics()?.decisions).toEqual([]);
        expect(collectAiDiagnostics()?.escalations).toHaveLength(1);
    });

    it("does not clear the rings it reads", () => {
        recordAiDecision({
            outcome: "move",
            expectedKind: "priority",
            phase: "PRECOMBAT_MAIN",
            seq: 3,
            moveKind: "play-land",
        });
        collectAiDiagnostics();
        expect(getAiDecisions()).toHaveLength(1);
    });

    it("keeps the ring bounded over a long game", () => {
        for (let i = 0; i < 200; i++) {
            recordAiDecision({
                outcome: "skip-pass",
                expectedKind: "priority",
                phase: "END_STEP",
                seq: i,
            });
        }
        const decisions = collectAiDiagnostics()!.decisions;
        expect(decisions.length).toBeLessThanOrEqual(60);
        // The ring keeps the RECENT end: the failure that is still happening.
        expect(decisions[decisions.length - 1].seq).toBe(199);
    });
});
