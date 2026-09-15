// `/admin/verdicts` — where a contested position is rebuilt and resolved
// (issue #3582, PRD #3574, ADR 0128 §6).
//
// The claims worth a DOM: both answers are on screen with the people who gave
// them; opening a position rebuilds the board with the DECIDING seat's hand
// shown (and only that hand); a resolution cannot be sent while a rejected
// answer has no reason; and what is sent is the decision the admin made.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReviewPosition, VerdictReview } from "@convex/verdictReview";
import VerdictReviewPanel from "../verdict-review-panel";

const review = vi.fn();
const resolve = vi.fn();

vi.mock("convex/react", () => ({
    useAction: (fn: { _name: string }) =>
        fn._name === "review"
            ? review
            : fn._name === "resolve"
              ? resolve
              : vi.fn(),
    useMutation: () => vi.fn(),
}));

vi.mock("@convex/_generated/api", () => {
    const leaf = (name: string): unknown =>
        new Proxy(
            { _name: name },
            {
                get: (target, prop) =>
                    prop === "_name" || typeof prop === "symbol"
                        ? Reflect.get(target, prop)
                        : leaf(String(prop)),
            }
        );
    return { api: leaf("") };
});

const ID_PASS = "v1-" + "1".repeat(64);
const ID_BOLT = "v1-" + "2".repeat(64);
const KEY = "v1-" + "9".repeat(64);

const JUDGEMENT = {
    spec: {
        cards: [
            { name: "Mountain", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Counterspell",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        turn: 5,
    },
    seat: "me" as const,
    candidates: [
        { key: "pass", description: "Pass priority" },
        {
            key: "bolt",
            description: "Cast Lightning Bolt targeting Grizzly Bears",
        },
    ],
};

const POSITION: ReviewPosition = {
    positionKey: KEY,
    status: "contested",
    verdicts: [
        {
            verdictId: ID_PASS,
            positionKey: KEY,
            judgement: {
                ...JUDGEMENT,
                answer: { kind: "right", rightIndexes: [0] },
            },
            attestations: [
                { author: "dep:u-alice", nickname: "Alice", note: "hold it" },
            ],
        },
        {
            verdictId: ID_BOLT,
            positionKey: KEY,
            judgement: {
                ...JUDGEMENT,
                answer: { kind: "right", rightIndexes: [1] },
            },
            attestations: [{ author: "other-dep:u-bob" }],
        },
    ],
    resolution: null,
    staleResolution: null,
};

const REVIEW: VerdictReview = {
    positions: [POSITION],
    promotable: 4,
    storeRead: false,
    unreadable: [],
};

beforeEach(() => {
    review.mockReset().mockResolvedValue(REVIEW);
    resolve.mockReset().mockResolvedValue("v1-" + "r".repeat(64));
});

async function openPosition() {
    render(<VerdictReviewPanel />);
    const row = await screen.findByTestId("verdict-position-row");
    fireEvent.click(row);
    return await screen.findByTestId("verdict-position-detail");
}

describe("VerdictReviewPanel", () => {
    it("lists the contested position with both answers", async () => {
        render(<VerdictReviewPanel />);
        const row = await screen.findByTestId("verdict-position-row");
        expect(row.textContent).toContain("Contested");
        expect(row.textContent).toContain("A — Right: Pass priority");
        expect(row.textContent).toContain(
            "B — Right: Cast Lightning Bolt targeting Grizzly Bears"
        );
        expect(
            screen.getByText("1 contested · 0 resolved · 4 promotable")
        ).toBeTruthy();
    });

    it("rebuilds the board with the deciding seat's hand and only that hand", async () => {
        await openPosition();
        expect(screen.getByTestId("scenario-board-hand-me").dataset.hand).toBe(
            "cards"
        );
        expect(screen.getByTestId("scenario-board-hand-opp").dataset.hand).toBe(
            "count"
        );
        expect(screen.getByTestId("scenario-board").textContent).toContain(
            "Lightning Bolt"
        );
        expect(screen.getByTestId("scenario-board").textContent).not.toContain(
            "Counterspell"
        );
        expect(screen.getByTestId("verdict-candidates").textContent).toContain(
            "A: right"
        );
    });

    it("shows both answers side by side with their attesting authors", async () => {
        await openPosition();
        const cards = screen.getAllByTestId("verdict-answer-card");
        expect(cards).toHaveLength(2);
        expect(cards[0].textContent).toContain("Alice");
        expect(cards[0].textContent).toContain("“hold it”");
        // An author this deployment cannot name is shown as the author string.
        expect(cards[1].textContent).toContain("other-dep:u-bob");
    });

    it("will not send a resolution until the rejected answer has a reason, then sends the decision", async () => {
        await openPosition();
        const submit = screen.getByRole("button", {
            name: "Record resolution",
        }) as HTMLButtonElement;
        expect(submit.disabled).toBe(true);

        fireEvent.click(screen.getByLabelText("Answer B is right"));
        expect(submit.disabled).toBe(true);
        expect(screen.getByText("Say why Answer A is wrong.")).toBeTruthy();

        fireEvent.change(screen.getByLabelText("Why Answer A is wrong"), {
            target: { value: "  Bolt kills the only blocker  " },
        });
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);

        await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
        expect(resolve).toHaveBeenCalledWith({
            positionKey: KEY,
            acceptedVerdictId: ID_BOLT,
            rejected: [
                { verdictId: ID_PASS, reason: "Bolt kills the only blocker" },
            ],
        });
        // Resolving reloads the snapshot.
        await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    });

    it("marks a resolved position's rejected answer with its reason, and offers no form", async () => {
        review.mockResolvedValue({
            ...REVIEW,
            positions: [
                {
                    ...POSITION,
                    status: "resolved",
                    resolution: {
                        resolutionId: "v1-" + "r".repeat(64),
                        author: "dep:u-ada",
                        nickname: "Ada",
                        acceptedVerdictId: ID_BOLT,
                        rejected: [{ verdictId: ID_PASS, reason: "too slow" }],
                    },
                },
            ],
        });
        await openPosition();
        const cards = screen.getAllByTestId("verdict-answer-card");
        expect(cards[0].textContent).toContain("Rejected");
        expect(cards[0].textContent).toContain("Why not: too slow");
        expect(cards[1].textContent).toContain("Accepted");
        expect(screen.queryByRole("form")).toBeNull();
        expect(screen.getByText(/Resolved by Ada/)).toBeTruthy();
    });
});
