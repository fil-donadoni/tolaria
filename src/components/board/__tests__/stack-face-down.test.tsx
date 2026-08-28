// A face-down SPELL on the stack (CR 702.37c morph cast / CR 708.2a), issue
// #2904 review findings 3 and 4.
//
// Issue #2904 moved the caster's CR 708.5 "I may look at my own face-down
// spell" entitlement OFF the board face and ONTO the preview's second face.
// The stack row renders that same card art, so its TEXT has to follow: a row
// showing a card back captioned "Exalted Angel {4}{W}{W}" states a rules object
// that does not exist — CR 708.2a gives a face-down spell no name, no mana cost
// and no text.
//
// Driven through the REAL projection (`projectStackItem` via
// `projectPublicState`), per `.claude/rules/gre-development.md` § Frontend
// wiring analysis: the caster's leg is the one that used to leak, and a
// hand-built stack item would not exercise it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { makeState, makeInstance } from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { turnFaceDown } from "@convex/gre/faceDown";
import { projectPublicState } from "@convex/gameProjections";
import { GameContext } from "~/hooks/useGameContext";
import type { Player, StackItem } from "~/types/game";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("~/hooks/useDraggable", () => ({
    useDraggable: () => ({ offset: { x: 0, y: 0 }, dragHandlers: {} }),
}));
vi.mock("../drag-handle", () => ({ default: () => null }));
vi.mock("../../cards/color-overlay-card-image", () => ({
    default: () => <div data-testid="stack-card" />,
}));

import GameStack from "../game-stack";

const ANGEL = getCardByName("Serra Angel");

/** A face-down morph spell cast by p1, projected for `viewerId`. */
function projectFaceDownSpell(viewerId: "p1" | "p2"): StackItem {
    const spell = makeInstance(ANGEL.id, {
        id: "fd-spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "stack",
    });
    turnFaceDown(spell as never, "morph");
    const base = makeState();
    const state = makeState({
        players: [{ ...base.players[0], id: "p1" }, base.players[1]],
        stack: [{ ...spell, castById: "p1" }],
    } as never);
    const projected = projectPublicState(state, 1, viewerId);
    return projected.stack[0] as unknown as StackItem;
}

function renderStack(item: StackItem, viewerId: "p1" | "p2") {
    const value = {
        gameId: "game-id" as never,
        playerId: viewerId,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 1,
        stackItems: [],
        allPlayers: [] as unknown as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <GameStack stack={[item]} />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("face-down spell on the stack (CR 708.2a, issue #2904)", () => {
    it("never names the real card in the row — not even for its own CASTER", () => {
        const own = projectFaceDownSpell("p1");
        // The caster's identification affordance is on the wire (CR 708.5) —
        // the row is choosing not to print it, which is the whole assertion.
        expect(own.knownCardId).toBe(ANGEL.id);

        const { container } = renderStack(own, "p1");
        expect(container.textContent).not.toContain("Serra Angel");
        // The sentinel's own anonymous label is what the row shows instead.
        expect(container.textContent).toContain("Face-down creature");
    });

    it("names nothing for the opponent either (unchanged)", () => {
        const opp = projectFaceDownSpell("p2");
        expect(opp.knownCardId).toBeUndefined();
        const { container } = renderStack(opp, "p2");
        expect(container.textContent).not.toContain("Serra Angel");
    });
});
