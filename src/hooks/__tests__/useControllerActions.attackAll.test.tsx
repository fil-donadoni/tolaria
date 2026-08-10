// "Attack with all" button (design 2026-07-23). Drives the real
// `useControllerActions` hook: the button declares every eligible creature,
// then either confirms immediately (no defending planeswalker) or opens the
// destination sequence (≥1 planeswalker). Kept as a focused renderHook test so
// the branch logic is exercised without the full pod render.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    AttackSequenceContext,
    type AttackSequence,
} from "~/hooks/useAttackSequence";

const calls: { ref: string; args: unknown }[] = [];
// Card instance ids the fake server refuses to declare (stands in for an
// engine-side restriction the client predicate can't see).
const rejectedIds = new Set<string>();
vi.mock("convex/react", () => ({
    useMutation: (ref: string) => (args: unknown) => {
        calls.push({ ref, args });
        const id = (args as { cardInstanceId?: string })?.cardInstanceId;
        if (ref === "toggleAttacker" && id && rejectedIds.has(id)) {
            return Promise.reject(new Error("Creature can't attack"));
        }
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
        "submitMayPay",
        "submitLandEntryChoice",
        "submitDrawReplacementPay",
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
import {
    trackGameIntent,
    resetPendingGameIntents,
} from "~/lib/pending-intent-store";

function creature(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "c1",
        card: { id: "plain" },
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
function planeswalker(): CardInstance {
    return creature({
        id: "pw1",
        controllerId: "opp",
        ownerId: "opp",
        types: ["Planeswalker"],
        counters: { loyalty: 4 },
    } as Partial<CardInstance>);
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

function makeSequence(overrides: Partial<AttackSequence> = {}): AttackSequence {
    return {
        active: false,
        order: [],
        index: 0,
        currentAttackerId: undefined,
        begin: vi.fn(),
        advance: vi.fn(),
        reset: vi.fn(),
        ...overrides,
    };
}

function renderCtrl(
    me: Player,
    opp: Player,
    seq: AttackSequence,
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
        stackItems: [],
        allPlayers: [me, opp],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
            ...combatOverrides,
        },
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>
            <AttackSequenceContext value={seq}>
                {children}
            </AttackSequenceContext>
        </GameContext>
    );
    return renderHook(() => useControllerActions(), { wrapper });
}

function findAction(
    result: { current: ReturnType<typeof useControllerActions> },
    key: string
) {
    return result.current.actions.find((a) => a.key === key);
}

describe("useControllerActions — Attack with all (design 2026-07-23)", () => {
    beforeEach(() => {
        calls.length = 0;
        rejectedIds.clear();
    });

    it("shows the button labelled with the eligible count", () => {
        const me = player("me", [
            creature({ id: "a" }),
            creature({ id: "b" }),
            creature({ id: "tapped", isTapped: true }),
        ]);
        const opp = player("opp", []);
        const { result } = renderCtrl(me, opp, makeSequence());
        expect(findAction(result, "attack-with-all")?.label).toBe(
            "Attack with all (2)"
        );
    });

    it("hides the button when no creature is eligible", () => {
        const me = player("me", [creature({ id: "tapped", isTapped: true })]);
        const opp = player("opp", []);
        const { result } = renderCtrl(me, opp, makeSequence());
        expect(findAction(result, "attack-with-all")).toBeUndefined();
    });

    it("with no defending planeswalker: declares all then confirms immediately", async () => {
        const me = player("me", [creature({ id: "a" }), creature({ id: "b" })]);
        const opp = player("opp", []);
        const seq = makeSequence();
        const { result } = renderCtrl(me, opp, seq);

        await act(async () => {
            await findAction(result, "attack-with-all")!.onClick();
        });

        const toggles = calls.filter((c) => c.ref === "toggleAttacker");
        expect(
            toggles.map(
                (c) => (c.args as { cardInstanceId: string }).cardInstanceId
            )
        ).toEqual(["a", "b"]);
        expect(calls.some((c) => c.ref === "confirmAttackers")).toBe(true);
        expect(seq.begin).not.toHaveBeenCalled();
    });

    it("with a defending planeswalker: declares all then opens the sequence", async () => {
        const me = player("me", [creature({ id: "a" }), creature({ id: "b" })]);
        const opp = player("opp", [planeswalker()]);
        const seq = makeSequence();
        const { result } = renderCtrl(me, opp, seq);

        await act(async () => {
            await findAction(result, "attack-with-all")!.onClick();
        });

        expect(calls.filter((c) => c.ref === "toggleAttacker")).toHaveLength(2);
        expect(calls.some((c) => c.ref === "confirmAttackers")).toBe(false);
        expect(seq.begin).toHaveBeenCalledWith(["a", "b"]);
    });

    it("during the sequence: shows Assign-target progress + Cancel, hides Confirm", () => {
        const me = player("me", [creature({ id: "a" }), creature({ id: "b" })]);
        const opp = player("opp", [planeswalker()]);
        const seq = makeSequence({
            active: true,
            order: ["a", "b"],
            index: 0,
            currentAttackerId: "a",
        });
        const { result } = renderCtrl(me, opp, seq);

        expect(findAction(result, "assign-attack-target-next")?.label).toBe(
            "Assign target (1/2)"
        );
        expect(findAction(result, "cancel-attack-sequence")).toBeDefined();
        expect(findAction(result, "confirm-attackers")).toBeUndefined();
        expect(findAction(result, "attack-with-all")).toBeUndefined();
        // Pass Turn stays reachable throughout the sequence (design §6).
        expect(findAction(result, "pass-turn-attackers")).toBeDefined();

        act(() => findAction(result, "assign-attack-target-next")!.onClick());
        expect(seq.advance).toHaveBeenCalledTimes(1);
    });

    it("a server-rejected creature does not abort the run, and is kept out of the sequence order", async () => {
        // The client predicate is a subset of the server's, so a creature it
        // admits can still be refused. The rest must still be declared and the
        // sequence must walk only what was ACTUALLY declared.
        rejectedIds.add("b");
        const me = player("me", [
            creature({ id: "a" }),
            creature({ id: "b" }),
            creature({ id: "c" }),
        ]);
        const opp = player("opp", [planeswalker()]);
        const seq = makeSequence();
        const { result } = renderCtrl(me, opp, seq);

        await act(async () => {
            await findAction(result, "attack-with-all")!.onClick();
        });

        // All three were attempted — the rejection did not short-circuit "c".
        expect(
            calls
                .filter((c) => c.ref === "toggleAttacker")
                .map(
                    (c) => (c.args as { cardInstanceId: string }).cardInstanceId
                )
        ).toEqual(["a", "b", "c"]);
        expect(seq.begin).toHaveBeenCalledWith(["a", "c"]);
    });

    it("the sequence order includes attackers declared manually beforehand", async () => {
        const me = player("me", [creature({ id: "a" }), creature({ id: "b" })]);
        const opp = player("opp", [planeswalker()]);
        const seq = makeSequence();
        const { result } = renderCtrl(me, opp, seq, {
            attackerIds: ["a"],
        });

        await act(async () => {
            await findAction(result, "attack-with-all")!.onClick();
        });

        // "a" was already declared, so only "b" is toggled — but both walk.
        expect(
            calls
                .filter((c) => c.ref === "toggleAttacker")
                .map(
                    (c) => (c.args as { cardInstanceId: string }).cardInstanceId
                )
        ).toEqual(["b"]);
        expect(seq.begin).toHaveBeenCalledWith(["a", "b"]);
    });

    it("Space offers Attack with all behind a confirmation instead of skipping", async () => {
        const me = player("me", [creature({ id: "a" }), creature({ id: "b" })]);
        const opp = player("opp", []);
        const seq = makeSequence();
        const { result } = renderCtrl(me, opp, seq);

        expect(result.current.attackAllConfirm.open).toBe(false);
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Space" })
            );
        });

        // Dialog up, nothing dispatched yet — Space must never declare or skip
        // the attack on its own.
        expect(result.current.attackAllConfirm.open).toBe(true);
        expect(result.current.attackAllConfirm.eligibleCount).toBe(2);
        expect(calls).toHaveLength(0);

        await act(async () => {
            result.current.attackAllConfirm.confirm();
        });
        expect(calls.filter((c) => c.ref === "toggleAttacker")).toHaveLength(2);
        expect(result.current.attackAllConfirm.open).toBe(false);
    });

    it("cancelling the Space confirmation dispatches nothing", () => {
        const me = player("me", [creature({ id: "a" })]);
        const opp = player("opp", []);
        const { result } = renderCtrl(me, opp, makeSequence());

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Space" })
            );
        });
        act(() => result.current.attackAllConfirm.cancel());

        expect(result.current.attackAllConfirm.open).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it("Space confirms the declared attackers once at least one is declared", () => {
        // With an attacker already picked, Space means "Confirm Attackers" —
        // NOT "Attack with all", which would widen a deliberate attack.
        const me = player("me", [creature({ id: "a" }), creature({ id: "b" })]);
        const opp = player("opp", []);
        const { result } = renderCtrl(me, opp, makeSequence(), {
            attackerIds: ["a"],
        });

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Space" })
            );
        });

        expect(result.current.attackAllConfirm.open).toBe(false);
        expect(calls.some((c) => c.ref === "confirmAttackers")).toBe(true);
        expect(calls.some((c) => c.ref === "toggleAttacker")).toBe(false);
    });

    it("Space still skips the attack when no creature is eligible", () => {
        const me = player("me", [creature({ id: "tapped", isTapped: true })]);
        const opp = player("opp", []);
        const { result } = renderCtrl(me, opp, makeSequence());

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Space" })
            );
        });

        expect(result.current.attackAllConfirm.open).toBe(false);
        expect(calls.some((c) => c.ref === "confirmAttackers")).toBe(true);
    });

    it("Space advances the destination sequence rather than re-offering the dialog", () => {
        const me = player("me", [creature({ id: "a" }), creature({ id: "b" })]);
        const opp = player("opp", [planeswalker()]);
        const seq = makeSequence({
            active: true,
            order: ["a", "b"],
            index: 0,
            currentAttackerId: "a",
        });
        const { result } = renderCtrl(me, opp, seq);

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Space" })
            );
        });

        expect(seq.advance).toHaveBeenCalledTimes(1);
        expect(result.current.attackAllConfirm.open).toBe(false);
    });

    it("with every creature rejected, neither confirms nor opens a sequence", async () => {
        rejectedIds.add("a");
        const me = player("me", [creature({ id: "a" })]);
        const opp = player("opp", []);
        const seq = makeSequence();
        const { result } = renderCtrl(me, opp, seq);

        await act(async () => {
            await findAction(result, "attack-with-all")!.onClick();
        });

        expect(calls.some((c) => c.ref === "confirmAttackers")).toBe(false);
        expect(seq.begin).not.toHaveBeenCalled();
    });
});

