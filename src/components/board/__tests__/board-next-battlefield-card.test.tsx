// Slice #256 (PRD #249) — the spatial board's battlefield card carries its
// board-coupled visual state and target-arrow anchor.
//
// Asserts the contract (observable structure), not pixels:
//  - emits `data-arrow-anchor-permanent` so target arrows attach,
//  - renders the combat grouping ring + badge from the supplied CardVisualState,
//  - rotates 90° when tapped, dims when the vs says so,
//  - shows marked damage + effective P/T for creatures, computed from the
//    projected `allPlayers` (wire-format: reads only public/full fields),
//  - the legal-target highlight rides on `vs.ringClass`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import type { CardVisualState } from "../battlefield-card";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("motion/react", () => ({ useReducedMotion: () => false }));

// Leaf face + tilt → inert markers (no Convex/router/refs needed).
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

import BoardNextBattlefieldCard from "../board-next-battlefield-card";

// "Bird Maiden" (ARN) — a real 1/2 creature def so effectivePower/Toughness
// resolve from the registry.
const CREATURE_DEF_ID = "5c1ba0b9-db01-447f-90cc-a2fc2c24146e";

function makeCreature(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "c1",
        card: { id: CREATURE_DEF_ID },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        // `types` is a projected (public/full) instance field; isCreature and
        // the P/T badge read it, not the registry.
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

function renderCard(card: CardInstance, vs: CardVisualState) {
    const me = makePlayer([card]);
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <BoardNextBattlefieldCard card={card} vs={vs} />
        </GameContext>
    );
}

describe("BoardNextBattlefieldCard visual state + anchors (#256)", () => {
    beforeEach(() => cleanup());

    it("emits the target-arrow anchor for the permanent", () => {
        const card = makeCreature();
        const { container } = renderCard(card, NEUTRAL_VS);
        expect(
            container.querySelector(
                `[data-arrow-anchor-permanent="${card.id}"]`
            )
        ).toBeTruthy();
    });

    it("renders the combat grouping ring and badge from the visual state", () => {
        const vs: CardVisualState = {
            ...NEUTRAL_VS,
            ringClass: "ring-2 ring-red-500 rounded-sm",
            badge: { color: "bg-red-500", index: 0 },
            combatOffset: "-translate-y-8",
        };
        const { container, getByText } = renderCard(makeCreature(), vs);
        // Ring is applied to the framed face element.
        expect(
            container.querySelector(".ring-red-500.rounded-sm")
        ).toBeTruthy();
        // Combat group badge shows the 1-based group index.
        expect(getByText("1")).toBeTruthy();
        // Combat offset is applied to the outer slot wrapper.
        expect(container.querySelector(".-translate-y-8")).toBeTruthy();
    });

    it("rotates 90° when the permanent is tapped", () => {
        const { container } = renderCard(
            makeCreature({ isTapped: true }),
            NEUTRAL_VS
        );
        const anchor = container.querySelector<HTMLElement>(
            "[data-arrow-anchor-permanent]"
        );
        expect(anchor?.getAttribute("data-tapped")).toBe("true");
        expect(anchor?.style.transform).toContain("rotate(90deg)");
    });

    it("does not rotate when untapped", () => {
        const { container } = renderCard(makeCreature(), NEUTRAL_VS);
        const anchor = container.querySelector<HTMLElement>(
            "[data-arrow-anchor-permanent]"
        );
        expect(anchor?.getAttribute("data-tapped")).toBeNull();
        expect(anchor?.style.transform || "").not.toContain("rotate(90deg)");
    });

    it("shows marked damage and an effective P/T badge for a creature (projected fields)", () => {
        // damageMarked is a projected (public/full) field; the P/T badge is
        // computed by effectivePower/Toughness reading the projected
        // `allPlayers` — no GRE engine import.
        const { getByText, container } = renderCard(
            makeCreature({ damageMarked: 3 }),
            NEUTRAL_VS
        );
        // Marked damage badge.
        expect(getByText("3")).toBeTruthy();
        // P/T badge present (text split as power "/" toughness across nodes).
        const ptBadge = Array.from(container.querySelectorAll("div")).find(
            (d) => /^\d+\/\d+$/.test(d.textContent ?? "")
        );
        expect(ptBadge).toBeTruthy();
    });

    it("omits the damage badge when no damage is marked", () => {
        const { container } = renderCard(
            makeCreature({ damageMarked: 0 }),
            NEUTRAL_VS
        );
        // No red damage chip when damageMarked is 0.
        expect(container.querySelector(".bg-red-600")).toBeNull();
    });

    it("renders no P/T badge for a non-creature permanent", () => {
        const land = makeCreature({
            id: "land1",
            types: ["Land"],
        });
        const { container } = renderCard(land, NEUTRAL_VS);
        const ptBadge = Array.from(container.querySelectorAll("div")).find(
            (d) => /^\d+\/\d+$/.test(d.textContent ?? "")
        );
        expect(ptBadge).toBeUndefined();
    });

    it("renders the dim overlay when the visual state marks it ineligible", () => {
        const vs: CardVisualState = {
            ...NEUTRAL_VS,
            interactive: true,
            enabled: false,
        };
        const { container } = renderCard(makeCreature(), vs);
        expect(container.querySelector(".bg-black\\/40")).toBeTruthy();
    });

    it("applies the legal-target highlight ring from the visual state", () => {
        // During target selection getVisualState supplies a soft target ring.
        const vs: CardVisualState = {
            ...NEUTRAL_VS,
            interactive: true,
            enabled: true,
            ringClass: "ring-2 ring-[#c8a060]/50 rounded-sm",
        };
        const { container } = renderCard(makeCreature(), vs);
        const ringed = container.querySelector('[class*="ring-[#c8a060]/50"]');
        expect(ringed).toBeTruthy();
    });
});
