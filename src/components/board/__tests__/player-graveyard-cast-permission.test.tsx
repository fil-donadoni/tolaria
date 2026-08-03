// Graveyard-cast permission affordance (CR 305.1-analog / 601, issue #1149 —
// Yawgmoth's Will). A NON-LAND card in the viewer's own graveyard whose
// projection carries `legalActions` + `castKind: "graveyard-permission"`
// (gameProjections.ts `projectGraveyardCard`) must render a "Cast" button
// (GraveyardFlashbackButton, which also handles the Flashback/Escape labels)
// and dispatch `announceCast` — exactly like a Flashback/Escape cast, but at
// the card's NORMAL printed mana cost — while the OPPONENT gets no
// affordance at all. Mirrors `player-graveyard-play-land.test.tsx`'s
// land-play coverage (issue #1190) for the SPELL half of #1149's permission —
// closes the "frontend wiring is not optional" gap: a card correct in the
// GRE (rules.ts / gameProjections.ts) is still dead in the UI unless a
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
        name: "Shock",
        types: ["Instant"],
        manaCost: { R: 1 },
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

// The projection tags a graveyard SPELL with `legalActions` +
// `castKind: "graveyard-permission"` only while the caster's own
// `graveyardPlayPermissionThisTurn` covers "spell" (gameProjections.ts
// `projectGraveyardCard`).
function makeGraveyardSpell(
    legalActions: CardInstance["legalActions"] = ["cast"]
): CardInstance {
    return {
        id: "gy-bolt",
        card: { id: "shock-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions,
        castKind: "graveyard-permission",
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

describe("PlayerGraveyard graveyard-cast permission (#1149, CR 305.1-analog / 601)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("offers a Cast button (not Play/Flashback/Escape) on a graveyard spell under the permission", () => {
        renderGraveyard(makePlayer(makeGraveyardSpell()), "me");
        expect(screen.getByRole("button", { name: "Cast" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Flashback" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Escape" })).toBeNull();
    });

    it("casting a graveyard spell dispatches announceCast via the public mutation", () => {
        renderGraveyard(makePlayer(makeGraveyardSpell()), "me");
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "gy-bolt",
        });
        expect(playCard).not.toHaveBeenCalled();
    });

    it("offers NO cast affordance to the opponent viewer", () => {
        renderGraveyard(makePlayer(makeGraveyardSpell()), "opp");
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
    });

    it("disables the Cast button and dispatches nothing when 'cast' is not legal (e.g. unaffordable)", () => {
        renderGraveyard(makePlayer(makeGraveyardSpell([])), "me");
        const castBtn = screen.getByRole("button", {
            name: "Cast",
        }) as HTMLButtonElement;
        expect(castBtn.disabled).toBe(true);
        fireEvent.click(castBtn);
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("renders NO affordance at all once the permission has expired (legalActions undefined)", () => {
        // Once CLEANUP clears graveyardPlayPermissionThisTurn,
        // `projectGraveyardCard` stops attaching `legalActions`/`castKind`.
        const card = makeGraveyardSpell();
        delete (card as { legalActions?: unknown }).legalActions;
        delete (card as { castKind?: unknown }).castKind;
        renderGraveyard(makePlayer(card), "me");
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    });
});
