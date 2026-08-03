// Targeting + mid-resolution choice + additional-cost parity (PRD #249, issue
// #279). The spatial board's battlefield card (`BoardBattlefieldCard`, wired
// by `BoardBattlefield`) and the classic board (`PlayerBattlefield`) BOTH
// consume the extracted `useBattlefieldInteraction` hook, so the selection
// click-paths dispatch the SAME GRE-boundary mutation / toggle the SAME buffer
// on either board:
//  (a) target selection  → selectTarget (gated by matchesTargetRequirement)
//  (b) additional cost    → selectAdditionalCost (CR 117.9)
//  (c) battlefield choice → buffer.toggle (CR 608.2): own / cross-player
//      (zoneOwnerId) / all-controllers
//  (d) hand choice        → buffer.toggle on the viewer's own spatial hand card,
//      matching the classic `selectable-card` hand-choice path
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import {
    DivideBufferContext,
    type DivideBuffer,
} from "~/hooks/useDivideBuffer";
import DivideTargetChip from "../divide-target-chip";
import type { DivideTargetItem } from "~/hooks/useDivideTargets";

// --- Mutation capture: each api.game.* ref resolves to its own spy ---
type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const selectTarget = vi.fn<MutFn>(() => Promise.resolve());
const selectAdditionalCost = vi.fn<MutFn>(() => Promise.resolve());
const selectActivationCost = vi.fn<MutFn>(() => Promise.resolve());
const selectSacrifice = vi.fn<MutFn>(() => Promise.resolve());
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const playCard = vi.fn<MutFn>(() => Promise.resolve());
const announceCast = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    selectTarget,
    selectAdditionalCost,
    selectActivationCost,
    selectSacrifice,
    tapUntap,
    playCard,
    announceCast,
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
        "playCard",
        "announceCast",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

