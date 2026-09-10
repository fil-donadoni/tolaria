// Issue #2932 — a TOKEN on the battlefield must be identifiable as one at a
// glance. CR 111.1 (a token represents a permanent not represented by a card)
// and CR 111.7 (a token that leaves the battlefield ceases to exist, as an SBA)
// make token-ness gameplay-relevant: a bounce annihilates a token where it only
// inconveniences the real permanent, so the player must see it BEFORE choosing
// a target. The regression this pins is the copy case — a token created as a
// copy (CR 707.2) wears the copied card's name and art and was otherwise
// indistinguishable from it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import type { CardVisualState } from "../battlefield-card";
import { GameContext } from "~/hooks/useGameContext";

const MOTION_PROPS = new Set([
    "initial",
    "animate",
    "transition",
    "layout",
    "layoutId",
    "onAnimationComplete",
]);
vi.mock("motion/react", () => ({
    useReducedMotion: () => false,
    motion: new Proxy(
        {},
        {
            get:
                () =>
                (props: {
                    children?: React.ReactNode;
                    [k: string]: unknown;
                }) => {
                    const domProps: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(props)) {
                        if (k === "children" || MOTION_PROPS.has(k)) continue;
                        domProps[k] = v;
                    }
                    return <div {...domProps}>{props.children}</div>;
                },
        }
    ),
}));

vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: CardInstance | { id: string } }) => (
        <div
            data-testid="card-image"
            data-card-id={"id" in card ? card.id : "?"}
        />
    ),
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => (
        <div data-card-tilt-root>{children}</div>
    ),
}));

import BoardBattlefieldCard from "../board-battlefield-card";

// "Bird Maiden" (ARN) — a real 1/2 creature def so the P/T badge resolves.
const CREATURE_DEF_ID = "5c1ba0b9-db01-447f-90cc-a2fc2c24146e";

function makeCreature(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "c1",
        card: { id: CREATURE_DEF_ID },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Creature"],
        ...overrides,
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

function renderCard(card: CardInstance) {
    const me = makePlayer([card]);
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
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <BoardBattlefieldCard card={card} vs={NEUTRAL_VS} />
        </GameContext>
    );
}

describe("battlefield token marker (issue #2932, CR 111.1 / 111.7)", () => {
    beforeEach(() => cleanup());

    it("marks a token permanent", () => {
        const { container } = renderCard(makeCreature({ isToken: true }));
        const badge = container.querySelector('[data-token="true"]');
        expect(badge).toBeTruthy();
        // Labelled, not just coloured — the marker carries its meaning for a
        // screen reader and on hover.
        expect(badge!.getAttribute("aria-label")).toBe("Token");
    });

    it("marks a token that is a COPY of a real card (CR 707.2)", () => {
        // Name, art and characteristics are the copied card's; only `isToken`
        // separates it from the real permanent — which is the whole bug.
        const { container } = renderCard(
            makeCreature({
                id: "copy-token",
                isToken: true,
                copiedFrom: CREATURE_DEF_ID,
            })
        );
        expect(container.querySelector('[data-token="true"]')).toBeTruthy();
    });

    it("leaves a non-token permanent unmarked", () => {
        const { container } = renderCard(makeCreature());
        expect(container.querySelector("[data-token]")).toBeNull();
    });

    it("does not occlude the P/T stack or the summoning-sickness badge", () => {
        const { container } = renderCard(
            makeCreature({ isToken: true, isSummoningSick: true })
        );
        const badge = container.querySelector<HTMLElement>(
            '[data-token="true"]'
        )!;
        // Bottom-LEFT: the P/T + damage stack owns bottom-right and the
        // summoning-sickness badge top-left, so all three coexist.
        expect(badge.className).toContain("bottom-1");
        expect(badge.className).toContain("left-1");
        expect(badge.className).toContain("pointer-events-none");
        expect(
            container.querySelector('[data-summoning-sick="true"]')
        ).toBeTruthy();
    });

    it("steps above the noted-mana badge instead of covering it", () => {
        // A token CAN be a copy of Ice Cauldron (CR 707.2) and bank mana like
        // the original, and `NotedManaBadge` owns the same bottom-left corner
        // (CR 106.10). Both must stay readable.
        const { container } = renderCard(
            makeCreature({
                isToken: true,
                types: ["Artifact"],
                notedMana: { mana: { U: 1 } },
            })
        );
        const badge = container.querySelector<HTMLElement>(
            '[data-token="true"]'
        )!;
        expect(badge.className).toContain("bottom-8");
        expect(badge.className).not.toContain("bottom-1 ");
        // The noted-mana badge keeps its own place — nothing else moves.
        const noted = container.querySelector<HTMLElement>(
            "[class*='bottom-1'][class*='left-1']"
        );
        expect(noted).toBeTruthy();
        expect(noted).not.toBe(badge);
    });

    it("keeps the bottom-left corner when there is no noted mana", () => {
        const { container } = renderCard(
            makeCreature({ isToken: true, notedMana: { mana: { U: 0 } } })
        );
        const badge = container.querySelector<HTMLElement>(
            '[data-token="true"]'
        )!;
        expect(badge.className).toContain("bottom-1");
    });
});
