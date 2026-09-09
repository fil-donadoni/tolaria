// The board's payment-clickability gate for a multi-colour fixed TAP mana
// source (CR 605.1a, issue #3263).
//
// The server now accepts such a source in `tapSourceIntoPayment`, but the board
// decides on its own whether the permanent is clickable while a cost is being
// paid, and it decided with three probes that all answer "no" for this shape:
// `getActivatedManaColor` (a single `Color`, so null for {W}{B}),
// `hasFixedSacrificeManaAbility` (TAP-LESS sacrifice costs only) and
// `getManaChoices` (choosers only). Offered by the server and dead on the board
// is the ADR 0068 divergence the other way round.
//
// Asserted THROUGH the real reducers — a real GRE `GameState`, the real
// `projectPublicState`, fed into the real `useBattlefieldVisualState`. A
// hand-built view would mask a dropped field
// (`.claude/rules/gre-development.md` § Frontend wiring analysis).

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
} from "../../../convex/cards/__tests__/setup";
import { getCardByName, preloadDefinitions } from "../../../convex/cards";
import type { CardDefinition } from "../../../convex/cards/types";
import { projectPublicState } from "../../../convex/gameProjections";

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

/** "{T}: Add {W}{B}." — no catalogue card is this shape (the Invasion "Vent"
 *  lands pair theirs with a single-colour `{T}: Add {U}`), and it is reachable
 *  in production only through a GRANTED ability, so the subject is a test-only
 *  definition shadowing no catalogue id. Engine side:
 *  `convex/__tests__/multiColorFixedTapMana.test.ts`. */
const PRISM_VENT_ID = "test-3263-hook-prism-vent";

preloadDefinitions([
    {
        id: PRISM_VENT_ID,
        name: "Test Prism Vent",
        rarity: "common",
        oracleText: "{T}: Add {W}{B}.",
        manaCost: {},
        types: ["Land"],
        activatedAbilities: [
            {
                id: "test-3263-hook-prism-vent-tap",
                oracleText: "{T}: Add {W}{B}.",
                cost: { tap: true },
                useStack: false,
                manaProduced: { W: 1, B: 1 },
            },
        ],
    } as CardDefinition,
]);

/** p1 mid-payment for a {W}{B} spell, with `defId` untapped on their
 *  battlefield, projected for p1 exactly as the wire delivers it. */
function projectBoardMidPayment(defId: string): {
    me: Player;
    opp: Player;
    pendingCast: NonNullable<Ctx>["pendingCast"];
} {
    const source = makeInstance(defId, {
        id: "source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const spell = makeInstance(getCardByName("Grizzly Bears").id, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [source], hand: [spell] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { W: 1, B: 1 },
            tappedLandIds: [],
        },
    });
    const projected = projectPublicState(state, 1, "p1");
    return {
        me: projected.players[0] as unknown as Player,
        opp: projected.players[1] as unknown as Player,
        pendingCast: projected.pendingCast as NonNullable<Ctx>["pendingCast"],
    };
}

function renderBoard(boards: ReturnType<typeof projectBoardMidPayment>) {
    const ctx = {
        gameId: "game-id" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [boards.me, boards.opp],
        pendingCast: boards.pendingCast,
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    return renderHook(() => useBattlefieldVisualState(boards.me), { wrapper });
}

describe("multi-colour fixed TAP mana source is clickable while paying (CR 605.1a, issue #3263)", () => {
    it("the {W}{B} source is interactive mid-payment", () => {
        const boards = projectBoardMidPayment(PRISM_VENT_ID);
        const { result } = renderBoard(boards);
        const source = boards.me.battlefield[0] as CardInstance;

        expect(source.id).toBe("source");
        expect(result.current.canInteract(source)).toBe(true);
        expect(result.current.getVisualState(source).enabled).toBe(true);
    });

    it("a single-colour source is still interactive (the gate only widened)", () => {
        const boards = projectBoardMidPayment(getCardByName("Forest").id);
        const { result } = renderBoard(boards);
        const source = boards.me.battlefield[0] as CardInstance;

        expect(result.current.canInteract(source)).toBe(true);
    });

    it("a permanent with no mana ability at all stays uninteractive", () => {
        // Grizzly Bears taps for nothing — the gate must not have become a
        // blanket "everything is clickable during a payment".
        const boards = projectBoardMidPayment(
            getCardByName("Grizzly Bears").id
        );
        const { result } = renderBoard(boards);
        const source = boards.me.battlefield[0] as CardInstance;

        expect(result.current.canInteract(source)).toBe(false);
    });
});
