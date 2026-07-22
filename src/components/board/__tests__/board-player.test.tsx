// Player-facing chrome + interaction parity on the spatial board (PRD #249,
// issue #280). The classic life chrome (`PlayerLife`) and the spatial player
// (`BoardPlayer`) BOTH consume the extracted `usePlayerInteraction` hook,
// so clicking a player as a target / damage-choice dispatches the SAME
// GRE-boundary mutation / toggles the SAME buffer on either board:
//   (a) target selection  → selectTarget (targetType "player")
//   (b) damage-target pick → buffer.toggle (Cuombajj Witches, CR 115.4 / 608.2)
// Plus: the spatial board renders both players' life totals + names.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

// Capture the selectTarget mutation so we can compare classic vs spatial args.
const selectTargetSpy = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: () => selectTargetSpy,
}));

import PlayerLife from "../player-life";
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

function makeBuffer(overrides: Partial<PendingChoiceBuffer> = {}) {
    return {
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(async () => {}),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
        ...overrides,
    } as PendingChoiceBuffer;
}

type Ctx = React.ContextType<typeof GameContext>;

function makeContext(overrides: Partial<NonNullable<Ctx>> = {}): Ctx {
    return {
        gameId: "game-id" as never,
        playerId: "p2",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as Ctx;
}

function renderClassic(
    player: Player,
    ctx: Partial<NonNullable<Ctx>>,
    buffer?: PendingChoiceBuffer
) {
    return render(
        <GameContext value={makeContext(ctx)}>
            <PendingChoiceBufferContext value={buffer ?? makeBuffer()}>
                <PlayerLife player={player} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

function renderSpatial(
    player: Player,
    ctx: Partial<NonNullable<Ctx>>,
    side: "top" | "bottom" = "bottom",
    buffer?: PendingChoiceBuffer
) {
    return render(
        <GameContext value={makeContext(ctx)}>
            <PendingChoiceBufferContext value={buffer ?? makeBuffer()}>
                <BoardPlayer player={player} side={side} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

beforeEach(() => {
    selectTargetSpy.mockClear();
    cleanup();
});

describe("board player target parity (#280)", () => {
    // The viewer (p2) is asked to choose a player target; p1 is targetable.
    const targetCtx: Partial<NonNullable<Ctx>> = {
        playerId: "p2",
        pendingTarget: {
            playerId: "p2",
            targetType: "player",
            selected: [],
        } as never,
    };

    it("(a) clicking a player dispatches the SAME selectTarget args on both boards", () => {
        renderClassic(makePlayer("p1"), targetCtx);
        fireEvent.click(
            document.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        const classicArgs = selectTargetSpy.mock.calls[0][0];

        selectTargetSpy.mockClear();
        cleanup();

        const { container } = renderSpatial(makePlayer("p1"), targetCtx, "top");
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        const spatialArgs = selectTargetSpy.mock.calls[0][0];

        expect(spatialArgs).toEqual(classicArgs);
        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "p2",
            targetType: "player",
            targetId: "p1",
        });
    });

    // Regression: Lava Spike's requirement is the ARRAY ["player",
    // "Planeswalker"], not the scalar "player". The player face must still be
    // clickable — a raw === "player" left it inert.
    it("(a2) an array target type ['player','Planeswalker'] still targets the player", () => {
        const arrayCtx: Partial<NonNullable<Ctx>> = {
            playerId: "p2",
            pendingTarget: {
                playerId: "p2",
                targetType: ["player", "Planeswalker"],
                selected: [],
            } as never,
        };
        const { container } = renderSpatial(makePlayer("p1"), arrayCtx, "top");
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(selectTargetSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                targetType: "player",
                targetId: "p1",
            })
        );
    });

    it("a non-targetable player is inert on the spatial board", () => {
        // No pendingTarget → nothing to dispatch.
        const { container } = renderSpatial(makePlayer("p1"), {
            playerId: "p2",
        });
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(selectTargetSpy).not.toHaveBeenCalled();
    });
});

describe("board damage-target choice parity (#280, CR 115.4)", () => {
    // The choice is owed to the viewer (p2 — the opponent doing the choosing);
    // p1 is an eligible candidate.
    const damageChoice = [
        {
            stackItemId: "witches",
            step: 0,
            choiceId: "cuombajj-witches",
            playerId: "p2",
            kind: "choose-damage-target" as const,
            zone: "battlefield" as const,
            allControllers: true,
            count: 1,
            prompt: "Cuombajj Witches: choose any target.",
            candidateIds: ["body-1"],
            candidatePlayerIds: ["p1", "p2"],
        },
    ];

    it("(b) clicking an eligible player toggles the SAME buffer id on both boards", () => {
        const classicBuffer = makeBuffer();
        renderClassic(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: damageChoice as never },
            classicBuffer
        );
        fireEvent.click(
            document.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(classicBuffer.toggle).toHaveBeenCalledWith("p1");
        // Damage-target picks route through the buffer, never selectTarget.
        expect(selectTargetSpy).not.toHaveBeenCalled();

        cleanup();

        const spatialBuffer = makeBuffer();
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: damageChoice as never },
            "top",
            spatialBuffer
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(spatialBuffer.toggle).toHaveBeenCalledWith("p1");
        expect(selectTargetSpy).not.toHaveBeenCalled();
    });

    it("an ineligible player (not a candidate) is inert on the spatial board", () => {
        const spatialBuffer = makeBuffer();
        const onlyP2 = [
            { ...damageChoice[0], candidatePlayerIds: ["p2"] },
        ] as never;
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: onlyP2 },
            "top",
            spatialBuffer
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(spatialBuffer.toggle).not.toHaveBeenCalled();
    });
});

