// Attack a planeswalker — visual state affordance (issue #1220, CR 508.1a).
//
// While the active player is declaring attackers, the DEFENDING player's
// planeswalkers must read as clickable attack targets, and a planeswalker that
// already has an attacker pointed at it (`combat.attackTargets`) reads with the
// committed (emerald) ring. Driven THROUGH the shared visual-state reducer with
// a projected-shape context (no hand-built override of the surface), so a
// dropped `attackTargets` field would fail here.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
    }),
}));

const PLAIN_DEF = { id: "plain-def", name: "Test", staticEffects: [] };
vi.mock("@convex/cards", () => ({
    getDefinition: () => PLAIN_DEF,
    tryGetDefinition: () => PLAIN_DEF,
}));

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
    // The planeswalker sits on the OPPONENT's board, so drive the hook for opp.
    return renderHook(() => useBattlefieldVisualState(opp), { wrapper });
}

describe("useBattlefieldVisualState — attack a planeswalker (#1220, CR 508.1a)", () => {
    it("a defending planeswalker is clickable while attackers are declared", () => {
        const atk = creature();
        const pw = planeswalker();
        const me = player("me", [atk]);
        const opp = player("opp", [pw]);
        const { result } = renderForOpponent(me, opp);

        expect(result.current.canInteract(pw)).toBe(true);
        expect(result.current.getVisualState(pw).interactive).toBe(true);
        expect(result.current.getVisualState(pw).enabled).toBe(true);
    });

    it("a planeswalker under attack (attackTargets) reads with the committed emerald ring", () => {
        const atk = creature();
        const pw = planeswalker();
        const me = player("me", [atk]);
        const opp = player("opp", [pw]);
        const { result } = renderForOpponent(me, opp, {
            attackTargets: { atk1: "pw1" },
        });

        const vs = result.current.getVisualState(pw);
        expect(vs.ringClass).toContain("signal-self");
    });

    it("with no attacker declared yet, the planeswalker is not an attack target", () => {
        const pw = planeswalker();
        const me = player("me", []);
        const opp = player("opp", [pw]);
        const { result } = renderForOpponent(me, opp, { attackerIds: [] });

        expect(result.current.canInteract(pw)).toBe(false);
    });

    it("an opponent creature (non-planeswalker) is NOT an attack target", () => {
        const atk = creature();
        const oppCreature = creature({
            id: "oppc",
            controllerId: "opp",
            ownerId: "opp",
        });
        const me = player("me", [atk]);
        const opp = player("opp", [oppCreature]);
        const { result } = renderForOpponent(me, opp);

        expect(result.current.canInteract(oppCreature)).toBe(false);
    });
});
