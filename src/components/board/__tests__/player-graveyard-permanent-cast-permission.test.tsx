// Static graveyard-permanent-cast permission affordance (CR 702.139, issue
// #1392 — Lurrus of the Dream-Den). A PERMANENT card in the viewer's own
// graveyard whose projection carries `legalActions` + `castKind:
// "graveyard-permanent-permission"` (gameProjections.ts
// `projectGraveyardCard`) must render a "Cast" button
// (GraveyardFlashbackButton, which also handles the Flashback/Escape/
// graveyard-permission/graveyard-grant labels) and dispatch `announceCast` —
// exactly like the BROAD `"graveyard-permission"` cast (issue #1149), but
// STATIC (battlefield-derived), permanent-cards-only, and capped once per
// turn — while the OPPONENT gets no affordance at all. Mirrors
// `player-graveyard-cast-permission.test.tsx` / `player-graveyard-cast-grant
// .test.tsx`'s coverage for the SAME button component's new `castKind`
// branch — closes the "frontend wiring is not optional" gap: a card correct
// in the GRE (rules.ts / gameProjections.ts) is still dead in the UI unless a
// button component reads the projected `legalActions`/`castKind` and
// dispatches the right mutation.
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
vi.mock("@convex/cards", () => ({
    getDefinition: () => ({
        name: "Savannah Lions",
        types: ["Creature"],
        manaCost: { W: 1 },
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

// The projection tags an eligible PERMANENT with `legalActions` +
// `castKind: "graveyard-permanent-permission"` only while Lurrus (or any
// `castsPermanentsFromGraveyard` grantor) is on the battlefield and the
// once-per-turn use hasn't been spent (gameProjections.ts
// `projectGraveyardCard`, issue #1392).
function makeEligiblePermanent(
    legalActions: CardInstance["legalActions"] = ["cast"]
): CardInstance {
    return {
        id: "gy-lions",
        card: { id: "lions-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions,
        castKind: "graveyard-permanent-permission",
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

describe("PlayerGraveyard static graveyard-permanent-cast permission (issue #1392, CR 702.139)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("offers a Cast button (not Play/Flashback/Escape) on the eligible permanent", () => {
        renderGraveyard(makePlayer(makeEligiblePermanent()), "me");
        expect(screen.getByRole("button", { name: "Cast" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Flashback" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Escape" })).toBeNull();
    });

    it("casting the permanent dispatches announceCast via the public mutation", () => {
        renderGraveyard(makePlayer(makeEligiblePermanent()), "me");
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "gy-lions",
        });
        expect(playCard).not.toHaveBeenCalled();
    });

    it("offers NO cast affordance to the opponent viewer", () => {
        renderGraveyard(makePlayer(makeEligiblePermanent()), "opp");
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
    });

    it("disables the Cast button and dispatches nothing when 'cast' is not legal (e.g. once-per-turn use already spent)", () => {
        renderGraveyard(makePlayer(makeEligiblePermanent([])), "me");
        const castBtn = screen.getByRole("button", {
            name: "Cast",
        }) as HTMLButtonElement;
        expect(castBtn.disabled).toBe(true);
        fireEvent.click(castBtn);
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("renders NO affordance at all once Lurrus has left the battlefield (legalActions undefined)", () => {
        // Once Lurrus leaves play (or the once-per-turn use is spent and
        // CLEANUP hasn't yet reset it isn't the case here — this models the
        // source-gone case), `projectGraveyardCard` stops attaching
        // `legalActions`/`castKind` — re-derived live, no stale flag.
        const card = makeEligiblePermanent();
        delete (card as { legalActions?: unknown }).legalActions;
        delete (card as { castKind?: unknown }).castKind;
        renderGraveyard(makePlayer(card), "me");
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    });
});
