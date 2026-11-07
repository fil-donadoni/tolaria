// CR 613.4 / 602.1b — a mana ability gated on power, through the REAL hooks on a
// board built by `projectPublicState`. The pump is a registry entry: a player
// alone does not carry it, so only the layer input the hooks attach
// (`withManaLayers`) can show it to the click handler and the source highlight.
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "tapUntap" ? tapUntap : noop,
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

// NOTE: `@convex/cards` is deliberately NOT mocked — the gate is a real card's.
import { getCardByName, registerTokenDefinition } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import type { ContinuousEffect } from "@convex/gre/continuousEffects";
import { useBattlefieldInteraction } from "../useBattlefieldInteraction";

const TWO_OPTIONS = getCardByName("Fanatic of Rhonas").id; // {G}, or gated {G}{G}{G}{G}
const THREE_THREE = getCardByName("Hill Giant").id;

/** Its ONLY mana ability is gated, so the gate decides whether it is a source
 *  at all. An id distinct from the sibling suites: the registry is process-wide. */
const ONLY_GATED = "hook-2311-only-gated-source";
registerTokenDefinition({
    id: ONLY_GATED,
    name: "Test Hook Power-Gated Source",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "only-gated-mana",
            oracleText:
                "{T}: Add {G}. Activate only if you control a creature with power 4 or greater.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 1 },
            canActivate: (source, view) =>
                view.players
                    .find((p) => p.id === source.controllerId)!
                    .battlefield.some((c) => (c.power ?? 0) >= 4),
        },
    ],
});

function pump(power: number): ContinuousEffect {
    return {
        id: "ce-pump",
        layer: 7,
        sublayer: "7c",
        timestamp: 10,
        expiry: { kind: "indefinite", controllerId: "me" },
        affected: { kind: "instances", instanceIds: ["giant"] },
        payload: { kind: "pt-modify", power, toughness: 0 },
        characteristicDefining: false,
    } as ContinuousEffect;
}

function boardOnWire(sourceCardId: string, pumpBy: number) {
    const state = makeState({
        players: [
            makePlayer("me", {
                battlefield: [
                    makeInstance(sourceCardId, {
                        id: "source",
                        controllerId: "me",
                        ownerId: "me",
                    }),
                    makeInstance(THREE_THREE, {
                        id: "giant",
                        controllerId: "me",
                        ownerId: "me",
                    }),
                ],
            }),
            makePlayer("them"),
        ],
        activePlayerId: "me",
        priorityPlayerId: "me",
        continuousEffects: pumpBy === 0 ? [] : [pump(pumpBy)],
    });
    const wire = projectPublicState(state, 1, "me");
    const me = wire.players[0] as unknown as Player;
    const source = me.battlefield.find(
        (c) => c.id === "source"
    ) as CardInstance;
    return { me, source, continuousEffects: wire.continuousEffects };
}

function renderInteraction(
    board: ReturnType<typeof boardOnWire>,
    fields: Record<string, unknown> = {}
) {
    const ctx = {
        ...fields,
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [board.me],
        continuousEffects: board.continuousEffects,
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;

    const handle: { current: ReturnType<typeof useBattlefieldInteraction> } = {
        current: null as never,
    };
    function Harness() {
        handle.current = useBattlefieldInteraction(board.me);
        return <>{handle.current.overlays}</>;
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    render(<Harness />, { wrapper });
    return handle;
}

describe("the hooks read a power gate through the board's layer input (CR 613.4)", () => {
    beforeEach(() => {
        tapUntap.mockClear();
        cleanup();
    });

    it("a click opens the two-option picker under a registry pump", () => {
        const board = boardOnWire(TWO_OPTIONS, 1);
        const handle = renderInteraction(board);

        act(() => handle.current.handleClick(board.source));

        expect(tapUntap).not.toHaveBeenCalled();
        expect(document.querySelectorAll("button")).toHaveLength(2);
    });

    it("the same click taps directly with no creature at power 4", () => {
        const board = boardOnWire(TWO_OPTIONS, 0);
        const handle = renderInteraction(board);

        act(() => handle.current.handleClick(board.source));

        expect(tapUntap).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll("button")).toHaveLength(0);
    });

    it("a board-gated chooser stays clickable while paying a cost (CR 605.3a)", () => {
        const artifactOf = (id: string) =>
            makeInstance(getCardByName("Ankh of Mishra").id, {
                id,
                controllerId: "me",
                ownerId: "me",
            });
        const state = makeState({
            players: [
                makePlayer("me", {
                    battlefield: [
                        makeInstance(getCardByName("Mox Opal").id, {
                            id: "source",
                            controllerId: "me",
                            ownerId: "me",
                        }),
                        artifactOf("ankh-1"),
                        artifactOf("ankh-2"),
                    ],
                }),
                makePlayer("them"),
            ],
            activePlayerId: "me",
            priorityPlayerId: "me",
        });
        const wire = projectPublicState(state, 1, "me");
        const me = wire.players[0] as unknown as Player;
        const source = me.battlefield.find(
            (c) => c.id === "source"
        ) as CardInstance;
        const handle = renderInteraction(
            { me, source, continuousEffects: undefined },
            {
                pendingCast: {
                    playerId: "me",
                    cardInstanceId: "spell-1",
                    manaCost: { R: 1 },
                    tappedLandIds: [],
                },
            }
        );
        expect(handle.current.canInteract(source)).toBe(true);
    });

    it("a source whose only mana ability is gated reads as interactable under the pump", () => {
        const pumped = boardOnWire(ONLY_GATED, 1);
        expect(
            renderInteraction(pumped).current.canInteract(pumped.source)
        ).toBe(true);
        cleanup();

        const plain = boardOnWire(ONLY_GATED, 0);
        expect(renderInteraction(plain).current.canInteract(plain.source)).toBe(
            false
        );
    });
});
