// The waterbend picker on the board (CR 701.67a), driven from a real GRE state
// through the real `projectPublicState`: the picker reads "paid" from its first
// moment, so a gate keyed on `isTapOtherChoicePaid` alone leaves it dead. It is
// also not modal, because the mana leg stays payable beside it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup.helper";
import { getCardByName } from "../../../convex/cards";
import { projectPublicState } from "../../../convex/gameProjections";
import {
    activateAbilityOnState,
    selectActivationCostOnState,
} from "../../../convex/game";
import type { GameState } from "../../../convex/gre/state";

type MutFn = (args?: Record<string, unknown>) => Promise<void>;
const selectActivationCost = vi.fn<MutFn>(() => Promise.resolve());
const tapForActivationPayment = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    selectActivationCost,
    tapForActivationPayment,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => {
    const game = new Proxy(
        {},
        { get: (_t, name) => ({ _name: String(name) }) }
    );
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

// Import AFTER mocks are registered.
import { useBattlefieldInteraction } from "../useBattlefieldInteraction";

const on = (name: string, id: string, overrides = {}) =>
    makeInstance(getCardByName(name).id, {
        id,
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        ...overrides,
    });

function announced(): GameState {
    const state = makeState({
        players: [
            makePlayer("me", {
                battlefield: [
                    on("Aang's Iceberg", "iceberg"),
                    on("Grizzly Bears", "bear"),
                    on("Llanowar Elves", "sickElf", { isSummoningSick: true }),
                    on("Llanowar Elves", "elf"),
                    on("Sol Ring", "ring"),
                    on("Ornithopter", "thopter"),
                    on("Mountain", "mountain"),
                ],
            }),
            makePlayer("opp"),
        ],
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    activateAbilityOnState(state, {
        playerId: "me",
        cardInstanceId: "iceberg",
        abilityId: "aangs-iceberg-waterbend",
    });
    return state;
}

type Interaction = ReturnType<typeof useBattlefieldInteraction>;

function mount(state: GameState) {
    const view = projectPublicState(state, 1, "me");
    const me = view.players[0] as unknown as Player;
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
        allPlayers: view.players,
        pendingActivation: view.pendingActivation,
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;
    const handle: { current: Interaction | null } = { current: null };
    function Harness() {
        handle.current = useBattlefieldInteraction(me);
        return null;
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    render(<Harness />, { wrapper });
    const card = (id: string) =>
        me.battlefield.find((c) => c.id === id) as CardInstance;
    return { handle: handle.current!, card };
}

describe("waterbend picker on the board (CR 701.67a)", () => {
    beforeEach(() => {
        selectActivationCost.mockClear();
        tapForActivationPayment.mockClear();
        cleanup();
    });

    it("a creature with no mana ability is clickable, and the click is the pick", () => {
        const { handle, card } = mount(announced());
        expect(handle.canInteract(card("bear"))).toBe(true);
        act(() => handle.handleClick(card("bear")));
        expect(selectActivationCost).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "bear",
        });
        expect(tapForActivationPayment).not.toHaveBeenCalled();
    });

    it("a mana-less artifact creature and a summoning-sick mana creature are picks", () => {
        const { handle, card } = mount(announced());
        act(() => handle.handleClick(card("thopter")));
        act(() => handle.handleClick(card("sickElf")));
        expect(
            selectActivationCost.mock.calls.map((c) => c[0]?.cardInstanceId)
        ).toEqual(["thopter", "sickElf"]);
    });

    it("the picker is not modal: a land still pays the mana leg", () => {
        const { handle, card } = mount(announced());
        expect(handle.canInteract(card("mountain"))).toBe(true);
        act(() => handle.handleClick(card("mountain")));
        expect(selectActivationCost).not.toHaveBeenCalled();
        expect(tapForActivationPayment).toHaveBeenCalledTimes(1);
    });

    it("a free mana source taps for mana, so a Sol Ring pays its two", () => {
        const { handle, card } = mount(announced());
        expect(handle.canInteract(card("ring"))).toBe(true);
        act(() => handle.handleClick(card("ring")));
        expect(selectActivationCost).not.toHaveBeenCalled();
        expect(tapForActivationPayment).toHaveBeenCalledTimes(1);
    });

    it("the source is not a candidate, and a pick already made is spoken for", () => {
        const state = announced();
        selectActivationCostOnState(state, {
            playerId: "me",
            cardInstanceId: "ring",
        });
        const { handle, card } = mount(state);
        expect(handle.canInteract(card("iceberg"))).toBe(false);
        expect(handle.canInteract(card("ring"))).toBe(false);
    });

    it("offered with no eligible permanent at all: mana can pay it (the tap is a 'may')", () => {
        const state = makeState({
            players: [
                makePlayer("me", {
                    battlefield: [on("Aang's Iceberg", "iceberg")],
                }),
                makePlayer("opp"),
            ],
            activePlayerId: "me",
            priorityPlayerId: "me",
        });
        const { handle, card } = mount(state);
        expect(
            handle.getActivatable(card("iceberg")).map((a) => a.id)
        ).toContain("aangs-iceberg-waterbend");
    });

    it("with no generic left to substitute the board is a plain mana payment", () => {
        const state = announced();
        state.pendingActivation!.manaCost = { R: 1 };
        const { handle, card } = mount(state);
        expect(handle.canInteract(card("bear"))).toBe(false);
        expect(handle.canInteract(card("mountain"))).toBe(true);
    });
});
