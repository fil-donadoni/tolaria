// Attack a planeswalker — click routing (issue #1220, CR 508.1a).
//
// Clicking a defending planeswalker during DECLARE_ATTACKERS must dispatch
// `toggleAttacker` with the chosen attacker + `planeswalkerId`, sending that
// attacker at the planeswalker. Drives the real `useBattlefieldInteraction`
// hook (its `handleClick`) so the click branch + the canInteract gate + the
// projected `combat.attackTargets` shape are all exercised together.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const toggleAttacker = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = { toggleAttacker };

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

const PLAIN_DEF = { id: "plain-def", name: "Test", staticEffects: [] };
vi.mock("@convex/cards", () => ({
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
        reportError: vi.fn(),
        dismissError: vi.fn(),
    }),
}));

// Import AFTER mocks are registered.
import { useBattlefieldInteraction } from "../useBattlefieldInteraction";
import {
    AttackSequenceContext,
    type AttackSequence,
} from "~/hooks/useAttackSequence";

function creature(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "atk1",
        card: { id: "plain-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        ...overrides,
    } as CardInstance;
}

function planeswalker(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "pw1",
        card: { id: "plain-def" },
        controllerId: "opp",
        ownerId: "opp",
        zone: "battlefield",
        isTapped: false,
        types: ["Planeswalker"],
        subtypes: [],
        staticAbilities: [],
        counters: { loyalty: 4 },
        ...overrides,
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

type Ctx = React.ContextType<typeof GameContext>;

function renderForOpponent(
    me: Player,
    opp: Player,
    combatOverrides: Record<string, unknown> = {}
) {
    const ctx = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "DECLARE_ATTACKERS",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [me, opp],
        showAllCards: false,
        debugAllActions: false,
        combat: {
            attackerIds: ["atk1"],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
            ...combatOverrides,
        },
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    return renderHook(() => useBattlefieldInteraction(opp), { wrapper });
}

describe("useBattlefieldInteraction — attack a planeswalker (#1220, CR 508.1a)", () => {
    beforeEach(() => {
        toggleAttacker.mockClear();
    });

    it("clicking a defending planeswalker sends the declared attacker at it", () => {
        const atk = creature();
        const pw = planeswalker();
        const me = player("me", [atk]);
        const opp = player("opp", [pw]);
        const { result } = renderForOpponent(me, opp);

        result.current.handleClick(pw);

        expect(toggleAttacker).toHaveBeenCalledTimes(1);
        expect(toggleAttacker).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "atk1",
            planeswalkerId: "pw1",
        });
    });

    it("does not fire when no attacker has been declared", () => {
        const pw = planeswalker();
        const me = player("me", []);
        const opp = player("opp", [pw]);
        const { result } = renderForOpponent(me, opp, { attackerIds: [] });

        result.current.handleClick(pw);
        expect(toggleAttacker).not.toHaveBeenCalled();
    });
});

// "Attack with all" destination sequence (design 2026-07-23) — while the
// sequence is active, a planeswalker click targets the CURRENT sequence
// attacker (not the last-declared heuristic) and advances the cursor.
describe("useBattlefieldInteraction — attack-with-all sequence routing", () => {
    beforeEach(() => toggleAttacker.mockClear());

    function seq(overrides: Partial<AttackSequence> = {}): AttackSequence {
        return {
            active: true,
            order: ["atk1", "atk2"],
            index: 0,
            currentAttackerId: "atk1",
            begin: vi.fn(),
            advance: vi.fn(),
            reset: vi.fn(),
            ...overrides,
        };
    }

    function renderWithSequence(
        me: Player,
        opp: Player,
        s: AttackSequence,
        combatOverrides: Record<string, unknown> = {}
    ) {
        const ctx = {
            gameId: "game-id",
            playerId: "me",
            activePlayerId: "me",
            priorityPlayerId: "me",
            phase: "DECLARE_ATTACKERS",
            turn: 1,
            engineTurn: 1,
            stackCount: 0,
            allPlayers: [me, opp],
            showAllCards: false,
            debugAllActions: false,
            combat: {
                attackerIds: ["atk1", "atk2"],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
                ...combatOverrides,
            },
        } as unknown as NonNullable<React.ContextType<typeof GameContext>>;
        const wrapper = ({ children }: { children: ReactNode }) => (
            <GameContext value={ctx}>
                <AttackSequenceContext value={s}>
                    {children}
                </AttackSequenceContext>
            </GameContext>
        );
        return renderHook(() => useBattlefieldInteraction(opp), { wrapper });
    }

    it("targets the current sequence attacker and advances", () => {
        const pw = planeswalker();
        const me = player("me", []);
        const opp = player("opp", [pw]);
        const s = seq({ index: 1, currentAttackerId: "atk2" });
        const { result } = renderWithSequence(me, opp, s);

        result.current.handleClick(pw);

        expect(toggleAttacker).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "atk2",
            planeswalkerId: "pw1",
        });
        expect(s.advance).toHaveBeenCalledTimes(1);
    });

    it("does NOT re-toggle an attacker already on that planeswalker (would de-target it)", () => {
        // The server reads a repeat `planeswalkerId` for an attacker already
        // attacking that planeswalker as a toggle-OFF back to the defending
        // player. Confirming the existing target mid-sequence must be a no-op
        // mutation — but must still advance the cursor.
        const pw = planeswalker();
        const me = player("me", []);
        const opp = player("opp", [pw]);
        const s = seq({ index: 0, currentAttackerId: "atk1" });
        const { result } = renderWithSequence(me, opp, s, {
            attackTargets: { atk1: "pw1" },
        });

        result.current.handleClick(pw);

        expect(toggleAttacker).not.toHaveBeenCalled();
        expect(s.advance).toHaveBeenCalledTimes(1);
    });
});
