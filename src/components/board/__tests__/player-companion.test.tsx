// Companion slot + summon button (CR 702.139, ADR 0064, issue #1391). The
// slot renders the revealed card for BOTH players; the "Companion {3}" summon
// button appears ONLY when the wire projection carries `canSummon: true`
// (present only on the slot's own controller's view, gameProjections.ts) and
// dispatches the dedicated `summonCompanion` mutation — no cardInstanceId,
// unlike every other card-scoped action button.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

const summonCompanion = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: () => summonCompanion,
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { summonCompanion: { _name: "summonCompanion" } } },
}));
// Inert card visuals so the slot renders without image plumbing.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="companion-card-image" />,
}));

import PlayerCompanion from "../player-companion";

function makePlayer(overrides: Partial<Player> = {}): Player {
    return {
        id: "me",
        name: "Me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: {},
        ...overrides,
    };
}

function renderCompanion(player: Player, viewerId: string) {
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
            <PlayerCompanion player={player} />
        </GameContext>
    );
}

describe("PlayerCompanion slot (CR 702.139c)", () => {
    beforeEach(() => {
        summonCompanion.mockClear();
        cleanup();
    });

    it("renders nothing when the player declared no companion", () => {
        const { container } = renderCompanion(makePlayer(), "me");
        expect(
            container.querySelector('[data-testid="companion-me"]')
        ).toBeNull();
    });

    it("reveals the companion card to both the controller and the opponent viewer", () => {
        const player = makePlayer({
            companion: {
                instance: {
                    id: "lutri-inst",
                    card: { id: "lutri-def" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "library" as const,
                    types: [],
                    subtypes: [],
                    staticAbilities: [],
                    isTapped: false,
                },
                used: false,
                canSummon: true,
            },
        });
        renderCompanion(player, "me");
        expect(screen.getByTestId("companion-me")).toBeTruthy();
        expect(screen.getByTestId("companion-card-image")).toBeTruthy();
        cleanup();
        // Opponent viewer: same slot data still carries the revealed card
        // (server never sends canSummon to a non-owner viewer — see the
        // wire-projection test in convex/__tests__/gameProjections.test.ts).
        const opponentView = makePlayer({
            id: "me",
            companion: {
                instance: {
                    id: "lutri-inst",
                    card: { id: "lutri-def" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "library" as const,
                    types: [],
                    subtypes: [],
                    staticAbilities: [],
                    isTapped: false,
                },
                used: false,
                // canSummon absent — opponent viewer never receives it.
            },
        });
        renderCompanion(opponentView, "opp");
        expect(screen.getByTestId("companion-me")).toBeTruthy();
    });

    it("shows the Companion {3} summon button only when canSummon is true", () => {
        const player = makePlayer({
            companion: {
                instance: {
                    id: "lutri-inst",
                    card: { id: "lutri-def" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "library" as const,
                    types: [],
                    subtypes: [],
                    staticAbilities: [],
                    isTapped: false,
                },
                used: false,
                canSummon: true,
            },
        });
        renderCompanion(player, "me");
        expect(screen.getByRole("button", { name: /Companion/i })).toBeTruthy();
    });

    it("hides the summon button when canSummon is false (not the owner's viewer)", () => {
        const player = makePlayer({
            companion: {
                instance: {
                    id: "lutri-inst",
                    card: { id: "lutri-def" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "library" as const,
                    types: [],
                    subtypes: [],
                    staticAbilities: [],
                    isTapped: false,
                },
                used: false,
                canSummon: false,
            },
        });
        renderCompanion(player, "me");
        expect(screen.queryByRole("button", { name: /Companion/i })).toBeNull();
    });

    it("disappears entirely once the companion has been summoned to hand", () => {
        const player = makePlayer({
            companion: {
                instance: {
                    id: "lutri-inst",
                    card: { id: "lutri-def" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "library" as const,
                    types: [],
                    subtypes: [],
                    staticAbilities: [],
                    isTapped: false,
                },
                used: true,
                canSummon: false,
            },
        });
        const { container } = renderCompanion(player, "me");
        expect(
            container.querySelector('[data-testid="companion-me"]')
        ).toBeNull();
    });

    it("clicking Companion {3} dispatches the dedicated summonCompanion mutation with no cardInstanceId", () => {
        const player = makePlayer({
            companion: {
                instance: {
                    id: "lutri-inst",
                    card: { id: "lutri-def" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "library" as const,
                    types: [],
                    subtypes: [],
                    staticAbilities: [],
                    isTapped: false,
                },
                used: false,
                canSummon: true,
            },
        });
        renderCompanion(player, "me");
        fireEvent.click(screen.getByRole("button", { name: /Companion/i }));
        expect(summonCompanion).toHaveBeenCalledTimes(1);
        expect(summonCompanion.mock.calls[0][0]).toEqual({
            gameId: "game-id",
            playerId: "me",
        });
    });
});
