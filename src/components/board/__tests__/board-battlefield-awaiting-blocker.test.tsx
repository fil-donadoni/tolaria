// Issue #10972 — a blocker clicked into the awaiting set (issue #10373, CR
// 509.1a: blockers are declared together) must wear its ring at once, and the
// attacker click that follows must declare the block.
//
// The awaiting set is client-only state (`useAttackSequenceState`), so it never
// changes `player.battlefield`. `BoardBattlefield` used to cache its card nodes
// in a `useMemo` keyed on server state: the nodes kept the previous render's
// ring AND click handler, so the ring never showed and the attacker click ran
// a handler that saw no awaiting blocker — a no-op. In production nobody could
// block (issue #10972, issue #10977).
//
// Unlike `board-combat.test.tsx`, this mounts the REAL sequence provider the
// way `Board` does, so the awaiting set lives in React state and a click has to
// re-render through it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const selectBlocker = vi.fn<MutFn>(() => Promise.resolve());
const assignBlockerTarget = vi.fn<MutFn>(() => Promise.resolve());
const reportError = vi.hoisted(() => vi.fn());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    selectBlocker,
    assignBlockerTarget,
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
        "toggleExert",
        "toggleEnlist",
        "selectBlocker",
        "assignBlockerTarget",
        "selectTarget",
        "selectAdditionalCost",
        "selectActivationCost",
        "selectSacrifice",
        "activateAbility",
        "activateManaAbility",
        "createBand",
        "removeBand",
        "setDamageAssignment",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

const PLAIN_DEF = { id: "plain-def", name: "Grizzly Bears", staticEffects: [] };
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, () => PLAIN_DEF),
    getDefinition: () => PLAIN_DEF,
    tryGetDefinition: () => PLAIN_DEF,
}));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        reportError,
        dismissError: vi.fn(),
    }),
}));

// Inert visuals so the test sees only the gesture, the ring and the dispatch.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
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
vi.mock("../band-formation-panel", () => ({
    default: () => <div data-testid="band-panel" />,
}));
vi.mock("../damage-assignment-panel", () => ({
    default: () => <div data-testid="damage-panel" />,
}));

import BoardBattlefield from "../board-battlefield";
import {
    AttackSequenceContext,
    useAttackSequenceState,
} from "~/hooks/useAttackSequence";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";

function creature(
    id: string,
    owner: string,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: "plain-def" },
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        ...overrides,
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
    } as Player;
}

type Ctx = React.ContextType<typeof GameContext>;

const me = makePlayer("me", [creature("blk1", "me"), creature("blk2", "me")]);
const opp = makePlayer("opp", [
    creature("atk1", "opp", { isTapped: true, isAttacking: true }),
]);

// The vs-Bot position the two reports were filed from: the Bot attacked and
// holds priority, the human owes the block declaration (CR 509.1).
const ctx = {
    gameId: "game-id" as never,
    playerId: "me",
    activePlayerId: "opp",
    priorityPlayerId: "opp",
    phase: "DECLARE_BLOCKERS",
    turn: 6,
    engineTurn: 6,
    stackCount: 0,
    stackItems: [],
    allPlayers: [opp, me],
    showAllCards: false,
    debugAllActions: false,
    expectedInput: { kind: "blockers", playerId: "me" },
    combat: {
        attackerIds: ["atk1"],
        attackedPlayerIds: ["me"],
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    },
} as unknown as Ctx;

/** Mounts both battlefields under the real sequence provider, as `Board`
 *  does: the awaiting set is React state, not a fixture. */
function BlockWindow() {
    const sequence = useAttackSequenceState("6:DECLARE_BLOCKERS:open:blocking");
    return (
        <GameContext value={ctx}>
            <AttackSequenceContext value={sequence}>
                <div data-testid="opp-board">
                    <BoardBattlefield player={opp} />
                </div>
                <div data-testid="my-board">
                    <BoardBattlefield player={me} />
                </div>
            </AttackSequenceContext>
        </GameContext>
    );
}

function slot(container: HTMLElement, id: string): HTMLElement {
    return container.querySelector<HTMLElement>(
        `[data-arrow-anchor-permanent="${id}"]`
    )!;
}

function hasAwaitingRing(container: HTMLElement, id: string): boolean {
    return slot(container, id).querySelector(".card-ring-pending") !== null;
}

beforeEach(() => {
    selectBlocker.mockClear();
    assignBlockerTarget.mockClear();
    reportError.mockClear();
    resetPendingGameIntents();
    cleanup();
});

describe("awaiting blockers re-render the battlefield (issue #10972, CR 509.1a)", () => {
    it("a clicked blocker wears its ring at once, and a second click takes it off", () => {
        const { container } = render(<BlockWindow />);
        expect(hasAwaitingRing(container, "blk1")).toBe(false);

        fireEvent.click(slot(container, "blk1"));
        expect(hasAwaitingRing(container, "blk1")).toBe(true);

        fireEvent.click(slot(container, "blk1"));
        expect(hasAwaitingRing(container, "blk1")).toBe(false);
    });

    it("one blocker click then one attacker click declares the block (CR 509.1b)", async () => {
        const { container } = render(<BlockWindow />);

        fireEvent.click(slot(container, "blk1"));
        fireEvent.click(slot(container, "atk1"));

        await waitFor(() =>
            expect(assignBlockerTarget).toHaveBeenCalledTimes(1)
        );
        expect(selectBlocker).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "blk1",
        });
        expect(assignBlockerTarget).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            attackerId: "atk1",
        });
        expect(reportError).not.toHaveBeenCalled();
    });

    it("two blockers clicked, one attacker click sends both at it", async () => {
        const { container } = render(<BlockWindow />);

        fireEvent.click(slot(container, "blk1"));
        fireEvent.click(slot(container, "blk2"));
        fireEvent.click(slot(container, "atk1"));

        await waitFor(() =>
            expect(assignBlockerTarget).toHaveBeenCalledTimes(2)
        );
        expect(
            selectBlocker.mock.calls.map((c) => c[0]?.cardInstanceId)
        ).toEqual(["blk1", "blk2"]);
    });
});
