// Non-tap choice-based mana ability activation (issue #1179) — Vivi
// Ornitier's "{0}: Add X mana in any combination of {U} and/or {R}..." has
// no {T} component, so it is reachable ONLY through the activated-ability
// menu (`getActivatable` + `handleActivateAbility`), never a direct
// left-click tap. This drives the REAL `useBattlefieldInteraction` reducer
// end-to-end: `getActivatable` must surface the ability, `handleActivateAbility`
// must open the mana-choice picker (not fire the mutation directly), and
// picking an option in the REAL `ManaChoicePicker` must dispatch
// `activateManaAbility` with the chosen `manaChoiceIndex` — never `tapUntap`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, fireEvent, cleanup } from "@testing-library/react";
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

// A Vivi-Ornitier-shaped definition: a free ("{0}:"), non-tap, non-stack,
// once-per-turn, controller-turn-only mana ability whose `getManaChoices`
// enumerates every {U}/{R} split summing to the source's power — the SAME
// shape `convex/cards/sets/fin/multicolor.ts` ships, deterministic here
// since the mock never touches the real effective-power layer pipeline.
const VIVI_DEF = {
    id: "vivi-def",
    name: "Vivi Ornitier",
    activatedAbilities: [
        {
            id: "vivi-ornitier-mana",
            oracleText: "{0}: Add X mana in any combination of {U} and/or {R}.",
            cost: {},
            useStack: false,
            controllerTurnOnly: true,
            oncePerTurn: true,
            getManaChoices: (source: { power?: number }) => {
                const x = Math.max(0, source.power ?? 0);
                const options: Record<string, number>[] = [];
                for (let u = 0; u <= x; u++) {
                    const r = x - u;
                    const option: Record<string, number> = {};
                    if (u > 0) option.U = u;
                    if (r > 0) option.R = r;
                    options.push(option);
                }
                return options;
            },
        },
    ],
};
vi.mock("@convex/cards", () => ({
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

function vivi(power: number): CardInstance {
    return {
        id: "vivi1",
        card: { id: "vivi-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: ["Wizard"],
        staticAbilities: [],
        power,
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

/** Mounts the REAL hook + its `overlays` (where `ManaChoicePicker` lives) and
 *  exposes the latest interaction handle via a ref so a test can call
 *  `handleActivateAbility` and then inspect the picker DOM the resulting
 *  `overlays` re-render produces. */
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

describe("useBattlefieldInteraction — non-tap choice-based mana ability (Vivi Ornitier, issue #1179)", () => {
    beforeEach(() => {
        tapUntap.mockClear();
        activateManaAbility.mockClear();
        cleanup();
    });

    it("getActivatable surfaces the free non-tap mana ability as an explicit menu entry", () => {
        const me = player("me", [vivi(2)]);
        const { handle } = renderInteraction(me);

        const activatable = handle.current!.getActivatable(vivi(2));
        expect(activatable).toEqual([
            {
                id: "vivi-ornitier-mana",
                oracleText:
                    "{0}: Add X mana in any combination of {U} and/or {R}.",
            },
        ]);
    });

    it("handleActivateAbility opens the mana-choice picker instead of firing activateManaAbility directly", () => {
        const me = player("me", [vivi(2)]);
        const { handle, container } = renderInteraction(me);

        act(() => {
            handle.current!.handleActivateAbility(
                "vivi1",
                "vivi-ornitier-mana",
                false
            );
        });

        expect(activateManaAbility).not.toHaveBeenCalled();
        expect(tapUntap).not.toHaveBeenCalled();
        // The picker rendered: 3 options for power 2 (RR, UR, UU).
        expect(container.querySelectorAll("button")).toHaveLength(3);
    });

    it("picking an option dispatches activateManaAbility with the chosen manaChoiceIndex — never tapUntap", () => {
        const me = player("me", [vivi(2)]);
        const { handle, container } = renderInteraction(me);

        act(() => {
            handle.current!.handleActivateAbility(
                "vivi1",
                "vivi-ornitier-mana",
                false
            );
        });

        // getManaChoices(power=2) → [{R:2}, {U:1,R:1}, {U:2}] (index order).
        // Pick the all-{U} option (index 2, "Add {U}{U}").
        const buttons = Array.from(container.querySelectorAll("button"));
        const allU = buttons.find((b) =>
            b.getAttribute("title")?.includes("{U}{U}")
        )!;
        expect(allU).toBeDefined();
        fireEvent.click(allU);

        expect(activateManaAbility).toHaveBeenCalledTimes(1);
        expect(activateManaAbility).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "vivi1",
            abilityId: "vivi-ornitier-mana",
            manaChoiceIndex: 2,
        });
        expect(tapUntap).not.toHaveBeenCalled();
    });

    it("at power 0, the picker renders a single explicit '0 mana' option (not a silently empty picker)", () => {
        const me = player("me", [vivi(0)]);
        const { handle, container } = renderInteraction(me);

        act(() => {
            handle.current!.handleActivateAbility(
                "vivi1",
                "vivi-ornitier-mana",
                false
            );
        });

        const buttons = Array.from(container.querySelectorAll("button"));
        expect(buttons).toHaveLength(1);
        expect(buttons[0].textContent).toBe("0");

        fireEvent.click(buttons[0]);
        expect(activateManaAbility).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "vivi1",
            abilityId: "vivi-ornitier-mana",
            manaChoiceIndex: 0,
        });
    });
});