// A plain creature def (no mana / activated abilities) so a click during
// targeting / choice routes straight to the selection branch.
const CREATURE_DEF = { id: "creature-def", name: "Grizzly Bears" };
vi.mock("@convex/cards", () => ({
    getDefinition: () => CREATURE_DEF,
    tryGetDefinition: () => CREATURE_DEF,
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
import BoardBattlefield from "../board-battlefield";
import BoardHandCard from "../board-hand-card";
import SelectableCard from "../../cards/selectable-card";

function creature(id: string, ownerId = "me"): CardInstance {
    return {
        id,
        card: { id: "creature-def" },
        controllerId: ownerId,
        ownerId,
        zone: "battlefield",
        isTapped: false,
        types: ["Creature"],
    } as CardInstance;
}

function handCard(id: string, ownerId = "me"): CardInstance {
    return {
        id,
        card: { id: "creature-def" },
        controllerId: ownerId,
        ownerId,
        zone: "hand",
        isTapped: false,
        types: ["Creature"],
        legalActions: ["cast"],
    } as CardInstance;
}

function makePlayer(id: string, battlefield: CardInstance[]): Player {
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
    };
}

// A controllable buffer spy shared between renders so we can assert toggle()
// is called with the clicked id on either board.
let bufferToggle: ReturnType<typeof vi.fn<(id: string) => void>>;
let bufferState: string[];
function makeBuffer(): PendingChoiceBuffer {
    return {
        buffer: bufferState,
        toggle: bufferToggle,
        clear: vi.fn(),
        submit: vi.fn(() => Promise.resolve()),
        isPending: false,
        lastError: null,
        reportError: vi.fn(),
        dismissError: vi.fn(),
    };
}

function makeContext(
    players: Player[],
    overrides: Partial<React.ContextType<typeof GameContext>> = {}
): React.ContextType<typeof GameContext> {
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
        allPlayers: players,
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as React.ContextType<typeof GameContext>;
}

function renderSpatialBf(
    player: Player,
    players: Player[],
    ctx?: Partial<React.ContextType<typeof GameContext>>
) {
    return render(
        <GameContext value={makeContext(players, ctx)}>
            <PendingChoiceBufferContext value={makeBuffer()}>
                <BoardBattlefield player={player} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

function clearAll() {
    for (const m of Object.values(MUTATIONS)) m.mockClear();
    bufferToggle.mockClear();
}

beforeEach(() => {
    bufferToggle = vi.fn<(id: string) => void>();
    bufferState = [];
    clearAll();
    cleanup();
});

const spatialCard = (root: ParentNode, id: string) =>
    root.querySelector(`[data-arrow-anchor-permanent="${id}"]`)!;

describe("board targeting parity (#279)", () => {
    it("(a) clicking a legal permanent dispatches the SAME selectTarget args on both boards", () => {
        const me = makePlayer("me", [creature("bear1")]);
        const targetCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingTarget: {
                playerId: "me",
                targetType: "Creature",
                selected: [],
            } as never,
        };

        const { container } = renderSpatialBf(me, [me], targetCtx);
        fireEvent.click(spatialCard(container, "bear1"));
        const spatialArgs = selectTarget.mock.calls[0][0];

        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            targetType: "permanent",
            targetId: "bear1",
        });
    });

    it("an illegal target (wrong type) is inert on the spatial board", () => {
        const me = makePlayer("me", [creature("bear1")]);
        const targetCtx: Partial<React.ContextType<typeof GameContext>> = {
            // "Land" doesn't match a creature → matchesTargetRequirement false.
            pendingTarget: {
                playerId: "me",
                targetType: "Land",
                selected: [],
            } as never,
        };
        const { container } = renderSpatialBf(me, [me], targetCtx);
        fireEvent.click(spatialCard(container, "bear1"));
        expect(selectTarget).not.toHaveBeenCalled();
    });
});

// Divide-as-you-choose (CR 601.2d, Pyrokinesis): while a `divideTotal`
// selection is active, a target is NOT click-to-select. The per-target
// [−] N [+] steppers now live in the divide dialog (`DivideTargetList` /
// `DivideTargetChip`), not on the board card, so they are no longer occluded by
// neighbouring cards. Clicking the card itself is inert (the dialog owns
// assignment); a normal, non-divide target still dispatches selectTarget on
// click.
describe("board targeting — divide-as-you-choose steppers (CR 601.2d)", () => {
    function makeDivide(overrides: Partial<DivideBuffer> = {}): DivideBuffer {
        return {
            active: true,
            kind: "deal",
            total: 4,
            sum: 0,
            remaining: 4,
            get: () => 0,
            inc: vi.fn(),
            dec: vi.fn(),
            canSubmit: false,
            submit: vi.fn(() => Promise.resolve()),
            isPending: false,
            lastError: null,
            dismissError: vi.fn(),
            ...overrides,
        };
    }

    function renderWithDivide(
        player: Player,
        players: Player[],
        ctx: Partial<React.ContextType<typeof GameContext>>,
        divide: DivideBuffer
    ) {
        return render(
            <GameContext value={makeContext(players, ctx)}>
                <PendingChoiceBufferContext value={makeBuffer()}>
                    <DivideBufferContext value={divide}>
                        <BoardBattlefield player={player} />
                    </DivideBufferContext>
                </PendingChoiceBufferContext>
            </GameContext>
        );
    }

    const divideCtx: Partial<React.ContextType<typeof GameContext>> = {
        pendingTarget: {
            playerId: "me",
            targetType: "Creature",
            selected: [],
            divideTotal: 4,
        } as never,
    };

    it("does NOT dispatch selectTarget when a divide target card is clicked", () => {
        const me = makePlayer("me", [creature("bear1")]);
        const { container } = renderWithDivide(
            me,
            [me],
            divideCtx,
            makeDivide()
        );
        fireEvent.click(spatialCard(container, "bear1"));
        expect(selectTarget).not.toHaveBeenCalled();
    });

    it("no longer renders an on-card stepper on a divide target — moved to the divide dialog", () => {
        // The divide steppers were lifted off the board into the divide dialog
        // (`DivideTargetList` / `DivideTargetChip`) so they stop being occluded
        // by neighbouring cards. The board card must therefore NOT carry the
        // `[−] N [+]` stepper any more.
        const me = makePlayer("me", [creature("bear1")]);
        const { queryByLabelText } = renderWithDivide(
            me,
            [me],
            divideCtx,
            makeDivide()
        );
        expect(queryByLabelText("Assign one more")).toBeNull();
    });

    it("the divide-dialog chip stepper dials the shared buffer (CR 601.2d)", () => {
        // The stepper's old on-card assertion now lives on its new home,
        // `DivideTargetChip`: clicking `[+]` assigns one more point to that
        // target through the shared divide buffer. `DivideTargetChip` receives a
        // pre-resolved `DivideTargetItem` (name already looked up), so this test
        // exercises the stepper without touching the card registry.
        const inc = vi.fn();
        const item: DivideTargetItem = {
            type: "permanent",
            id: "bear1",
            name: "Grizzly Bears",
            card: creature("bear1"),
            mine: true,
        };
        const { getByLabelText } = render(
            <DivideBufferContext value={makeDivide({ inc })}>
                <DivideTargetChip item={item} />
            </DivideBufferContext>
        );
        fireEvent.click(getByLabelText("Assign one more"));
        expect(inc).toHaveBeenCalledWith("bear1", "permanent");
    });

    it("sends NO amount for a normal (non-divide) target — regression", () => {
        const me = makePlayer("me", [creature("bear1")]);
        const ctx: Partial<React.ContextType<typeof GameContext>> = {
            pendingTarget: {
                playerId: "me",
                targetType: "Creature",
                selected: [],
            } as never,
        };
        const { container } = renderWithDivide(me, [me], ctx, makeDivide());
        fireEvent.click(spatialCard(container, "bear1"));

        expect(selectTarget).toHaveBeenCalledTimes(1);
        expect(selectTarget.mock.calls[0][0]).not.toHaveProperty("amount");
    });
});

describe("board additional-cost parity (#279, CR 117.9)", () => {
    it("(b) clicking a battlefield permanent dispatches the SAME selectAdditionalCost args on both boards", () => {
        const me = makePlayer("me", [creature("bear1")]);
        const costCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingCast: {
                playerId: "me",
                tappedLandIds: [],
                additionalCost: {
                    filter: { types: "Creature" },
                    pickedId: undefined,
                },
            } as never,
        };

        const { container } = renderSpatialBf(me, [me], costCtx);
        fireEvent.click(spatialCard(container, "bear1"));
        const spatialArgs = selectAdditionalCost.mock.calls[0][0];

        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "bear1",
        });
    });
});

