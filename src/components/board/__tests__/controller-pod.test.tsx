// Controller pod (#331): the collapsed surface that replaced the phase rail +
// bottom-right action bar. Two contracts are tested here:
//   1. Space/Enter/U hotkey routing (ported verbatim from the old
//      action-bar.test.tsx — the logic moved into `useControllerActions`).
//   2. Render-level beats: the plain-language phase label, the priority cue,
//      and that each rendered action button dispatches the SAME mutation as the
//      old action bar, with the SAME args.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { SkipPhasePrefsContext } from "~/hooks/useSkipPhasePreferences";
import { DEFAULT_SKIP_PREFS } from "~/lib/skip-phase-prefs";
import type { Player } from "~/types/game";

const calls: { ref: unknown; args: unknown }[] = [];

// Tag every mutation the controller can hit by a plain string so assertions
// never touch Convex's FunctionReference proxies.
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            cancelCast: "cancelCast",
            cancelActivation: "cancelActivation",
            confirmAttackers: "confirmAttackers",
            confirmBlockers: "confirmBlockers",
            confirmDamage: "confirmDamage",
            passPriority: "passPriority",
            autoTapForPayment: "autoTapForPayment",
            endTurn: "endTurn",
            cancelAutoPass: "cancelAutoPass",
            submitMayPay: "submitMayPay",
        },
    },
}));

vi.mock("convex/react", () => ({
    useMutation: (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));

// Chrome that opens portals / popovers is irrelevant to these contracts.
vi.mock("../hotkeys-legend", () => ({ default: () => <div /> }));
vi.mock("../pause-menu-button", () => ({ default: () => <button /> }));
vi.mock("../controller-phase-panel", () => ({
    default: () => <div data-testid="phase-panel" />,
}));

const { default: ControllerPod } = await import("../controller-pod");

function makePlayer(overrides: Partial<Player> = {}): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    dismissError: () => {},
};

type CtxOverrides = Partial<React.ContextType<typeof GameContext>>;

function renderPod(
    ctx: CtxOverrides = {},
    extra: {
        buffer?: PendingChoiceBuffer;
        pendingChoices?: NonNullable<
            React.ContextType<typeof GameContext>
        >["pendingChoices"];
    } = {}
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [makePlayer()],
        showAllCards: false,
        debugAllActions: false,
        pendingChoices: extra.pendingChoices,
        ...ctx,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <SkipPhasePrefsContext
                value={{
                    prefs: DEFAULT_SKIP_PREFS,
                    toggle: () => {},
                    reset: () => {},
                }}
            >
                <PendingChoiceBufferContext value={extra.buffer ?? noopBuffer}>
                    <ControllerPod onOpenMenu={() => {}} />
                </PendingChoiceBufferContext>
            </SkipPhasePrefsContext>
        </GameContext>
    );
}

function pressSpace() {
    fireEvent.keyDown(window, { code: "Space" });
}

beforeEach(() => {
    calls.length = 0;
});

describe("ControllerPod Space hotkey", () => {
    it("passes priority when no choice is pending", () => {
        renderPod();
        pressSpace();
        expect(calls.map((c) => c.ref)).toContain("passPriority");
    });

    it("confirms a may-pay choice (Pay) instead of passing priority", () => {
        renderPod(
            {
                allPlayers: [
                    makePlayer({
                        manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                    }),
                ],
            },
            {
                pendingChoices: [
                    {
                        stackItemId: "stk",
                        step: 0,
                        choiceId: "me",
                        playerId: "me",
                        kind: "may-pay",
                        count: 1,
                        prompt: "Pay {R}?",
                        cost: { R: 1 },
                    },
                ],
            }
        );
        pressSpace();
        const refs = calls.map((c) => c.ref);
        expect(refs).toContain("submitMayPay");
        expect(refs).not.toContain("passPriority");
        const mayPay = calls.find((c) => c.ref === "submitMayPay");
        expect(mayPay?.args).toMatchObject({ accept: true });
    });

    it("does NOT pass priority when a may-pay cost is unaffordable", () => {
        renderPod(
            {},
            {
                pendingChoices: [
                    {
                        stackItemId: "stk",
                        step: 0,
                        choiceId: "me",
                        playerId: "me",
                        kind: "may-pay",
                        count: 1,
                        prompt: "Pay {R}?",
                        cost: { R: 1 },
                    },
                ],
            }
        );
        pressSpace();
        const refs = calls.map((c) => c.ref);
        expect(refs).not.toContain("submitMayPay");
        expect(refs).not.toContain("passPriority");
    });

    it("submits a zone-pick choice via the buffer when within [min, max]", () => {
        const submit = vi.fn(async () => {});
        renderPod(
            {},
            {
                pendingChoices: [
                    {
                        stackItemId: "stk",
                        step: 0,
                        choiceId: "me",
                        playerId: "me",
                        kind: "choose-permanents",
                        zone: "battlefield",
                        count: { min: 1, max: 1 },
                        prompt: "Choose a permanent.",
                    },
                ],
                buffer: { ...noopBuffer, buffer: ["c1"], submit },
            }
        );
        pressSpace();
        expect(submit).toHaveBeenCalledTimes(1);
        expect(calls.map((c) => c.ref)).not.toContain("passPriority");
    });

    it("does NOT submit a zone-pick choice below min", () => {
        const submit = vi.fn(async () => {});
        renderPod(
            {},
            {
                pendingChoices: [
                    {
                        stackItemId: "stk",
                        step: 0,
                        choiceId: "me",
                        playerId: "me",
                        kind: "choose-permanents",
                        zone: "battlefield",
                        count: { min: 1, max: 1 },
                        prompt: "Choose a permanent.",
                    },
                ],
                buffer: { ...noopBuffer, buffer: [], submit },
            }
        );
        pressSpace();
        expect(submit).not.toHaveBeenCalled();
        expect(calls.map((c) => c.ref)).not.toContain("passPriority");
    });

    it("passes priority when the pending choice belongs to the opponent", () => {
        renderPod(
            {},
            {
                pendingChoices: [
                    {
                        stackItemId: "stk",
                        step: 0,
                        choiceId: "opp",
                        playerId: "opp",
                        kind: "may-pay",
                        count: 1,
                        prompt: "Pay {R}?",
                        cost: { R: 1 },
                    },
                ],
            }
        );
        pressSpace();
        expect(calls.map((c) => c.ref)).toContain("passPriority");
    });
});

