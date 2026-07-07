// Haste vs. summoning sickness during DECLARE_ATTACKERS (issue #937, CR
// 702.10b): a summoning-sick creature IS a legal attacker if it has haste.
// `useBattlefieldVisualState` mirrors the server gate
// (`combat.ts` `validateAttackerEligibility`) so the UI does not gray out a
// creature the engine would happily let attack.
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

const PLAIN_DEF = { id: "plain-def", name: "Grizzly Bears", staticEffects: [] };
vi.mock("@convex/cards", () => ({
    getDefinition: () => PLAIN_DEF,
    tryGetDefinition: () => PLAIN_DEF,
}));

function creature(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "c1",
        card: { id: "plain-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: true,
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

function makeContext(me: Player, overrides: Partial<NonNullable<Ctx>> = {}) {
    return {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "DECLARE_ATTACKERS",
        turn: 1,
        stackCount: 0,
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
        ...overrides,
    } as NonNullable<Ctx>;
}

function renderVisualState(me: Player, ctx: Partial<NonNullable<Ctx>> = {}) {
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={makeContext(me, ctx)}>{children}</GameContext>
    );
    return renderHook(() => useBattlefieldVisualState(me), { wrapper });
}

describe("useBattlefieldVisualState — haste bypasses summoning sickness during attacker declaration (#937, CR 702.10b)", () => {
    it("a summoning-sick creature WITH haste is selectable and not dimmed", () => {
        const hasty = creature({ id: "hasty1", staticAbilities: ["haste"] });
        const me = makePlayer("me", [hasty]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(hasty)).toBe(true);
        expect(result.current.getVisualState(hasty).dimmed).toBe(false);
        expect(result.current.getVisualState(hasty).enabled).toBe(true);
    });

    it("a summoning-sick creature WITHOUT haste remains blocked and dimmed", () => {
        const sick = creature({ id: "sick1" });
        const me = makePlayer("me", [sick]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(sick)).toBe(false);
        expect(result.current.getVisualState(sick).dimmed).toBe(true);
        expect(result.current.getVisualState(sick).enabled).toBe(false);
    });

    it("a tapped creature with haste remains ineligible (haste exempts sickness, not tapped-ness)", () => {
        const tappedHasty = creature({
            id: "tapped-hasty",
            isTapped: true,
            staticAbilities: ["haste"],
        });
        const me = makePlayer("me", [tappedHasty]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(tappedHasty)).toBe(false);
        expect(result.current.getVisualState(tappedHasty).dimmed).toBe(true);
    });

    it("a creature with defender remains ineligible regardless of haste", () => {
        const defenderHasty = creature({
            id: "defender-hasty",
            isSummoningSick: false,
            staticAbilities: ["haste", "defender"],
        });
        const me = makePlayer("me", [defenderHasty]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(defenderHasty)).toBe(false);
        expect(result.current.getVisualState(defenderHasty).dimmed).toBe(true);
    });

    it("a non-summoning-sick, non-hasty creature is selectable as usual", () => {
        const veteran = creature({ id: "vet1", isSummoningSick: false });
        const me = makePlayer("me", [veteran]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(veteran)).toBe(true);
        expect(result.current.getVisualState(veteran).dimmed).toBe(false);
    });
});
