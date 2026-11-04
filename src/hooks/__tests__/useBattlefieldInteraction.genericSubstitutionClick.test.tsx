// CR 701.67a — where a click on a waterbend candidate with a free mana ability
// goes. With mana owed it taps for mana, which pays at least the same pip. With a
// `genericSubstitutionOffer` standing nothing is owed, so the server refuses that
// mana tap and the click has to be the pick, or the permanent cannot keep the
// player's floating mana at all. Drives the REAL hook's `handleClick`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, PendingActivation, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { solRing } from "@convex/cards/sets/lea/colorless.cards";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
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

// Import AFTER mocks are registered.
import { useBattlefieldInteraction } from "../useBattlefieldInteraction";

const ring: CardInstance = {
    id: "ring",
    card: { id: solRing().id },
    controllerId: "me",
    ownerId: "me",
    zone: "battlefield",
    isTapped: false,
    isSummoningSick: false,
    types: ["Artifact"],
    subtypes: [],
    staticAbilities: [],
} as CardInstance;

const me = {
    id: "me",
    name: "me",
    bgColor: "#000",
    life: 20,
    hand: [],
    library: { count: 0 },
    graveyard: [],
    exile: [],
    battlefield: [ring],
    manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
} as unknown as Player;

const activation = (fields: Partial<PendingActivation>) =>
    ({
        playerId: "me",
        cardInstanceId: "iceberg",
        abilityId: "aangs-iceberg-waterbend",
        manaCost: { X: 3 },
        tappedLandIds: [],
        tapOtherChoice: {
            filter: { types: ["Artifact", "Creature"] },
            substitutesGeneric: 3,
            pickedIds: [],
        },
        ...fields,
    }) as PendingActivation;

function clickRing(pendingActivation: PendingActivation) {
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
        pendingActivation,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;

    const handle: {
        current: ReturnType<typeof useBattlefieldInteraction> | null;
    } = { current: null };
    function Harness() {
        handle.current = useBattlefieldInteraction(me);
        return null;
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    render(<Harness />, { wrapper });
    act(() => {
        handle.current!.handleClick(ring);
    });
}

describe("clicking a waterbend candidate that makes mana (CR 701.67a)", () => {
    beforeEach(() => {
        selectActivationCost.mockClear();
        tapForActivationPayment.mockClear();
        cleanup();
    });

    it("with the offer standing the click is the pick: no mana is owed to tap for", () => {
        clickRing(activation({ genericSubstitutionOffer: true }));
        expect(selectActivationCost).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "ring",
        });
        expect(tapForActivationPayment).not.toHaveBeenCalled();
    });

    it("with mana owed and no offer the click taps it for mana", () => {
        clickRing(activation({}));
        expect(tapForActivationPayment).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "ring",
        });
        expect(selectActivationCost).not.toHaveBeenCalled();
    });
});
