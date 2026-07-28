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

    // Regression (#1719 review finding 1) — the review flagged this
    // predicate alongside the `kind`-only gates in `HandCardPick` /
    // `gameProjections.ts`'s exposure, since Mind Warp/Leshrac's Sigil
    // (`discard-hand`) hung on BOTH the missing modal AND (independently)
    // the fact that a cross-player pick's cards live in the OPPONENT's hand,
    // never the chooser's own — so the in-hand toggle could never have
    // helped regardless of `kind`. This function was already `kind`-agnostic
    // (it never reads `choice.kind`) and needed NO code change: it correctly
    // refuses ANY card the viewer doesn't own, `discard-hand` included, which
    // is exactly right for a cross-player pick's opponent-owned cards, and
    // exactly what's needed for an own-hand pick's own cards (Pox, cleanup
    // discard) to keep working. Pinned here so a future change can't
    // silently add a `kind` branch that carves out an exception.
    it("is false for a discard-hand pick's card the viewer does not own (Mind Warp/Leshrac's Sigil shape)", () => {
        expect(
            isSelectableHandChoiceCard(
                choice({ kind: "discard-hand", zoneOwnerId: "opp" }),
                { id: "c1", ownerId: "opp" },
                "me"
            )
        ).toBe(false);
    });

    it("is true for a discard-hand pick's OWN card (cleanup discard / Pox shape)", () => {
        expect(
            isSelectableHandChoiceCard(
                choice({ kind: "discard-hand" }),
                { id: "c1", ownerId: "me" },
                "me"
            )
        ).toBe(true);
    });
});
