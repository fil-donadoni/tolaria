// #754 — restricted mana must be visible in the mana pool (CR 106.6). The engine
// banks Ice Cauldron's replayed mana as instance-keyed RESTRICTED mana, which
// floats in a parallel pool invisible to the ordinary manaPool render. These
// assert the pool now surfaces restricted mana, distinguished from ordinary
// mana and labelled with its spend restriction.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

// Resolve the Ice-Cauldron exiled card name without loading the full registry.
vi.mock("@convex/cards", () => ({
    tryGetDefinition: (id: string) =>
        id === "brainstorm-def" ? { name: "Brainstorm" } : undefined,
}));

import PlayerManaPool from "../player-mana-pool";

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

function renderPool(player: Player) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [player],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PlayerManaPool player={player} />
        </GameContext>
    );
}

describe("PlayerManaPool restricted mana (#754, CR 106.6)", () => {
    beforeEach(() => cleanup());

    it("renders nothing when there is no ordinary or restricted mana", () => {
        const { container } = renderPool(makePlayer());
        expect(container.firstChild).toBeNull();
    });

    it("renders restricted mana even when the ordinary pool is empty", () => {
        const { container, getByText } = renderPool(
            makePlayer({
                restrictedMana: [
                    { color: "U", amount: 2, castableCardId: "noted-spell" },
                ],
                exile: [
                    {
                        id: "noted-spell",
                        card: { id: "brainstorm-def" },
                        controllerId: "me",
                        ownerId: "me",
                        zone: "exile",
                        isTapped: false,
                    },
                ],
            })
        );
        expect(container.firstChild).not.toBeNull();
        // The restricted unit is rendered and labelled with the exiled card name.
        const restricted = container.querySelector("[data-restricted-mana]")!;
        expect(restricted).not.toBeNull();
        expect(within(restricted as HTMLElement).getByText("2")).toBeTruthy();
        expect(getByText("Only: Brainstorm")).toBeTruthy();
    });

    it("distinguishes restricted mana from ordinary pool mana", () => {
        const { container } = renderPool(
            makePlayer({
                manaPool: { R: 1 },
                restrictedMana: [
                    { color: "U", amount: 2, castableCardId: "noted-spell" },
                ],
            })
        );
        // Ordinary mana has no restriction marker; the restricted unit does.
        const restrictedNodes = container.querySelectorAll(
            "[data-restricted-mana]"
        );
        expect(restrictedNodes).toHaveLength(1);
        // Both an ordinary {R} symbol and the restricted {U} symbol are present.
        const srcs = Array.from(container.querySelectorAll("img")).map((i) =>
            i.getAttribute("src")
        );
        expect(srcs).toEqual(
            expect.arrayContaining(["/img/symbols/R.svg", "/img/symbols/U.svg"])
        );
    });
});
