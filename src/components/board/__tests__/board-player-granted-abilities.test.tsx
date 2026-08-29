// Player-level granted abilities are REACHABLE on the board (issue #2691).
//
// `PlayerGrantedAbilities` existed but had zero render sites: its old mount,
// `PlayerSideRow`, was deleted in `d2b1d2fe0` during the board rewrite and the
// affordance was never re-mounted. Channel resolved, the grant reached the
// client in the projected player state, and nothing rendered — the player had
// no way to pay life for {C} until the grant expired at cleanup. That is the
// whole CLASS of player-scoped grants, not one card.
//
// So this file renders through `BoardPlayer` — the real mount — and feeds it a
// player produced by the real reducer, `projectPublicState`. A hand-built
// `Player` carrying `grantedAbilities` would keep passing if the projection
// dropped the field, and a direct render of `PlayerGrantedAbilities` would keep
// passing if it were unmounted again, which is exactly the bug
// (.claude/rules/gre-development.md § Frontend wiring analysis).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { projectPublicState } from "@convex/gameProjections";
import { makeState, pushSpell } from "@convex/cards/__tests__/setup";
import { resolveTopOfStack } from "@convex/gre/state";
import { getCardByName } from "@convex/cards";

// One spy per mutation reference: `BoardPlayer` also mounts the nameplate,
// which wires `selectTarget`. The api module is stubbed so every reference is
// its own `"module:function"` string, which keeps the two apart — so "clicking
// the control calls activatePlayerAbility" cannot be satisfied by some other
// mutation firing. (The real generated `api` is a proxy that hands back a fresh
// object per property access, so identity comparison against it never matches.)
vi.mock("@convex/_generated/api", () => ({
    api: new Proxy(
        {},
        {
            get: (_t, mod) =>
                new Proxy(
                    {},
                    { get: (_t2, fn) => `${String(mod)}:${String(fn)}` }
                ),
        }
    ),
}));

const ACTIVATE_REF = "game:activatePlayerAbility";
const mutationSpies = vi.hoisted(() => ({
    activate: vi.fn(),
    fallback: vi.fn(),
}));
vi.mock("convex/react", () => ({
    useMutation: (ref: unknown) =>
        ref === "game:activatePlayerAbility"
            ? mutationSpies.activate
            : mutationSpies.fallback,
}));

// Drive the responsive seams explicitly — jsdom's matchMedia must not decide
// which nameplate variant renders around the control under test.
vi.mock("~/hooks/useIsPortrait", () => ({ useIsPortrait: () => portrait }));
let portrait = false;
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => "desktop" as const,
}));

import { api } from "@convex/_generated/api";
import BoardPlayer from "../board-player";

// The component under test must reach for exactly this mutation.
expect(api.game.activatePlayerAbility).toBe(ACTIVATE_REF);

const CHANNEL = getCardByName("Channel").id;

/** The engine's own grant id for the Channel grant built by
 *  {@link projectChannelSeat} — read off `GameState` BEFORE projection, so the
 *  click assertion below compares the mutation payload against the engine's
 *  value rather than against the DOM attribute the button was rendered with. */
let engineGrantId = "";

/** Resolves Channel for p1, then hands back the player as `viewerId` sees them
 *  through the real public projection. `life` is applied AFTER the resolve so
 *  the unaffordable case doesn't depend on Channel touching life (it doesn't). */
function projectChannelSeat(
    viewerId: string,
    seat: "p1" | "p2",
    life?: number
): Player {
    const state = makeState();
    pushSpell(state, CHANNEL, "p1");
    resolveTopOfStack(state);
    engineGrantId = state.players[0].grantedAbilities![0].id;
    if (life !== undefined) state.players[0].life = life;
    const projected = projectPublicState(state, 1, viewerId);
    const index = seat === "p1" ? 0 : 1;
    return projected.players[index] as unknown as Player;
}

type Ctx = React.ContextType<typeof GameContext>;

