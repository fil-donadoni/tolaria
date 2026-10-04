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

    describe("a Minimal Pair (issue #4801, ADR 0148)", () => {
        const D = { kind: "step" as const, detail: "the opponent's end step" };
        const ANCHOR: ReviewVerdict = {
            ...VERDICT,
            judgement: {
                ...VERDICT.judgement,
                seat: "me",
                deckKnowledge: undefined,
                answer: { kind: "forbidden", forbiddenIndexes: [1] },
                classification: { kind: "conditional", discriminant: D },
            },
        };
        const HALF: ReviewVerdict = {
            ...VERDICT,
            verdictId: "v1-" + "2".repeat(64),
            judgement: {
                ...ANCHOR.judgement,
                answer: { kind: "right", rightIndexes: [1] },
                classification: undefined,
                pairOf: { anchorId: ANCHOR.verdictId, discriminant: D },
            },
        };

        it("shows an anchor its right-hand half and the Discriminant beside it", () => {
            render(
                <VerdictColdJudgement
                    verdict={{
                        ...ANCHOR,
                        pair: {
                            role: "anchor",
                            discriminant: D,
                            anchor: null,
                            halves: [HALF],
                        },
                    }}
                />
            );
            expect(
                screen.getByTestId("verdict-pair-discriminant").textContent
            ).toBe("Discriminant — step: the opponent's end step");
            expect(screen.getByTestId("verdict-pair-half")).toBeTruthy();
        });

        it("says the half is still owed when an anchor has none", () => {
            render(
                <VerdictColdJudgement
                    verdict={{
                        ...ANCHOR,
                        pair: {
                            role: "anchor",
                            discriminant: D,
                            anchor: null,
                            halves: [],
                        },
                    }}
                />
            );
            expect(screen.getByTestId("verdict-pair-missing").textContent).toBe(
                "The right-hand half is still owed."
            );
        });

        it("shows a half its anchor", () => {
            render(
                <VerdictColdJudgement
                    verdict={{
                        ...HALF,
                        pair: {
                            role: "half",
                            discriminant: D,
                            anchor: ANCHOR,
                            halves: [],
                        },
                    }}
                />
            );
            expect(screen.getByTestId("verdict-pair-anchor")).toBeTruthy();
        });

        it("agreeing with an anchor carries its classification, so it attests THAT verdict", async () => {
            render(<VerdictColdJudgement verdict={ANCHOR} />);
            fireEvent.click(
                screen.getByRole("button", {
                    name: "Agree with the answer on record",
                })
            );
            await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
            expect(submit.mock.calls[0][0].classification).toEqual({
                kind: "conditional",
                discriminant: D,
            });
            expect(submit.mock.calls[0][0].pairOf).toBeUndefined();
        });

        it("agreeing with a half carries its pair link", async () => {
            render(<VerdictColdJudgement verdict={HALF} />);
            fireEvent.click(
                screen.getByRole("button", {
                    name: "Agree with the answer on record",
                })
            );
            await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
            expect(submit.mock.calls[0][0].pairOf).toEqual(
                HALF.judgement.pairOf
            );
            expect(submit.mock.calls[0][0].classification).toBeUndefined();
        });

        it("naming the half's own move right is still an attestation of the half", async () => {
            render(<VerdictColdJudgement verdict={HALF} />);
            fireEvent.click(screen.getByRole("button", { name: /Cast Shock/ }));
            fireEvent.click(
                screen.getByRole("button", { name: "Record as the right move" })
            );
            await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
            expect(submit.mock.calls[0][0].pairOf).toEqual(
                HALF.judgement.pairOf
            );
        });

        it("disagreeing with a half submits the move as forbidden there, with no pair link", async () => {
            render(<VerdictColdJudgement verdict={HALF} />);
            fireEvent.click(
                screen.getByRole("button", {
                    name: "Disagree: the move is not right here",
                })
            );
            await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
            const sent = submit.mock.calls[0][0];
            expect(sent.answer).toEqual({
                kind: "forbidden",
                forbiddenIndexes: [1],
            });
            expect(sent.pairOf).toBeUndefined();
            expect(sent.classification).toBeUndefined();
            expect(sent.spec).toEqual(HALF.judgement.spec);
        });

        it("offers no disagreement button on an anchor", () => {
            render(<VerdictColdJudgement verdict={ANCHOR} />);
            expect(
                screen.queryByRole("button", {
                    name: "Disagree: the move is not right here",
                })
            ).toBe(null);
        });
    });
});
