// Frontend wiring for a MODAL double-faced card in hand (CR 712.12,
// ADR 0122 §2).
//
// The trap this closes is structural, not cosmetic. Before this slice a hand
// card had at most ONE primary action and `commit()` said so out loud: "land
// plays take precedence over cast for the same instance; only one of the two
// is legal for a hand card in practice." A modal card breaks that assumption —
// CR 712.11c evaluates the cast against the front face and CR 712.12 the land
// play against the back, so both windows can be open at once — and the menu
// that lists them refused to render at all for a card with no hand ability.
// The result would have been a card the server says is both castable and
// playable, with the client silently spending its land drop on every gesture.
//
// So this goes through the REAL projection, the REAL hook and the REAL menu,
// and asserts on what `playCard` receives — a helper-level test on
// `landPlayFaces` is blind to every one of those seams.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    screen,
    fireEvent,
    cleanup,
    within,
} from "@testing-library/react";
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
import { sinkIntoStupor } from "@convex/cards/sets/neo/blue";
import { island } from "@convex/cards/sets/lea/colorless";
import { hillGiant } from "@convex/cards/sets/lea/red";

/** `me` holds Sink into Stupor // Soporific Springs with three Islands, in
 *  their own main phase with an empty stack and a land drop left — so BOTH
 *  windows are open at once: the instant is castable and the land face is
 *  playable. `them` has a Hill Giant, a legal target for the instant. Run
 *  through the REAL wire projection. */
function projected() {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(sinkIntoStupor.id, {
                        id: "mdfc1",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: 3 }, (_, i) =>
                    makeInstance(island.id, {
                        id: `island-${i}`,
                        controllerId: "me",
                        ownerId: "me",
                    })
                ),
            }),
            makePlayer("them", {
                battlefield: [
                    makeInstance(hillGiant.id, {
                        id: "giant",
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

describe("a modal double-faced card in hand offers BOTH plays (CR 712.12)", () => {
    it("the projection says the card is castable AND playable at once", () => {
        const p = projected();
        // CR 712.11c / 712.12 — independent legality windows, both open in a
        // main phase with an empty stack and a land drop left. Every earlier
        // hand card had at most one of these.
        expect(p.card.legalActions).toContain("cast");
        expect(p.card.legalActions).toContain("play");
    });

    it("a left click opens a menu naming each FACE, not one 'Play land' row", () => {
        renderCard(projected());
        fireEvent.click(el());

        const items = within(document.body).getAllByRole("menuitem");
        const labels = items.map((i) => i.textContent);
        expect(labels).toContain("Cast");
        // CR 712.12 — the land row names the FACE that enters. "Play land"
        // would read identically for both halves of a `land // land` pathway,
        // which is the case the field exists for.
        expect(labels).toContain("Play Soporific Springs");
        // Nothing is dispatched by opening the menu: two options is a real
        // choice.
        expect(playCard).not.toHaveBeenCalled();
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("choosing the land row sends the BACK face to playCard", () => {
        renderCard(projected());
        fireEvent.click(el());
        fireEvent.click(
            within(document.body).getByRole("menuitem", {
                name: "Play Soporific Springs",
            })
        );

        expect(playCard).toHaveBeenCalledTimes(1);
        expect(playCard.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "mdfc1",
            face: "back",
        });
    });

    it("an ordinary land keeps its single direct play, with no face argument", () => {
        const state = makeState({
            players: [
                makePlayer("me", {
                    hand: [
                        makeInstance(island.id, {
                            id: "plainland",
                            controllerId: "me",
                            ownerId: "me",
                            zone: "hand",
                        }),
                    ],
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
        renderCard({
            card: view.players[0].hand[0] as unknown as CardInstance,
            allPlayers: view.players,
            activePlayerId: view.activePlayerId,
        });

        // One option, so no menu interposes and the click commits directly —
        // the affordance an ordinary land has always had.
        fireEvent.click(el());
        expect(within(document.body).queryAllByRole("menuitem")).toHaveLength(
            0
        );
        expect(playCard).toHaveBeenCalledTimes(1);
        expect(playCard.mock.calls[0][0].face).toBeUndefined();
    });
});
