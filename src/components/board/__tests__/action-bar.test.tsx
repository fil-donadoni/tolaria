// Space hotkey routing (bug: pressing Space to confirm a mid-resolution choice
// fired passPriority, which the server rejects with "Waiting for resolution
// choices — complete them before acting"). Space must mirror the
// PendingChoicePrompt's affirmative button when a choice is waiting on the
// viewer, and only fall through to passPriority when none is.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import type { Player } from "~/types/game";

const calls: { ref: unknown; args: unknown }[] = [];

// Tag mutations by plain string so assertions never touch Convex's
// FunctionReference proxies. Only the refs the Space path can hit need names;
// every other api.game.* access resolves to undefined, which the mocked
// useMutation still wraps in a recording spy.
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            passPriority: "passPriority",
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

// Child components are irrelevant to the hotkey logic — stub to plain markup.
vi.mock("../action-button", () => ({ default: () => <button /> }));
vi.mock("../hotkeys-legend", () => ({ default: () => <div /> }));
vi.mock("../pause-menu-button", () => ({ default: () => <button /> }));

const { default: ActionBar } = await import("../action-bar");

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

function renderBar(
    extra: {
        pendingChoices?: NonNullable<
            React.ContextType<typeof GameContext>
        >["pendingChoices"];
        allPlayers?: Player[];
        buffer?: PendingChoiceBuffer;
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
        allPlayers: extra.allPlayers ?? [makePlayer()],
        showAllCards: false,
        debugAllActions: false,
        pendingChoices: extra.pendingChoices,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={extra.buffer ?? noopBuffer}>
                <ActionBar onOpenMenu={() => {}} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

function pressSpace() {
    fireEvent.keyDown(window, { code: "Space" });
}

describe("ActionBar Space hotkey", () => {
    beforeEach(() => {
        calls.length = 0;
    });

    it("passes priority when no choice is pending", () => {
        renderBar();
        pressSpace();
        expect(calls.map((c) => c.ref)).toContain("passPriority");
    });

    it("confirms a may-pay choice (Pay) instead of passing priority", () => {
        renderBar({
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
            allPlayers: [
                makePlayer({
                    manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                }),
            ],
        });
        pressSpace();
        const refs = calls.map((c) => c.ref);
        expect(refs).toContain("submitMayPay");
        expect(refs).not.toContain("passPriority");
        const mayPay = calls.find((c) => c.ref === "submitMayPay");
        expect(mayPay?.args).toMatchObject({ accept: true });
    });

    it("does NOT pass priority when a may-pay cost is unaffordable", () => {
        renderBar({
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
            allPlayers: [makePlayer()], // empty pool
        });
        pressSpace();
        const refs = calls.map((c) => c.ref);
        expect(refs).not.toContain("submitMayPay");
        expect(refs).not.toContain("passPriority");
    });

    it("submits a zone-pick choice via the buffer when within [min, max]", () => {
        const submit = vi.fn(async () => {});
        renderBar({
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
        });
        pressSpace();
        expect(submit).toHaveBeenCalledTimes(1);
        expect(calls.map((c) => c.ref)).not.toContain("passPriority");
    });

    it("does NOT submit a zone-pick choice below min", () => {
        const submit = vi.fn(async () => {});
        renderBar({
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
        });
        pressSpace();
        expect(submit).not.toHaveBeenCalled();
        expect(calls.map((c) => c.ref)).not.toContain("passPriority");
    });

    it("passes priority when the pending choice belongs to the opponent", () => {
        renderBar({
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
        });
        pressSpace();
        expect(calls.map((c) => c.ref)).toContain("passPriority");
    });
});
