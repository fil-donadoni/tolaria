// A tap-less mana ability (Wall of Roots' placed counter) during a may-pay
// choice (issue #7387, CR 605.3a / 608.2g): the REAL hook must offer it in the
// ability menu and route a plain click to `activateManaAbility` — never to
// `tapUntap`, which would tap the source for nothing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const activateManaAbility = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    activateManaAbility,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
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

const VIVI_DEF = {
    id: "vivi-def",
    name: "Wall of Roots",
    activatedAbilities: [
        {
            id: "wall-of-roots-mana",
            oracleText:
                "Put a -0/-1 counter on this creature: Add {G}. Activate only once each turn.",
            cost: { addCounter: { type: "-0/-1", count: 1 } },
            useStack: false,
            manaProduced: { G: 1 },
            oncePerTurn: true,
        },
    ],
};
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, () => VIVI_DEF),
    getDefinition: () => VIVI_DEF,
    tryGetDefinition: () => VIVI_DEF,
}));

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

// Import AFTER mocks are registered.
import { useBattlefieldInteraction } from "../useBattlefieldInteraction";

function wall(): CardInstance {
    return {
        id: "wall1",
        card: { id: "vivi-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: ["Plant", "Wall"],
        staticAbilities: [],
        power: 0,
        toughness: 5,
    } as CardInstance;
}

function player(id: string, battlefield: CardInstance[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as Player;
}

type Interaction = ReturnType<typeof useBattlefieldInteraction>;

/** Mounts the REAL hook + its `overlays` (where `ManaChoicePicker` lives) and
 *  exposes the latest interaction handle via a ref so a test can call
 *  `handleActivateAbility` and then inspect the picker DOM the resulting
 *  `overlays` re-render produces. */
function renderInteraction(me: Player, pendingChoices: unknown[] = []) {
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
        pendingChoices,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;

    const handle: { current: Interaction | null } = { current: null };
    function Harness() {
        const interaction = useBattlefieldInteraction(me);
        const ref = useRef(interaction);
        ref.current = interaction;
        handle.current = interaction;
        return <>{interaction.overlays}</>;
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    const utils = render(<Harness />, { wrapper });
    return { ...utils, handle };
}

const MAY_PAY = {
    id: "choice-1",
    kind: "may-pay",
    playerId: "me",
    cost: { X: 1 },
};

describe("useBattlefieldInteraction — tap-less mana ability during a may-pay choice (issue #7387)", () => {
    beforeEach(() => {
        tapUntap.mockClear();
        activateManaAbility.mockClear();
        cleanup();
    });

    it("getActivatable offers the mana ability while the may-pay is open", () => {
        const me = player("me", [wall()]);
        const { handle } = renderInteraction(me, [MAY_PAY]);
        expect(handle.current!.getActivatable(wall())).toEqual([
            {
                id: "wall-of-roots-mana",
                oracleText:
                    "Put a -0/-1 counter on this creature: Add {G}. Activate only once each turn.",
            },
        ]);
    });

    it("a plain click activates the mana ability and never taps the source", () => {
        const me = player("me", [wall()]);
        const { handle } = renderInteraction(me, [MAY_PAY]);
        act(() => {
            handle.current!.handleClick(wall());
        });
        expect(tapUntap).not.toHaveBeenCalled();
        expect(activateManaAbility).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "wall1",
            abilityId: "wall-of-roots-mana",
        });
    });

    it("a non-mana-payment choice still suppresses the menu", () => {
        const me = player("me", [wall()]);
        const { handle } = renderInteraction(me, [
            { id: "c", kind: "keep-permanents", playerId: "me" },
        ]);
        expect(handle.current!.getActivatable(wall())).toEqual([]);
    });
});