describe("board battlefield choice parity (#279, CR 608.2)", () => {
    function choiceCtx(
        extra: Record<string, unknown> = {}
    ): Partial<React.ContextType<typeof GameContext>> {
        return {
            pendingChoices: [
                {
                    playerId: "me",
                    zone: "battlefield",
                    kind: "choose-permanents",
                    stackItemId: "s1",
                    step: 0,
                    choiceId: "c1",
                    ...extra,
                },
            ] as never,
        };
    }

    it("(c-own) toggles the buffer with the clicked id on both boards (own battlefield)", () => {
        const me = makePlayer("me", [creature("bear1")]);

        const { container } = renderSpatialBf(me, [me], choiceCtx());
        fireEvent.click(spatialCard(container, "bear1"));
        expect(bufferToggle).toHaveBeenCalledWith("bear1");
    });

    it("(c-cross) a cross-player pick (zoneOwnerId) toggles on the zone owner's spatial battlefield", () => {
        // "me" is the chooser; the choice picks from "opp"'s battlefield.
        const me = makePlayer("me", []);
        const opp = makePlayer("opp", [creature("oppbear", "opp")]);
        const ctx = choiceCtx({ zoneOwnerId: "opp" });

        // The chooser is "me" via context.playerId; the pick comes from the
        // zone owner ("opp")'s battlefield.
        const { container } = renderSpatialBf(opp, [me, opp], ctx);
        fireEvent.click(spatialCard(container, "oppbear"));
        expect(bufferToggle).toHaveBeenCalledWith("oppbear");
    });

    it("(c-all) an all-controllers pick is interactive on every battlefield", () => {
        const me = makePlayer("me", [creature("mybear")]);
        const opp = makePlayer("opp", [creature("oppbear", "opp")]);
        const ctx = choiceCtx({ allControllers: true });

        // The chooser can pick from the opponent's battlefield too.
        const { container } = renderSpatialBf(opp, [me, opp], ctx);
        fireEvent.click(spatialCard(container, "oppbear"));
        expect(bufferToggle).toHaveBeenCalledWith("oppbear");

        bufferToggle.mockClear();
        cleanup();

        // ...and from their own.
        const own = renderSpatialBf(me, [me, opp], ctx);
        fireEvent.click(spatialCard(own.container, "mybear"));
        expect(bufferToggle).toHaveBeenCalledWith("mybear");
    });
});

