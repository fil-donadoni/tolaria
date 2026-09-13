// Issue #3190 — a battlefield render must build the ability state view a
// number of times INDEPENDENT of the permanent count.
//
// `BoardBattlefield` / `BattlefieldStackFan` call `renderCard(card)` for every
// permanent, and `renderCard` → `getActivatable(card)` → the hook's ability
// state view. That view is a board-wide `buildTriggerStateView` build, so a
// per-card call made one render do N of them (each itself O(N) over the
// battlefield). Measured on the UI stress board (83 permanents): the
// `renderCard` path was ~60% of a ~480 ms dev commit / ~300 ms production
// longtask per server push.
//
// Driven through the REAL `useBattlefieldInteraction` hook on a board built by
// `projectPublicState` — the count is taken with a COUNTING WRAPPER around the
// real `buildTriggerStateView` (a spy, not a fake: the real reducer still
// runs), because the number of builds is not observable from the hook's
// return value.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

const counter = vi.hoisted(() => ({ builds: 0 }));

vi.mock("~/lib/card-utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/card-utils")>();
    return {
        ...actual,
        buildTriggerStateView: (
            ...args: Parameters<typeof actual.buildTriggerStateView>
        ) => {
            counter.builds += 1;
            return actual.buildTriggerStateView(...args);
        },
    };
});

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const noop = vi.fn<MutFn>(() => Promise.resolve());

vi.mock("convex/react", () => ({
    useMutation: () => noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => {
    const names = [
        "tapUntap",
        "tapForPayment",
        "untapForPayment",
        "tapForActivationPayment",
        "untapForActivationPayment",
        "tapArtifactForImprovise",
        "untapArtifactForImprovise",
        "tapForAttackTax",
        "untapForAttackTax",
        "toggleAttacker",
        "selectBlocker",
        "assignBlockerTarget",
        "selectTarget",
        "selectAdditionalCost",
        "selectActivationCost",
        "selectSacrifice",
        "activateAbility",
        "activateManaAbility",
        "getFullState",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        reportError: vi.fn(),
        dismissError: vi.fn(),
    }),
}));

import { registerTokenDefinition } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { useBattlefieldInteraction } from "../useBattlefieldInteraction";

// Id distinct from the sibling suites: vitest may reuse a worker and the card
// registry is process-wide.
const BEAR_ID = "hook-3190-vanilla-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: "Test Hook Vanilla Bear",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

/** A board of N vanilla creatures AS THE CLIENT SEES IT — through
 *  `projectPublicState`, never a hand-built instance. */
function projectedBoard(permanentCount: number): {
    me: Player;
    cards: CardInstance[];
} {
    const battlefield = Array.from({ length: permanentCount }, (_, i) =>
        makeInstance(BEAR_ID, {
            id: `bear-${i}`,
            controllerId: "me",
            ownerId: "me",
            isSummoningSick: false,
        })
    );
    const state = makeState({
        players: [makePlayer("me", { battlefield }), makePlayer("them")],
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    const wire = projectPublicState(state, 1, "me");
    const me = wire.players[0] as unknown as Player;
    return { me, cards: me.battlefield };
}

type Interaction = ReturnType<typeof useBattlefieldInteraction>;

function renderInteraction(me: Player) {
    const ctx = {
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
        debugAllActions: false,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;

    const handle: { current: Interaction | null } = { current: null };
    function Harness() {
        handle.current = useBattlefieldInteraction(me);
        return <>{handle.current.overlays}</>;
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    render(<Harness />, { wrapper });
    return handle;
}

/** One battlefield render as the board performs it: mount the hook, then ask
 *  it for every permanent's activatable abilities exactly the way
 *  `renderCard` does, once per card. */
function buildsForOneRender(permanentCount: number): number {
    const { me, cards } = projectedBoard(permanentCount);
    counter.builds = 0;
    const handle = renderInteraction(me);
    for (const card of cards) handle.current!.getActivatable(card);
    return counter.builds;
}

describe("useBattlefieldInteraction — the ability state view is built per RENDER, not per card (issue #3190)", () => {
    beforeEach(() => {
        cleanup();
    });

    it("builds the same number of board-wide views for 2 permanents and for 10", () => {
        const small = buildsForOneRender(2);
        cleanup();
        const large = buildsForOneRender(10);

        // Before the fix `getActivatable` called `abilityStateView()` itself,
        // so the count was the two per-render mana gates PLUS one build per
        // card — 4 vs 12 here. After: the mana gates plus ONE shared ability
        // view, whatever the board holds.
        expect(large).toBe(small);
    });

    it("stays flat on a 40-permanent board (no per-card build survives)", () => {
        const small = buildsForOneRender(2);
        cleanup();
        const stress = buildsForOneRender(40);
        expect(stress).toBe(small);
    });

    it("still offers the same abilities off the shared view", () => {
        // A vanilla creature has no stack ability, so the menu is empty — the
        // point is that the shared view is a REAL view the gate ran against,
        // not an empty stand-in that would make the counts trivially equal.
        const { me, cards } = projectedBoard(3);
        const handle = renderInteraction(me);
        for (const card of cards) {
            expect(handle.current!.getActivatable(card)).toEqual([]);
        }
        expect(counter.builds).toBeGreaterThan(0);
    });
});
