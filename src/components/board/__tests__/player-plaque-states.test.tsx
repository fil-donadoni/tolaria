// Player plaque states (ADR 0103, issue #2727 AC: "plaque states render for
// active / attacked / low life").
//
// The precedence itself is proved in `src/lib/__tests__/board-chrome-v4.test.ts`
// (a rendered plaque only ever shows the winner, so a DOM test cannot see that
// `attacked` beat `low`). What THIS file proves is the wiring, which the pure
// test cannot reach: that `BoardPlayer` actually derives `underAttack` from the
// projected combat state and hands it to the plaque, and that each state paints
// a distinguishable ring. Drop the `underAttack` prop from `board-player.tsx`
// and the attacked case below goes red.
//
// It also pins the one thing the portrait band budget cares about: the 44px
// seat plate belongs to the FULL plaque only. The compact plaque's box height
// is mirrored as `PORTRAIT_NAMEPLATE_MAX_H` in `portrait-board-bands.ts`, and a
// 44px child inside a 24px box would blow it — the bands are the contract, the
// skin fits inside them.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Combat, Player } from "~/types/game";
import type { ViewportMode } from "~/hooks/useViewportMode";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

const ho = vi.hoisted(() => ({ portrait: false }));
vi.mock("~/hooks/useIsPortrait", () => ({ useIsPortrait: () => ho.portrait }));

const viewportHolder = vi.hoisted(() => ({ mode: "desktop" as ViewportMode }));
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => viewportHolder.mode,
}));

import BoardPlayer from "../board-player";

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
    return {
        id,
        name: `${id}-name`,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeCombat(overrides: Partial<Combat> = {}): Combat {
    return {
        attackerIds: [],
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
        ...overrides,
    };
}

type Ctx = React.ContextType<typeof GameContext>;

const buffer = {
    buffer: [],
    toggle: vi.fn(),
    clear: vi.fn(),
    submit: vi.fn(async () => {}),
    isPending: false,
    lastError: null,
    dismissError: vi.fn(),
    reportError: vi.fn(),
} as unknown as PendingChoiceBuffer;

function renderPlaque(player: Player, ctx: Partial<NonNullable<Ctx>> = {}) {
    const { container } = render(
        <GameContext
            value={
                {
                    gameId: "game-id" as never,
                    playerId: "me",
                    activePlayerId: "opp",
                    priorityPlayerId: "opp",
                    phase: "DECLARE_ATTACKERS",
                    turn: 1,
                    engineTurn: 1,
                    stackCount: 0,
                    stackItems: [],
                    allPlayers: [],
                    showAllCards: false,
                    debugAllActions: false,
                    ...ctx,
                } as Ctx
            }
        >
            <PendingChoiceBufferContext value={buffer}>
                <BoardPlayer player={player} side="bottom" />
            </PendingChoiceBufferContext>
        </GameContext>
    );
    return container.querySelector<HTMLElement>(
        `[data-arrow-anchor-player="${player.id}"]`
    )!;
}

beforeEach(() => {
    cleanup();
    ho.portrait = false;
    viewportHolder.mode = "desktop";
});

describe("plaque states (ADR 0103, issue #2727)", () => {
    it("rests with no state and no ring", () => {
        const plate = renderPlaque(makePlayer("me"));
        expect(plate.dataset.plaqueState).toBeUndefined();
        expect(plate.style.boxShadow).toBe("");
    });

    it("active — the seat holding priority wears a ring", () => {
        const plate = renderPlaque(makePlayer("me"), {
            priorityPlayerId: "me",
        });
        expect(plate.dataset.plaqueState).toBe("active");
        expect(plate.style.boxShadow).toContain("--color-secondary-accent");
    });

    it("low life — a seat at or under the threshold wears the danger ring", () => {
        const plate = renderPlaque(makePlayer("me", { life: 3 }));
        expect(plate.dataset.plaqueState).toBe("low");
        expect(plate.style.boxShadow).toContain("--color-danger");
    });

    it("attacked — derived from the REAL projected combat, not a prop the caller invents", () => {
        // `BoardPlayer` reads `combat` + `activePlayerId` off the game context
        // (CR 506.2: the defending player is the non-active one) and hands the
        // result to the presentational plaque. Without that derivation this
        // renders the resting plaque.
        const plate = renderPlaque(makePlayer("me"), {
            activePlayerId: "opp",
            combat: makeCombat({ attackerIds: ["bear"] }),
        });
        expect(plate.dataset.plaqueState).toBe("attacked");
        expect(plate.style.boxShadow).toContain("--color-signal-opponent");
    });

    it("attacked beats low life on the rendered plaque too", () => {
        const plate = renderPlaque(makePlayer("me", { life: 2 }), {
            activePlayerId: "opp",
            combat: makeCombat({ attackerIds: ["bear"] }),
        });
        expect(plate.dataset.plaqueState).toBe("attacked");
    });
});

describe("the 44px seat plate stays out of the compact box (ADR 0101 §2 / band budget)", () => {
    it("the full plaque carries it", () => {
        const plate = renderPlaque(makePlayer("me"));
        const seat = plate.querySelector<HTMLElement>("[data-seat-plate]");
        expect(seat).toBeTruthy();
        expect(seat!.className).toContain("h-11");
        expect(seat!.className).toContain("w-11");
    });

    it("the portrait compact plaque does NOT — its box is 24px by contract", () => {
        ho.portrait = true;
        const plate = renderPlaque(makePlayer("me"));
        expect(plate.querySelector("[data-seat-plate]")).toBeNull();
        expect(plate.className).toContain("py-0.5");
    });

    it("the landscape-compact plaque does NOT either", () => {
        viewportHolder.mode = "landscape-compact";
        const plate = renderPlaque(makePlayer("me"));
        expect(plate.querySelector("[data-seat-plate]")).toBeNull();
    });
});
