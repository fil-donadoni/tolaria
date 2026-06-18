// Combat declaration parity on the spatial board (PRD #249, issue #281).
//
// The spatial battlefield card (`BoardNextBattlefieldCard`, wired by
// `BoardNextBattlefield`) and the classic board (`PlayerBattlefield`) BOTH
// consume the extracted `useBattlefieldInteraction` hook, so a combat click
// must dispatch the SAME GRE-boundary mutation with the SAME args on either
// board. This file asserts that parity for:
//  (a) attacker toggle (DECLARE_ATTACKERS, active player)   → toggleAttacker
//  (a') the client-side "must attack if able" guard          → NO dispatch
//  (b) blocker select (DECLARE_BLOCKERS, defender)           → selectBlocker
//  (c) blocker-target assign (pending blocker, defender)     → assignBlockerTarget
//  (d) a multi-color source is DECLARED, not opening its mana picker, during a
//      combat sub-step (matches the classic `handleClickWithEvent` guard).
// It also asserts the band-formation and damage-assignment panels mount at the
// right combat steps on the spatial board (`CombatPanels`, the same panels the
// classic board mounts).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

// --- Mutation capture ---
type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const toggleAttacker = vi.fn<MutFn>(() => Promise.resolve());
const selectBlocker = vi.fn<MutFn>(() => Promise.resolve());
const assignBlockerTarget = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    toggleAttacker,
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
        "toggleAttacker",
        "selectBlocker",
        "assignBlockerTarget",
        "selectTarget",
        "selectAdditionalCost",
        "activateAbility",
        "createBand",
        "removeBand",
        "setDamageAssignment",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

// Card registry. A plain creature has no attack requirement; the "must attack"
// creature carries an `attack-requirement` static effect; the multi-color
// source returns a Birds-of-Paradise-style `manaChoices` ability.
const PLAIN_DEF = { id: "plain-def", name: "Grizzly Bears", staticEffects: [] };
const MUST_ATTACK_DEF = {
    id: "must-attack-def",
    name: "Juggernaut",
    staticEffects: [{ kind: "attack-requirement" }],
};
const CHOICE_DEF = {
    id: "choice-def",
    name: "Birds of Paradise",
    staticEffects: [],
    activatedAbilities: [
        {
            id: "birds-mana",
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            cost: { tap: true },
        },
    ],
};
const REGISTRY: Record<string, unknown> = {
    "plain-def": PLAIN_DEF,
    "must-attack-def": MUST_ATTACK_DEF,
    "choice-def": CHOICE_DEF,
};
vi.mock("@convex/cards", () => ({
    getCardById: (id: string) => REGISTRY[id] ?? PLAIN_DEF,
    tryGetCardById: (id: string) => REGISTRY[id] ?? PLAIN_DEF,
}));

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

// Thin panel shells: assert that the parent mounts the right panel at the right
// combat step without fighting each panel's internal early-return.
vi.mock("../band-formation-panel", () => ({
    default: () => <div data-testid="band-panel" />,
}));
vi.mock("../damage-assignment-panel", () => ({
    default: () => <div data-testid="damage-panel" />,
}));

import BoardNextBattlefield from "../board-next-battlefield";
import PlayerBattlefield from "../player-battlefield";

