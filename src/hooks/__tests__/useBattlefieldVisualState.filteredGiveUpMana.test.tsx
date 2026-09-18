// The board's payment-clickability gate for a FILTERED give-up mana source
// (CR 605.1a / 605.3a, issue #3047).
//
// `tapSourceIntoPayment` accepts Ashnod's Altar mid-cast (issue #3455 taught it
// to park on the victim pick and commit inline), but the board decides on its
// own whether the permanent is clickable while a cost is being paid, and every
// probe it had answers "no" for this shape: `getActivatedManaColor` (no {T}),
// `hasFixedSacrificeManaAbility` (the source does not sacrifice ITSELF),
// `hasFixedMultiColorTapManaAbility` (no {T} again) and `getManaChoices` (one
// fixed output). Offered by the server and dead on the board is the ADR 0068
// divergence the other way round — and the mid-cast activation CR 605.3a grants
// would be unreachable by a click.
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
import { getCardByName } from "../../../convex/cards";
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

/** p1 mid-payment for a generic spell, with `defId` untapped on their
 *  battlefield beside `victims` creatures, projected exactly as the wire
 *  delivers it. */
function projectBoardMidPayment(
    defId: string,
    victims: number
): {
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
    const creatures = Array.from({ length: victims }, (_, i) =>
        makeInstance(getCardByName("Grizzly Bears").id, {
            id: `bear-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        })
    );
    const spell = makeInstance(getCardByName("Grizzly Bears").id, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [source, ...creatures],
                hand: [spell],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { X: 2 },
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

const sourceOf = (boards: ReturnType<typeof projectBoardMidPayment>) =>
    boards.me.battlefield.find((c) => c.id === "source") as CardInstance;

describe("a filtered give-up mana source is clickable while paying (CR 605.3a, issue #3047)", () => {
    it("Ashnod's Altar is interactive mid-payment with a legal victim", () => {
        const boards = projectBoardMidPayment(
            getCardByName("Ashnod's Altar").id,
            1
        );
        const { result } = renderBoard(boards);
        const source = sourceOf(boards);

        expect(result.current.canInteract(source)).toBe(true);
        expect(result.current.getVisualState(source).enabled).toBe(true);
    });

    it("Phyrexian Altar — the CHOSEN-colour member of the shape — too", () => {
        const boards = projectBoardMidPayment(
            getCardByName("Phyrexian Altar").id,
            1
        );
        const { result } = renderBoard(boards);

        expect(result.current.canInteract(sourceOf(boards))).toBe(true);
    });

    it("with no legal victim it stays uninteractive (CR 602.1a — an unpayable cost)", () => {
        const boards = projectBoardMidPayment(
            getCardByName("Ashnod's Altar").id,
            0
        );
        const { result } = renderBoard(boards);

        expect(result.current.canInteract(sourceOf(boards))).toBe(false);
    });

    it("a permanent with no mana ability at all stays uninteractive", () => {
        // The gate must not have become a blanket "everything is clickable
        // during a payment".
        const boards = projectBoardMidPayment(
            getCardByName("Grizzly Bears").id,
            1
        );
        const { result } = renderBoard(boards);

        expect(result.current.canInteract(sourceOf(boards))).toBe(false);
    });
});
