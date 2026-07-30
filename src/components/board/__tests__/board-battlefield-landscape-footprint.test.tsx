// The landscape-compact card footprint, asserted through the REAL
// `BoardBattlefield` → `SpatialZone` → `SpatialSlot` chain (#1768).
//
// `board-landscape-bands.test.tsx` stubs `board-battlefield` to a prop-reporter,
// so it proves the board HANDS the compact metrics down — but not that the
// battlefield USES them. Deleting `cardWidth` / `cardHeight` / `bandPad` from
// `BoardBattlefield`'s `bandedRowsLayout` call left that suite fully green while
// re-opening the exact two-scale bug this ticket closes: the hand renders at the
// compact footprint and the battlefield silently caps its row scale against the
// DESKTOP 120×168 card, i.e. small clipped permanents next to full-size hand
// cards.
//
// So this file drives the real component at the ticket's representative viewport
// and reads the rendered slot geometry (`[data-card-slot]`'s literal box + the
// resolved transform — see `spatial-slot.tsx`, which carries the exact placement
// so layout tests never sample a mid-tween value). Only leaf card ART is stubbed.
// Each of the three props is load-bearing for at least one assertion below:
//   • cardWidth  → the slot's centred x (the row reserves the compact footprint)
//   • cardHeight → scale 1 (the band-height cap is measured against OUR card)
//   • bandPad    → scale 1 (the desktop 14px pad alone shrinks the row to ~0.88)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { CARD_WIDTH } from "~/lib/board-layout";
import {
    LANDSCAPE_BATTLEFIELD_FRAC,
    landscapeCardMetrics,
} from "~/lib/landscape-board-bands";

/** The ticket's representative compact viewport (iPhone 14/15 landscape). */
const PHONE_H = 390;
/** The viewer battlefield band at that height: one seat's share of the budget.
 *  This is the REAL number the band gets — a battlefield ROW is then exactly as
 *  tall as the hand band, which is what makes the shared footprint fit at
 *  scale 1. Any other height would make the assertions arbitrary. */
const ZONE_H = PHONE_H * LANDSCAPE_BATTLEFIELD_FRAC;
/** Band width after the left seat rail and the right control/pile rails. */
const ZONE_W = 600;

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
    "bear-def": { id: "bear-def", name: "Grizzly Bears" },
    "forest-def": { id: "forest-def", name: "Forest" },
};
vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => DEFS[id] ?? { id, name: id },
    tryGetDefinition: (id: string) => DEFS[id] ?? { id, name: id },
}));

// The client-side pick buffer lives in a provider the board mounts; this test
// renders the battlefield alone, so stand in with an empty buffer.
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));

// Leaf card art only — everything between the zone and the card box is real.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../combat-panels", () => ({ default: () => null }));

import BoardBattlefield from "../board-battlefield";

function permanent(id: string, defId: string, types: string[]): CardInstance {
    return {
        id,
        card: { id: defId },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types,
    } as CardInstance;
}

const BEAR = permanent("bear-1", "bear-def", ["Creature"]);
const FOREST = permanent("forest-1", "forest-def", ["Land"]);

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

function renderBattlefield(compact?: ReturnType<typeof landscapeCardMetrics>) {
    const player = makePlayer([BEAR, FOREST]);
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
                    allPlayers: [player],
                    showAllCards: false,
                    debugAllActions: false,
                    onSwitchGame: () => {},
                } as React.ContextType<typeof GameContext>
            }
        >
            <BoardBattlefield player={player} compact={compact} />
        </GameContext>
    );
}

type SlotGeometry = {
    width: string;
    height: string;
    x: number;
    y: number;
    scale: number;
};

/** Read a slot's RENDERED geometry: the literal card box plus the resolved
 *  placement `SpatialSlot` writes as its transform. */
function geometryOf(slotId: string): SlotGeometry {
    const el = document.querySelector(
        `[data-card-slot="${slotId}"]`
    ) as HTMLElement | null;
    expect(el).not.toBeNull();
    const t = el!.style.transform;
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\).*scale\(([\d.]+)\)/.exec(
        t
    );
    expect(m, `unparsable transform: ${t}`).not.toBeNull();
    return {
        width: el!.style.width,
        height: el!.style.height,
        x: Number(m![1]),
        y: Number(m![2]),
        scale: Number(m![3]),
    };
}

beforeEach(cleanup);

describe("battlefield lays out at the shared landscape footprint (#1768)", () => {
    const metrics = landscapeCardMetrics(PHONE_H);

    it("renders every slot at the compact card box, never the desktop one", () => {
        renderBattlefield(metrics);
        for (const id of ["bear-1", "forest-1"]) {
            const g = geometryOf(id);
            expect(g.width).toBe(`${metrics.cardWidth}px`);
            expect(g.height).toBe(`${metrics.cardHeight}px`);
        }
    });

    it("places them at FULL scale — the band caps against OUR card, not 120×168", () => {
        renderBattlefield(metrics);
        // scale 1 is the whole ticket: a battlefield permanent is exactly as
        // big as a hand card. It holds only because `bandedRowsLayout` is given
        // BOTH the compact `cardHeight` (the cap's denominator) and the tighter
        // `bandPad` — the desktop 14px padding alone drops this to ~0.88.
        expect(geometryOf("bear-1").scale).toBe(1);
        expect(geometryOf("forest-1").scale).toBe(1);
    });

    it("reserves the compact footprint in the row, not a 120px one", () => {
        renderBattlefield(metrics);
        // The creature row holds one card, so it is centred: its box centre is
        // at half the zone width and the slot's translate is that minus half a
        // COMPACT card. Laying out against the default 120px card would offset
        // it by (120 − cardWidth)/2 ≈ 37px.
        const g = geometryOf("bear-1");
        expect(g.x).toBeCloseTo((ZONE_W - metrics.cardWidth) / 2, 3);
        expect(g.x).not.toBeCloseTo(
            (ZONE_W - CARD_WIDTH) / 2 + CARD_WIDTH / 2,
            0
        );
    });

    it("would clip on this band WITHOUT the compact metrics (the bug)", () => {
        // Same zone, no `compact`: the desktop card can't fit a ~70px row, so
        // the layout shrinks it — which is exactly the two-scale board (small
        // permanents beside full-size hand cards) this ticket removes. Proves
        // the scale-1 assertions above have teeth.
        renderBattlefield(undefined);
        const g = geometryOf("bear-1");
        expect(g.width).toBe(`${CARD_WIDTH}px`);
        expect(g.scale).toBeLessThan(1);
    });
});