function creature(id: string, defId: string): CardInstance {
    return {
        id,
        card: { id: defId },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: [],
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

type Ctx = NonNullable<React.ContextType<typeof GameContext>>;
type Combat = NonNullable<Ctx["combat"]>;

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

const attackCombat = (attackerIds: string[] = []): Combat =>
    ({
        attackerIds,
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
    }) as Combat;

describe("board-next combat declaration parity with the classic board (#281)", () => {
    it("(a) attacker toggle dispatches the SAME toggleAttacker args on both boards", () => {
        const me = makePlayer("me", [creature("bear1", "plain-def")]);
        const ctx: Partial<React.ContextType<typeof GameContext>> = {
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "me",
            combat: attackCombat([]),
        };

        renderClassic(me, ctx);
        fireEvent.click(document.querySelector('[data-classic-card="bear1"]')!);
        const classicArgs = toggleAttacker.mock.calls[0][0];

        clearAll();
        cleanup();

        const { container } = renderSpatial(me, ctx);
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="bear1"]')!
        );
        const spatialArgs = toggleAttacker.mock.calls[0][0];

        expect(spatialArgs).toEqual(classicArgs);
        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "bear1",
        });
    });

    it("(a') the must-attack guard blocks deselection identically on both boards (no dispatch)", () => {
        // An already-selected attacker with an attack-requirement, untapped and
        // not summoning sick, cannot be deselected (CR 508.1d).
        const jugg = creature("jugg1", "must-attack-def");
        const me = makePlayer("me", [jugg]);
        const ctx: Partial<React.ContextType<typeof GameContext>> = {
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "me",
            combat: attackCombat(["jugg1"]),
        };

        renderClassic(me, ctx);
        fireEvent.click(document.querySelector('[data-classic-card="jugg1"]')!);
        expect(toggleAttacker).not.toHaveBeenCalled();

        cleanup();

        const { container } = renderSpatial(me, ctx);
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="jugg1"]')!
        );
        expect(toggleAttacker).not.toHaveBeenCalled();
    });

    it("(b) blocker select dispatches the SAME selectBlocker args on both boards", () => {
        // Defender's perspective: viewer == defender, attacker is the opponent.
        // A legal blocker must be able to block at least one declared attacker,
        // so the opponent fields an attacker that `blk1` can block.
        const me = makePlayer("me", [creature("blk1", "plain-def")]);
        const oppAttacker = {
            ...creature("atk1", "plain-def"),
            controllerId: "opp",
            ownerId: "opp",
            isAttacking: true,
        } as CardInstance;
        const opp = makePlayer("opp", [oppAttacker]);
        const ctx: Partial<React.ContextType<typeof GameContext>> = {
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "opp", // the attacking player
            priorityPlayerId: "me",
            combat: attackCombat(["atk1"]),
            allPlayers: [opp, me],
        };

        renderClassic(me, ctx);
        fireEvent.click(document.querySelector('[data-classic-card="blk1"]')!);
        const classicArgs = selectBlocker.mock.calls[0][0];

        clearAll();
        cleanup();

        const { container } = renderSpatial(me, ctx);
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="blk1"]')!
        );
        const spatialArgs = selectBlocker.mock.calls[0][0];

        expect(spatialArgs).toEqual(classicArgs);
        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "blk1",
        });
    });

    it("(c) blocker-target assign dispatches the SAME assignBlockerTarget args on both boards", () => {
        // A pending blocker exists; clicking an opponent's attacker assigns it.
        // The attacker lives on the active (opponent) player's battlefield and
        // is flagged `isAttacking`; the defender (viewer) clicks it.
        const attacker = {
            ...creature("atk1", "plain-def"),
            controllerId: "opp",
            ownerId: "opp",
            isAttacking: true,
        } as CardInstance;
        const opp = makePlayer("opp", [attacker]);
        const me = makePlayer("me", []);
        const combat = {
            ...attackCombat([]),
            pendingBlockerId: "blk1",
        } as Combat;
        const ctx: Partial<React.ContextType<typeof GameContext>> = {
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "opp",
            priorityPlayerId: "me",
            combat,
            allPlayers: [opp, me],
        };

        // Classic: render the OPPONENT's battlefield (where the attacker lives)
        // from the viewer's seat.
        render(
            <GameContext value={makeContext(me, ctx)}>
                <PlayerBattlefield player={opp} />
            </GameContext>
        );
        fireEvent.click(document.querySelector('[data-classic-card="atk1"]')!);
        const classicArgs = assignBlockerTarget.mock.calls[0][0];

        clearAll();
        cleanup();

        const spatial = render(
            <GameContext value={makeContext(me, ctx)}>
                <BoardNextBattlefield player={opp} />
            </GameContext>
        );
        fireEvent.click(
            spatial.container.querySelector(
                '[data-arrow-anchor-permanent="atk1"]'
            )!
        );
        const spatialArgs = assignBlockerTarget.mock.calls[0][0];

        expect(spatialArgs).toEqual(classicArgs);
        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            attackerId: "atk1",
        });
    });

    it("(d) a multi-color source is DECLARED as an attacker, not opening its mana picker, during DECLARE_ATTACKERS", () => {
        // Birds of Paradise (multi-color mana source) is a creature attacking;
        // clicking it during attacker declaration must toggle it as an attacker
        // — NOT open the mana-choice picker. Matches the classic guard in
        // `handleClickWithEvent`.
        const birds = creature("birds1", "choice-def");
        const me = makePlayer("me", [birds]);
        const ctx: Partial<React.ContextType<typeof GameContext>> = {
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "me",
            combat: attackCombat([]),
        };

        const { container } = renderSpatial(me, ctx);
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-permanent="birds1"]')!
        );

        expect(toggleAttacker).toHaveBeenCalledTimes(1);
        expect(toggleAttacker.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "birds1",
        });
        // No mana picker was opened (no picker buttons in the DOM).
        const pickerButtons = Array.from(
            document.querySelectorAll("button")
        ).filter((b) => b.getAttribute("title")?.includes("{"));
        expect(pickerButtons.length).toBe(0);
    });
});

describe("board-next mounts the combat panels at the right steps (#281)", () => {
    it("mounts the band-formation panel during DECLARE_ATTACKERS for the active player", () => {
        const me = makePlayer("me", [creature("bear1", "plain-def")]);
        const { queryByTestId } = renderSpatial(me, {
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "me",
            combat: attackCombat(["bear1"]),
        });
        expect(queryByTestId("band-panel")).toBeTruthy();
        expect(queryByTestId("damage-panel")).toBeNull();
    });

    it("does NOT mount the band panel for the defender during DECLARE_ATTACKERS", () => {
        const me = makePlayer("me", [creature("bear1", "plain-def")]);
        const { queryByTestId } = renderSpatial(me, {
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "opp", // viewer is the defender
            combat: attackCombat([]),
        });
        expect(queryByTestId("band-panel")).toBeNull();
    });

    it("mounts the damage-assignment panel for the active player during COMBAT_DAMAGE", () => {
        const me = makePlayer("me", [creature("bear1", "plain-def")]);
        const combat = {
            ...attackCombat(["bear1"]),
            confirmed: true,
            blockersConfirmed: true,
            damageConfirmed: false,
        } as Combat;
        const { queryByTestId } = renderSpatial(me, {
            phase: "COMBAT_DAMAGE",
            activePlayerId: "me",
            combat,
        });
        expect(queryByTestId("damage-panel")).toBeTruthy();
        expect(queryByTestId("band-panel")).toBeNull();
    });

    it("mounts neither panel outside combat", () => {
        const me = makePlayer("me", [creature("bear1", "plain-def")]);
        const { queryByTestId } = renderSpatial(me, {
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "me",
        });
        expect(queryByTestId("band-panel")).toBeNull();
        expect(queryByTestId("damage-panel")).toBeNull();
    });
});
