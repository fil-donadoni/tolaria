// Issue #9863 — **Auto-answer** on the optional-action (`may-pay`) prompt:
// "Always yes" / "Always skip" record the seat's answer for that exact prompt
// of that ability (the **Yield** key + the prompt's `step:choiceId`), the next
// matching prompt is answered through the same `submitMayPay` without
// rendering, and "Manage yields" / "Clear all yields" list and forget it.
//
// Runs the REAL prompt against the REAL store (`useYieldPrefsState`), with the
// stack taken out of the real projection (`projectPublicState`) so the
// identities are minted from what the client is actually handed.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { makeInstance, makeState } from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type {
    GameState,
    StackItem as EngineStackItem,
} from "@convex/gre/state";
import type { PendingChoice, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import {
    YieldPrefsContext,
    useYieldPrefsState,
} from "~/hooks/useYieldPreferences";

const submitCalls: { playerId: string; accept: boolean }[] = [];
let rejectSubmits = false;
vi.mock("convex/react", () => ({
    useMutation: () => (args: { playerId: string; accept: boolean }) => {
        submitCalls.push(args);
        return rejectSubmits
            ? Promise.reject(new Error("refused"))
            : Promise.resolve(null);
    },
}));
vi.mock("~/hooks/useIsPortrait", () => ({ useIsPortrait: () => false }));

import PendingChoicePrompt from "../pending-choice-prompt";
import ClearYieldsButton from "../clear-yields-button";
import ManageYieldsButton from "../manage-yields-button";

const NOBLE = getCardByName("Noble Hierarch");
const IGNOBLE = getCardByName("Ignoble Hierarch");
const EXALTED = "exalted";
const PROMPT = "You may draw a card.";

type Firing = {
    instance: string;
    defId?: string;
    abilityId?: string;
    seat?: string;
    choiceId?: string;
    cost?: PendingChoice["cost"];
    /** Raise the choice on an id that is NOT on the stack — no identity. */
    offStack?: boolean;
};

function firing(f: Firing): { stack: StackItem[]; choice: PendingChoice } {
    const seat = f.seat ?? "p1";
    const item = {
        ...makeInstance(f.defId ?? NOBLE.id, {
            id: f.instance,
            controllerId: seat,
            ownerId: seat,
            zone: "stack",
        }),
        castById: seat,
        triggeredAbilityId: f.abilityId ?? EXALTED,
        triggerSourceId: "src",
    } as EngineStackItem;
    const state: GameState = makeState({ stack: [item] } as Partial<GameState>);
    const stack = projectPublicState(state, 1, seat)
        .stack as unknown as StackItem[];
    const choice = {
        stackItemId: f.offStack ? "inline" : f.instance,
        step: 0,
        choiceId: f.choiceId ?? "mayDraw",
        playerId: seat,
        kind: "may-pay",
        count: 1,
        prompt: PROMPT,
        ...(f.cost ? { cost: f.cost } : {}),
    } as PendingChoice;
    return { stack, choice };
}

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};
const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

function Board({
    current,
    viewer = "p1",
}: {
    current: ReturnType<typeof firing> | null;
    viewer?: string;
}) {
    const yieldPrefs = useYieldPrefsState("g1");
    const ctx = {
        gameId: "g1",
        playerId: viewer,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: current?.stack.length ?? 0,
        stackItems: current?.stack ?? [],
        allPlayers: [
            { id: "p1", name: "One" },
            { id: "p2", name: "Two" },
        ],
        pendingChoices: current ? [current.choice] : [],
    } as unknown as React.ContextType<typeof GameContext>;
    return (
        <GameContext value={ctx}>
            <YieldPrefsContext value={yieldPrefs}>
                <PendingChoiceBufferContext value={noopBuffer}>
                    <MinimizedChoiceContext value={noopMinimized}>
                        {current && (
                            <PendingChoicePrompt
                                choice={current.choice}
                                playerId={viewer}
                                gameId={"g1" as never}
                            />
                        )}
                        <div data-home="panel">
                            <ClearYieldsButton />
                            <ManageYieldsButton />
                        </div>
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </YieldPrefsContext>
        </GameContext>
    );
}

const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const flush = () => act(async () => {});
const promptShown = () =>
    Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent === "No" || b.textContent?.startsWith("Skip")
    );
const toggleOf = (answer: "yes" | "skip") =>
    $(`[data-optional-answer-toggle="${answer}"] [role="checkbox"]`);
async function turnOn(answer: "yes" | "skip") {
    await act(async () => {
        fireEvent.click(toggleOf(answer)!);
        await Promise.resolve();
    });
}
/** The prompt resolves (unmounts), then the next firing raises it again. */
async function next(
    rerender: (ui: React.ReactElement) => void,
    f: Firing,
    viewer = "p1"
) {
    rerender(<Board current={null} viewer={viewer} />);
    rerender(<Board current={firing(f)} viewer={viewer} />);
    await flush();
}

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    setItem = vi.spyOn(Storage.prototype, "setItem");
});
afterEach(() => {
    // Never `localStorage` — an Auto-answer lives inside one Game (§4).
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    cleanup();
    submitCalls.length = 0;
    rejectSubmits = false;
});

