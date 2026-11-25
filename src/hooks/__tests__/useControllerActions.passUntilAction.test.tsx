// Pass Until Action (issue #5782) — the controller's descriptor, shortcut and
// active-state pills. The context carries `passUntilAction` /
// `queuedPassUntilAction` exactly as `projectPublicState` ships them
// (`convex/__tests__/passUntilActionFullPath.test.ts` proves the wire half).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HOTKEYS } from "~/lib/hotkeys";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PassUntilActionIntent, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    AttackSequenceContext,
    type AttackSequence,
} from "~/hooks/useAttackSequence";
import { makeAttackSequence } from "./attack-sequence.fixture";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";
import { selectCommandSlots } from "~/lib/controller-action-slots";

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
        "declareAttackers",
        "confirmBlockers",
        "confirmDamage",
        "passPriority",
        "autoTapForPayment",
        "autoTapForAttackTax",
        "cancelAttackTax",
        "endTurn",
        "passUntilAction",
        "cancelAutoPass",
        "submitMayPay",
        "submitLandEntryChoice",
        "submitDrawReplacementPay",
        "submitMiracleReveal",
    ];
    const game: Record<string, string> = {};
    for (const n of names) game[n] = n;
    return { api: { game } };
});
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => ({ id: "plain", name: "T", staticEffects: [] }),
    tryGetDefinition: () => ({ id: "plain", name: "T", staticEffects: [] }),
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

/** The prompt's primary action — null = no choice of the viewer's is open. */
let mockPrimaryAction: { canConfirm: boolean; confirm: () => void } | null =
    null;
vi.mock("~/hooks/usePendingChoicePrimaryAction", () => ({
    usePendingChoicePrimaryAction: () => mockPrimaryAction,
}));

import { useControllerActions } from "../useControllerActions";

function player(id: string): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as Player;
}

const SEQUENCE: AttackSequence = makeAttackSequence();

function renderCtrl(overrides: {
    priorityPlayerId?: string;
    passUntilAction?: PassUntilActionIntent[];
    queuedPassUntilAction?: PassUntilActionIntent[];
    autoPassPlayers?: string[];
    queuedEndTurn?: string[];
}) {
    const ctx = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [player("me"), player("opp")],
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>
            <AttackSequenceContext value={SEQUENCE}>
                {children}
            </AttackSequenceContext>
        </GameContext>
    );
    return renderHook(() => useControllerActions(), { wrapper });
}

function press(key: string) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function pressEnter() {
    window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Enter", bubbles: true })
    );
}

describe("useControllerActions — Pass Until Action (issue #5782)", () => {
    beforeEach(() => {
        calls.length = 0;
        resetPendingGameIntents();
    });

    it("offers the action beside Pass Turn, in its own slot — never the centre", () => {
        const { result } = renderCtrl({});
        const action = result.current.actions.find(
            (a) => a.key === "pass-until-action"
        );
        expect(action?.label).toBe("Pass Until Action");
        expect(action?.shortcut).toBe(HOTKEYS.passUntilAction);
        // Issue #7423: the P keycap moved to Pass Turn.
        expect(
            result.current.actions.find((a) => a.key === "pass-turn")?.shortcut
        ).toBe(HOTKEYS.passTurn);
        // Issue #9833: Pass shows the Space keycap — the key that passes.
        expect(
            result.current.actions.find((a) => a.key === "pass")?.shortcut
        ).toBe(HOTKEYS.passPriority);
        const slots = selectCommandSlots(result.current.actions);
        expect(slots.passUntilAction).toBe(action);
        expect(slots.primary?.key).toBe("pass");
        expect(slots.secondary).not.toContain(action);
    });

    it("Pass drops the Space keycap while a choice of the viewer's is open — Space confirms the prompt then (issue #9833)", () => {
        mockPrimaryAction = { canConfirm: true, confirm: () => {} };
        try {
            const { result } = renderCtrl({});
            const pass = result.current.actions.find((a) => a.key === "pass");
            expect(pass).toBeDefined();
            expect(pass?.shortcut).toBeUndefined();
        } finally {
            mockPrimaryAction = null;
        }
    });

    it("Pass, Pass Turn and Pass Until Action are disabled while a choice of the viewer's is open (issue #9972, ADR 0047)", () => {
        mockPrimaryAction = { canConfirm: true, confirm: () => {} };
        try {
            const { result } = renderCtrl({});
            for (const key of ["pass", "pass-turn", "pass-until-action"]) {
                expect(
                    result.current.actions.find((a) => a.key === key)?.disabled
                ).toBe(true);
            }
        } finally {
            mockPrimaryAction = null;
        }
    });

    it("P and Enter send no intent while a choice of the viewer's is open (issue #9972)", async () => {
        mockPrimaryAction = { canConfirm: true, confirm: () => {} };
        try {
            renderCtrl({});
            await act(async () => press("P"));
            await act(async () => pressEnter());
            expect(calls).toEqual([]);
        } finally {
            mockPrimaryAction = null;
        }
    });

    it("with no pending choice the pass descriptors stay enabled (issue #9972)", () => {
        const { result } = renderCtrl({});
        for (const key of ["pass", "pass-turn", "pass-until-action"]) {
            expect(
                result.current.actions.find((a) => a.key === key)?.disabled
            ).toBe(false);
        }
    });

    it("Enter arms it through the passUntilAction mutation", async () => {
        renderCtrl({});
        await act(async () => pressEnter());
        expect(calls).toEqual([
            {
                ref: "passUntilAction",
                args: { gameId: "game-id", playerId: "me" },
            },
        ]);
    });

    it("Enter is accepted without priority (the server queues it)", async () => {
        renderCtrl({ priorityPlayerId: "opp" });
        await act(async () => pressEnter());
        expect(calls.map((c) => c.ref)).toEqual(["passUntilAction"]);
    });

    it("P passes the turn instead (issue #7423)", async () => {
        renderCtrl({});
        await act(async () => press("P"));
        expect(calls.map((c) => c.ref)).toEqual(["endTurn"]);
    });

    it("an armed intent shows a cancelling pill and Enter cancels it", async () => {
        const { result } = renderCtrl({
            priorityPlayerId: "opp",
            passUntilAction: [{ playerId: "me", ignoredStackIds: [] }],
        });
        expect(result.current.isPassUntilAction).toBe(true);
        expect(result.current.cue).toBe("auto-passing");
        const pill = result.current.actions.find(
            (a) => a.key === "passing-until-action"
        );
        expect(pill?.pill).toBe(true);

        await act(async () => pressEnter());
        expect(calls.map((c) => c.ref)).toEqual(["cancelAutoPass"]);
    });

    it("an armed intent belonging to the other seat is not this viewer's", () => {
        const { result } = renderCtrl({
            priorityPlayerId: "opp",
            passUntilAction: [{ playerId: "opp", ignoredStackIds: [] }],
        });
        expect(result.current.isPassUntilAction).toBe(false);
        expect(
            result.current.actions.some((a) => a.key === "passing-until-action")
        ).toBe(false);
    });

    it("a queued intent stays visible and cancellable while holding priority", () => {
        const { result } = renderCtrl({
            queuedPassUntilAction: [{ playerId: "me", ignoredStackIds: [] }],
        });
        expect(result.current.isQueuedPassUntilAction).toBe(true);
        const pill = result.current.actions.find(
            (a) => a.key === "queued-pass-until-action"
        );
        expect(pill?.label).toBe("Pass Until Action queued (cancel)");
    });
});

