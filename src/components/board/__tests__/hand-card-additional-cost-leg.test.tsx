// Frontend wiring for the CR 601.2b caster-chosen ADDITIONAL cost (issue #2379).
//
// "As an additional cost to cast this spell, discard a card or pay 3 life"
// (Bitter Triumph) is decided at ANNOUNCEMENT — before targets (CR 601.2c) and
// before anything is paid (CR 601.2h) — so it is collected by a client-side
// picker and dispatched as `announceCast`'s `additionalCostLegId`, exactly like
// the modal mode (CR 700.2c) and the alternative cost (CR 118.9). NOT a
// server-raised `PendingChoice`: no cast-time choice in this engine is one.
//
// Two failure modes this pins, both invisible to every server-side test:
//   • the picker never opens → `announceCast` throws "must choose which
//     additional cost to pay" on the only button the caster has;
//   • the picker opens for a card that declares no disjunction → the mutation
//     hard-rejects the stray argument.
// A third, the one the acceptance criteria name: with an empty hand AND life
// below 3 NEITHER leg is payable, so the projection must not even offer "cast".
//
// Assertions run through the REAL reducer and the REAL card definitions —
// `@convex/cards` is not mocked, the hand card comes out of
// `projectPublicState`, and the picker is the real `AdditionalCostPicker`.
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
} from "@convex/cards/__tests__/setup";
import { bitterTriumph } from "@convex/cards/sets/lci/black";
import { lightningBolt, grizzlyBears } from "@convex/cards/sets/lea";

/** `cardId` in `me`'s hand with mana to spare and `spares` other hand cards,
 *  at `life`, in `me`'s own main phase, with a creature on the opponent's
 *  board so the spell has a legal target. Run through the REAL projection. */
function projectedBoard(
    cardId: string,
    instanceId: string,
    opts: { life: number; spares: number } = { life: 20, spares: 1 }
): { card: CardInstance; players: Player[] } {
    const spares = Array.from({ length: opts.spares }, (_, i) =>
        makeInstance(lightningBolt.id, {
            id: `spare${i}`,
            controllerId: "me",
            ownerId: "me",
            zone: "hand",
        })
    );
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(cardId, {
                        id: instanceId,
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                    ...spares,
                ],
                life: opts.life,
                manaPool: { W: 7, U: 7, B: 7, R: 7, G: 7, C: 7 },
            }),
            makePlayer("them", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "bears",
                        controllerId: "them",
                        ownerId: "them",
                        zone: "battlefield",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    const projected = projectPublicState(state, 1, "me");
    return {
        card: projected.players[0].hand.find(
            (c) => c?.id === instanceId
        ) as unknown as CardInstance,
        players: projected.players as unknown as Player[],
    };
}

/** `allPlayers` is NOT decoration here: `useHandCardCommit` reads the caster's
 *  life and hand off the context's projected players to decide which
 *  additional-cost legs are payable. An empty array silently makes every leg
 *  unpayable — the picker never opens — which is exactly the dropped-field bug
 *  class this file guards, so the real projection is threaded through. */
function renderCard(card: CardInstance, players: Player[]) {
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
        allPlayers: players,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <BoardHandCard card={card} />
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

describe("cast-click additional-cost leg picker (CR 601.2b, #2379)", () => {
    it("Bitter Triumph: opens the picker with BOTH legs and dispatches the chosen one", () => {
        // The premise the gate reads — from the real definition, so the test
        // goes red if the card stops declaring the clause, not only if the
        // gate is removed.
        expect(bitterTriumph.additionalCosts?.oneOf?.map((l) => l.id)).toEqual([
            "discard",
            "pay-3-life",
        ]);

        const { card, players } = projectedBoard(bitterTriumph.id, "bt1");
        expect(card.legalActions).toContain("cast");

        renderCard(card, players);
        fireEvent.click(el());

        // Nothing is dispatched until a leg is named: the server rejects an
        // announcement without one.
        expect(announceCast).not.toHaveBeenCalled();
        expect(screen.getByTestId("additional-cost-leg-discard")).toBeTruthy();
        expect(
            screen.getByTestId("additional-cost-leg-pay-3-life")
        ).toBeTruthy();

        fireEvent.click(screen.getByTestId("additional-cost-leg-pay-3-life"));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "bt1",
            additionalCostLegId: "pay-3-life",
        });
    });

    it("Bitter Triumph, empty hand: only the payable leg is offered", () => {
        // CR 601.2a — the spell can't discard itself to pay its own cost, so a
        // hand holding nothing else leaves the discard leg unpayable. Offering
        // it would throw "Can't pay that additional cost" on click.
        const { card, players } = projectedBoard(bitterTriumph.id, "bt2", {
            life: 20,
            spares: 0,
        });
        expect(card.legalActions).toContain("cast");

        renderCard(card, players);
        fireEvent.click(el());

        expect(screen.queryByTestId("additional-cost-leg-discard")).toBeNull();
        // The single remaining leg is still SHOWN rather than auto-picked: a
        // forced cost is information the caster must see before paying it
        // (the same rule ADR 0079 applies to a forced permanent-cost pick).
        fireEvent.click(screen.getByTestId("additional-cost-leg-pay-3-life"));
        expect(announceCast.mock.calls[0][0].additionalCostLegId).toBe(
            "pay-3-life"
        );
    });

    it("Bitter Triumph, empty hand AND 2 life: not castable at all (CR 601.2h)", () => {
        const { card } = projectedBoard(bitterTriumph.id, "bt3", {
            life: 2,
            spares: 0,
        });
        expect(card.legalActions).not.toContain("cast");
    });

    it("Lightning Bolt (the must-NOT row): no picker, no stray leg argument", () => {
        const { card, players } = projectedBoard(lightningBolt.id, "bolt1");
        expect(card.legalActions).toContain("cast");

        renderCard(card, players);
        fireEvent.click(el());

        expect(
            document.querySelector('[data-testid^="additional-cost-leg-"]')
        ).toBeNull();
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(
            announceCast.mock.calls[0][0].additionalCostLegId
        ).toBeUndefined();
    });
});
