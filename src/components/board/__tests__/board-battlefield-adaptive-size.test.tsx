// Adaptive per-zone card size, measured through the REAL component chain
// (ADR 0103 "adaptive zone sizing", issue #2725).
//
// `board-layout.test.ts` proves the arithmetic; this file proves the number
// reaches the DOM — `BoardBattlefield` -> `bandedRowsLayout` -> `SpatialZone`
// -> `SpatialSlot`'s literal `transform` string. A `scale` that never leaves
// the pure module is a card size no player ever sees, and that gap is exactly
// the one `board-battlefield-landscape-footprint.test.tsx` was written to
// close for the compact metrics.
//
// The load-bearing assertion is the FOOTPRINT CENSUS one: `n` in
// `min(max, (zone − gaps) / n)` counts laid-out FOOTPRINTS, not cards. Twelve
// identical Forests are ONE footprint with a count badge (PRD #621), so the
// zone must NOT shrink for them; twelve DIFFERENT lands are twelve footprints,
// so it must. A rule written against `cards.length` passes every test whose
// fixture happens to have no stacks — hence both halves here, on the same
// zone, with the same card count.
//
// The second census row is a must-NOT: a tapped permanent's 90°-rotated box is
// wider than its slot, and it still contributes exactly ONE card-wide entry.
// Reserving the rotated width was measured to make things worse (#1994 / PR
// #2279 round 2 — it shrank the row's one shared gap for every card and took an
// untapped fetchland's clickable area to 0px²), so the row stays tap-blind.
// The sibling `board-battlefield-tapped-footprint.test.tsx` guards that in the
// FIT regime; this file guards it in the SHRINK regime, which #2725 added.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { CARD_WIDTH } from "~/lib/board-layout";

// Narrow enough that twelve separate lands cannot fit at full size, wide
// enough that one twelve-deep permanent stack comfortably can.
const ZONE_W = 900;
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

const LAND_IDS = Array.from({ length: 12 }, (_, i) => `land-def-${i}`);
const DEFS: Record<string, unknown> = Object.fromEntries([
    ["forest-def", { id: "forest-def", name: "Forest" }],
    ...LAND_IDS.map((id) => [id, { id, name: id }]),
]);
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

function land(id: string, defId: string, isTapped = false): CardInstance {
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

/** Every laid-out slot's placement centre-x and scale, in DOM order — read
 *  from the literal `transform` string `SpatialSlot` writes. */
function slots(): { x: number; scale: number }[] {
    return [...document.querySelectorAll<HTMLElement>("[data-card-slot]")].map(
        (el) => {
            const t = el.style.transform;
            const m = /translate\((-?[\d.]+)px,.*scale\(([\d.]+)\)/.exec(t);
            expect(m, `unparsable transform: ${t}`).not.toBeNull();
            return { x: Number(m![1]) + CARD_WIDTH / 2, scale: Number(m![2]) };
        }
    );
}

/** Twelve DIFFERENT lands — twelve footprints. */
const twelveDistinct = (tapped = false) =>
    LAND_IDS.map((defId, i) => land(`land-${i}`, defId, tapped));

/** Twelve IDENTICAL clean Forests — ONE footprint (PRD #621 permanent stack). */
const twelveIdentical = () =>
    Array.from({ length: 12 }, (_, i) => land(`forest-${i}`, "forest-def"));

beforeEach(cleanup);

describe("adaptive per-zone card size reaches the DOM (issue #2725)", () => {
    it("shrinks the cards, rather than burying them, when a row overflows", () => {
        renderBattlefield(twelveDistinct());
        const placed = slots();
        expect(placed).toHaveLength(12);
        // Shrunk...
        expect(placed[0].scale).toBeLessThan(1);
        // ...and every card's centre still painted: consecutive centres are
        // more than half an on-screen card apart, which is precisely what the
        // ui-gate probe hit-tests for (`cardsOcc`).
        for (let i = 1; i < placed.length; i++) {
            const step = placed[i].x - placed[i - 1].x;
            expect(step).toBeGreaterThan(
                (CARD_WIDTH * placed[i - 1].scale) / 2
            );
        }
    });

    it("counts a permanent stack as ONE footprint, not twelve cards", () => {
        // Same zone, same twelve permanents — but identical and clean, so they
        // collapse into one fanned/depth-piled footprint with a count badge.
        // A rule keyed on `cards.length` would shrink this row too.
        renderBattlefield(twelveIdentical());
        const placed = slots();
        expect(placed).toHaveLength(1);
        expect(placed[0].scale).toBe(1);
    });

    it("does NOT shrink for a tapped permanent's wider rotated box", () => {
        // Must-NOT census row: the rotation is presentational and
        // `pointer-events: none` (#1994 / PR #2279 round 2). In the SHRINK
        // regime a tap-aware footprint would show up as a smaller scale and a
        // different x for every card in the row.
        renderBattlefield(twelveDistinct(false));
        const untapped = slots();
        cleanup();
        renderBattlefield(twelveDistinct(true));
        const tapped = slots();

        expect(tapped).toHaveLength(untapped.length);
        tapped.forEach((s, i) => {
            expect(s.scale).toBeCloseTo(untapped[i].scale, 6);
            expect(s.x).toBeCloseTo(untapped[i].x, 3);
        });
    });

    it("never lays a card outside the zone it belongs to", () => {
        renderBattlefield(twelveDistinct());
        const placed = slots();
        for (const s of placed) {
            expect(s.x - (CARD_WIDTH * s.scale) / 2).toBeGreaterThanOrEqual(
                -0.5
            );
            expect(s.x + (CARD_WIDTH * s.scale) / 2).toBeLessThanOrEqual(
                ZONE_W + 0.5
            );
        }
    });
});
