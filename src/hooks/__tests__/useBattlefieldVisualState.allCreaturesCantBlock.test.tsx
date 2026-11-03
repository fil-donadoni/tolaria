// Frontend wiring for the GAME-scoped "creatures can't block this turn"
// restriction (CR 509.1a / 611.2c — Chaos, of Order // Chaos).
//
// The GRE refuses every block while `GameState.allCreaturesCantBlockThisTurn`
// stands; the board must gray every would-be blocker out instead of offering
// a click the server rejects. Driven THROUGH the real reducers: Chaos resolves
// on a real GameState, `projectPublicState` carries the flag over the wire,
// and the real `useBattlefieldVisualState` reads it from the context the
// board forwards it into (`.claude/rules/gre-development.md` § Frontend
// wiring analysis).
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../convex/cards/__tests__/setup.helper";
import { projectPublicState } from "../../../convex/gameProjections";
import { resolveTopOfStack } from "../../../convex/gre/state";
import { getDefinition } from "../../../convex/cards/index";
import { splitHalfDefinitionId } from "../../../convex/cards/splitCard";
import { grizzlyBears } from "../../../convex/cards/sets/lea/green.cards";

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
    }),
}));

type Ctx = React.ContextType<typeof GameContext>;

const ORDER_CHAOS = "14e4f5a4-b1ea-4816-b2d7-cf148468a388";

/** `me` attacks with `a`; `opp` holds `x`. Chaos resolves (or not), then the
 *  board is what the client receives through `projectPublicState`. */
function projectAfter(castChaos: boolean) {
    const bear = (id: string, controller: string) =>
        makeInstance(grizzlyBears().id, {
            id,
            controllerId: controller,
            ownerId: controller,
            isSummoningSick: false,
        });
    const state = makeState({
        activePlayerId: "me",
        priorityPlayerId: "me",
        players: [
            makePlayer("me", { battlefield: [bear("a", "me")] }),
            makePlayer("opp", { battlefield: [bear("x", "opp")] }),
        ],
    });
    if (castChaos) {
        const chaos = getDefinition(
            splitHalfDefinitionId(ORDER_CHAOS, "right")
        );
        pushSpell(state, chaos.id, "me");
        resolveTopOfStack(state);
    }
    const projected = projectPublicState(state, 1, "opp");
    return {
        me: projected.players[0] as unknown as Player,
        opp: projected.players[1] as unknown as Player,
        allCreaturesCantBlockThisTurn: projected.allCreaturesCantBlockThisTurn,
    };
}

function renderOppBoard(boards: ReturnType<typeof projectAfter>) {
    const ctx = {
        gameId: "game-id" as never,
        playerId: "opp",
        activePlayerId: "me",
        priorityPlayerId: "opp",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [boards.me, boards.opp],
        showAllCards: false,
        debugAllActions: false,
        phase: "DECLARE_BLOCKERS",
        combat: {
            attackerIds: ["a"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
        // Forwarded exactly as `board.tsx` forwards the wire field.
        allCreaturesCantBlockThisTurn: boards.allCreaturesCantBlockThisTurn,
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    return renderHook(() => useBattlefieldVisualState(boards.opp), {
        wrapper,
    });
}

describe("creatures can't block this turn on the board (CR 509.1a / 611.2c)", () => {
    it("after Chaos resolves, an untapped would-be blocker is NOT clickable", () => {
        const boards = projectAfter(true);
        const { result } = renderOppBoard(boards);
        const x = boards.opp.battlefield[0] as CardInstance;

        expect(result.current.canInteract(x)).toBe(false);
        expect(result.current.getVisualState(x).enabled).toBe(false);
    });

    it("without Chaos the SAME blocker is clickable", () => {
        const boards = projectAfter(false);
        const { result } = renderOppBoard(boards);
        const x = boards.opp.battlefield[0] as CardInstance;

        expect(result.current.canInteract(x)).toBe(true);
    });
});
