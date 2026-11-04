// CR 702.170d (issue #7586) — a plotted card's cast permission is derived from
// `plottedOnTurn`, so the card carries no `castableFromExileBy`. The Cast button
// and its reason must follow the derived permission through the real projection.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import { becomePlotted } from "@convex/gre/plot";
import { holdsExileCastPermission } from "@convex/gre/castCost";
import { exileRouteChosenX, exileRouteLocksX } from "~/lib/card-utils";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

const playCard = vi.fn();
const announceCast = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard" ? playCard : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
        },
    },
}));

import ExileCastButton from "../exile-cast-button";

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: () => Promise.resolve(),
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

/** A Lightning Bolt plotted on turn 3, projected for `viewerId` at `turn`, with
 *  `activePlayerId` holding the turn and priority. */
function projectedPlottedBolt(
    turn: number,
    viewerId = "p1",
    activePlayerId = "p1"
) {
    const bolt = makeInstance(getCardByName("Lightning Bolt").id, {
        id: "bolt",
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
    });
    const state = makeState({
        players: [makePlayer("p1", { exile: [bolt] }), makePlayer("p2")],
        activePlayerId,
        priorityPlayerId: activePlayerId,
        turn: 3,
    });
    becomePlotted(state, bolt);
    state.turn = turn;
    return projectPublicState(state, 1, viewerId).players[0].exile[0];
}

function renderButton(
    card: ReturnType<typeof projectedPlottedBolt>,
    engineTurn: number
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: engineTurn,
        engineTurn,
        stackCount: 0,
        stackItems: [],
        allPlayers: [] as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <ExileCastButton card={card as never} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

const castButton = () => screen.getByRole("button", { name: "Cast" });

describe("ExileCastButton on a plotted card (CR 702.170d)", () => {
    beforeEach(() => {
        announceCast.mockClear();
        cleanup();
    });

    it("the permission's holder is the owner, through the projected card", () => {
        const card = projectedPlottedBolt(3);
        expect(card.castableFromExileBy).toBeUndefined();
        expect(holdsExileCastPermission(card, "p1")).toBe(true);
        expect(holdsExileCastPermission(card, "p2")).toBe(false);
    });

    it("names the window on the turn the card became plotted", () => {
        renderButton(projectedPlottedBolt(3), 3);
        expect(castButton().getAttribute("title")).toBe(
            "Can't cast yet — not available from exile until turn 4."
        );
    });

    it("is enabled on a later turn in the owner's window, with no mana", () => {
        renderButton(projectedPlottedBolt(5), 5);
        expect(castButton().hasAttribute("disabled")).toBe(false);
    });

    it("names the timing, not the mana, outside the owner's window", () => {
        renderButton(projectedPlottedBolt(4, "p1", "p2"), 4);
        expect(castButton().getAttribute("title")).toBe(
            "Can't cast now — only in your main phase while the stack is empty."
        );
    });
});

describe("ExileCastButton on a card holding two permissions (CR 601.2b, 107.3b)", () => {
    beforeEach(() => {
        announceCast.mockClear();
        cleanup();
    });

    /** `name` plotted on turn 3 and holding `grant`, projected at turn 5. */
    function projected(name: string, grant: boolean) {
        const card = makeInstance(getCardByName(name).id, {
            id: "subject",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        const state = makeState({
            players: [makePlayer("p1", { exile: [card] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            turn: 3,
        });
        becomePlotted(state, card);
        state.turn = 5;
        state.phase = "PRECOMBAT_MAIN";
        if (grant) card.castableFromExileBy = "p1";
        state.players[0].manaPool.R = 3;
        return projectPublicState(state, 1, "p1").players[0].exile[0];
    }

    it("the picker offers both routes; the second announces the decline", () => {
        renderButton(projected("Lightning Bolt", true), 5);
        fireEvent.click(castButton());
        expect(announceCast).not.toHaveBeenCalled();
        screen.getByText("Cast without paying its mana cost");
        fireEvent.click(screen.getByText("Pay mana cost"));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "subject",
            declineManaCostReplacement: true,
        });
    });

    it("the free row announces no decline", () => {
        renderButton(projected("Lightning Bolt", true), 5);
        fireEvent.click(castButton());
        fireEvent.click(screen.getByText("Cast without paying its mana cost"));
        expect(announceCast.mock.calls[0][0]).not.toHaveProperty(
            "declineManaCostReplacement"
        );
    });

    it("a plotted {X} spell alone asks no X and no route", () => {
        renderButton(projected("Rock Hydra", false), 5);
        fireEvent.click(castButton());
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0].chosenX).toBeUndefined();
    });

    it("an X collected for the paying route is dropped on the free row", () => {
        const choice = projected("Rock Hydra", true).exileCastRouteChoice;
        expect(exileRouteLocksX(choice)).toBe(false);
        expect(exileRouteChosenX(choice, undefined, undefined, 3)).toBe(
            undefined
        );
        expect(exileRouteChosenX(choice, undefined, true, 3)).toBe(3);
    });
});
