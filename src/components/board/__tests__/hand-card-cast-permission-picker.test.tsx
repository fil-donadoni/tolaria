// Frontend wiring for a BOARD CAST PERMISSION's free cast (CR 118.9, issue #2706).
//
// The trap this file exists for: `useHandCardCommit` opened the CR 118.9
// `AltCostPicker` only for a card whose DEFINITION declared an alternative cost
// (`alternativeCosts` / evoke / dash / bestow / morph). Aluren's permission is
// granted by another permanent, so the covered cards — Grizzly Bears,
// Man-o'-War, every vanilla creature the deck is built on — declare none of
// those fields and the picker never opened. The whole cost half of the mechanic
// was unreachable from the only button the caster has: inside the sorcery
// window the click silently paid the printed cost, and outside it the click hit
// the CR 118.9b rejection with no affordance able to satisfy it.
//
// A test on `affordableAltCostsForCard` alone is blind to that — it calls the
// helper the gate never reached. So this one goes through the REAL hook, the
// REAL projection and the REAL picker, and asserts on what `announceCast`
// receives.
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
import { aluren } from "@convex/cards/sets/tmp/green";
import { grizzlyBears } from "@convex/cards/sets/lea/green";
import { shivanDragon } from "@convex/cards/sets/lea/red";
import { forest } from "@convex/cards/sets/lea/colorless";

const ALUREN_ALT_COST_ID = "cast-permission:aluren-creature-permission";

/** `me` holds one copy of `cardId` with an Aluren and two Forests out, in their
 *  own main phase — enough mana for the printed cost, so the picker's two rows
 *  are a genuine choice rather than the only payable line. Run through the REAL
 *  wire projection. */
function projected(cardId: string, instanceId: string) {
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
                ],
                battlefield: [
                    makeInstance(aluren.id, {
                        id: "aluren",
                        controllerId: "me",
                        ownerId: "me",
                    }),
                    ...Array.from({ length: 2 }, (_, i) =>
                        makeInstance(forest.id, {
                            id: `forest-${i}`,
                            controllerId: "me",
                            ownerId: "me",
                        })
                    ),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 7, G: 7, C: 7 },
            }),
            makePlayer("them"),
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

describe("cast-option picker under a board cast permission (CR 118.9, #2706)", () => {
    it("Grizzly Bears under Aluren: the picker opens and the free cast reaches announceCast", () => {
        // The premise: the card declares NO alternative cost of its own — which
        // is exactly why the old def-shape gate skipped it.
        expect(grizzlyBears.alternativeCosts).toBeUndefined();
        expect(grizzlyBears.evoke).toBeUndefined();
        expect(grizzlyBears.dash).toBeUndefined();
        expect(grizzlyBears.bestow).toBeUndefined();
        expect(grizzlyBears.morph).toBeUndefined();

        const p = projected(grizzlyBears.id, "bears1");
        expect(p.card.legalActions).toContain("cast");

        renderCard(p);
        fireEvent.click(el());

        // CR 118.5 / 601.2b — nothing is announced until the caster picks; a
        // free cast is a cost they CHOOSE, never one applied behind their back.
        expect(announceCast).not.toHaveBeenCalled();
        const freeRow = screen.getByRole("button", {
            name: /without paying their mana costs/,
        });
        expect(
            screen.getByRole("button", { name: "Pay mana cost" })
        ).toBeTruthy();

        fireEvent.click(freeRow);
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "bears1",
            alternativeCostId: ALUREN_ALT_COST_ID,
        });
    });

    it("Shivan Dragon (the must-NOT row): outside the filter, no picker and a plain announcement", () => {
        // CR 202.3 — mana value 6, so Aluren covers nothing here and the click
        // must behave exactly as it did before this mechanic existed.
        const p = projected(shivanDragon.id, "dragon1");
        expect(p.card.legalActions).toContain("cast");

        renderCard(p);
        fireEvent.click(el());

        expect(
            screen.queryByRole("button", { name: "Pay mana cost" })
        ).toBeNull();
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0].alternativeCostId).toBeUndefined();
    });
});
