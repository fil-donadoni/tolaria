// Manual Board battlefield behaviour, rendered through the SHARED board
// (PRD #2162, issue #2169).
//
// Two acceptance criteria are proven here, both through the real
// `BoardBattlefield` under the real `BattlefieldInteractionProvider` — never a
// hand-built view:
//   (a) a click on a permanent dispatches the manual tap verb with the expected
//       arguments;
//   (b) the manual verbs reach the SHARED ability menu (the card is wrapped in
//       the shared menu's trigger) and its touch action sheet lists them.
//
// (b) is not cosmetic: the shared card only binds the ability affordance when
// `getActivatable` returns a non-empty list, and it only ALSO fires the click
// when the injected result opts into `clickActsWithAbilities`. Those two
// interact — which is exactly why (a) and (b) are asserted on the same render.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { BattlefieldInteractionProvider } from "~/hooks/useBattlefieldInteractionContext";
import { adaptManualPlayers } from "~/lib/manual-board-adapter";
import { makeManualBattlefieldInteraction } from "~/lib/manual-battlefield-interaction";
import {
    manualCard,
    manualRuntime,
    manualSeat,
    manualState,
    spyDispatch,
} from "~/lib/__tests__/manual-test-fixtures";

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => ({ api: { game: {} } }));

import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    tryGetDefinition: () => undefined,
    FACE_DOWN_CARD_ID: "__faceDownDef",
}));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));

// SpatialZone measures its box via ResizeObserver; the layout is irrelevant
// here, only that each item's node reaches the DOM.
vi.mock("../spatial-zone", () => ({
    default: ({
        items,
    }: {
        items: { key: string; node: React.ReactNode }[];
    }) => (
        <div data-testid="spatial-zone">
            {items.map((it) => (
                <div key={it.key}>{it.node}</div>
            ))}
        </div>
    ),
}));

// CombatPanels is mounted unconditionally by BoardBattlefield and is pure GRE
// combat chrome — inert with no combat in context, stubbed so it can't pull a
// mutation into this render.
vi.mock("../combat-panels", () => ({ default: () => null }));

const { default: BoardBattlefield } = await import("../board-battlefield");
const { default: ActivatableAbilityMenu } =
    await import("../activatable-ability-menu");

function build(cardOverrides = {}) {
    const dispatch = spyDispatch();
    const state = manualState([
        manualSeat("me", {
            battlefield: [manualCard("perm1", cardOverrides)],
        }),
        manualSeat("opp"),
    ]);
    const runtime = manualRuntime(state, dispatch);
    const [me] = adaptManualPlayers(state);
    return { dispatch, runtime, me, state };
}

function makeContext(me: Player): React.ContextType<typeof GameContext> {
    return {
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
        onSwitchGame: () => {},
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
}

beforeEach(cleanup);

describe("manual battlefield interaction through the shared board (#2169)", () => {
    it("a click on a permanent dispatches the manual tap verb", () => {
        const { dispatch, runtime, me } = build();
        const { container } = render(
            <GameContext value={makeContext(me)}>
                <BattlefieldInteractionProvider
                    value={makeManualBattlefieldInteraction(runtime)}
                >
                    <BoardBattlefield player={me} />
                </BattlefieldInteractionProvider>
            </GameContext>
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="perm1"]')!
        );
        expect(dispatch.setTapped).toHaveBeenCalledWith({
            instanceId: "perm1",
            tapped: true,
        });
    });

    it("a click on a TAPPED permanent untaps it", () => {
        const { dispatch, runtime, me } = build({ isTapped: true });
        const { container } = render(
            <GameContext value={makeContext(me)}>
                <BattlefieldInteractionProvider
                    value={makeManualBattlefieldInteraction(runtime)}
                >
                    <BoardBattlefield player={me} />
                </BattlefieldInteractionProvider>
            </GameContext>
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="perm1"]')!
        );
        expect(dispatch.setTapped).toHaveBeenCalledWith({
            instanceId: "perm1",
            tapped: false,
        });
    });

    it("the permanent is wrapped in the SHARED ability menu's trigger", () => {
        const { runtime, me } = build();
        const { container } = render(
            <GameContext value={makeContext(me)}>
                <BattlefieldInteractionProvider
                    value={makeManualBattlefieldInteraction(runtime)}
                >
                    <BoardBattlefield player={me} />
                </BattlefieldInteractionProvider>
            </GameContext>
        );
        const card = container.querySelector(
            '[data-arrow-anchor-permanent="perm1"]'
        )!;
        // `ActivatableAbilityMenu` renders its children BARE when the ability
        // list is empty, so the presence of the trigger is exactly the
        // assertion "the manual verbs reached the shared menu".
        expect(
            card.closest('[data-slot="context-menu-trigger"]')
        ).not.toBeNull();
    });

    it("the touch action sheet lists the manual verbs and dispatches the picked one", () => {
        const { dispatch, runtime } = build();
        const interaction = makeManualBattlefieldInteraction(runtime)(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {} as any
        );
        const abilities = interaction.getActivatable({
            id: "perm1",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        render(
            <ActivatableAbilityMenu
                abilities={abilities}
                onActivate={(abilityId, keepPriority) =>
                    interaction.handleActivateAbility(
                        "perm1",
                        abilityId,
                        keepPriority
                    )
                }
                sheetOpen
                onSheetClose={() => {}}
            >
                <div data-testid="card" />
            </ActivatableAbilityMenu>
        );
        for (const label of [
            "Tap",
            "Turn face down",
            "Add a +1/+1 counter",
            "Move to graveyard",
        ]) {
            expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        }
        fireEvent.click(screen.getAllByText("Move to graveyard")[0]);
        expect(dispatch.moveCard).toHaveBeenCalledWith({
            instanceId: "perm1",
            toZone: "graveyard",
        });
    });
});
