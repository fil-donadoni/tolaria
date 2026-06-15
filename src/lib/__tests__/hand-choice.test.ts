import { describe, it, expect } from "vitest";
import type { PendingChoice } from "~/types/game";
import { isSelectableHandChoiceCard } from "../hand-choice";

function choice(overrides: Partial<PendingChoice> = {}): PendingChoice {
    return {
        stackItemId: "s1",
        step: 0,
        choiceId: "me",
        playerId: "me",
        kind: "choose-hand-card",
        zone: "hand",
        count: { min: 0, max: 1 },
        prompt: "pick",
        ...overrides,
    } as PendingChoice;
}

const card = (id: string) => ({ id, ownerId: "me" });

describe("isSelectableHandChoiceCard", () => {
    it("selects own hand cards when there is no candidate restriction", () => {
        expect(isSelectableHandChoiceCard(choice(), card("c1"), "me")).toBe(
            true
        );
    });

    it("restricts selection to candidateIds when present (Illusionary Mask)", () => {
        const c = choice({ candidateIds: ["c1"] });
        expect(isSelectableHandChoiceCard(c, card("c1"), "me")).toBe(true);
        expect(isSelectableHandChoiceCard(c, card("c2"), "me")).toBe(false);
    });

    it("is false when no choice is active", () => {
        expect(isSelectableHandChoiceCard(undefined, card("c1"), "me")).toBe(
            false
        );
    });

    it("is false when the viewer is not the chooser", () => {
        expect(
            isSelectableHandChoiceCard(
                choice({ playerId: "opp" }),
                card("c1"),
                "me"
            )
        ).toBe(false);
    });

    it("is false for a non-hand choice", () => {
        expect(
            isSelectableHandChoiceCard(
                choice({ zone: "battlefield" }),
                card("c1"),
                "me"
            )
        ).toBe(false);
    });

    it("is false for a card the viewer does not own", () => {
        expect(
            isSelectableHandChoiceCard(
                choice(),
                { id: "c1", ownerId: "opp" },
                "me"
            )
        ).toBe(false);
    });
});
