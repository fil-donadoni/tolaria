// Pile-division dialog (ADR 0053, Fact or Fiction). Covers the two render
// contracts that don't need a real drag gesture (jsdom has no layout, so
// pointer hit-testing against zone rects can't be exercised here — the drag
// path is covered by the projection + resolve tests plus manual QA):
//   • DIVIDE mode — Done is disabled while cards remain in the candidates row,
//     and every candidate renders a face.
//   • PICK mode — the two piles render with their counts and the Take buttons
//     submit "A" / "B" through `submitResolutionChoice`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CardInstance, PendingChoice } from "~/types/game";

const calls: { ref: unknown; args: unknown }[] = [];

vi.mock("@convex/_generated/api", () => ({
    api: { game: { submitResolutionChoice: "submitResolutionChoice" } },
}));

vi.mock("convex/react", () => ({
    useMutation: (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));

// The minimize affordance needs the minimized-choice context; irrelevant here.
vi.mock("~/components/board/minimize-choice-button", () => ({
    default: () => <button aria-label="Minimize" />,
}));

const { default: PileDivisionPicker } = await import("../pile-division-picker");

function card(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
        isTapped: false,
    };
}

beforeEach(() => {
    calls.length = 0;
});

describe("PileDivisionPicker — divide mode", () => {
    const choice = {
        stackItemId: "s1",
        step: 0,
        choiceId: "fof:divide",
        playerId: "p2",
        kind: "divide-piles",
        zone: "library",
        count: { min: 0, max: 3 },
        candidateIds: ["l1", "l2", "l3"],
        prompt: "Separate into two piles.",
    } as unknown as PendingChoice;

    it("disables Done and shows the remaining count while cards are unplaced", () => {
        render(
            <PileDivisionPicker
                choice={choice}
                cards={[card("l1"), card("l2"), card("l3")]}
                playerId="p2"
                gameId={"g1" as never}
            />
        );
        const done = screen.getByRole("button", { name: "Done" });
        expect((done as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(/3 cards left/)).toBeTruthy();
        // Every candidate renders a face (img alt="" → role img has no name).
        expect(document.querySelectorAll("img").length).toBe(3);
    });
});

describe("PileDivisionPicker — pick mode", () => {
    const choice = {
        stackItemId: "s1",
        step: 0,
        choiceId: "fof:pick",
        playerId: "p1",
        kind: "pick-pile",
        count: 1,
        pileA: ["l1"],
        pileB: ["l2", "l3"],
        prompt: "Choose a pile.",
    } as unknown as PendingChoice;

    it("renders both pile counts and submits the chosen pile label", () => {
        render(
            <PileDivisionPicker
                choice={choice}
                cards={[card("l1"), card("l2"), card("l3")]}
                playerId="p1"
                gameId={"g1" as never}
            />
        );
        expect(screen.getByText("Pile A (1)")).toBeTruthy();
        expect(screen.getByText("Pile B (2)")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "Take Pile B" }));
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("submitResolutionChoice");
        expect(calls[0].args).toMatchObject({
            gameId: "g1",
            playerId: "p1",
            choiceId: "fof:pick",
            cardInstanceIds: ["B"],
        });
    });
});
