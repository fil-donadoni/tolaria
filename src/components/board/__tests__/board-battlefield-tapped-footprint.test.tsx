// Issue #1994 (review on PR #2279): a tapped permanent's rotated box (7:5
// after rotating a 5:7 portrait card 90°) is wider than its unrotated slot,
// so an earlier fix shrunk the card back down to fit — undisclosed, and a
// global visual regression (every tapped permanent 29% smaller on every
// viewport). The replacement reserves the wider ROTATED footprint in the row
// LAYOUT instead (`tappedFootprintWidth`, `board-layout.ts`), so tapping a
// permanent reflows its row rather than shrinking the card.
//
// `board-layout.test.ts` proves the pure math (`tappedFootprintWidth`,
// `rowLayout`'s reservation). This file proves `BoardBattlefield` actually
// WIRES that math into its per-item `widths[]` — the same class of gap
// `board-battlefield-landscape-footprint.test.tsx` closed for the compact
// card metrics (a prop threaded through but never consumed passes every
// other test in the suite). Drives the REAL `BoardBattlefield` →
// `SpatialZone` → `SpatialSlot` chain and reads the rendered slot transform
// (`spatial-slot.tsx` — the literal resolved placement, never a mid-tween
// value), same technique as that file.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { CARD_WIDTH, tappedFootprintWidth } from "~/lib/board-layout";

// Wide enough that both lands lay out in the "fit" regime (scale 1, full
// gap) — the geometry below is then exact, not shrunk by an unrelated
// overflow computation.
const ZONE_W = 2000;
const ZONE_H = 400;

vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: ZONE_W, height: ZONE_H },
    }),
}));

vi.mock("convex/react", () => ({
    useQuery: () => undefined,
    useMutation: () => async () => {},
    useAction: () => async () => {},
}));

const DEFS: Record<string, unknown> = {
    "forest-def": { id: "forest-def", name: "Forest" },
    "island-def": { id: "island-def", name: "Island" },
};
vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => DEFS[id] ?? { id, name: id },
    tryGetDefinition: (id: string) => DEFS[id] ?? { id, name: id },
}));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));

vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../combat-panels", () => ({ default: () => null }));

import BoardBattlefield from "../board-battlefield";

function land(id: string, defId: string, isTapped: boolean): CardInstance {
    return {
        id,
        card: { id: defId },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped,
        types: ["Land"],
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

function renderBattlefield(battlefield: CardInstance[]) {
    const player = makePlayer(battlefield);
    return render(
        <GameContext
            value={
                {
                    gameId: "game-id" as never,
                    playerId: "me",
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
                } as React.ContextType<typeof GameContext>
            }
        >
            <BoardBattlefield player={player} />
        </GameContext>
    );
}

function xOf(slotId: string): number {
    const el = document.querySelector(
        `[data-card-slot="${slotId}"]`
    ) as HTMLElement | null;
    expect(el).not.toBeNull();
    const m = /translate\((-?[\d.]+)px,/.exec(el!.style.transform);
    expect(m, `unparsable transform: ${el!.style.transform}`).not.toBeNull();
    // The transform is `translate(x - cardWidth/2, ...)`; recover the
    // placement center (matches `geometryOf` in the landscape-footprint
    // sibling test, minus the y/scale fields this file doesn't need).
    return Number(m![1]) + CARD_WIDTH / 2;
}

beforeEach(cleanup);

describe("BoardBattlefield reserves a tapped permanent's rotated footprint in the row (#1994)", () => {
    it("pushes the NEXT land further right when the FIRST land is tapped, by exactly the extra rotated footprint", () => {
        // Baseline: both untapped — normal one-card-width spacing.
        renderBattlefield([
            land("land-a", "forest-def", false),
            land("land-b", "island-def", false),
        ]);
        const baselineGap = xOf("land-b") - xOf("land-a");
        cleanup();

        // Same pair, land-a now tapped — its footprint reservation widens by
        // `tappedFootprintWidth(CARD_WIDTH) - CARD_WIDTH`, pushing land-b out
        // by exactly that much (both rows are in the fit regime, scale 1).
        renderBattlefield([
            land("land-a", "forest-def", true),
            land("land-b", "island-def", false),
        ]);
        const tappedGap = xOf("land-b") - xOf("land-a");

        const expectedExtra = tappedFootprintWidth(CARD_WIDTH) - CARD_WIDTH;
        expect(expectedExtra).toBeGreaterThan(0); // sanity: the fixture is meaningful
        expect(tappedGap - baselineGap).toBeCloseTo(expectedExtra, 3);
    });

    it("reserves NO extra footprint when nothing is tapped — untapped lands keep the pre-#1994 spacing", () => {
        renderBattlefield([
            land("land-a", "forest-def", false),
            land("land-b", "island-def", false),
        ]);
        const gap = xOf("land-b") - xOf("land-a");
        // Plain card width + the row's default full gap (12px) at scale 1 —
        // no rotation-driven widening in play.
        expect(gap).toBeCloseTo(CARD_WIDTH + 12, 3);
    });
});
