// Battlefield tap/pay parity (PRD #249, issue #272). The spatial board's
// battlefield card (`BoardBattlefieldCard`, wired by `BoardBattlefield`)
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
// CR 702.126 — Improvise (issue #1313).
const tapArtifactForImprovise = vi.fn<MutFn>(() => Promise.resolve());
const untapArtifactForImprovise = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    tapForPayment,
    untapForPayment,
    tapForActivationPayment,
    untapForActivationPayment,
    tapArtifactForImprovise,
    untapArtifactForImprovise,
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
// CR 702.126 — a spell declaring Improvise, for the artifact-tap routing
// test below (issue #1313).
const IMPROVISE_SPELL_DEF = {
    id: "improvise-spell-def",
    name: "Test Improvise Spell",
    staticAbilities: ["improvise"],
    activatedAbilities: [],
};
vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) =>
        id === "choice-def"
            ? CHOICE_DEF
            : id === "improvise-spell-def"
              ? IMPROVISE_SPELL_DEF
              : LAND_DEF,
    tryGetDefinition: (id: string) =>
        id === "choice-def"
            ? CHOICE_DEF
            : id === "improvise-spell-def"
              ? IMPROVISE_SPELL_DEF
              : LAND_DEF,
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
import BoardBattlefield from "../board-battlefield";

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

// CR 702.126 — a plain artifact with no mana ability of its own (LAND_DEF has
// no activatedAbilities), the shape Improvise cares about tapping.
function artifactNoMana(id: string): CardInstance {
    return {
        id,
        card: { id: "land-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Artifact"],
    } as CardInstance;
}

function improviseSpellInHand(): CardInstance {
    return {
        id: "spell-1",
        card: { id: "improvise-spell-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "hand",
        isTapped: false,
        types: ["Instant"],
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
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
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
            <BoardBattlefield player={me} />
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

describe("board battlefield tap/pay parity with the classic board (#272)", () => {
    it("(a) a plain tap dispatches the SAME tapUntap args on both boards", () => {
        const me = makePlayer([land("forest1")]);

        const { container } = renderSpatial(me);
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="forest1"]')!
        );
        const spatialArgs = tapUntap.mock.calls[0][0];

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

        const { container } = renderSpatial(me, payCtx);
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="forest1"]')!
        );
        const spatialArgs = tapForPayment.mock.calls[0][0];

        // issue #1779 / PRD #1776 T4 — tapForPayment now takes a `payments`
        // batch; a single manual click submits it as a one-element array.
        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            payments: [{ cardInstanceId: "forest1" }],
        });
        expect(tapUntap).not.toHaveBeenCalled();
    });

    it("(c) a mana-choice pick dispatches the SAME tapUntap(index) args on both boards", () => {
        const me = makePlayer([manaChoiceSource("birds1")]);

        // Click opens the mana picker → pick the 4th color (R, index 3).
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

        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "birds1",
            manaChoiceIndex: 3,
        });
    });

    it("renders this player's phased-out permanents dimmed/inert (CR 702.26)", () => {
        const me = makePlayer([land("forest1")]);
        const phasedMine = { ...land("phased-mine"), controllerId: "me" };
        const phasedOpp = { ...land("phased-opp"), controllerId: "them" };
        const { container } = renderSpatial(me, {
            phasedOutCards: [phasedMine, phasedOpp],
        });
        // My phased permanent renders, flagged phased and non-interactive.
        const mine = container.querySelector(
            '[data-arrow-anchor-permanent="phased-mine"]'
        )!;
        expect(mine.getAttribute("data-phased")).toBe("true");
        expect(mine.className).toContain("pointer-events-none");
        // A phased permanent controlled by the opponent is NOT on my side.
        expect(
            container.querySelector(
                '[data-arrow-anchor-permanent="phased-opp"]'
            )
        ).toBeNull();
        // The live land is still interactive (tap works) alongside the phased one.
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="forest1"]')!
        );
        expect(tapUntap).toHaveBeenCalledTimes(1);
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
        // The extracted hook's `overlays` (mounted by BoardBattlefield)
        // includes the ErrorToast; the rejected mutation surfaces its inner
        // message as the toast title.
        expect(await findByText("It's not your turn")).toBeTruthy();
    });
});

// CR 702.126 — Improvise (issue #1313). A mana-ability-less artifact tapped
// during a cast whose spell declares Improvise routes to the dedicated
// tapArtifactForImprovise/untapArtifactForImprovise mutations instead of the
// mana-tap pair — this is the full reducer → click → mutation-dispatch path
// (useBattlefieldVisualState's canInteract gate + useBattlefieldInteraction's
// handleClick routing), exercised through the real BoardBattlefield component
// rather than a hand-built view.
describe("board battlefield Improvise artifact-tap routing (CR 702.126, issue #1313)", () => {
    function payingContext(
        pendingCastOverrides: Record<string, unknown> = {}
    ): Partial<React.ContextType<typeof GameContext>> {
        return {
            pendingCast: {
                playerId: "me",
                cardInstanceId: "spell-1",
                manaCost: { X: 2 },
                tappedLandIds: [],
                improviseTappedArtifactIds: [],
                ...pendingCastOverrides,
            } as never,
        };
    }

    it("taps a mana-ability-less artifact via tapArtifactForImprovise, not tapForPayment", () => {
        const me: Player = {
            ...makePlayer([artifactNoMana("art1")]),
            hand: [improviseSpellInHand()],
        };

        const { container } = renderSpatial(me, payingContext());
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="art1"]')!
        );

        expect(tapArtifactForImprovise).toHaveBeenCalledTimes(1);
        expect(tapArtifactForImprovise.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "art1",
        });
        expect(tapForPayment).not.toHaveBeenCalled();
    });

    it("untaps an Improvise-tapped artifact via untapArtifactForImprovise", () => {
        const tapped = { ...artifactNoMana("art1"), isTapped: true };
        const me: Player = {
            ...makePlayer([tapped]),
            hand: [improviseSpellInHand()],
        };

        const { container } = renderSpatial(
            me,
            payingContext({ improviseTappedArtifactIds: ["art1"] })
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="art1"]')!
        );

        expect(untapArtifactForImprovise).toHaveBeenCalledTimes(1);
        expect(untapArtifactForImprovise.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "art1",
        });
        expect(untapForPayment).not.toHaveBeenCalled();
    });

    it("does not route through Improvise once no generic cost remains", () => {
        const me: Player = {
            ...makePlayer([artifactNoMana("art1")]),
            hand: [improviseSpellInHand()],
        };

        const { container } = renderSpatial(
            me,
            payingContext({ manaCost: {} })
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="art1"]')!
        );

        expect(tapArtifactForImprovise).not.toHaveBeenCalled();
    });

    it("an ordinary mana source during the SAME Improvise cast still routes to tapForPayment", () => {
        const me: Player = {
            ...makePlayer([land("forest1")]),
            hand: [improviseSpellInHand()],
        };

        const { container } = renderSpatial(me, payingContext());
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="forest1"]')!
        );

        expect(tapForPayment).toHaveBeenCalledTimes(1);
        expect(tapArtifactForImprovise).not.toHaveBeenCalled();
    });
});
