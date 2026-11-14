// Issue #2401 — a revealed (known, face-up) library top supports the same
// card-preview gestures as every other visible card (ADR 0009 hover-dwell dock,
// long-press overlay); an unrevealed top stays a card back with no affordance.
// Real PlayerLibrary → CardsPile → CardImage → CardPreview, no stubs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { PendingChoiceBufferContext } from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import { resetPreviewSingleton } from "~/components/cards/card-preview-singleton";
import PlayerLibrary from "../player-library";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

const PAST_LONG_PRESS_MS = 500;
const HOVER_DWELL_MS = 250;

function makeCard(id: string, owner: string): CardInstance {
    return {
        id,
        card: { id: "lightning-bolt" },
        controllerId: owner,
        ownerId: owner,
        zone: "library",
        isTapped: false,
    };
}

function makePlayer(id: string, known: boolean): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: {
            count: 3,
            known: known ? [{ index: 0, card: makeCard("top", id) }] : [],
        },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function renderLibrary(player: Player, viewerId: string) {
    const value = {
        gameId: "g" as never,
        playerId: viewerId,
        activePlayerId: viewerId,
        priorityPlayerId: viewerId,
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext
                value={{
                    buffer: [],
                    toggle: () => {},
                    clear: () => {},
                    submit: async () => {},
                    isPending: false,
                    lastError: null,
                    reportError: () => {},
                    dismissError: () => {},
                }}
            >
                <MinimizedChoiceContext
                    value={{
                        isMinimized: false,
                        minimize: () => {},
                        restore: () => {},
                    }}
                >
                    <PlayerLibrary player={player} />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

const overlay = () => document.querySelector(".fixed.inset-0");
const dock = () => document.querySelector("[data-card-preview-dock]");

/** CardPreview binds its gesture listeners on the tilt root. */
function tiltRootOf(container: HTMLElement, id: string): HTMLElement {
    const slot = container.querySelector(
        `[data-flight-id="${id}"]`
    ) as HTMLElement;
    expect(slot).toBeTruthy();
    const root = slot.querySelector("[data-card-tilt-root]") as HTMLElement;
    expect(root).toBeTruthy();
    return root;
}

function longPressTop(container: HTMLElement) {
    const target = tiltRootOf(container, "top");
    act(() => {
        fireEvent.touchStart(target, {
            touches: [{ clientX: 10, clientY: 10 }],
        });
        vi.advanceTimersByTime(PAST_LONG_PRESS_MS);
    });
}

describe("revealed library top card preview (issue #2401)", () => {
    beforeEach(() => {
        resetPreviewSingleton();
        vi.useFakeTimers();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        resetPreviewSingleton();
    });

    for (const [label, owner, viewer] of [
        ["own", "me", "me"],
        ["opponent", "opp", "me"],
    ] as const) {
        it(`long-press opens the overlay on a revealed ${label} top`, () => {
            const { container } = renderLibrary(
                makePlayer(owner, true),
                viewer
            );
            longPressTop(container);
            expect(overlay() ?? dock()).toBeTruthy();
        });
    }

    for (const [label, owner, viewer] of [
        ["own", "me", "me"],
        ["opponent", "opp", "me"],
    ] as const) {
        it(`hover-dwell opens the dock on a revealed ${label} top`, () => {
            const { container } = renderLibrary(
                makePlayer(owner, true),
                viewer
            );
            const root = tiltRootOf(container, "top");
            act(() => {
                fireEvent.pointerEnter(root, { pointerType: "mouse" });
                vi.advanceTimersByTime(HOVER_DWELL_MS);
            });
            expect(dock()).toBeTruthy();
        });
    }

    it("an unrevealed top is a card back with no preview affordance", () => {
        const { container } = renderLibrary(makePlayer("me", false), "me");
        // Every visible pile slot is a card back — no card art, no preview.
        const slots = container.querySelectorAll("[data-flight-id]");
        expect(slots.length).toBeGreaterThan(0);
        for (const s of slots) {
            const alts = [...s.querySelectorAll("img")].map((i) => i.alt);
            expect(alts).toEqual(["Card back"]);
        }
        const slot = container.querySelector("[data-flight-id]") as HTMLElement;
        const root = slot.querySelector("[data-card-tilt-root]") as HTMLElement;
        expect(root).toBeTruthy();
        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 10, clientY: 10 }],
            });
            vi.advanceTimersByTime(PAST_LONG_PRESS_MS);
        });
        act(() => {
            fireEvent.pointerEnter(root, { pointerType: "mouse" });
            vi.advanceTimersByTime(HOVER_DWELL_MS);
        });
        expect(overlay()).toBeNull();
        expect(dock()).toBeNull();
    });
});
