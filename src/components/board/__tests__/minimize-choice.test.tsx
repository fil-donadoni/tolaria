// Minimize / restore for blocking choice dialogs (issue #315). Verifies the
// full UI contract across the two dialog surfaces:
//  - PendingChoicePrompt banner: a visible minimize control invokes minimize()
//  - MinimizedChoiceIndicator: a visible board badge that invokes restore()
//  - the buffered selection (usePendingChoiceBuffer) is NEVER touched by the
//    minimize/restore toggle, so in-progress picks survive the cycle
//  - minimizing does NOT submit / advance the game (no submit dispatch)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import {
    MinimizedChoiceContext,
    type MinimizedChoice,
} from "~/hooks/useMinimizedChoice";

// --- Convex mutation stubs: every api.game.* ref resolves to a spy ---
type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const submitResolutionChoice = vi.fn<MutFn>(() => Promise.resolve());
const submitMayPay = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    submitResolutionChoice,
    submitMayPay,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => {
    const names = [
        "submitResolutionChoice",
        "submitMayPay",
        "submitLandEntryChoice",
        "submitNameCard",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

// usePendingChoicePrimaryAction reads the buffer/context; stub it to a static
// confirm spy so the prompt's primary button has a stable code path.
const primaryConfirm = vi.fn();
vi.mock("~/hooks/usePendingChoicePrimaryAction", () => ({
    usePendingChoicePrimaryAction: () => ({
        canConfirm: true,
        confirm: primaryConfirm,
    }),
}));

import PendingChoicePrompt from "../pending-choice-prompt";
import MinimizedChoiceIndicator from "../minimized-choice-indicator";

const CHOICE = {
    stackItemId: "s1",
    step: 0,
    choiceId: "c1",
    playerId: "me",
    kind: "choose-permanents" as const,
    zone: "battlefield" as const,
    count: { min: 0, max: 2 },
    prompt: "Choose up to two",
};

function makePlayer(id: string): Player {
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
    };
}

let bufferState: string[];
function makeBuffer(): PendingChoiceBuffer {
    return {
        buffer: bufferState,
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(() => Promise.resolve()),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
    };
}

function makeMinimized(over: Partial<MinimizedChoice> = {}): MinimizedChoice {
    return {
        isMinimized: false,
        minimize: vi.fn(),
        restore: vi.fn(),
        ...over,
    };
}

function makeContext(): React.ContextType<typeof GameContext> {
    return {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [makePlayer("me"), makePlayer("opp")],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
}

function renderPrompt(min: MinimizedChoice, buffer = makeBuffer()) {
    return render(
        <GameContext value={makeContext()}>
            <PendingChoiceBufferContext value={buffer}>
                <MinimizedChoiceContext value={min}>
                    <PendingChoicePrompt
                        choice={CHOICE as never}
                        playerId="me"
                        gameId={"game-id" as never}
                    />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

function renderIndicator(min: MinimizedChoice) {
    return render(
        <GameContext value={makeContext()}>
            <PendingChoiceBufferContext value={makeBuffer()}>
                <MinimizedChoiceContext value={min}>
                    <MinimizedChoiceIndicator choice={CHOICE as never} />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

beforeEach(() => {
    bufferState = [];
    submitResolutionChoice.mockClear();
    submitMayPay.mockClear();
    primaryConfirm.mockClear();
    cleanup();
});

describe("PendingChoicePrompt minimize control (issue #315)", () => {
    it("renders a visible minimize button for the chooser", () => {
        const min = makeMinimized();
        const { container } = renderPrompt(min);
        const btn = container.querySelector(
            'button[aria-label="Minimize choice dialog"]'
        );
        expect(btn).not.toBeNull();
    });

    it("clicking minimize invokes minimize() and does NOT submit / advance", () => {
        const min = makeMinimized();
        const { container } = renderPrompt(min);
        const btn = container.querySelector(
            'button[aria-label="Minimize choice dialog"]'
        )!;
        fireEvent.click(btn);
        expect(min.minimize).toHaveBeenCalledTimes(1);
        // Minimize is a pure view toggle: no submission, no game advance.
        expect(submitResolutionChoice).not.toHaveBeenCalled();
        expect(submitMayPay).not.toHaveBeenCalled();
        expect(primaryConfirm).not.toHaveBeenCalled();
    });

    it("the non-chooser (opponent view) gets no minimize control", () => {
        // Opponent viewer: choice.playerId !== playerId → static waiting line.
        const min = makeMinimized();
        const { container } = render(
            <GameContext value={makeContext()}>
                <PendingChoiceBufferContext value={makeBuffer()}>
                    <MinimizedChoiceContext value={min}>
                        <PendingChoicePrompt
                            choice={CHOICE as never}
                            playerId="opp"
                            gameId={"game-id" as never}
                        />
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </GameContext>
        );
        expect(
            container.querySelector(
                'button[aria-label="Minimize choice dialog"]'
            )
        ).toBeNull();
    });
});

describe("MinimizedChoiceIndicator (issue #315)", () => {
    it("renders a clearly visible, labelled board badge", () => {
        const min = makeMinimized({ isMinimized: true });
        const { container, getByText } = renderIndicator(min);
        const btn = container.querySelector("button")!;
        // Accent + pulse so the player can't forget play is blocked.
        expect(btn.className).toContain("animate-pulse");
        // The choice kind label is surfaced ("Choose" for choose-permanents).
        expect(getByText(/Choose/)).toBeTruthy();
    });

    it("clicking the indicator invokes restore() and does NOT submit", () => {
        const min = makeMinimized({ isMinimized: true });
        const { container } = renderIndicator(min);
        fireEvent.click(container.querySelector("button")!);
        expect(min.restore).toHaveBeenCalledTimes(1);
        expect(submitResolutionChoice).not.toHaveBeenCalled();
    });
});

describe("buffered selections survive minimize/restore (issue #315)", () => {
    it("the same buffer instance is read before and after a minimize toggle — minimize never clears it", () => {
        // Buffer holds an in-progress pick.
        bufferState = ["bear-1"];
        const buffer = makeBuffer();
        const min = makeMinimized();

        renderPrompt(min, buffer);
        // Minimize only flips the view flag; the buffer object is untouched
        // (no clear()/toggle() dispatched by the minimize path).
        fireEvent.click(
            document.querySelector(
                'button[aria-label="Minimize choice dialog"]'
            )!
        );
        expect(buffer.clear).not.toHaveBeenCalled();
        expect(min.minimize).toHaveBeenCalledTimes(1);

        cleanup();

        // Restore re-renders the prompt with the SAME buffer state intact:
        // the "selected / max" line reflects the preserved pick.
        const restored = makeMinimized({ isMinimized: false });
        const { getByText } = renderPrompt(restored, buffer);
        expect(getByText(/1 \/ 2 selected/)).toBeTruthy();
    });
});
