// Injectable player-nameplate interaction hook (issue #2169, seam C).
//
// `BoardPlayer` used to call `usePlayerInteraction` by name, hardcoded, which
// left the Manual Board no way to reach the nameplate at all — and the
// nameplate itself had no life affordance to reach. Both halves are proven
// here:
//  (a) DEFAULT FALLBACK — with no provider, the real hook is still the one
//      `BoardPlayer` invokes, and the nameplate binds no wheel handler and no
//      editable life. This half is what proves the GRE board is unchanged.
//  (b) PROVIDER OVERRIDE — with a provider, the supplied hook is invoked
//      instead, the real hook is never touched, and the manual life
//      affordances (wheel, click-to-edit, Enter to commit) dispatch the manual
//      life verb.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { Player } from "~/types/game";
import type { PlayerInteraction } from "~/hooks/usePlayerInteraction";
import { GameContext } from "~/hooks/useGameContext";
import { PlayerInteractionProvider } from "~/hooks/usePlayerInteractionContext";
import { makeManualPlayerInteraction } from "~/lib/manual-player-interaction";
import {
    manualRuntime,
    manualSeat,
    manualState,
    spyDispatch,
} from "~/lib/__tests__/manual-test-fixtures";

function stubInteraction(): PlayerInteraction {
    return {
        isMe: true,
        hasPriority: false,
        isTargetable: false,
        isDamageTargetPickable: false,
        isPlayerPicked: false,
        isDivideTarget: false,
        divideAssigned: 0,
        divideCanPlus: false,
        incDivide: () => {},
        decDivide: () => {},
        handleClick: () => {},
    };
}

const realHookSpy = vi.fn((player: Player) => {
    void player;
    return stubInteraction();
});
vi.mock("~/hooks/usePlayerInteraction", () => ({
    usePlayerInteraction: (player: Player) => realHookSpy(player),
}));

vi.mock("~/hooks/useIsPortrait", () => ({ useIsPortrait: () => false }));
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => "desktop",
}));

const { default: BoardPlayer } = await import("../board-player");

function makePlayer(id = "me", life = 20): Player {
    return {
        id,
        name: `${id}-name`,
        bgColor: "#000",
        life,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function makeContext(me: Player): React.ContextType<typeof GameContext> {
    return {
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
        onSwitchGame: () => {},
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
}

beforeEach(() => {
    cleanup();
    realHookSpy.mockClear();
});

describe("injected player interaction hook (#2169)", () => {
    it("absent a provider, the real hook is the one BoardPlayer calls", () => {
        const me = makePlayer();
        const { container } = render(
            <GameContext value={makeContext(me)}>
                <BoardPlayer player={me} side="bottom" />
            </GameContext>
        );
        expect(realHookSpy).toHaveBeenCalledTimes(1);
        expect(realHookSpy).toHaveBeenCalledWith(me);
        // …and the GRE nameplate offers no life affordance whatsoever.
        expect(container.querySelector("[data-life-editable]")).toBeNull();
        expect(container.querySelector("[data-life-input]")).toBeNull();
    });

    it("a provider-supplied hook is what the mounted seat uses", () => {
        const me = makePlayer();
        const fake = vi.fn((player: Player) => {
            void player;
            return stubInteraction();
        });
        render(
            <GameContext value={makeContext(me)}>
                <PlayerInteractionProvider value={fake}>
                    <BoardPlayer player={me} side="bottom" />
                </PlayerInteractionProvider>
            </GameContext>
        );
        expect(fake).toHaveBeenCalledTimes(1);
        expect(fake).toHaveBeenCalledWith(me);
        expect(realHookSpy).not.toHaveBeenCalled();
    });

    it("the manual interaction makes the nameplate's life wheel-adjustable", () => {
        const me = makePlayer("me", 20);
        const dispatch = spyDispatch();
        const runtime = manualRuntime(
            manualState([manualSeat("me"), manualSeat("opp")]),
            dispatch
        );
        const { container } = render(
            <GameContext value={makeContext(me)}>
                <PlayerInteractionProvider
                    value={makeManualPlayerInteraction(runtime)}
                >
                    <BoardPlayer player={me} side="bottom" />
                </PlayerInteractionProvider>
            </GameContext>
        );
        fireEvent.wheel(
            container.querySelector("[data-arrow-anchor-player]")!,
            {
                deltaY: -1,
            }
        );
        expect(dispatch.adjustLife).toHaveBeenCalledWith({
            playerId: "me",
            delta: 1,
        });
        fireEvent.wheel(
            container.querySelector("[data-arrow-anchor-player]")!,
            {
                deltaY: 1,
            }
        );
        expect(dispatch.adjustLife).toHaveBeenLastCalledWith({
            playerId: "me",
            delta: -1,
        });
    });

    it("the manual interaction makes the nameplate's life click-to-type", () => {
        const me = makePlayer("me", 20);
        const dispatch = spyDispatch();
        const runtime = manualRuntime(
            manualState([manualSeat("me"), manualSeat("opp")]),
            dispatch
        );
        const { container } = render(
            <GameContext value={makeContext(me)}>
                <PlayerInteractionProvider
                    value={makeManualPlayerInteraction(runtime)}
                >
                    <BoardPlayer player={me} side="bottom" />
                </PlayerInteractionProvider>
            </GameContext>
        );
        fireEvent.click(container.querySelector("[data-life-editable]")!);
        const input = screen.getByLabelText("Life total") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "13" } });
        fireEvent.keyDown(input, { key: "Enter" });
        // 20 → 13 is a delta of −7: the manual verb is relative, so the
        // nameplate must convert an EXACT total into one.
        expect(dispatch.adjustLife).toHaveBeenCalledWith({
            playerId: "me",
            delta: -7,
        });
    });
});
