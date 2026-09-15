// Judging a verdict cold (issue #3582, ADR 0128).
//
// The claim worth a DOM: agreeing submits the answer ON RECORD, unchanged —
// several right moves, or a forbidden one — together with the position
// exactly as stored. A form that could only name one right move would turn
// every "I agree" with such a verdict into a new, contesting answer.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReviewVerdict } from "@convex/verdictReview";
import VerdictColdJudgement from "../verdict-cold-judgement";

const submit = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: () => submit,
    useAction: () => vi.fn(),
}));

vi.mock("@convex/_generated/api", () => ({
    api: { verdicts: { submit: { _name: "submit" } } },
}));

const VERDICT: ReviewVerdict = {
    verdictId: "v1-" + "1".repeat(64),
    positionKey: "v1-" + "9".repeat(64),
    judgement: {
        spec: { cards: [{ name: "Mountain", owner: "me" }] },
        seat: "opp",
        deckKnowledge: [{ seat: "opp", cards: ["Shock"] }],
        candidates: [
            { key: "pass", description: "Pass priority" },
            { key: "shock", description: "Cast Shock" },
            { key: "land", description: "Play Mountain" },
        ],
        answer: { kind: "forbidden", forbiddenIndexes: [0] },
    },
    attestations: [{ author: "dep:u-alice", nickname: "Alice" }],
};

beforeEach(() => {
    submit.mockReset().mockResolvedValue("row-id");
});

describe("VerdictColdJudgement", () => {
    it("agreeing submits the answer on record unchanged, with the stored position", async () => {
        render(<VerdictColdJudgement verdict={VERDICT} />);
        fireEvent.click(
            screen.getByRole("button", {
                name: "Agree with the answer on record",
            })
        );
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
        expect(submit).toHaveBeenCalledWith({
            spec: VERDICT.judgement.spec,
            seat: "opp",
            deckKnowledge: [{ seat: "opp", cards: ["Shock"] }],
            candidates: VERDICT.judgement.candidates,
            answer: { kind: "forbidden", forbiddenIndexes: [0] },
        });
        expect(
            await screen.findByText(
                "Recorded: your attestation of the answer on record."
            )
        ).toBeTruthy();
    });

    it("naming one move submits that move as the single right answer", async () => {
        render(<VerdictColdJudgement verdict={VERDICT} />);
        fireEvent.click(screen.getByRole("button", { name: /Cast Shock/ }));
        fireEvent.click(
            screen.getByRole("button", { name: "Record as the right move" })
        );
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
        expect(submit.mock.calls[0][0].answer).toEqual({
            kind: "right",
            rightIndexes: [1],
        });
    });
});
