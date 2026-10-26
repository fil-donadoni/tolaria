// Payment Park click precedence (CR 605.3a): while a sacrifice pick is
// parked, a click on a legal candidate that ALSO has a mana ability must submit
// `selectSacrifice`, never open the mana-choice picker. Drives the REAL
// `useBattlefieldInteraction` reducer through `handleClickWithEvent`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const selectSacrifice = vi.fn<MutFn>(() => Promise.resolve());
const activateManaAbility = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    selectSacrifice,
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

// Treasure-shaped: a choice-based mana ability, so `getManaChoices` is non-null.
const VIVI_DEF = {
    id: "vivi-def",
    name: "Treasure",
    activatedAbilities: [
        {
            id: "treasure-mana",
            oracleText: "Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            getManaChoices: () => [{ R: 1 }, { U: 1 }],
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

function vivi(id = "vivi1"): CardInstance {
    return {
        id,
        card: { id: "vivi-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: ["Wizard"],
        staticAbilities: [],
        power: 0,
        toughness: 3,
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

function renderInteraction(me: Player, extra: Record<string, unknown>) {
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
        ...extra,
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
    return { ...render(<Harness />, { wrapper }), handle };
}

const PARKED_SACRIFICE = {
    playerId: "me",
    cardInstanceId: "src",
    abilityId: "boast",
    manaCost: {},
    sacrificeSelection: {
        playerId: "me",
        reason: "Sacrifice a creature",
        requirements: [{ filter: { types: ["Creature"] }, count: 1 }],
        picked: [],
    },
};

describe("useBattlefieldInteraction — parked sacrifice vs mana-choice picker (issue #3076)", () => {
    beforeEach(() => {
        tapUntap.mockClear();
        selectSacrifice.mockClear();
        cleanup();
    });

    it("a legal sacrifice candidate with a mana ability submits the pick, no picker", () => {
        const me = player("me", [vivi("cand")]);
        const { handle } = renderInteraction(me, {
            pendingActivation: PARKED_SACRIFICE,
        });
        act(() => {
            handle.current!.handleClickWithEvent(vivi("cand"), {
                clientX: 0,
                clientY: 0,
            } as never);
        });
        expect(selectSacrifice).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll("button")).toHaveLength(0);
    });
});
