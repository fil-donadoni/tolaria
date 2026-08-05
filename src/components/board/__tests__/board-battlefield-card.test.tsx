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

import BoardBattlefieldCard from "../board-battlefield-card";

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

function renderCard(
    card: CardInstance,
    vs: CardVisualState,
    compactCardHeight?: number
) {
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
            <BoardBattlefieldCard
                card={card}
                vs={vs}
                compactCardHeight={compactCardHeight}
            />
        </GameContext>
    );
}

describe("BoardBattlefieldCard visual state + anchors (#256)", () => {
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

    it("renders the combat grouping ring + offset but NOT the numeric badge", () => {
        const vs: CardVisualState = {
            ...NEUTRAL_VS,
            ringClass: "ring-2 ring-combat-1 rounded-sm",
            badge: { color: "bg-combat-1", index: 0 },
            combatOffset: "-translate-y-8",
        };
        const { container, queryByText } = renderCard(makeCreature(), vs);
        // Ring is applied to the framed face element.
        expect(
            container.querySelector(".ring-combat-1.rounded-sm")
        ).toBeTruthy();
        // Combat offset is applied to the outer slot wrapper.
        expect(container.querySelector(".-translate-y-8")).toBeTruthy();
        // The numeric combat-group badge is intentionally NOT rendered on the
        // spatial board — the blocker → attacker arrows convey the grouping
        // (combat-read). The badge index would have shown "1".
        expect(queryByText("1")).toBeNull();
    });

    // #1770 follow-up from #1802's review: the desktop `-translate-y-8`
    // (32px, tuned for a 168px card) overshoots the midline at the much
    // smaller landscape-compact card scale. `compactCardHeight` re-derives it
    // as a proportional inline `translate` instead of applying the class.
    it("scales the combat lift proportionally in landscape-compact (compactCardHeight set)", () => {
        const vs: CardVisualState = {
            ...NEUTRAL_VS,
            combatOffset: "-translate-y-8",
        };
        const { container } = renderCard(makeCreature(), vs, 64);
        // The desktop Tailwind class never renders once a compact height is
        // supplied — an inline `translate` replaces it.
        expect(container.querySelector(".-translate-y-8")).toBeNull();
        const anchor = container.querySelector<HTMLElement>(
            "[data-arrow-anchor-permanent]"
        );
        // 32/168 desktop ratio applied to a 64px card ≈ 12px, and UP (toward
        // the midline) for `-translate-y-8`'s direction.
        expect(anchor?.style.translate).toBe("0 -12px");
    });

    it("keeps the desktop class untouched when compactCardHeight is omitted", () => {
        const vs: CardVisualState = {
            ...NEUTRAL_VS,
            combatOffset: "translate-y-8",
        };
        const { container } = renderCard(makeCreature(), vs);
        expect(container.querySelector(".translate-y-8")).toBeTruthy();
        const anchor = container.querySelector<HTMLElement>(
            "[data-arrow-anchor-permanent]"
        );
        expect(anchor?.style.translate).toBeFalsy();
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

    // Issue #1994: on a battlefield with many overlapping lands, tapped lands
    // visually covered untapped fetchlands, making them unclickable. Root
    // cause: a bare rotate(90deg) on a 5:7 portrait box swaps its bounding
    // box to 7:5 landscape — WIDER than the card's own reserved slot — and
    // that extra reach paints (and hit-tests) OVER a neighbouring permanent
    // in an overlapped row. Scaling the rotation by the card's own aspect
    // ratio (5/7) shrinks the rotated box back to exactly the slot's
    // original width, so a tapped permanent's footprint never bleeds into a
    // neighbour's click target.
    it("scales the rotation so a tapped card's rotated footprint never exceeds its own slot width (#1994)", () => {
        const { container } = renderCard(
            makeCreature({ isTapped: true }),
            NEUTRAL_VS
        );
        const anchor = container.querySelector<HTMLElement>(
            "[data-arrow-anchor-permanent]"
        );
        const cardAspect = 5 / 7; // width / height, the codebase-wide `aspect-5/7` card ratio
        expect(anchor?.style.transform).toBe(
            `rotate(90deg) scale(${cardAspect})`
        );
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
        expect(container.querySelector(".bg-danger")).toBeNull();
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

    it("renders the accent-strong glow overlay for a legal target (matching a targetable player nameplate)", () => {
        // During target selection getVisualState sets targetGlow so the
        // permanent reads the SAME accent-strong glow ring a targetable player
        // nameplate gets — a box-shadow overlay, not a ringClass.
        const vs: CardVisualState = {
            ...NEUTRAL_VS,
            interactive: true,
            enabled: true,
            targetGlow: true,
        };
        const { container } = renderCard(makeCreature(), vs);
        const glow = container.querySelector(
            '[style*="--color-accent-strong"]'
        );
        expect(glow).toBeTruthy();
    });
});

describe("BoardBattlefieldCard phased-out treatment (CR 702.26)", () => {
    beforeEach(() => cleanup());

    it("renders a dimmed, grayscaled, inert card with a Phased tag", () => {
        const card = makeCreature();
        const { getByText } = renderCard(card, NEUTRAL_VS);
        // Baseline (not phased) — no "Phased" tag rendered.
        expect(() => getByText("Phased")).toThrow();

        cleanup();
        const me = makePlayer([card]);
        const value = {
            gameId: "g" as never,
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
        const r = render(
            <GameContext value={value}>
                <BoardBattlefieldCard card={card} vs={NEUTRAL_VS} phased />
            </GameContext>
        );
        expect(r.getByText("Phased")).toBeTruthy();
        const anchor = r.container.querySelector<HTMLElement>(
            `[data-arrow-anchor-permanent="${card.id}"]`
        )!;
        expect(anchor.getAttribute("data-phased")).toBe("true");
        expect(anchor.className).toContain("pointer-events-none");
        expect(anchor.style.opacity).toBe("0.4");
        expect(anchor.style.filter).toContain("grayscale");
    });

    it("never fires onClick even when a handler is supplied", () => {
        const card = makeCreature();
        const onClick = vi.fn();
        const me = makePlayer([card]);
        const value = {
            gameId: "g" as never,
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
        const { container } = render(
            <GameContext value={value}>
                <BoardBattlefieldCard
                    card={card}
                    vs={NEUTRAL_VS}
                    onClick={onClick}
                    phased
                />
            </GameContext>
        );
        container
            .querySelector(`[data-arrow-anchor-permanent="${card.id}"]`)!
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(onClick).not.toHaveBeenCalled();
    });
});

describe("BoardBattlefieldCard click wiring (#272)", () => {
    beforeEach(() => cleanup());

    it("invokes onClick with the mouse event when the permanent is clicked", () => {
        const card = makeCreature();
        const onClick = vi.fn();
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
        const { container } = render(
            <GameContext value={value}>
                <BoardBattlefieldCard
                    card={card}
                    vs={NEUTRAL_VS}
                    onClick={onClick}
                />
            </GameContext>
        );
        const anchor = container.querySelector(
            `[data-arrow-anchor-permanent="${card.id}"]`
        )!;
        anchor.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("shows a pointer cursor when interactive+enabled, not-allowed when blocked", () => {
        const card = makeCreature();
        const onClick = vi.fn();
        const enabledVs: CardVisualState = {
            ...NEUTRAL_VS,
            interactive: true,
            enabled: true,
        };
        const { container, rerender } = render(
            <GameContext
                value={
                    {
                        gameId: "g" as never,
                        playerId: "me",
                        activePlayerId: "me",
                        priorityPlayerId: "me",
                        phase: "PRECOMBAT_MAIN",
                        turn: 1,
                        engineTurn: 1,
                        stackCount: 0,
                        stackItems: [],
                        allPlayers: [makePlayer([card])],
                        showAllCards: false,
                        debugAllActions: false,
                        onSwitchGame: () => {},
                    } as React.ContextType<typeof GameContext>
                }
            >
                <BoardBattlefieldCard
                    card={card}
                    vs={enabledVs}
                    onClick={onClick}
                />
            </GameContext>
        );
        expect(
            container.querySelector(
                `[data-arrow-anchor-permanent="${card.id}"]`
            )?.className
        ).toContain("cursor-pointer");

        const blockedVs: CardVisualState = {
            ...NEUTRAL_VS,
            interactive: true,
            enabled: false,
        };
        rerender(
            <GameContext
                value={
                    {
                        gameId: "g" as never,
                        playerId: "me",
                        activePlayerId: "me",
                        priorityPlayerId: "me",
                        phase: "PRECOMBAT_MAIN",
                        turn: 1,
                        engineTurn: 1,
                        stackCount: 0,
                        stackItems: [],
                        allPlayers: [makePlayer([card])],
                        showAllCards: false,
                        debugAllActions: false,
                        onSwitchGame: () => {},
                    } as React.ContextType<typeof GameContext>
                }
            >
                <BoardBattlefieldCard
                    card={card}
                    vs={blockedVs}
                    onClick={onClick}
                />
            </GameContext>
        );
        expect(
            container.querySelector(
                `[data-arrow-anchor-permanent="${card.id}"]`
            )?.className
        ).toContain("cursor-not-allowed");
    });
});

// Persistent summoning-sickness marker (CR 302.6 / 702.10b). Sickness used to
// be legible only while DECLARE_ATTACKERS dimmed ineligible creatures; the
// badge is the turn-long signal, and haste suppresses it because a hasty
// creature is under no restriction at all.
describe("BoardBattlefieldCard summoning-sickness badge (CR 302.6)", () => {
    beforeEach(() => cleanup());

    const badge = (container: HTMLElement) =>
        container.querySelector('[data-summoning-sick="true"]');

    it("marks a summoning-sick creature", () => {
        const { container } = renderCard(
            makeCreature({ isSummoningSick: true }),
            NEUTRAL_VS
        );
        expect(badge(container)).toBeTruthy();
    });

    it("does not mark a creature that has been around", () => {
        const { container } = renderCard(makeCreature(), NEUTRAL_VS);
        expect(badge(container)).toBeNull();
    });

    it("does not mark a summoning-sick creature with haste (CR 702.10b)", () => {
        const { container } = renderCard(
            makeCreature({ isSummoningSick: true, staticAbilities: ["haste"] }),
            NEUTRAL_VS
        );
        expect(badge(container)).toBeNull();
    });

    it("does not mark a non-creature permanent that arrived this turn", () => {
        const { container } = renderCard(
            makeCreature({ isSummoningSick: true, types: ["Artifact"] }),
            NEUTRAL_VS
        );
        expect(badge(container)).toBeNull();
    });
});
