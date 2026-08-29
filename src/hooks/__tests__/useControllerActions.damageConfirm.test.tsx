// Confirm Damage completeness gate (issue #2873). `allDamageAssigned` must
// budget on the source's EFFECTIVE power (CR 613.4c, CR 510.1a) — the same
// value the server's `setDamageAssignment` validator and the
// `DamageAssignmentPanel` modal already use. Reading the raw base `power`
// field deadlocked the button (and the Space hotkey, which mirrors the same
// predicate) for any buffed multi-blocked attacker: the panel reads "5/5
// complete" while Confirm stays disabled forever.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import type { EmblemInstance } from "@convex/cards/types";
import { SORIN_LORD_OF_INNISTRAD_EMBLEM_ID } from "@convex/cards/emblems";
import { GameContext } from "~/hooks/useGameContext";

const calls: { ref: string; args: unknown }[] = [];
vi.mock("convex/react", () => ({
    useMutation: (ref: string) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));
vi.mock("@convex/_generated/api", () => {
    const names = [
        "cancelCast",
        "cancelActivation",
        "confirmAttackers",
        "toggleAttacker",
        "confirmBlockers",
        "confirmDamage",
        "passPriority",
        "autoTapForPayment",
        "autoTapForAttackTax",
        "cancelAttackTax",
        "endTurn",
        "cancelAutoPass",
    ];
    const game: Record<string, string> = {};
    for (const n of names) game[n] = n;
    return { api: { game } };
});
const PLAIN_DEF = { id: "plain", name: "T", staticEffects: [] };
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => PLAIN_DEF,
    tryGetDefinition: () => PLAIN_DEF,
}));
vi.mock("@convex/cards/attackRestrictions", () => ({
    globalAttackProhibitionReason: () => undefined,
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

import { useControllerActions } from "../useControllerActions";

function creature(
    id: string,
    power: number,
    toughness: number,
    controllerId: string,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: "plain" },
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: [],
        power,
        toughness,
        staticAbilities: [],
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

function renderCtrl(
    me: Player,
    opp: Player,
    combatOverrides: Record<string, unknown>,
    emblems?: EmblemInstance[]
) {
    const ctx = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "COMBAT_DAMAGE",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [me, opp],
        emblems,
        combat: {
            attackerIds: [],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
            damageConfirmed: false,
            damageAssignerIds: {},
            damageAssignments: {},
            damageAssignmentConfirmedBy: [],
            ...combatOverrides,
        },
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    return renderHook(() => useControllerActions(), { wrapper });
}

function findAction(
    result: { current: ReturnType<typeof useControllerActions> },
    key: string
) {
    return result.current.actions.find((a) => a.key === key);
}

describe("useControllerActions — Confirm Damage budgets on effective power (#2873)", () => {
    beforeEach(() => {
        calls.length = 0;
    });

    it("enables Confirm Damage once a +1/+1-counter-buffed attacker's assignment totals its EFFECTIVE power", async () => {
        // Base 4/1 token, one +1/+1 counter -> effective power 5. Blocked by a
        // 2/2 and a 1/3 (lethal thresholds 2 and 3, matching #2873's report).
        const source = creature("token-2", 4, 1, "me", {
            counters: { "+1/+1": 1 },
        });
        const blocker1 = creature("b1", 2, 2, "opp");
        const blocker2 = creature("b2", 1, 3, "opp");
        const me = player("me", [source]);
        const opp = player("opp", [blocker1, blocker2]);

        const { result } = renderCtrl(me, opp, {
            damageAssignerIds: { "token-2": "me" },
            damageAssignments: { "token-2": { b1: 2, b2: 3 } }, // total 5
        });

        const action = findAction(result, "confirm-damage");
        expect(action).toBeDefined();
        expect(action!.disabled).toBe(false);

        await act(async () => {
            await action!.onClick();
        });
        expect(calls.some((c) => c.ref === "confirmDamage")).toBe(true);
    });

    it("Space fires confirmDamage once the buffed attacker's assignment is complete", () => {
        const source = creature("token-2", 4, 1, "me", {
            counters: { "+1/+1": 1 },
        });
        const blocker1 = creature("b1", 2, 2, "opp");
        const blocker2 = creature("b2", 1, 3, "opp");
        const me = player("me", [source]);
        const opp = player("opp", [blocker1, blocker2]);

        renderCtrl(me, opp, {
            damageAssignerIds: { "token-2": "me" },
            damageAssignments: { "token-2": { b1: 2, b2: 3 } },
        });

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Space" })
            );
        });
        expect(calls.some((c) => c.ref === "confirmDamage")).toBe(true);
    });

    it("does NOT enable Confirm Damage for a stored total equal to base power once effective power is buffed", () => {
        // Same fixture, but assign only 4 (the OLD base-power reading of
        // "complete") -- 4 !== effective 5, so it must read incomplete.
        const source = creature("token-2", 4, 1, "me", {
            counters: { "+1/+1": 1 },
        });
        const blocker1 = creature("b1", 2, 2, "opp");
        const blocker2 = creature("b2", 1, 3, "opp");
        const me = player("me", [source]);
        const opp = player("opp", [blocker1, blocker2]);

        const { result } = renderCtrl(me, opp, {
            damageAssignerIds: { "token-2": "me" },
            damageAssignments: { "token-2": { b1: 2, b2: 2 } }, // total 4
        });

        expect(findAction(result, "confirm-damage")!.disabled).toBe(true);
    });

    it("reads a shrunk source's base-power-equal total as incomplete", () => {
        // 3/3 base, -2/-0 temporary mod -> effective power 1. A stored total
        // equal to the (now stale) base power, 3, must NOT read as complete.
        const source = creature("shrunk", 3, 3, "me", {
            temporaryPTMods: [{ power: -2, toughness: 0 }],
        });
        const blocker = creature("b1", 1, 3, "opp");
        const me = player("me", [source]);
        const opp = player("opp", [blocker]);

        const { result } = renderCtrl(me, opp, {
            damageAssignerIds: { shrunk: "me" },
            damageAssignments: { shrunk: { b1: 3 } },
        });

        expect(findAction(result, "confirm-damage")!.disabled).toBe(true);
    });

    it("folds a command-zone emblem anthem into the budget", () => {
        // Base 2/1 attacker + Sorin, Lord of Innistrad's "+1/+0" emblem ->
        // effective power 3.
        const source = creature("archers", 2, 1, "me");
        const blocker = creature("b1", 3, 3, "opp");
        const me = player("me", [source]);
        const opp = player("opp", [blocker]);
        const sorinEmblem: EmblemInstance = {
            id: "emblem-1",
            ownerId: "me",
            emblemId: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID,
            name: "Sorin, Lord of Innistrad emblem",
            text: "Creatures you control get +1/+0.",
        };

        const { result } = renderCtrl(
            me,
            opp,
            {
                damageAssignerIds: { archers: "me" },
                damageAssignments: { archers: { b1: 3 } },
            },
            [sorinEmblem]
        );

        expect(findAction(result, "confirm-damage")!.disabled).toBe(false);
    });

    it("unbuffed source still gates on base power (regression)", () => {
        const source = creature("vanilla", 2, 2, "me");
        const blocker = creature("b1", 3, 3, "opp");
        const me = player("me", [source]);
        const opp = player("opp", [blocker]);

        const incomplete = renderCtrl(me, opp, {
            damageAssignerIds: { vanilla: "me" },
            damageAssignments: { vanilla: { b1: 1 } },
        });
        expect(findAction(incomplete.result, "confirm-damage")!.disabled).toBe(
            true
        );

        const complete = renderCtrl(me, opp, {
            damageAssignerIds: { vanilla: "me" },
            damageAssignments: { vanilla: { b1: 2 } },
        });
        expect(findAction(complete.result, "confirm-damage")!.disabled).toBe(
            false
        );
    });
});
