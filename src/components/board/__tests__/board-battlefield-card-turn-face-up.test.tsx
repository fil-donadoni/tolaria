// Morph turn-face-up affordance, MOUNT contract (CR 116.2b / 702.37e, issue
// #2705). `turn-face-up-button.test.tsx` proves the wire field survives the
// real projection and that the button dispatches; this file proves the third
// link nothing else covers — that `BoardBattlefieldCard` actually RENDERS the
// button off that field, and only then.
//
// The permanent is built from a projected shape (`canTurnFaceUp` as the
// projection emits it: `true` or ABSENT, never `false`), so a component that
// keyed on some other field, or rendered the button unconditionally, goes red.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import type { CardVisualState } from "../battlefield-card";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("motion/react", () => ({ useReducedMotion: () => false }));

vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: CardInstance | { id: string } }) => (
        <div
            data-testid="card-image"
            data-card-id={"id" in card ? card.id : "?"}
        />
    ),
}));

const turnPermanentFaceUp = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: () => turnPermanentFaceUp,
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { turnPermanentFaceUp: { _name: "turnPermanentFaceUp" } } },
}));

import BoardBattlefieldCard from "../board-battlefield-card";

// The face-down sentinel (`FACE_DOWN_CARD_ID`) — what the projection puts in
// `card.id` for a face-down permanent, for BOTH seats.
const FACE_DOWN_DEF_ID = "face-down:2-2-vanilla";

function faceDownPermanent(
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id: "morphed",
        card: { id: FACE_DOWN_DEF_ID },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Creature"],
        faceDown: true,
        power: 2,
        toughness: 2,
        ...overrides,
    } as CardInstance;
}

const NEUTRAL_VS: CardVisualState = {
    interactive: false,
    enabled: false,
    dimmed: false,
    combatOffset: "",
    ringClass: "",
    badge: null,
};

function renderCard(card: CardInstance, phased = false) {
    const me: Player = {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [card],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <BoardBattlefieldCard card={card} vs={NEUTRAL_VS} phased={phased} />
        </GameContext>
    );
}

describe("BoardBattlefieldCard — morph turn-face-up affordance (CR 702.37e)", () => {
    beforeEach(() => {
        turnPermanentFaceUp.mockClear();
        cleanup();
    });

    it("renders the button when the projection says the action is available", () => {
        renderCard(faceDownPermanent({ canTurnFaceUp: true }));
        expect(
            screen.getByRole("button", { name: "Turn face up" })
        ).toBeTruthy();
    });

    it("renders NO button when the field is absent (the opponent's view, or unaffordable)", () => {
        renderCard(faceDownPermanent());
        expect(
            screen.queryByRole("button", { name: "Turn face up" })
        ).toBeNull();
    });

    it("renders NO button on a PHASED-OUT permanent (CR 702.26b)", () => {
        // Belt and braces: the projection already withholds the flag for a
        // phased-out bundle (it is projected without a `state`), so this is the
        // component refusing a flag it should never receive.
        renderCard(faceDownPermanent({ canTurnFaceUp: true }), true);
        expect(
            screen.queryByRole("button", { name: "Turn face up" })
        ).toBeNull();
    });
});
