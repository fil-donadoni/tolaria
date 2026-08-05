// Issue #1994 (PR #2279, review round 4). Round 3's `pointer-events: none`
// fix on `[data-tap-visual]` (see `board-battlefield-card.tsx`'s
// `tapTransform` comment for the full history) genuinely fixed the reported
// occlusion bug, but `CardTilt3D` — and everything it wraps (`CardImage`,
// `CardPreview`) — lived INSIDE `[data-tap-visual]`, so `[data-card-tilt-
// root]` inherited `pointer-events: none` too while tapped. That silently
// killed hover-tilt, hover-dwell preview, right-click preview and (per
// `card-preview.tsx`'s own `closest("[data-card-tilt-root]")` binding)
// mobile long-press on every tapped permanent, and un-suppressed the
// browser's native context menu (both `preventDefault()` sites lived inside
// the same now-inert subtree).
//
// The fix re-orders the nesting so `CardTilt3D` WRAPS `[data-tap-visual]`
// instead of living inside it.
//
// jsdom computes no layout and does not implement CSS pointer-events-based
// hit-testing during `dispatchEvent` — you always name the event's target
// directly, bypassing the browser's real target-resolution step — so a
// naive "dispatch at a leaf and see if it bubbles to the tilt root" test
// cannot distinguish the old (broken) nesting from the new one: bubbling
// from a real DOM descendant to a real DOM ancestor works identically
// either way, regardless of any `pointer-events` value in between. What CAN
// be proven in jsdom, because it is pure CSS cascade (not layout, not hit-
// testing), is the COMPUTED `pointer-events` value AT `[data-card-tilt-
// root]` itself — jsdom's `getComputedStyle` correctly resolves inherited
// properties through inline styles (verified independently against a bare
// probe before writing this file). If `[data-card-tilt-root]` is a
// DESCENDANT of the inert `[data-tap-visual]` (round 3's shape), that
// computed value inherits down to `none`; if it is an ANCESTOR (this fix),
// it stays `auto` regardless of the tapped state below it — exactly the
// property real hit-testing consults.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import type { CardVisualState } from "../battlefield-card";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("motion/react", () => ({ useReducedMotion: () => false }));

// Leaf face only — CardTilt3D itself is REAL (unlike the sibling
// board-battlefield-card.test.tsx, which mocks it away for its unrelated
// assertions). No Convex/router/refs needed for the leaf.
vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: CardInstance | { id: string } }) => (
        <div
            data-testid="card-image"
            data-card-id={"id" in card ? card.id : "?"}
        />
    ),
}));

import BoardBattlefieldCard from "../board-battlefield-card";

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

beforeEach(() => cleanup());

describe("BoardBattlefieldCard tap-inert-layer boundary (#1994 round 4)", () => {
    it("keeps [data-card-tilt-root] an ANCESTOR of [data-tap-visual], tapped or not", () => {
        const { container } = renderCard(makeCreature({ isTapped: true }));
        const tiltRoot = container.querySelector<HTMLElement>(
            "[data-card-tilt-root]"
        );
        const tapVisual =
            container.querySelector<HTMLElement>("[data-tap-visual]");
        expect(tiltRoot).toBeTruthy();
        expect(tapVisual).toBeTruthy();
        // This fix's shape: `closest()` from the rotated layer finds an
        // ANCESTOR tilt root. The round-3 regression put the tilt root
        // INSIDE `[data-tap-visual]` instead — a DESCENDANT, not an
        // ancestor — where this same `closest()` call would return null.
        expect(tapVisual!.closest("[data-card-tilt-root]")).not.toBeNull();
        // Equivalently: the tilt root genuinely CONTAINS the rotated layer.
        expect(tiltRoot!.contains(tapVisual!)).toBe(true);
    });

    it("leaves [data-card-tilt-root]'s computed pointer-events untouched (not inherited none) while tapped", () => {
        const { container } = renderCard(makeCreature({ isTapped: true }));
        const tiltRoot = container.querySelector<HTMLElement>(
            "[data-card-tilt-root]"
        )!;
        const tapVisual =
            container.querySelector<HTMLElement>("[data-tap-visual]")!;
        // The rotated layer itself IS inert (this is the #1994 fix — a
        // pointer-events:none element can never itself be hit-tested).
        expect(getComputedStyle(tapVisual).pointerEvents).toBe("none");
        // But the tilt root, now an ANCESTOR of it rather than a descendant,
        // must NOT inherit that `none` — this is the round-4 regression fix.
        // (Round 3's shape would compute "none" here too, since inheritance
        // flows DOWN from an ancestor with `pointer-events: none`.)
        expect(getComputedStyle(tiltRoot).pointerEvents).not.toBe("none");
    });

    it("leaves an UNTAPPED permanent's tilt root fully interactive (baseline, unaffected either way)", () => {
        const { container } = renderCard(makeCreature({ isTapped: false }));
        const tiltRoot = container.querySelector<HTMLElement>(
            "[data-card-tilt-root]"
        )!;
        expect(getComputedStyle(tiltRoot).pointerEvents).not.toBe("none");
    });

    it("still suppresses the native context menu on a TAPPED permanent (CardTilt3D's own onContextMenu)", () => {
        const { container } = renderCard(makeCreature({ isTapped: true }));
        const tiltRoot = container.querySelector<HTMLElement>(
            "[data-card-tilt-root]"
        )!;
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
        });
        tiltRoot.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("bubbles a right-click from inside the rotated layer up to the tilt root's suppression on a tapped permanent", () => {
        const { container } = renderCard(makeCreature({ isTapped: true }));
        const leaf = container.querySelector<HTMLElement>(
            '[data-testid="card-image"]'
        )!;
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
        });
        leaf.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });
});
