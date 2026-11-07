// A Set that fails to download refuses out loud, never a panel stuck on its
// loading line (issue #8728).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("~/lib/catalogue/definitionShards", () => ({
    installHandWrittenSets: () =>
        Promise.reject(new Error("chunk failed to load")),
}));
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: () => ({ nickname: "Tessa", isTester: true }),
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        users: { currentUser: "users:currentUser" },
        verdicts: { submit: "verdicts:submit" },
    },
}));
vi.mock("~/lib/session", () => ({
    getStoredSession: () => ({ gameId: "game-7", playerId: "p1" }),
}));

import { makeState } from "@convex/cards/__tests__/setup.helper";
import type { FullGameState } from "@convex/gameProjections";
import AiDecisionVerdictQuiz from "../ai-decision-verdict-quiz";
import DebugCopyScenario from "../debug-copy-scenario";

describe("a hand-written Set fails to install (issue #8728)", () => {
    it("the quiz refuses with the cause", async () => {
        render(
            <AiDecisionVerdictQuiz
                subject={{
                    id: 1,
                    feed: {
                        kind: "trace",
                        trace: { chosen: "pass" } as never,
                        source: { state: {} as never, botId: "p1" },
                    },
                }}
                onJudged={() => {}}
                onClose={() => {}}
            />
        );
        expect(
            await screen.findByText(
                "the quiz could not be built: chunk failed to load",
                {},
                { timeout: 30_000 }
            )
        ).toBeTruthy();
    }, 30_000);

    it("Copy as scenario says it could not copy", async () => {
        render(
            <DebugCopyScenario
                state={makeState() as unknown as FullGameState}
                mySeatId="p1"
            />
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Copy as scenario" })
        );
        expect(
            await screen.findByText(
                "this position could not be copied as a scenario: chunk failed to load"
            )
        ).toBeTruthy();
    });
});
