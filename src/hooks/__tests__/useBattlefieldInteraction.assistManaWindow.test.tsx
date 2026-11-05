// The player Assist named (CR 702.132a / 605.3a) activates mana abilities while
// someone ELSE's `pendingCast` stands: the REAL hook must keep their mana abilities
// live, through the same mutations a may-pay window uses, and leave the caster's
// payment mutations alone.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const tapForPayment = vi.fn<MutFn>(() => Promise.resolve());
const activateManaAbility = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    tapForPayment,
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
        // The caster's turn and priority: the named player holds neither.
        activePlayerId: "opp",
        priorityPlayerId: "opp",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        pendingChoices,
        pendingCast: {
            playerId: "opp",
            cardInstanceId: "spell",
            manaCost: { X: 4, W: 1 },
            tappedLandIds: [],
        },
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

const ASSIST_WINDOW = {
    stackItemId: "",
    choiceId: "assist:mana",
    kind: "number-pick",
    playerId: "me",
    paysMana: true,
    numberMax: 0,
    assistPayment: {
        stage: "mana",
        spellCardId: "spell",
        spellTypes: ["Creature"],
        spellSupertypes: [],
    },
};

describe("useBattlefieldInteraction — the player Assist named (CR 702.132a)", () => {
    beforeEach(() => {
        tapUntap.mockClear();
        tapForPayment.mockClear();
        activateManaAbility.mockClear();
        cleanup();
    });

    it("offers their mana ability though another player's cast is being paid", () => {
        const me = player("me", [wall()]);
        const { handle } = renderInteraction(me, [ASSIST_WINDOW]);
        expect(handle.current!.getActivatable(wall())).toHaveLength(1);
    });

    it("a click activates it through the mana-window mutation, not the caster's", () => {
        const me = player("me", [wall()]);
        const { handle } = renderInteraction(me, [ASSIST_WINDOW]);
        act(() => {
            handle.current!.handleClick(wall());
        });
        expect(tapForPayment).not.toHaveBeenCalled();
        expect(activateManaAbility).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "wall1",
            abilityId: "wall-of-roots-mana",
        });
    });

    it("the same pending cast with no Assist step open offers nothing", () => {
        const me = player("me", [wall()]);
        const { handle } = renderInteraction(me, []);
        expect(handle.current!.getActivatable(wall())).toEqual([]);
    });
});
