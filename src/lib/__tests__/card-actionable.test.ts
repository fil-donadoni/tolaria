// Issue #6917 — ONE predicate decides "this card has a legal action for the
// viewer" (the `actionable` ring, ADR 0103 §8). Each source a zone feeds it is
// pinned here, with the negatives that must NOT ring.
import { describe, it, expect } from "vitest";
import {
    actionableRingClass,
    cardHasLegalAction,
    exileActionSources,
    graveyardActionSources,
    isPlainPriorityWindow,
    libraryTopActionSources,
    type ActionWindowView,
} from "../card-actionable";

const window: ActionWindowView = {
    playerId: "me",
    activePlayerId: "me",
    priorityPlayerId: "me",
    phase: "PRECOMBAT_MAIN",
    allPlayers: [{ id: "me" }, { id: "opp" }],
};

describe("isPlainPriorityWindow (Expected Input gate, ADR 0047)", () => {
    it("is open for the seat holding Priority", () => {
        expect(isPlainPriorityWindow(window)).toBe(true);
    });

    it("is closed when the opponent holds Priority", () => {
        expect(
            isPlainPriorityWindow({ ...window, priorityPlayerId: "opp" })
        ).toBe(false);
    });

    it("is closed during a cast payment, an activation payment and a target pick", () => {
        const pending = { playerId: "me" } as never;
        expect(isPlainPriorityWindow({ ...window, pendingCast: pending })).toBe(
            false
        );
        expect(
            isPlainPriorityWindow({ ...window, pendingActivation: pending })
        ).toBe(false);
        expect(
            isPlainPriorityWindow({ ...window, pendingTarget: pending })
        ).toBe(false);
    });

    it("is closed while a Pending Choice is open", () => {
        expect(
            isPlainPriorityWindow({
                ...window,
                pendingChoices: [{ playerId: "me", kind: "choose" } as never],
            })
        ).toBe(false);
    });
});

describe("cardHasLegalAction", () => {
    it("hand cast", () => {
        expect(cardHasLegalAction(true, { legalActions: ["cast"] })).toBe(true);
    });
    it("hand land play", () => {
        expect(cardHasLegalAction(true, { legalActions: ["play"] })).toBe(true);
    });
    it("an untapped land's Mana Ability (CR 605.3a)", () => {
        expect(cardHasLegalAction(true, { manaSourceActivatable: true })).toBe(
            true
        );
    });
    it("a battlefield activated ability", () => {
        expect(cardHasLegalAction(true, { activatableAbilityCount: 1 })).toBe(
            true
        );
    });
    it("companion summon and morph turn-face-up", () => {
        expect(cardHasLegalAction(true, { canSummon: true })).toBe(true);
        expect(cardHasLegalAction(true, { canTurnFaceUp: true })).toBe(true);
    });

    it("flashback from the graveyard (CR 702.34)", () => {
        const card = { legalActions: ["cast"], castKind: "flashback" };
        expect(cardHasLegalAction(true, graveyardActionSources(card, 0))).toBe(
            true
        );
    });
    it("a graveyard activated ability", () => {
        expect(cardHasLegalAction(true, graveyardActionSources({}, 1))).toBe(
            true
        );
    });
    it("cast from exile, and a land only with the land grant (CR 305.9)", () => {
        const spell = { castableFromExileBy: "me", legalActions: ["cast"] };
        expect(cardHasLegalAction(true, exileActionSources(spell, "me"))).toBe(
            true
        );
        const land = {
            castableFromExileBy: "me",
            types: ["Land"],
            legalActions: ["play"],
        };
        expect(cardHasLegalAction(true, exileActionSources(land, "me"))).toBe(
            false
        );
        expect(
            cardHasLegalAction(
                true,
                exileActionSources(
                    { ...land, castableFromExileIncludesLand: true },
                    "me"
                )
            )
        ).toBe(true);
    });
    it("play from the library top", () => {
        const land = { types: ["Land"], legalActions: ["play"] };
        expect(cardHasLegalAction(true, libraryTopActionSources(land))).toBe(
            true
        );
        const spell = { types: ["Instant"], legalActions: ["cast"] };
        expect(cardHasLegalAction(true, libraryTopActionSources(spell))).toBe(
            true
        );
    });

    it("no Priority window ⇒ nothing rings, whatever the sources say", () => {
        expect(
            cardHasLegalAction(false, {
                legalActions: ["cast", "play"],
                canSummon: true,
                canTurnFaceUp: true,
                activatableAbilityCount: 2,
                manaSourceActivatable: true,
            })
        ).toBe(false);
    });
    it("an unaffordable cost (empty legalActions) does not ring", () => {
        expect(cardHasLegalAction(true, { legalActions: [] })).toBe(false);
        expect(
            cardHasLegalAction(
                true,
                graveyardActionSources(
                    { legalActions: [], castKind: "flashback" },
                    0
                )
            )
        ).toBe(false);
    });
    it("a tapped land (no mana source activatable) does not ring", () => {
        expect(cardHasLegalAction(true, { manaSourceActivatable: false })).toBe(
            false
        );
    });
    it("sorcery timing on the opponent's turn: the projection withholds the action", () => {
        expect(cardHasLegalAction(true, {})).toBe(false);
    });
    it("a zone button offers ONE action: the other legal action does not enable it", () => {
        // A flashback card (castKind set) whose only legal action is "play".
        expect(
            cardHasLegalAction(
                true,
                graveyardActionSources(
                    { legalActions: ["play"], castKind: "flashback" },
                    0
                )
            )
        ).toBe(false);
        // Another player's exile card is never the viewer's to cast.
        expect(
            cardHasLegalAction(
                true,
                exileActionSources(
                    { castableFromExileBy: "opp", legalActions: ["cast"] },
                    "me"
                )
            )
        ).toBe(false);
    });
});

describe("actionableRingClass", () => {
    it("is the actionable role when true and empty when false", () => {
        expect(actionableRingClass(true)).toBe(
            "card-ring card-ring-actionable"
        );
        expect(actionableRingClass(false)).toBe("");
    });
});
