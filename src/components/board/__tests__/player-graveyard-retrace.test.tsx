// Retrace graveyard-cast affordance (CR 702.81a, issue #2358 — Wrenn and Six's
// -7 emblem). A NONLAND card in the viewer's own graveyard whose projection
// carries `legalActions` + `castKind: "retrace"` (gameProjections.ts
// `projectGraveyardCard`) must render a "Retrace" button and dispatch
// `announceCast`, while the OPPONENT gets no affordance at all.
//
// The label dispatch in `graveyard-flashback-button.tsx` is an if/=== chain
// whose DEFAULT is "Flashback", so an unhandled `castKind` renders a silently
// wrong label with no type error — this file is what turns that into a red
// test. Mirrors `player-graveyard-cast-grant.test.tsx` for the same component.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Player, CardInstance } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";

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

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

// Capture the dispatch. useHandCardCommit calls useMutation(api.game.*).
const playCard = vi.fn();
const announceCast = vi.fn();
const selectTarget = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => {
        if (ref._name === "playCard") return playCard;
        if (ref._name === "announceCast") return announceCast;
        return selectTarget;
    },
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
            selectTarget: { _name: "selectTarget" },
        },
    },
}));
// A def with no X/kicker/modes/alt-costs (so onCastClick dispatches
// announceCast in one click, no dialog) and no activatedAbilities (so
// getGraveyardStackAbilities never offers an Activate button ahead of the
// Cast branch).
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => ({
        name: "Bear",
        types: ["Creature"],
        manaCost: { X: 2, G: 1 },
    }),
    tryGetDefinition: () => undefined,
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: () => <div data-testid="selectable-card" />,
}));

import PlayerGraveyard from "../player-graveyard";

// The projection tags the card with `legalActions` + `castKind: "retrace"`
// only while a retrace grant reaches it AND the whole cost (printed mana +
// discard a land) is payable (gameProjections.ts `projectGraveyardCard`).
function makeRetraceGraveyardCard(
    legalActions: CardInstance["legalActions"] = ["cast"]
): CardInstance {
    return {
        id: "gy-retrace-bolt",
        card: { id: "bear-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions,
        castKind: "retrace",
    };
}

function makePlayer(card: CardInstance): Player {
    return {
        id: "me",
        name: "Me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [card],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function renderGraveyard(player: Player, viewerId: string) {
    const value = {
        gameId: "game-id" as never,
        playerId: viewerId,
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [player],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <MinimizedChoiceContext value={noopMinimized}>
                    {/* open the reveal so the per-card actions mount */}
                    <PlayerGraveyard
                        player={player}
                        open
                        onOpenChange={() => {}}
                    />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("PlayerGraveyard retrace cast affordance (issue #2358, CR 702.81a)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it('labels the button "Retrace" — not Flashback/Escape/Cast/Play', () => {
        renderGraveyard(makePlayer(makeRetraceGraveyardCard()), "me");
        expect(screen.getByRole("button", { name: "Retrace" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
        // The default branch of the label chain: if `"retrace"` were unhandled
        // the button would read "Flashback".
        expect(screen.queryByRole("button", { name: "Flashback" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Escape" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
    });

    it("explains the retrace cost in the disabled tooltip, not the flashback cost", () => {
        renderGraveyard(makePlayer(makeRetraceGraveyardCard([])), "me");
        const btn = screen.getByRole("button", { name: "Retrace" });
        expect(btn.getAttribute("title")).toContain("discarding a land card");
    });

    it("retracing the card dispatches announceCast via the public mutation", () => {
        renderGraveyard(makePlayer(makeRetraceGraveyardCard()), "me");
        fireEvent.click(screen.getByRole("button", { name: "Retrace" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "gy-retrace-bolt",
        });
        expect(playCard).not.toHaveBeenCalled();
    });

    it("offers NO cast affordance to the opponent viewer", () => {
        renderGraveyard(makePlayer(makeRetraceGraveyardCard()), "opp");
        expect(screen.queryByRole("button", { name: "Retrace" })).toBeNull();
    });

    it("disables the button and dispatches nothing when 'cast' is not legal (no land in hand)", () => {
        renderGraveyard(makePlayer(makeRetraceGraveyardCard([])), "me");
        const castBtn = screen.getByRole("button", {
            name: "Retrace",
        }) as HTMLButtonElement;
        expect(castBtn.disabled).toBe(true);
        fireEvent.click(castBtn);
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("renders NO affordance at all when nothing grants retrace (legalActions undefined)", () => {
        const card = makeRetraceGraveyardCard();
        delete (card as { legalActions?: unknown }).legalActions;
        delete (card as { castKind?: unknown }).castKind;
        renderGraveyard(makePlayer(card), "me");
        expect(screen.queryByRole("button", { name: "Retrace" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    });
});