// `combat.attackerIds` is SERVER state. A Space pressed between clicking a
// creature and its `toggleAttacker` landing still saw an EMPTY declaration and
// offered "Attack with all" — silently widening a deliberate, hand-picked
// attack. That is the very thing the ">0 declared ⇒ Confirm" branch exists to
// prevent, so the keystroke is dropped while a declaration is in flight.
describe("useControllerActions — Space during DECLARE_ATTACKERS", () => {
    beforeEach(() => {
        calls.length = 0;
        rejectedIds.clear();
        resetPendingGameIntents();
    });

    function pressSpace() {
        window.dispatchEvent(
            new KeyboardEvent("keydown", { code: "Space", bubbles: true })
        );
    }

    it("means Confirm Attackers once at least one attacker is declared", async () => {
        const me = player("me", [creature({ id: "a" }), creature({ id: "b" })]);
        const opp = player("opp", []);
        renderCtrl(me, opp, makeSequence(), { attackerIds: ["a"] });
        await act(async () => {
            pressSpace();
        });
        expect(calls.map((c) => c.ref)).toContain("confirmAttackers");
    });

    it("offers Attack with all only when nothing is declared", async () => {
        const me = player("me", [creature({ id: "a" })]);
        const opp = player("opp", []);
        renderCtrl(me, opp, makeSequence());
        await act(async () => {
            pressSpace();
        });
        // The dialog opens instead of confirming an empty attack.
        expect(calls.map((c) => c.ref)).not.toContain("confirmAttackers");
    });

    it("drops the keystroke while a declaration is still round-tripping", async () => {
        const me = player("me", [creature({ id: "a" })]);
        const opp = player("opp", []);
        renderCtrl(me, opp, makeSequence());
        let settle!: () => void;
        const dispatch = new Promise<void>((res) => {
            settle = res;
        });
        await act(async () => {
            void trackGameIntent(dispatch);
        });
        await act(async () => {
            pressSpace();
        });
        expect(calls.map((c) => c.ref)).not.toContain("confirmAttackers");
        await act(async () => {
            settle();
            await dispatch;
        });
    });
});