function makeContext(overrides: Partial<NonNullable<Ctx>> = {}): Ctx {
    return {
        gameId: "game-id" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as Ctx;
}

function makeBuffer() {
    return {
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(async () => {}),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
        reportError: vi.fn(),
    } satisfies PendingChoiceBuffer;
}

function renderSeat(player: Player, ctx: Partial<NonNullable<Ctx>> = {}) {
    return render(
        <GameContext value={makeContext(ctx)}>
            <PendingChoiceBufferContext value={makeBuffer()}>
                <BoardPlayer player={player} side="bottom" />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

/** The control for the one grant Channel produces, as rendered by the board. */
function grantButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>("[data-granted-ability]");
}

beforeEach(() => {
    mutationSpies.activate.mockClear();
    mutationSpies.fallback.mockClear();
    portrait = false;
    cleanup();
});

describe("player-level granted abilities on the board (issue #2691, CR 605.3a)", () => {
    it("renders an activation control on the board for a grant in the viewer's projected state", () => {
        const { container } = renderSeat(projectChannelSeat("p1", "p1"));
        const button = grantButton(container);
        expect(button).not.toBeNull();
        // Labelled with the ability's oracle text, through the shared
        // formatter — "{C}" renders as a mana symbol image, not literal text.
        expect(button!.title).toBe("Pay 1 life: Add {C}.");
        expect(button!.querySelector("img")).not.toBeNull();
    });

    it("is enabled and calls activatePlayerAbility with the grant's instance id", () => {
        const { container } = renderSeat(projectChannelSeat("p1", "p1"));
        const button = grantButton(container)!;
        expect(button.disabled).toBe(false);
        fireEvent.click(button);
        expect(mutationSpies.activate).toHaveBeenCalledTimes(1);
        // Compared against the id the ENGINE minted, not against the DOM
        // attribute the button was rendered with — the latter would pass even
        // if the component invented an id and rendered it into both places.
        expect(engineGrantId).toMatch(/^grant-\d+$/);
        expect(mutationSpies.activate).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "p1",
            grantedAbilityInstanceId: engineGrantId,
        });
    });

    it("is DISABLED while a resolution choice is queued — the mutation rejects on any pending choice", () => {
        // `activatePlayerAbility` calls `assertNoPendingChoices(state)` with no
        // `allowManaForMayPay` option (unlike tapUntap / tapForPayment), so a
        // queued choice makes it throw even in a may-pay window where the
        // projected priority sits with the chooser.
        const { container } = renderSeat(projectChannelSeat("p1", "p1"), {
            pendingChoices: [
                {
                    stackItemId: "s1",
                    step: 0,
                    choiceId: "may-pay",
                    playerId: "p1",
                    kind: "may-pay",
                    prompt: "Pay {1}?",
                },
            ] as never,
        });
        const button = grantButton(container);
        expect(button).not.toBeNull();
        expect(button!.disabled).toBe(true);
        fireEvent.click(button!);
        expect(mutationSpies.activate).not.toHaveBeenCalled();
    });

    it("is DISABLED — not hidden — when the viewer neither holds priority nor is paying a cost", () => {
        const { container } = renderSeat(projectChannelSeat("p1", "p1"), {
            priorityPlayerId: "p2",
        });
        const button = grantButton(container);
        expect(button).not.toBeNull();
        expect(button!.disabled).toBe(true);
        fireEvent.click(button!);
        expect(mutationSpies.activate).not.toHaveBeenCalled();
    });

    it("stays enabled mid-cast without priority — a mana ability is legal while paying (CR 605.3a)", () => {
        const { container } = renderSeat(projectChannelSeat("p1", "p1"), {
            priorityPlayerId: "p2",
            pendingCast: { playerId: "p1" } as never,
        });
        expect(grantButton(container)!.disabled).toBe(false);
    });

    it("is DISABLED — not hidden — when the viewer cannot pay the life cost", () => {
        const { container } = renderSeat(projectChannelSeat("p1", "p1", 0));
        const button = grantButton(container);
        expect(button).not.toBeNull();
        expect(button!.disabled).toBe(true);
        fireEvent.click(button!);
        expect(mutationSpies.activate).not.toHaveBeenCalled();
    });

    it("renders no control for the OPPONENT's grant, though the projection carries it", () => {
        // p2 is the viewer; p1 holds the grant. The projection hydrates it for
        // both viewers (it is public information), but only its holder may
        // activate it — so p2's board shows no button on p1's seat.
        const p1AsSeenByP2 = projectChannelSeat("p2", "p1");
        expect(p1AsSeenByP2.grantedAbilities).toHaveLength(1);
        const { container } = renderSeat(p1AsSeenByP2, { playerId: "p2" });
        expect(grantButton(container)).toBeNull();
    });

    it("the seat with no grant renders no control", () => {
        const { container } = renderSeat(projectChannelSeat("p2", "p2"), {
            playerId: "p2",
        });
        expect(grantButton(container)).toBeNull();
    });

    // Two layout invariants happy-dom CAN see, both load-bearing:
    //
    //  (a) the stale `absolute left-full` box the deleted `PlayerSideRow` gave
    //      this component anchored it OUTSIDE the seat chrome's right edge —
    //      off-screen at phone portrait (390x844);
    //  (b) the seat wrapper's IN-FLOW height must stay the nameplate's, because
    //      `PORTRAIT_NAMEPLATE_BAND_H` reserves exactly that box plus a 2px
    //      rounding margin. An in-flow control above the bottom-pinned
    //      nameplate grows the wrapper straight past that reservation into the
    //      battlefield's back row — the #1814 bug class. Hence the `h-0`
    //      ancestor with an `absolute` stack inside it.
    it("floats above the plate from a ZERO-HEIGHT box, never in the seat's in-flow height", () => {
        const { container } = renderSeat(projectChannelSeat("p1", "p1"));
        const controls = container.querySelector<HTMLElement>(
            '[data-testid="player-granted-abilities"]'
        )!;
        expect(controls.className).not.toContain("left-full");
        const stack = controls.parentElement!;
        expect(stack.className).toContain("absolute");
        expect(stack.className).toContain("bottom-0");
        // Taps fall through the stack's empty area to the card underneath; only
        // the button's own rectangle is interactive.
        expect(stack.className).toContain("pointer-events-none");
        expect(grantButton(container)!.className).toContain(
            "pointer-events-auto"
        );
        const zeroHeightBox = stack.parentElement!;
        expect(zeroHeightBox.className).toContain("h-0");
        // …and that box is a child of the seat wrapper, ahead of the nameplate,
        // so the controls render above the plate and the plate keeps the
        // wrapper's whole in-flow height to itself.
        const wrapper = container.firstElementChild as HTMLElement;
        expect(zeroHeightBox.parentElement).toBe(wrapper);
        expect(wrapper.className).toContain("play-area-center-x");
        const plate = container.querySelector(
            '[data-arrow-anchor-player="p1"]'
        );
        expect(
            zeroHeightBox.compareDocumentPosition(plate!) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it("the mana pool rides ABOVE the controls, off its own anchor — never on top of them", () => {
        // Activating the grant puts mana in the pool, so the two are live at
        // the same time by construction. The pool anchors `bottom-full` of its
        // own zero-height box, which sits above the controls in the stack; with
        // no grant that box is flush at the wrapper's top edge, so the pool
        // lands exactly where it did before issue #2691.
        const withMana = projectChannelSeat("p1", "p1");
        withMana.manaPool = { ...withMana.manaPool, C: 1 };
        const { container } = renderSeat(withMana);
        const pool = container.querySelector<HTMLElement>(
            '[data-testid="mana-pool"]'
        )!;
        const controls = container.querySelector<HTMLElement>(
            '[data-testid="player-granted-abilities"]'
        )!;
        expect(pool.className).toContain("bottom-full");
        const poolAnchor = pool.parentElement!;
        expect(poolAnchor.className).toContain("relative");
        expect(poolAnchor.parentElement).toBe(controls.parentElement);
        // Earlier in the column = higher on screen (the column is bottom-pinned).
        expect(
            poolAnchor.compareDocumentPosition(controls) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });
});
