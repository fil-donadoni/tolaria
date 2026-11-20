// The play-time notes (issue #10088): the plain affordance writes the Plan,
// the comment and the "obvious" mark into the capture, tied to the seq on
// screen and to the decision the seat is on.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PublicGameState } from "@convex/gameProjections";
import {
    captureHumanDecision,
    clearHumanCapture,
    humanCaptureView,
    humanPlans,
    startHumanCapture,
} from "~/lib/ai/human-decision-capture";
import { setProposalStorageForTest } from "~/lib/ai/verdict-proposal-persistence";
import DecisionCaptureNotes from "../decision-capture-notes";

const GAME = "game-10088";

function view(seat: string, seq: number): PublicGameState {
    return {
        seq,
        players: [{ id: seat, hand: [] }],
    } as unknown as PublicGameState;
}

afterEach(() => {
    cleanup();
    clearHumanCapture();
    setProposalStorageForTest(undefined);
});

describe("DecisionCaptureNotes (issue #10088)", () => {
    it("states a Plan on the seq on screen and annotates the open decision", () => {
        setProposalStorageForTest(null);
        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        captureHumanDecision(GAME, { state: view("me", 7), botId: "me" });
        render(<DecisionCaptureNotes gameId={GAME} seatId="me" seq={8} />);

        fireEvent.click(screen.getByRole("button", { name: "Notes" }));
        fireEvent.change(screen.getByLabelText("Plan"), {
            target: { value: "race them" },
        });
        fireEvent.click(screen.getByRole("button", { name: "State plan" }));
        expect(humanPlans(GAME)).toEqual([
            { seatId: "me", text: "race them", seq: 8 },
        ]);
        expect(screen.getByText("Plan: race them")).toBeTruthy();

        fireEvent.change(screen.getByLabelText("Why this decision"), {
            target: { value: "keep Bolt up" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Comment" }));
        expect(humanCaptureView(GAME, "me").decision).toEqual({
            seq: 7,
            annotation: { kind: "comment", text: "keep Bolt up" },
        });
        expect(screen.getByText("This decision: keep Bolt up")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "Obvious" }));
        expect(humanCaptureView(GAME, "me").decision?.annotation).toEqual({
            kind: "obvious",
        });
    });

    it("offers no decision note while no decision is open", () => {
        setProposalStorageForTest(null);
        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        render(<DecisionCaptureNotes gameId={GAME} seatId="me" seq={3} />);
        fireEvent.click(screen.getByRole("button", { name: "Notes" }));
        expect(screen.getByText("No decision open.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    });
});
