// Frontend wiring for "can't be blocked this turn except by <filter>" (CR 509.1b,
// issue #8168): the board grays out a would-be blocker the server refuses, and
// offers only the legal attackers to a picked blocker. Driven through
// `projectPublicState` and the real `useBattlefieldVisualState`.
import { beforeAll, describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup.helper";
import { projectPublicState } from "../../../convex/gameProjections";
import { preloadDefinitions } from "../../../convex/cards/registry";
import type { CardDefinition } from "../../../convex/cards/types";

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

const creature = (slug: string, keywords: string[] = []): CardDefinition => ({
    id: `test-evasion-exception-${slug}`,
    name: `Test Evasion Exception ${slug}`,
    rarity: "common",
    manaCost: { generic: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: keywords,
});

const ATTACKER = creature("attacker");
const HASTY = creature("hasty", ["haste"]);
const PLAIN = creature("plain");

beforeAll(() => preloadDefinitions([ATTACKER, HASTY, PLAIN]));

const body = (
    def: CardDefinition,
    id: string,
    controller: string,
    extra: Partial<Parameters<typeof makeInstance>[1]> = {}
) =>
    makeInstance(def.id, {
        id,
        controllerId: controller,
        ownerId: controller,
        isSummoningSick: false,
        ...extra,
    });

const GRANT = { cantBeBlockedExceptByThisTurn: [{ requireAbility: "haste" }] };

/** `me` attacks with `a`; `opp` declares, optionally with `x` already picked. */
function render(
    attackerExtra: Partial<Parameters<typeof makeInstance>[1]>,
    blockerDef: CardDefinition,
    pendingBlockerId?: string
) {
    const state = makeState({
        activePlayerId: "me",
        priorityPlayerId: "me",
        players: [
            makePlayer("me", {
                battlefield: [
                    body(ATTACKER, "a", "me", {
                        isAttacking: true,
                        ...attackerExtra,
                    }),
                ],
            }),
            makePlayer("opp", {
                battlefield: [body(blockerDef, "x", "opp")],
            }),
        ],
    });
    const projected = projectPublicState(state, 1, "opp");
    const me = projected.players[0] as unknown as Player;
    const opp = projected.players[1] as unknown as Player;
    const ctx = {
        gameId: "game-id" as never,
        playerId: "opp",
        activePlayerId: "me",
        priorityPlayerId: "opp",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [me, opp],
        showAllCards: false,
        debugAllActions: false,
        phase: "DECLARE_BLOCKERS",
        combat: {
            attackerIds: ["a"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
            ...(pendingBlockerId ? { pendingBlockerId } : {}),
        },
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    const blockerBoard = renderHook(() => useBattlefieldVisualState(opp), {
        wrapper,
    }).result.current;
    const attackerBoard = renderHook(() => useBattlefieldVisualState(me), {
        wrapper,
    }).result.current;
    return {
        blockerClickable: blockerBoard.canInteract(
            opp.battlefield.find((c) => c.id === "x") as CardInstance
        ),
        attackerClickable: attackerBoard.canInteract(
            me.battlefield.find((c) => c.id === "a") as CardInstance
        ),
    };
}

describe("evasion exception on the block board (CR 509.1b)", () => {
    it("a blocker without the keyword is NOT clickable", () => {
        expect(render(GRANT, PLAIN).blockerClickable).toBe(false);
    });

    it("a blocker with the keyword is clickable", () => {
        expect(render(GRANT, HASTY).blockerClickable).toBe(true);
    });

    it("no grant leaves the plain blocker clickable", () => {
        expect(render({}, PLAIN).blockerClickable).toBe(true);
    });

    it('a plain "can\'t be blocked this turn" grays the blocker out too', () => {
        expect(
            render({ cantBeBlockedThisTurn: true }, HASTY).blockerClickable
        ).toBe(false);
    });

    it("a picked blocker can target only an attacker it may legally block", () => {
        expect(render(GRANT, PLAIN, "x").attackerClickable).toBe(false);
        expect(render(GRANT, HASTY, "x").attackerClickable).toBe(true);
    });
});
