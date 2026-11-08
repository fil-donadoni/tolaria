// Frontend wiring for a split card with FUSE (CR 702.102a): the cast-option
// picker offers a THIRD row — both halves as one fused split spell — beside
// the two halves, and picking it sends the fused announcement.
//
// Through the REAL hook, the REAL projection and the REAL picker, for the
// reason `hand-card-split-cast-picker.test.tsx` gives: the option list is
// decided client-side from the PROJECTED hand card, so a projection that
// dropped what `splitCastOptionsFor` reads (the card's zone) would hide the
// row while every server test stays green.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: vi.fn(),
    clear: vi.fn(),
    submit: vi.fn(() => Promise.resolve()),
    isPending: false,
    lastError: null,
    reportError: vi.fn(),
    dismissError: vi.fn(),
};

const playCard = vi.fn();
const announceCast = vi.fn();
const activateAbility = vi.fn().mockResolvedValue(undefined);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard"
            ? playCard
            : ref._name === "activateAbility"
              ? activateAbility
              : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
            activateAbility: { _name: "activateAbility" },
            activateManaAbility: { _name: "activateManaAbility" },
            plotCard: { _name: "plotCard" },
            foretellCard: { _name: "foretellCard" },
        },
    },
}));
// Inert visuals only — definition, projection and picker are all the real thing.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BoardHandCard from "../board-hand-card";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { hillGiant } from "@convex/cards/sets/lea/red.cards";
import { mountain } from "@convex/cards/sets/lea/colorless.cards";
import { grizzlyBears } from "@convex/cards/sets/lea/green.cards";
import {
    FUSED_SPLIT_PROBE_ID,
    fusedSplitProbe,
} from "@convex/gre/__tests__/fixtures/fusedSplitProbe.fixture";
import { splitCastAltCostId } from "@convex/gre/splitCast";

const FUSED_ALT = splitCastAltCostId(fusedSplitProbe, "fused");
const LEFT_ALT = splitCastAltCostId(fusedSplitProbe, "left");

/** `me` holds the fuse probe ({R} // {1}{R}) with three Mountains — enough for
 *  the fused {1}{R}{R}. `them` has two creatures, one target per half. */
function projected() {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(FUSED_SPLIT_PROBE_ID, {
                        id: "split1",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: 3 }, (_, i) =>
                    makeInstance(mountain().id, {
                        id: `mountain-${i}`,
                        controllerId: "me",
                        ownerId: "me",
                    })
                ),
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("them", {
                battlefield: [
                    makeInstance(hillGiant().id, {
                        id: "giant",
                        controllerId: "them",
                        ownerId: "them",
                    }),
                    makeInstance(grizzlyBears().id, {
                        id: "bears",
                        controllerId: "them",
                        ownerId: "them",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    const view = projectPublicState(state, 1, "me") as unknown as {
        players: Player[];
        activePlayerId: string;
    };
    return {
        card: view.players[0].hand[0] as unknown as CardInstance,
        allPlayers: view.players,
        activePlayerId: view.activePlayerId,
    };
}

function renderCard(p: ReturnType<typeof projected>) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: p.activePlayerId,
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: p.allPlayers,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <BoardHandCard card={p.card} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

const el = () =>
    screen.getByTestId("card-image").closest("[data-board-hand-card]")!;

beforeEach(() => {
    playCard.mockClear();
    announceCast.mockClear();
    cleanup();
    resetPendingGameIntents();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("cast-option picker for a split card with fuse (CR 702.102a)", () => {
    it("offers both halves AND the fused cast", () => {
        const p = projected();
        expect(p.card.legalActions).toContain("cast");
        renderCard(p);
        fireEvent.click(el());

        expect(
            screen.getAllByRole("button", {
                name: (n: string) =>
                    n.startsWith("Cast Probe Spark") ||
                    n.startsWith("Cast Probe Blaze"),
            })
        ).toHaveLength(2);
        expect(
            screen.getByRole("button", {
                name: (n: string) => n.startsWith("Fuse"),
            })
        ).toBeDefined();
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("picking the fused row sends the fused alternativeCostId", () => {
        const p = projected();
        renderCard(p);
        fireEvent.click(el());
        fireEvent.click(
            screen.getByRole("button", {
                name: (n: string) => n.startsWith("Fuse"),
            })
        );
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "split1",
            alternativeCostId: FUSED_ALT,
        });
        expect(announceCast.mock.calls[0][0].alternativeCostId).not.toBe(
            LEFT_ALT
        );
    });
});