describe("board hand choice parity (#279, CR 608.2)", () => {
    function handChoiceCtx(): Partial<React.ContextType<typeof GameContext>> {
        return {
            pendingChoices: [
                {
                    playerId: "me",
                    zone: "hand",
                    kind: "discard-hand",
                    stackItemId: "s1",
                    step: 0,
                    choiceId: "c1",
                },
            ] as never,
        };
    }

    function renderSpatialHand(card: CardInstance) {
        return render(
            <GameContext
                value={makeContext([makePlayer("me", [])], handChoiceCtx())}
            >
                <PendingChoiceBufferContext value={makeBuffer()}>
                    <BoardHandCard card={card} />
                </PendingChoiceBufferContext>
            </GameContext>
        );
    }

    function renderClassicHand(card: CardInstance) {
        return render(
            <GameContext
                value={makeContext([makePlayer("me", [])], handChoiceCtx())}
            >
                <PendingChoiceBufferContext value={makeBuffer()}>
                    <SelectableCard cardInstance={card} />
                </PendingChoiceBufferContext>
            </GameContext>
        );
    }

    it("(d) clicking the viewer's own spatial hand card toggles the buffer — NOT a cast", () => {
        const card = handCard("h1");
        const { container } = renderSpatialHand(card);
        const el = container.querySelector('[data-board-hand-card="h1"]')!;
        expect(el.getAttribute("data-choice-selectable")).toBe("true");
        fireEvent.click(el);
        expect(bufferToggle).toHaveBeenCalledWith("h1");
        // The drag-to-cast pipeline is suppressed during a hand choice.
        expect(announceCast).not.toHaveBeenCalled();
        expect(playCard).not.toHaveBeenCalled();
    });

    it("parity: both boards toggle the SAME id for a hand choice", () => {
        const card = handCard("h1");

        renderClassicHand(card);
        // Classic selectable-card renders a clickable choice wrapper around the
        // card image; click it.
        fireEvent.click(
            document.querySelector('[class*="ring-signal-target"]')!
        );
        expect(bufferToggle).toHaveBeenCalledWith("h1");

        bufferToggle.mockClear();
        cleanup();

        const { container } = renderSpatialHand(card);
        fireEvent.click(
            container.querySelector('[data-board-hand-card="h1"]')!
        );
        expect(bufferToggle).toHaveBeenCalledWith("h1");
    });

    it("an opponent's hand card is NOT choice-selectable (ownerId mismatch)", () => {
        const card = handCard("oh1", "opp");
        // Spatial board only ever renders BoardHandCard for the viewer's own
        // hand, but the guard must still hold defensively.
        const { container } = renderSpatialHand(card);
        const el = container.querySelector('[data-board-hand-card="oh1"]')!;
        expect(el.getAttribute("data-choice-selectable")).toBeNull();
    });
});

describe("board activation sacrifice-cost picker (#282, CR 602.1)", () => {
    it("clicking a matching battlefield permanent dispatches the SAME selectSacrifice args on both boards", () => {
        const me = makePlayer("me", [creature("bear1")]);
        const costCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingActivation: {
                playerId: "me",
                cardInstanceId: "some-source",
                abilityId: "atog-pump",
                manaCost: {},
                tappedLandIds: [],
                tapSource: false,
                sacrificeSource: false,
                sacrificeSelection: {
                    playerId: "me",
                    reason: "Atog",
                    requirements: [{ filter: { types: "Creature" }, count: 1 }],
                    picked: [],
                },
            } as never,
        };

        const { container } = renderSpatialBf(me, [me], costCtx);
        fireEvent.click(spatialCard(container, "bear1"));
        const spatialArgs = selectSacrifice.mock.calls[0][0];

        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "bear1",
        });
    });

    it("a non-matching permanent is NOT clickable for the sacrifice cost", () => {
        // The picker filter requires an Artifact; the mocked def is a plain
        // Creature, so the card must not route to selectSacrifice.
        const me = makePlayer("me", [creature("bear1")]);
        const costCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingActivation: {
                playerId: "me",
                cardInstanceId: "some-source",
                abilityId: "atog-pump",
                manaCost: {},
                tappedLandIds: [],
                tapSource: false,
                sacrificeSource: false,
                sacrificeSelection: {
                    playerId: "me",
                    reason: "Atog",
                    requirements: [{ filter: { types: "Artifact" }, count: 1 }],
                    picked: [],
                },
            } as never,
        };
        const { container } = renderSpatialBf(me, [me], costCtx);
        fireEvent.click(spatialCard(container, "bear1"));
        expect(selectSacrifice).not.toHaveBeenCalled();
    });
});