// Issue #10457 — P and Enter each own one intent: a key cancels its own kind
// and switches the other kind to its own in ONE mutation (the server replaces
// the standing intent, `passUntilActionFullPath.test.ts`), never a cancel
// followed by an arm. The pod buttons dispatch the same toggles.
describe("useControllerActions — P / Enter switch Pass Turn <-> Pass Until Action (issue #10457)", () => {
    beforeEach(() => {
        calls.length = 0;
        resetPendingGameIntents();
    });

    const ME_UNTIL = [{ playerId: "me", ignoredStackIds: [] }];
    const ARMED_TURN = { priorityPlayerId: "opp", autoPassPlayers: ["me"] };
    const ARMED_UNTIL = { priorityPlayerId: "opp", passUntilAction: ME_UNTIL };
    const QUEUED_TURN = { priorityPlayerId: "opp", queuedEndTurn: ["me"] };
    const QUEUED_UNTIL = {
        priorityPlayerId: "opp",
        queuedPassUntilAction: ME_UNTIL,
    };

    const cases = [
        ["armed Pass Turn", "P", "cancelAutoPass", ARMED_TURN],
        ["armed Pass Until Action", "Enter", "cancelAutoPass", ARMED_UNTIL],
        ["armed Pass Turn", "Enter", "passUntilAction", ARMED_TURN],
        ["armed Pass Until Action", "P", "endTurn", ARMED_UNTIL],
        ["queued Pass Turn", "P", "cancelAutoPass", QUEUED_TURN],
        ["queued Pass Until Action", "Enter", "cancelAutoPass", QUEUED_UNTIL],
        ["queued Pass Turn", "Enter", "passUntilAction", QUEUED_TURN],
        ["queued Pass Until Action", "P", "endTurn", QUEUED_UNTIL],
    ] as const;

    it.each(cases)(
        "%s + %s sends exactly %s",
        async (_name, key, expected, state) => {
            renderCtrl(state);
            await act(async () => (key === "P" ? press("p") : pressEnter()));
            expect(calls).toEqual([
                { ref: expected, args: { gameId: "game-id", playerId: "me" } },
            ]);
        }
    );

    it.each(cases)(
        "%s: the pod's %s button sends exactly %s",
        async (_name, key, expected, state) => {
            const { result } = renderCtrl(state);
            const button =
                key === "P"
                    ? result.current.queuedPasses?.passTurn
                    : result.current.queuedPasses?.passUntilAction;
            expect(button?.disabled).toBe(false);
            await act(async () => {
                await button!.onClick();
            });
            expect(calls.map((c) => c.ref)).toEqual([expected]);
        }
    );

    it("with priority, the Pass Turn / Pass Until Action descriptors match the keys", async () => {
        // The seat holds priority while a Pass Turn intent still stands: the
        // descriptors toggle exactly as P and Enter do.
        const { result } = renderCtrl({ queuedEndTurn: ["me"] });
        const until = result.current.actions.find(
            (a) => a.key === "pass-until-action"
        );
        const turn = result.current.actions.find((a) => a.key === "pass-turn");
        expect(until?.disabled).toBe(false);
        await act(async () => {
            await until!.onClick();
        });
        await act(async () => {
            await turn!.onClick();
        });
        expect(calls.map((c) => c.ref)).toEqual([
            "passUntilAction",
            "cancelAutoPass",
        ]);
    });
});
