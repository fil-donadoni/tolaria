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

// Synthetic Chrome-Mox-shaped mana ability (CR 602.5b, issue #947): a
// `canActivate` predicate gated on an imprint counter, mirroring
// `convex/cards/sets/mrd/colorless.ts` without importing the real card —
// this proves the fix is a general `canActivate` mechanism, not a
// Chrome-Mox-specific special case.
const MOX_DEF = {
    id: "mox-def",
    name: "Test Gated Mox",
    staticEffects: [],
    activatedAbilities: [
        {
            id: "test-mox-mana",
            oracleText: "{T}: Add one mana of the imprinted colour.",
            cost: { tap: true },
            useStack: false,
            canActivate: (source: { counters?: Record<string, number> }) =>
                (source.counters?.["imprint-G"] ?? 0) > 0,
            manaChoices: [{ G: 1 }],
            getManaChoices: (source: { counters?: Record<string, number> }) =>
                (source.counters?.["imprint-G"] ?? 0) > 0 ? [{ G: 1 }] : [],
        },
    ],
};

vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => (id === "mox-def" ? MOX_DEF : PLAIN_DEF),
    tryGetDefinition: (id: string) => (id === "mox-def" ? MOX_DEF : PLAIN_DEF),
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

/** A canActivate-gated mana source (CR 602.5b, issue #947) — an artifact
 *  with the synthetic `MOX_DEF`'s ability. `counters` un-set (or without the
 *  imprint key) means `canActivate` is false, i.e. un-imprinted. */
function moxCard(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "mox1",
        card: { id: "mox-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Artifact"],
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

describe("useBattlefieldVisualState — mana ability canActivate gate (CR 602.5b, issue #947)", () => {
    it("an un-imprinted (ungated) mana source is NOT clickable and NOT highlighted as a mana source", () => {
        const mox = moxCard();
        const me = makePlayer("me", [mox]);
        const { result } = renderVisualState(me, {
            phase: "PRECOMBAT_MAIN",
        });

        expect(result.current.canInteract(mox)).toBe(false);
        expect(result.current.getVisualState(mox).enabled).toBe(false);
    });

    it("an imprinted (gate-satisfied) mana source IS clickable", () => {
        const mox = moxCard({ counters: { "imprint-G": 1 } });
        const me = makePlayer("me", [mox]);
        const { result } = renderVisualState(me, {
            phase: "PRECOMBAT_MAIN",
        });

        expect(result.current.canInteract(mox)).toBe(true);
    });
});

// Multi-element cost picks (Fireblast's two Mountains, Thwart's three
// Islands, CR 701.21a) must show a distinct SELECTED ring on already-committed
// picks — `matchesSacrificePick` excludes picked ids, so without the
// `isCostPicked` branch a chosen permanent would lose its ring entirely and
// the player couldn't tell what they already selected.
describe("useBattlefieldVisualState — multi-pick sacrifice cost selected ring (CR 701.21a)", () => {
    function mountain(id: string): CardInstance {
        return {
            id,
            card: { id: "mountain-def" },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            isTapped: false,
            isSummoningSick: false,
            types: ["Land"],
            subtypes: ["Mountain"],
            staticAbilities: [],
        } as CardInstance;
    }

    // Sacrifice two Mountains; m1 already picked, m2 still eligible.
    function ctxWithSacrifice() {
        return {
            phase: "PRECOMBAT_MAIN",
            combat: undefined,
            pendingCast: {
                playerId: "me",
                sacrificeSelection: {
                    playerId: "me",
                    reason: "Fireblast",
                    requirements: [
                        { filter: { subtypes: ["Mountain"] }, count: 2 },
                    ],
                    picked: ["m1"],
                },
            },
        } as unknown as Partial<NonNullable<Ctx>>;
    }

    it("already-picked permanent shows the solid selected ring", () => {
        const m1 = mountain("m1");
        const m2 = mountain("m2");
        const me = makePlayer("me", [m1, m2]);
        const { result } = renderVisualState(me, ctxWithSacrifice());

        expect(result.current.getVisualState(m1).ringClass).toBe(
            "ring-2 ring-accent rounded-sm"
        );
    });

    it("still-eligible permanent shows the dim candidate ring", () => {
        const m1 = mountain("m1");
        const m2 = mountain("m2");
        const me = makePlayer("me", [m1, m2]);
        const { result } = renderVisualState(me, ctxWithSacrifice());

        expect(result.current.getVisualState(m2).ringClass).toBe(
            "ring-2 ring-accent/40 rounded-sm"
        );
    });
});