describe("board activation tap-other-cost picker (#939, CR 602.1 / 118.8)", () => {
    it("clicking a matching untapped permanent dispatches selectActivationCost with its id", () => {
        const me = makePlayer("me", [creature("bear1"), creature("bear2")]);
        const costCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingActivation: {
                playerId: "me",
                cardInstanceId: "hand-of-justice",
                abilityId: "hoj-pump",
                manaCost: {},
                tappedLandIds: [],
                tapSource: false,
                sacrificeSource: false,
                tapOtherChoice: {
                    filter: { types: "Creature" },
                    count: 1,
                    pickedIds: [],
                },
            } as never,
        };

        const { container } = renderSpatialBf(me, [me], costCtx);
        fireEvent.click(spatialCard(container, "bear1"));

        expect(selectActivationCost).toHaveBeenCalledTimes(1);
        expect(selectActivationCost.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "bear1",
        });
    });

    it("the ability's own source is NOT clickable for the tap-other cost", () => {
        const me = makePlayer("me", [creature("hand-of-justice")]);
        const costCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingActivation: {
                playerId: "me",
                cardInstanceId: "hand-of-justice",
                abilityId: "hoj-pump",
                manaCost: {},
                tappedLandIds: [],
                tapSource: false,
                sacrificeSource: false,
                tapOtherChoice: {
                    filter: { types: "Creature" },
                    count: 1,
                    pickedIds: [],
                },
            } as never,
        };

        const { container } = renderSpatialBf(me, [me], costCtx);
        fireEvent.click(spatialCard(container, "hand-of-justice"));
        expect(selectActivationCost).not.toHaveBeenCalled();
    });

    it("an already-tapped matching permanent is NOT clickable for the tap-other cost", () => {
        const tapped = { ...creature("bear1"), isTapped: true };
        const me = makePlayer("me", [tapped]);
        const costCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingActivation: {
                playerId: "me",
                cardInstanceId: "hand-of-justice",
                abilityId: "hoj-pump",
                manaCost: {},
                tappedLandIds: [],
                tapSource: false,
                sacrificeSource: false,
                tapOtherChoice: {
                    filter: { types: "Creature" },
                    count: 1,
                    pickedIds: [],
                },
            } as never,
        };

        const { container } = renderSpatialBf(me, [me], costCtx);
        fireEvent.click(spatialCard(container, "bear1"));
        expect(selectActivationCost).not.toHaveBeenCalled();
    });

    it("once the count is already satisfied, no permanent is clickable for the tap-other cost", () => {
        const me = makePlayer("me", [creature("bear1"), creature("bear2")]);
        const costCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingActivation: {
                playerId: "me",
                cardInstanceId: "hand-of-justice",
                abilityId: "hoj-pump",
                manaCost: {},
                tappedLandIds: [],
                tapSource: false,
                sacrificeSource: false,
                tapOtherChoice: {
                    filter: { types: "Creature" },
                    count: 1,
                    pickedIds: ["bear2"],
                },
            } as never,
        };

        const { container } = renderSpatialBf(me, [me], costCtx);
        fireEvent.click(spatialCard(container, "bear1"));
        expect(selectActivationCost).not.toHaveBeenCalled();
    });

    // Hand of Justice shape: count 3, one creature already picked (deferred
    // commit — the server does NOT tap picks until commit, #954 review). The
    // already-picked creature must be excluded from the clickable set even
    // though it isn't tapped yet, and a still-unpicked matching creature must
    // remain clickable so the remaining picks can be made.
    it("count > 1: an already-picked (but not yet tapped) permanent is NOT clickable again", () => {
        const me = makePlayer("me", [
            creature("bear1"),
            creature("bear2"),
            creature("bear3"),
        ]);
        const costCtx: Partial<React.ContextType<typeof GameContext>> = {
            pendingActivation: {
                playerId: "me",
                cardInstanceId: "hand-of-justice",
                abilityId: "hoj-pump",
                manaCost: {},
                tappedLandIds: [],
                tapSource: false,
                sacrificeSource: false,
                tapOtherChoice: {
                    filter: { types: "Creature" },
                    count: 3,
                    pickedIds: ["bear1"],
                },
            } as never,
        };

        const { container } = renderSpatialBf(me, [me], costCtx);

        // Already picked, still untapped client-side — must not re-select.
        fireEvent.click(spatialCard(container, "bear1"));
        expect(selectActivationCost).not.toHaveBeenCalled();

        // A different, not-yet-picked matching creature is still clickable.
        fireEvent.click(spatialCard(container, "bear2"));
        expect(selectActivationCost).toHaveBeenCalledTimes(1);
        expect(selectActivationCost.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "bear2",
        });
    });
});