describe("ControllerPod Enter / U hotkeys", () => {
    it("Enter ends the turn when the player has priority", () => {
        renderPod();
        fireEvent.keyDown(window, { code: "Enter" });
        const endTurn = calls.find((c) => c.ref === "endTurn");
        expect(endTurn?.args).toMatchObject({
            gameId: "game-id",
            playerId: "me",
        });
    });

    it("Enter cancels an active auto-pass instead of ending the turn", () => {
        renderPod({ autoPassPlayers: ["me"] });
        fireEvent.keyDown(window, { code: "Enter" });
        const refs = calls.map((c) => c.ref);
        expect(refs).toContain("cancelAutoPass");
        expect(refs).not.toContain("endTurn");
    });

    it("U cancels an in-flight cast", () => {
        renderPod({
            pendingCast: {
                playerId: "me",
                cardInstanceId: "c1",
            } as never,
        });
        fireEvent.keyDown(window, { key: "u" });
        expect(calls.map((c) => c.ref)).toContain("cancelCast");
    });
});

describe("ControllerPod render beats", () => {
    it("shows the plain-language phase label and a 'mine' cue in a main phase", () => {
        renderPod();
        expect(screen.getByText("Main Phase 1")).toBeTruthy();
        const cue = screen.getByRole("status");
        expect(cue.getAttribute("data-cue")).toBe("mine");
        // Pass dispatches passPriority with the viewer's seat.
        fireEvent.click(screen.getByText(/^Pass$/));
        const pass = calls.find((c) => c.ref === "passPriority");
        expect(pass?.args).toMatchObject({ gameId: "game-id", playerId: "me" });
    });

    it("declaring attackers: Confirm Attackers dispatches confirmAttackers", () => {
        renderPod({
            phase: "DECLARE_ATTACKERS",
            combat: { attackerIds: ["a1"], confirmed: false } as never,
        });
        expect(screen.getByText("Declare Attackers")).toBeTruthy();
        expect(screen.getByRole("status").getAttribute("data-cue")).toBe(
            "mine"
        );
        fireEvent.click(screen.getByText(/Confirm Attackers/));
        const confirm = calls.find((c) => c.ref === "confirmAttackers");
        expect(confirm?.args).toMatchObject({
            gameId: "game-id",
            playerId: "me",
        });
    });

    it("assigning damage: Confirm Damage dispatches confirmDamage once fully assigned", () => {
        renderPod({
            phase: "COMBAT_DAMAGE",
            allPlayers: [
                makePlayer({
                    battlefield: [
                        { id: "a1", power: 2, toughness: 2 } as never,
                    ],
                }),
            ],
            combat: {
                damageConfirmed: false,
                damageAssignerIds: { a1: "me" },
                damageAssignments: { a1: { opp: 2 } },
                damageAssignmentConfirmedBy: [],
            } as never,
        });
        expect(screen.getByText("Combat Damage")).toBeTruthy();
        fireEvent.click(screen.getByText("Confirm Damage"));
        const confirm = calls.find((c) => c.ref === "confirmDamage");
        expect(confirm?.args).toMatchObject({
            gameId: "game-id",
            playerId: "me",
        });
    });

    it("waiting on opponent declaring blockers: cue is 'waiting', shows status pill", () => {
        renderPod({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "me",
            priorityPlayerId: "opp",
            combat: { blockersConfirmed: false } as never,
        });
        expect(screen.getByRole("status").getAttribute("data-cue")).toBe(
            "waiting"
        );
        expect(screen.getByText(/Opponent declaring blockers/)).toBeTruthy();
    });

    it("auto-passing: cue is 'auto-passing' and the cancel pill dispatches cancelAutoPass", () => {
        renderPod({ autoPassPlayers: ["me"], priorityPlayerId: "opp" });
        expect(screen.getByRole("status").getAttribute("data-cue")).toBe(
            "auto-passing"
        );
        fireEvent.click(screen.getByText(/Auto-passing\.\.\. \(cancel\)/));
        expect(calls.map((c) => c.ref)).toContain("cancelAutoPass");
    });
});
