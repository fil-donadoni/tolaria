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

// `motion.div` stub (not just `useReducedMotion`): the peek-stack placement
// describe block below renders a real `AttachedCardsCluster`, whose dialog
// (`CardsPile`) imports `motion` from this module for its own card tiles —
// same pattern as `coin-flip-animation.test.tsx`.
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
            ringClass: "card-ring card-ring-combat-1",
            badge: { color: "bg-combat-1", index: 0 },
            combatOffset: "-translate-y-8",
        };
        const { container, queryByText } = renderCard(makeCreature(), vs);
        // Ring is applied to the framed face element.
        expect(
            container.querySelector(".card-ring.card-ring-combat-1")
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

    // Issue #1994 (PR #2279, review round 2): the INTERACTIVE box
    // (`data-arrow-anchor-permanent` — click/pointer handlers, the element
    // neighbours are hit-tested against) must be the SAME whether tapped or
    // not, so tapping a permanent never changes its own hit-testable
    // footprint. The 90° rotation lives on a separate, purely presentational
    // `data-tap-visual` layer one level in, which additionally goes
    // `pointer-events: none` while tapped so its overhang can never itself be
    // hit-tested (a click there falls through to whatever is genuinely
    // painted underneath instead of this card stealing it).
    it("never rotates or transforms the interactive (click-anchor) box, tapped or not", () => {
        const untapped = renderCard(
            makeCreature({ id: "c-untapped" }),
            NEUTRAL_VS
        );
        const untappedAnchor = untapped.container.querySelector<HTMLElement>(
            "[data-arrow-anchor-permanent]"
        );
        expect(untappedAnchor?.style.transform || "").toBe("");
        cleanup();

        const tapped = renderCard(
            makeCreature({ id: "c-tapped", isTapped: true }),
            NEUTRAL_VS
        );
        const tappedAnchor = tapped.container.querySelector<HTMLElement>(
            "[data-arrow-anchor-permanent]"
        );
        expect(tappedAnchor?.getAttribute("data-tapped")).toBe("true");
        // Same box as the untapped case — no rotation, no scale, nothing.
        expect(tappedAnchor?.style.transform || "").toBe("");
    });

    it("rotates the presentational tap-visual layer 90° when tapped, without any compensating scale", () => {
        const { container } = renderCard(
            makeCreature({ isTapped: true }),
            NEUTRAL_VS
        );
        const visual =
            container.querySelector<HTMLElement>("[data-tap-visual]");
        expect(visual?.style.transform).toBe("rotate(90deg)");
        expect(visual?.style.transform).not.toContain("scale");
    });

    it("does not rotate the tap-visual layer when untapped", () => {
        const { container } = renderCard(makeCreature(), NEUTRAL_VS);
        const visual =
            container.querySelector<HTMLElement>("[data-tap-visual]");
        expect(visual?.style.transform || "").not.toContain("rotate(90deg)");
    });

    // The mechanism that actually fixes #1994: a `pointer-events: none` layer
    // can never itself be hit-tested (by construction — CSS, not this app's
    // logic), so the rotated overhang is inert to both click and hover; the
    // click falls through to whatever a neighbour's own box exposes instead
    // of this card stealing it. Verified by mutation (proof-of-failure):
    // deleting the `pointerEvents` line turns this red.
    it("makes the tap-visual layer pointer-events:none while tapped, so its overhang can never be hit-tested", () => {
        const { container } = renderCard(
            makeCreature({ isTapped: true }),
            NEUTRAL_VS
        );
        const visual =
            container.querySelector<HTMLElement>("[data-tap-visual]");
        expect(visual?.style.pointerEvents).toBe("none");
    });

    it("leaves the tap-visual layer's pointer-events untouched (auto) when untapped", () => {
        const { container } = renderCard(makeCreature(), NEUTRAL_VS);
        const visual =
            container.querySelector<HTMLElement>("[data-tap-visual]");
        // No inline override at all — untapped cards keep full hover/tilt/
        // preview interactivity, unaffected by the tapped-only mechanism.
        expect(visual?.style.pointerEvents).toBe("");
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

    it("renders the outer signal-target glow for a legal target (matching a targetable player nameplate)", () => {
        // During target selection getVisualState sets targetGlow so the
        // permanent reads the SAME soft outer glow a targetable player
        // nameplate gets. It is the wrapper's OWN box-shadow (an
        // `overflow-hidden` wrapper clips a descendant's outward shadow), and
        // since #2724 it composes with the inset candidate ring instead of
        // replacing it.
        const vs: CardVisualState = {
            ...NEUTRAL_VS,
            interactive: true,
            enabled: true,
            targetGlow: true,
        };
        const { container } = renderCard(makeCreature(), vs);
        const glow = container.querySelector(
            '[style*="--color-signal-target"]'
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

// Round 3's PR body claimed the `associatedExiled` peek-stack (Banishing
// Light's held permanent, Ice Cauldron's noted card) "stays clickable
// regardless of tap state" because it renders OUTSIDE `[data-tap-visual]`.
// That claim had NO test — review round 4's mutation M5 moved the cluster
// INSIDE `[data-tap-visual]` and all 716 board tests stayed green. This
// closes that gap: assert the cluster is never a descendant of the inert
// rotated layer, on a TAPPED host (where it matters).
describe("BoardBattlefieldCard peek-stack placement (#1994 round 4)", () => {
    beforeEach(() => cleanup());

    it("keeps the associatedExiled peek-stack OUTSIDE [data-tap-visual] on a tapped host", () => {
        const host = makeCreature({ id: "host", isTapped: true });
        const exiledCard = {
            id: "exiled-1",
            card: { id: "some-exiled-def" },
            controllerId: "me",
            ownerId: "me",
            zone: "exile",
            exiledByPermanentId: "host",
        } as CardInstance;

        const me: Player = {
            id: "me",
            name: "me",
            bgColor: "#000",
            life: 20,
            hand: [],
            library: { count: 0 },
            graveyard: [],
            exile: [exiledCard],
            battlefield: [host],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        };
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
                <BoardBattlefieldCard card={host} vs={NEUTRAL_VS} />
            </GameContext>
        );

        const exiledImage = Array.from(
            container.querySelectorAll('[data-testid="card-image"]')
        ).find((el) => el.getAttribute("data-card-id") === "exiled-1");
        expect(exiledImage).toBeTruthy();
        // Must NOT be inside the rotated/inert layer — a tapped host would
        // otherwise make its own held-card peek unclickable.
        expect(exiledImage!.closest("[data-tap-visual]")).toBeNull();
    });
});
