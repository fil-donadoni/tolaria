// Battlefield tap/pay parity (PRD #249, issue #272). The spatial board's
// battlefield card (`BoardNextBattlefieldCard`, wired by `BoardNextBattlefield`)
// and the classic board (`PlayerBattlefield`) BOTH consume the extracted
// `useBattlefieldInteraction` hook, so a click on a mana source must dispatch
// the SAME GRE-boundary mutation with the SAME args on either board.
//
// These tests render each board's battlefield against identical mocked
// mutations + game context and compare the dispatched mutation/args for:
//  (a) a plain tap (untapped land, no payment in progress)  → tapUntap
//  (b) an in-payment tap (pendingCast for the viewer)        → tapForPayment
//  (c) a mana-choice pick (multi-color source)               → tapUntap(index)
// The classic board's existing behavior is unchanged — it now flows through the
// same hook.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

// --- Mutation capture: each api.game.* ref resolves to its own spy ---
type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const tapForPayment = vi.fn<MutFn>(() => Promise.resolve());
const untapForPayment = vi.fn<MutFn>(() => Promise.resolve());
const tapForActivationPayment = vi.fn<MutFn>(() => Promise.resolve());
const untapForActivationPayment = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    tapForPayment,
    untapForPayment,
    tapForActivationPayment,
    untapForActivationPayment,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
    // ErrorToast (shown on a rejected mutation) lazily queries the full state
    // for its copy-to-clipboard payload; an inert stub is enough here.
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => {
    const names = [
        "tapUntap",
        "tapForPayment",
        "untapForPayment",
        "tapForActivationPayment",
        "untapForActivationPayment",
        "toggleAttacker",
        "selectBlocker",
        "assignBlockerTarget",
        "selectTarget",
        "selectAdditionalCost",
        "activateAbility",
        "getFullState",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

// Controllable card registry. A "Forest" land gets its mana from subtypes
// (getLandManaColor) so no def is needed; the mana-choice source returns a
// Birds-of-Paradise-style activated ability with `manaChoices`.
const LAND_DEF = { id: "land-def", name: "Forest", activatedAbilities: [] };
const CHOICE_DEF = {
    id: "choice-def",
    name: "Birds of Paradise",
    activatedAbilities: [
        {
            id: "birds-mana",
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            cost: { tap: true },
        },
    ],
};
vi.mock("@convex/cards", () => ({
    getCardById: (id: string) => (id === "choice-def" ? CHOICE_DEF : LAND_DEF),
    tryGetCardById: (id: string) =>
        id === "choice-def" ? CHOICE_DEF : LAND_DEF,
}));

// The buffer is only used by the choice path (not exercised here).
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));

// Inert visuals so the test sees only the gesture + dispatch.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// SpatialZone measures its box via ResizeObserver; stub it so layout doesn't
// matter — we only need the card node mounted and clickable.
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
// The classic board renders BattlefieldCard; keep its click wiring but strip
// the heavy chrome (tooltip / context menu) to a thin clickable shell.
vi.mock("../battlefield-card", () => ({
    default: ({
        card,
        onClick,
    }: {
        card: CardInstance;
        onClick: (e: React.MouseEvent) => void;
    }) => (
        <div
            data-classic-card={card.id}
            onClick={(e) => onClick(e)}
            data-testid="classic-card"
        />
    ),
}));

import BoardNextBattlefield from "../board-next-battlefield";
import PlayerBattlefield from "../player-battlefield";

function land(id: string): CardInstance {
    return {
        id,
        card: { id: "land-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Land"],
        subtypes: ["Forest"],
    } as CardInstance;
}