describe("board choose-player choice (CR 115.1a, Endurance #1207)", () => {
    // Endurance's ETB owes a trigger-time player pick to its controller (p2 as
    // the viewer here). The pick routes through the SAME nameplate → buffer path
    // as the damage-target pick, so a `choose-player` choice must light up the
    // candidate players too (zone is "graveyard" — never a battlefield pick).
    const playerChoice = [
        {
            stackItemId: "end1",
            step: 0,
            choiceId: "endurance-etb",
            playerId: "p2",
            kind: "choose-player" as const,
            zone: "graveyard" as const,
            count: { min: 0, max: 1 },
            prompt: "Choose up to one player.",
            candidatePlayerIds: ["p1", "p2"],
        },
    ];

    it("clicking an eligible player toggles the buffer (not selectTarget)", () => {
        const spatialBuffer = makeBuffer();
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: playerChoice as never },
            "top",
            spatialBuffer
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(spatialBuffer.toggle).toHaveBeenCalledWith("p1");
        expect(selectTargetSpy).not.toHaveBeenCalled();
    });

    it("an ineligible player (not a candidate) is inert", () => {
        const spatialBuffer = makeBuffer();
        const onlyP2 = [
            { ...playerChoice[0], candidatePlayerIds: ["p2"] },
        ] as never;
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: onlyP2 },
            "top",
            spatialBuffer
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(spatialBuffer.toggle).not.toHaveBeenCalled();
    });
});

describe("board player life totals (#280)", () => {
    it("renders the life total and name for each player on the spatial board", () => {
        const opp = renderSpatial(
            makePlayer("p1", { life: 17, name: "Opponent" }),
            { playerId: "p2" },
            "top"
        );
        expect(opp.container.textContent).toContain("17");
        expect(opp.container.textContent).toContain("Opponent");

        cleanup();

        const me = renderSpatial(
            makePlayer("p2", { life: 12, name: "Me" }),
            { playerId: "p2" },
            "bottom"
        );
        expect(me.container.textContent).toContain("12");
        expect(me.container.textContent).toContain("Me");
    });

    it("anchors the opponent to the top edge and the viewer to the bottom edge", () => {
        // The edge-positioning class lives on the wrapper that pairs the
        // nameplate with the (restored) mana-pool indicator; the player anchor
        // is the nameplate inside it.
        const top = renderSpatial(makePlayer("p1"), { playerId: "p2" }, "top");
        expect(
            top.container.querySelector(
                '.top-1 [data-arrow-anchor-player="p1"]'
            )
        ).toBeTruthy();

        cleanup();

        const bottom = renderSpatial(
            makePlayer("p2"),
            { playerId: "p2" },
            "bottom"
        );
        expect(
            bottom.container.querySelector(
                '.bottom-1 [data-arrow-anchor-player="p2"]'
            )
        ).toBeTruthy();
    });

    it("centers the nameplate on the play area via the shared utility", () => {
        // Play-area layout rule: the nameplate wrapper centers on the play area
        // (viewport minus the right strip) through the single documented
        // `.play-area-center-x` utility (index.css), combined with the
        // `-translate-x-1/2` half-shift — NOT an inline `left-[calc(...)]`.
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2" },
            "top"
        );
        const wrapper = container.querySelector<HTMLElement>(
            ".play-area-center-x"
        );
        expect(wrapper).toBeTruthy();
        expect(wrapper!.className).toContain("-translate-x-1/2");
    });

    it("no longer shows the Monarch on the nameplate — it moved to a marker tile beside the piles (#1305)", () => {
        // Even when p1 IS the monarch, the nameplate carries no crown badge /
        // 'Monarch' text; the designation renders as a marker-card tile in
        // `board-piles.tsx` (`PlayerMonarchTile`), covered by its own test.
        const classic = renderClassic(makePlayer("p1"), {
            playerId: "p2",
            monarchId: "p1",
        });
        expect(classic.container.textContent).not.toContain("Monarch");
        cleanup();

        const spatial = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", monarchId: "p1" },
            "top"
        );
        expect(spatial.container.textContent).not.toContain("Monarch");
    });

    it("shows a priority ring on the player who holds priority", () => {
        // p1 has priority (default ctx), viewer is p2. The priority ring is a
        // token-based box-shadow (teal `secondary-accent` for both seats),
        // not a chromatic Tailwind ring class (ADR 0007).
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", priorityPlayerId: "p1" },
            "top"
        );
        const plate = container.querySelector<HTMLElement>(
            '[data-arrow-anchor-player="p1"]'
        );
        expect(plate?.style.boxShadow).toContain("--color-secondary-accent");
    });
});