describe("Auto-answer toggles on the may-pay prompt (issue #9863 §1)", () => {
    it("a costless prompt offers both, a prompt with a cost only Always skip, a prompt with no identity neither", () => {
        const { rerender } = render(
            <Board current={firing({ instance: "n1" })} />
        );
        expect(toggleOf("yes")).not.toBeNull();
        expect(toggleOf("skip")).not.toBeNull();

        rerender(
            <Board current={firing({ instance: "n2", cost: { life: 2 } })} />
        );
        expect(toggleOf("yes")).toBeNull();
        expect(toggleOf("skip")).not.toBeNull();

        rerender(
            <Board current={firing({ instance: "n3", offStack: true })} />
        );
        expect(promptShown()).toBe(true);
        expect($("[data-optional-answer-toggles]")).toBeNull();
    });

    it("turning a toggle on answers the current prompt and records the rule", async () => {
        render(<Board current={firing({ instance: "n1" })} />);
        await turnOn("yes");
        expect(submitCalls).toEqual([
            { gameId: "g1", playerId: "p1", accept: true },
        ]);
        expect($("[data-clear-yields]")?.textContent).toBe(
            "Clear all yields (1)"
        );
    });
});

describe("Auto-answer — matching (issue #9863 §2-§3)", () => {
    it("answers the same ability of another copy without rendering; another ability or another card still prompts", async () => {
        const { rerender } = render(
            <Board current={firing({ instance: "n1" })} />
        );
        await turnOn("skip");
        expect(submitCalls).toHaveLength(1);

        await next(rerender, { instance: "n2" });
        expect(promptShown()).toBe(false);
        expect(submitCalls).toHaveLength(2);
        expect(submitCalls[1]).toMatchObject({ playerId: "p1", accept: false });

        await next(rerender, { instance: "n3", abilityId: "other" });
        expect(promptShown()).toBe(true);
        await next(rerender, { instance: "i1", defId: IGNOBLE.id });
        expect(promptShown()).toBe(true);
        await next(rerender, { instance: "n4", choiceId: "mayDiscard" });
        expect(promptShown()).toBe(true);
        expect(submitCalls).toHaveLength(2);
    });

    it("never accepts a cost unattended: a remembered yes on a prompt that now has a cost is shown", async () => {
        const { rerender } = render(
            <Board current={firing({ instance: "n1" })} />
        );
        await turnOn("yes");
        await next(rerender, { instance: "n2", cost: { life: 1 } });
        expect(promptShown()).toBe(true);
        expect(submitCalls).toHaveLength(1);
    });

    it("is per seat: a rule set on one seat never answers the other seat's prompt", async () => {
        const { rerender } = render(
            <Board current={firing({ instance: "n1" })} />
        );
        await turnOn("skip");
        await next(rerender, { instance: "n2", seat: "p2" }, "p2");
        expect(promptShown()).toBe(true);
        expect(submitCalls).toHaveLength(1);
    });

    it("a refused auto-submit shows the prompt, submitted once", async () => {
        const { rerender } = render(
            <Board current={firing({ instance: "n1" })} />
        );
        await turnOn("skip");
        rejectSubmits = true;
        await next(rerender, { instance: "n2" });
        await flush();
        expect(submitCalls).toHaveLength(2);
        expect(promptShown()).toBe(true);
    });
});

describe("Auto-answer — Manage yields and Clear all yields (issue #9863 §5)", () => {
    it("lists card, prompt and answer; removing it makes the next firing prompt again", async () => {
        const { rerender } = render(
            <Board current={firing({ instance: "n1" })} />
        );
        await turnOn("skip");
        rerender(<Board current={null} />);
        await act(async () => {
            fireEvent.click($('[data-manage-yields="panel"]')!);
        });
        const row = $("[data-manage-yields-row]")!;
        expect(row.textContent).toContain(`${NOBLE.name} — Always skip`);
        expect(row.textContent).toContain(PROMPT);
        await act(async () => {
            fireEvent.click(
                $(
                    `[data-manage-yields-remove][aria-label="Forget answer: ${NOBLE.name} — ${PROMPT} (Always skip)"]`
                )!
            );
        });
        expect($("[data-manage-yields-empty]")).not.toBeNull();

        rerender(<Board current={firing({ instance: "n2" })} />);
        await flush();
        expect(promptShown()).toBe(true);
        expect(submitCalls).toHaveLength(1);
    });

    it("Clear all yields counts and clears it", async () => {
        const { rerender } = render(
            <Board current={firing({ instance: "n1" })} />
        );
        await turnOn("skip");
        rerender(<Board current={null} />);
        act(() => {
            fireEvent.click($("[data-clear-yields]")!);
        });
        expect($("[data-clear-yields]")).toBeNull();
        rerender(<Board current={firing({ instance: "n2" })} />);
        await flush();
        expect(promptShown()).toBe(true);
    });
});
