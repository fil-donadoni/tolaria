// Frontend wiring for Annihilator N's forced sacrifice (CR 702.86a, issue
// #2295).
//
// The keyword is correct in the GRE the moment the trigger resolves and raises
// a `sacrifice-permanents` Pending Choice — and still dead on the board if the
// defending player has nothing to click. The choice is TRIGGER-sourced and
// carries NO filter (CR 702.86a: "N permanents", any type, their choice), a
// shape no shipped card produces today: every existing `sacrifice-permanents`
// choice is either type-filtered (Portal to Phyrexia) or `candidates`-narrowed
// (Barrin's Spite). So the affordance is asserted here, and asserted THROUGH
// the real reducers — a real GRE `GameState`, the real trigger scan, the real
// `resolveTopOfStack`, the real `projectPublicState`, fed into the real
// `useBattlefieldVisualState`. A hand-built view would mask a dropped field
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
import type { GameEvent } from "../../../convex/cards/types";
import { resolveTopOfStack } from "../../../convex/gre/state";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../convex/gre/triggers";
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

const ANNIHILATOR_CARD_ID = "synthetic-annihilator-ui";

preloadDefinitions([
    {
        id: ANNIHILATOR_CARD_ID,
        name: "Synthetic Annihilator",
        rarity: "mythic",
        manaCost: { X: 15 },
        types: ["Creature"],
        subtypes: ["Eldrazi"],
        power: 15,
        toughness: 15,
        staticAbilities: ["annihilator 3"],
    } as CardDefinition,
]);

/** Runs the whole server-side path — declare attackers, collect + place the
 *  CR 702.86a annihilator trigger, resolve it into a suspended Pending Choice — then
 *  projects the result for the DEFENDING player, exactly as the wire delivers
 *  it. `defenderCards` is a deliberately mixed set of permanent types. */
function projectDefenderBoardMidChoice(): {
    me: Player;
    opp: Player;
    pendingChoices: NonNullable<Ctx>["pendingChoices"];
} {
    const attacker = makeInstance(ANNIHILATOR_CARD_ID, {
        id: "atk",
        controllerId: "p1",
        ownerId: "p1",
    });
    const defenderPermanents = [
        getCardByName("Forest").id,
        getCardByName("Black Lotus").id,
        getCardByName("Crusade").id,
        getCardByName("Grizzly Bears").id,
    ].map((cardId, i) =>
        makeInstance(cardId, {
            id: `d${i}`,
            controllerId: "p2",
            ownerId: "p2",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2", { battlefield: defenderPermanents }),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        combat: {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    const event: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: "p1",
        attackerIds: ["atk"],
    };
    placeTriggersOnStack(state, collectTriggers(state, [event]));
    expect(state.stack).toHaveLength(1);
    // Suspends on the sacrifice choice.
    expect(resolveTopOfStack(state)).toBeNull();

    const projected = projectPublicState(state, 1, "p2");
    return {
        me: projected.players[1] as unknown as Player,
        opp: projected.players[0] as unknown as Player,
        pendingChoices:
            projected.pendingChoices as NonNullable<Ctx>["pendingChoices"],
    };
}

function renderDefenderBoard(
    boards: ReturnType<typeof projectDefenderBoardMidChoice>
) {
    const ctx = {
        gameId: "game-id" as never,
        playerId: "p2",
        activePlayerId: "p1",
        priorityPlayerId: "p2",
        phase: "DECLARE_ATTACKERS",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [boards.me, boards.opp],
        pendingChoices: boards.pendingChoices,
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    return renderHook(() => useBattlefieldVisualState(boards.me), { wrapper });
}

describe("Annihilator N sacrifice affordance on the board (CR 702.86a, issue #2295)", () => {
    it("the trigger-sourced choice reaches the defender's board unfiltered", () => {
        const boards = projectDefenderBoardMidChoice();
        const head = boards.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p2");
        expect(head.count).toBe(3);
        // The filter-less shape is what makes every permanent type eligible;
        // a `filter` here would gray out the land / artifact / enchantment.
        expect(head.filter).toBeUndefined();
        expect(head.zone).toBe("battlefield");
    });

    it("EVERY permanent type the defender controls is clickable and highlighted", () => {
        const boards = projectDefenderBoardMidChoice();
        const { result } = renderDefenderBoard(boards);
        const permanents = boards.me.battlefield as CardInstance[];
        // Forest (Land), Black Lotus (Artifact), Crusade (Enchantment),
        // Grizzly Bears (Creature) — CR 702.86a is "N permanents", not
        // "N creatures".
        expect(permanents).toHaveLength(4);
        for (const card of permanents) {
            expect(result.current.canInteract(card)).toBe(true);
            expect(result.current.getVisualState(card).enabled).toBe(true);
        }
    });

    it("the ATTACKING player's board is not a pick surface (the choice is the defender's)", () => {
        const boards = projectDefenderBoardMidChoice();
        const ctx = {
            gameId: "game-id" as never,
            playerId: "p1",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            phase: "DECLARE_ATTACKERS",
            turn: 1,
            engineTurn: 1,
            stackCount: 0,
            allPlayers: [boards.opp, boards.me],
            pendingChoices: boards.pendingChoices,
            showAllCards: false,
            debugAllActions: false,
        } as unknown as NonNullable<Ctx>;
        const wrapper = ({ children }: { children: ReactNode }) => (
            <GameContext value={ctx}>{children}</GameContext>
        );
        const { result } = renderHook(
            () => useBattlefieldVisualState(boards.opp),
            { wrapper }
        );
        const attacker = boards.opp.battlefield[0] as CardInstance;
        expect(result.current.canInteract(attacker)).toBe(false);
    });
});
