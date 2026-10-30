// Issue #6917 — the `actionable` ring on the battlefield card and the Pile.
// The Priority gate goes through the Expected Input helper; another role's
// ring owns the card first; a collapsed Pile rings when any card qualifies and
// the qualifying tile rings inside the opened view.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import type { CardVisualState } from "~/types/battlefield";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("motion/react", () => ({
    useReducedMotion: () => false,
    motion: new Proxy(
        {},
        {
            get:
                () =>
                ({
                    children,
                    className,
                    style,
                }: {
                    children?: React.ReactNode;
                    className?: string;
                    style?: React.CSSProperties;
                }) => (
                    <div className={className} style={style}>
                        {children}
                    </div>
                ),
        }
    ),
}));
vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid={`card-image-${card.id}`} />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));
vi.mock("~/hooks/useInertialScroll", () => ({
    useInertialScroll: () => ({ current: null }),
}));

import BoardBattlefieldCard from "../board-battlefield-card";
import CardsPile from "../cards-pile";

const CREATURE_DEF_ID = "5c1ba0b9-db01-447f-90cc-a2fc2c24146e";

function makeCreature(): CardInstance {
    return {
        id: "c1",
        card: { id: CREATURE_DEF_ID },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Creature"],
    } as CardInstance;
}

function makePlayer(battlefield: CardInstance[]): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

const NEUTRAL_VS: CardVisualState = {
    interactive: false,
    enabled: false,
    dimmed: false,
    combatOffset: "",
    ringClass: "",
    badge: null,
};

const ABILITY = [{ id: "a1", oracleText: "{T}: Do a thing." }];

function renderBf(
    vs: CardVisualState,
    abilities: typeof ABILITY | undefined,
    ctx: Record<string, unknown> = {}
) {
    const card = makeCreature();
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
        allPlayers: [makePlayer([card]), { ...makePlayer([]), id: "opp" }],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        ...ctx,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <BoardBattlefieldCard
                card={card}
                vs={vs}
                activatableAbilities={abilities}
            />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("BoardBattlefieldCard `actionable` ring", () => {
    it("rings a permanent with an activatable ability while the viewer holds Priority", () => {
        const { container } = renderBf(NEUTRAL_VS, ABILITY);
        expect(container.querySelector(".card-ring-actionable")).not.toBeNull();
    });

    it("rings an untapped Mana Ability source", () => {
        const { container } = renderBf(
            { ...NEUTRAL_VS, manaActivatable: true },
            undefined
        );
        expect(container.querySelector(".card-ring-actionable")).not.toBeNull();
    });

    it("does not ring a card with nothing to do (tapped land / unaffordable)", () => {
        const { container } = renderBf(
            { ...NEUTRAL_VS, manaActivatable: false },
            undefined
        );
        expect(container.querySelector(".card-ring-actionable")).toBeNull();
    });

    it("does not ring when the opponent holds Priority", () => {
        const { container } = renderBf(NEUTRAL_VS, ABILITY, {
            priorityPlayerId: "opp",
        });
        expect(container.querySelector(".card-ring-actionable")).toBeNull();
    });

    it("does not ring during a target pick", () => {
        const { container } = renderBf(NEUTRAL_VS, ABILITY, {
            pendingTarget: { playerId: "me" },
        });
        expect(container.querySelector(".card-ring-actionable")).toBeNull();
    });

    it("never stacks on another role's ring", () => {
        const { container } = renderBf(
            { ...NEUTRAL_VS, ringClass: "card-ring card-ring-candidate" },
            ABILITY
        );
        expect(container.querySelector(".card-ring-candidate")).not.toBeNull();
        expect(container.querySelector(".card-ring-actionable")).toBeNull();
    });
});

function pileCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
    } as CardInstance;
}

describe("CardsPile `actionable` ring", () => {
    it("rings the collapsed pile when any card qualifies, with tile containment", () => {
        const { container } = render(
            <CardsPile
                cards={[pileCard("a"), pileCard("b")]}
                isFaceDown={false}
                title="Graveyard"
                actionableIds={new Set(["b"])}
            />
        );
        const ring = container.querySelector("[data-pile-actionable]");
        expect(ring?.className).toContain("card-ring-actionable");
        expect(ring?.parentElement?.className).toContain("isolate");
    });

    it("does not ring a collapsed pile with no qualifying card", () => {
        const { container } = render(
            <CardsPile
                cards={[pileCard("a")]}
                isFaceDown={false}
                title="Graveyard"
                actionableIds={new Set()}
            />
        );
        expect(container.querySelector("[data-pile-actionable]")).toBeNull();
    });

    it.each(["grid", "fan"] as const)(
        "rings only the qualifying tile inside the opened %s view",
        (layout) => {
            const { baseElement } = render(
                <CardsPile
                    cards={[pileCard("a"), pileCard("b")]}
                    isFaceDown={false}
                    title="Graveyard"
                    layout={layout}
                    forceOpen
                    actionableIds={new Set(["b"])}
                />
            );
            const face = (id: string) =>
                baseElement.querySelector(`[data-testid="card-image-${id}"]`)
                    ?.parentElement;
            expect(face("b")?.className).toContain("card-ring-actionable");
            expect(face("a")?.className).not.toContain("card-ring-actionable");
        }
    );
});
