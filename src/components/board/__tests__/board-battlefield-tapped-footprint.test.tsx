// Issue #1994 (PR #2279, review round 2): a tapped permanent's rotated box
// (7:5 after rotating a 5:7 portrait card 90°) is wider than its unrotated
// slot. Two fixes were tried and rejected before this one:
//
//   1. Scale the rotated box back down to fit the slot — shrank EVERY tapped
//      permanent 29% smaller (51% area) on every viewport, undisclosed.
//   2. Reserve the wider rotated footprint in the ROW LAYOUT
//      (`tappedFootprintWidth`, since removed from `board-layout.ts`) — this
//      was MEASURED (browser `elementFromPoint`, real BoardBattlefield DOM,
//      round-2 review) to make the reported bug WORSE: it protected the
//      harmless right-side overhang (slots paint in DOM order, so only the
//      LEFT overhang ever steals a click) and, on a phone already in the
//      overlap regime, `widths[]` inflation shrank the row's one shared
//      inter-item gap for EVERY card — an untapped fetchland's clickable
//      area went from 408px² on `main` to 0px² on that branch.
//
// The current fix (`board-battlefield-card.tsx`'s `tapTransform` /
// `data-tap-visual`) spends NO row width at all: the rotation is purely
// presentational and `pointer-events: none` while tapped, so the row layout
// is completely blind to tap state — this file's first `describe` block
// proves that blindness end-to-end (regression guard: if someone re-adds a
// tap-aware reservation, `land-b`'s position moves and this goes red).
//
// `board-battlefield-card.test.tsx` proves `data-tap-visual`'s
// transform/pointer-events in isolation (a single card, hand-built props).
// This file proves `BoardBattlefield` actually WIRES a real battlefield's
// `isTapped` flag through the REAL `BoardBattlefield` → `SpatialZone` →
// `SpatialSlot` → `BoardBattlefieldCard` chain to that same DOM shape — the
// same class of gap `board-battlefield-landscape-footprint.test.tsx` closed
// for the compact card metrics (a prop threaded through but never consumed
// passes every other test in the suite).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { CARD_WIDTH } from "~/lib/board-layout";

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
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, (id: string) => DEFS[id] ?? { id, name: id }),
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

describe("BoardBattlefield row layout is blind to tap state (#1994 round 2)", () => {
    it("places the NEXT land at the EXACT SAME x whether the first land is tapped or not", () => {
        renderBattlefield([
            land("land-a", "forest-def", false),
            land("land-b", "island-def", false),
        ]);
        const baselineX = xOf("land-b");
        cleanup();

        // Same pair, land-a now tapped — if the row layout reserved a wider
        // footprint for a tapped item (the rejected mechanism), land-b would
        // move. It must NOT: the rotation is purely presentational now.
        renderBattlefield([
            land("land-a", "forest-def", true),
            land("land-b", "island-def", false),
        ]);
        const tappedX = xOf("land-b");

        expect(tappedX).toBeCloseTo(baselineX, 3);
    });

    it("keeps the pre-#1994 spacing (card width + default gap) regardless of tap state", () => {
        renderBattlefield([
            land("land-a", "forest-def", true),
            land("land-b", "island-def", false),
        ]);
        const gap = xOf("land-b") - xOf("land-a");
        expect(gap).toBeCloseTo(CARD_WIDTH + 12, 3);
    });
});

describe("BoardBattlefield wires isTapped through to the presentational tap-visual layer", () => {
    it("gives a REAL tapped battlefield card's tap-visual layer pointer-events:none and a 90° rotation", () => {
        renderBattlefield([land("land-a", "forest-def", true)]);
        const visual = document.querySelector<HTMLElement>("[data-tap-visual]");
        expect(visual?.style.transform).toBe("rotate(90deg)");
        expect(visual?.style.pointerEvents).toBe("none");
    });

    it("leaves an untapped battlefield card's tap-visual layer fully interactive", () => {
        renderBattlefield([land("land-a", "forest-def", false)]);
        const visual = document.querySelector<HTMLElement>("[data-tap-visual]");
        expect(visual?.style.transform || "").toBe("");
        expect(visual?.style.pointerEvents).toBe("");
    });
});