function manaChoiceSource(id: string): CardInstance {
    return {
        id,
        card: { id: "choice-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        // A mana-choice artifact (Birds is a creature but summoning sickness
        // would block its tap; use a non-creature so the source is tappable).
        types: ["Artifact"],
    } as CardInstance;
}

function makePlayer(battlefield: CardInstance[]): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function makeContext(
    me: Player,
    overrides: Partial<React.ContextType<typeof GameContext>> = {}
): React.ContextType<typeof GameContext> {
    return {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as React.ContextType<typeof GameContext>;
}

function renderSpatial(
    me: Player,
    ctx?: Partial<React.ContextType<typeof GameContext>>
) {
    return render(
        <GameContext value={makeContext(me, ctx)}>
            <BoardNextBattlefield player={me} />
        </GameContext>
    );
}

function renderClassic(
    me: Player,
    ctx?: Partial<React.ContextType<typeof GameContext>>
) {
    return render(
        <GameContext value={makeContext(me, ctx)}>
            <PlayerBattlefield player={me} />
        </GameContext>
    );
}

function clearAll() {
    for (const m of Object.values(MUTATIONS)) m.mockClear();
}

beforeEach(() => {
    clearAll();
    cleanup();
});

describe("board-next battlefield tap/pay parity with the classic board (#272)", () => {
    it("(a) a plain tap dispatches the SAME tapUntap args on both boards", () => {
        const me = makePlayer([land("forest1")]);

        renderClassic(me);
        fireEvent.click(
            document.querySelector('[data-classic-card="forest1"]')!
        );
        const classicArgs = tapUntap.mock.calls[0][0];

        clearAll();
        cleanup();

        const { container } = renderSpatial(me);
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="forest1"]')!
        );
        const spatialArgs = tapUntap.mock.calls[0][0];

        expect(spatialArgs).toEqual(classicArgs);
        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "forest1",
        });
        expect(tapForPayment).not.toHaveBeenCalled();
    });

    it("(b) an in-payment tap dispatches the SAME tapForPayment args on both boards", () => {
        const me = makePlayer([land("forest1")]);
        // The viewer is paying for their own pending cast — tapping a source
        // routes to tapForPayment instead of tapUntap.
        const payCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingCast: {
                playerId: "me",
                tappedLandIds: [],
            } as never,
        };

        renderClassic(me, payCtx);
        fireEvent.click(
            document.querySelector('[data-classic-card="forest1"]')!
        );
        const classicArgs = tapForPayment.mock.calls[0][0];

        clearAll();
        cleanup();

        const { container } = renderSpatial(me, payCtx);
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="forest1"]')!
        );
        const spatialArgs = tapForPayment.mock.calls[0][0];

        expect(spatialArgs).toEqual(classicArgs);
        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "forest1",
        });
        expect(tapUntap).not.toHaveBeenCalled();
    });

    it("(c) a mana-choice pick dispatches the SAME tapUntap(index) args on both boards", () => {
        const me = makePlayer([manaChoiceSource("birds1")]);

        // Classic: click opens the mana picker → pick the 4th color (R, index 3).
        const classic = renderClassic(me);
        fireEvent.click(
            document.querySelector('[data-classic-card="birds1"]')!
        );
        // Picker buttons carry a title `Add 1{<color>}`.
        const classicPick = within(classic.container.ownerDocument.body)
            .getAllByRole("button")
            .find((b) => b.getAttribute("title")?.includes("{R}"))!;
        fireEvent.click(classicPick);
        const classicArgs = tapUntap.mock.calls[0][0];

        clearAll();
        cleanup();

        // Spatial: same gesture through the same hook.
        const spatial = renderSpatial(me);
        fireEvent.click(
            spatial.container.querySelector(
                '[data-arrow-anchor-permanent="birds1"]'
            )!
        );
        const spatialPick = within(spatial.container.ownerDocument.body)
            .getAllByRole("button")
            .find((b) => b.getAttribute("title")?.includes("{R}"))!;
        fireEvent.click(spatialPick);
        const spatialArgs = tapUntap.mock.calls[0][0];

        expect(spatialArgs).toEqual(classicArgs);
        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "birds1",
            manaChoiceIndex: 3,
        });
    });

    it("surfaces the validation toast on the spatial board when a tap is rejected", async () => {
        tapUntap.mockReturnValueOnce(
            Promise.reject(
                new Error(
                    "[CONVEX M(game:tapUntap)] Server Error\nUncaught Error: It's not your turn"
                )
            )
        );
        const me = makePlayer([land("forest1")]);
        const { container, findByText } = renderSpatial(me);
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="forest1"]')!
        );
        // The extracted hook's `overlays` (mounted by BoardNextBattlefield)
        // includes the ErrorToast; the rejected mutation surfaces its inner
        // message as the toast title.
        expect(await findByText("It's not your turn")).toBeTruthy();
    });
});
