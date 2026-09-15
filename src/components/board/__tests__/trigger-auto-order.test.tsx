// Issue #3617 — **Auto-order** on the simultaneous-trigger ordering picker
// (CR 603.3b, ADR 0058): confirming with the toggle on remembers the order for
// that multiset of ability identities (the **Yield** key), the next matching
// decision is submitted without rendering the picker, and every reset of the
// seat's **Yields** forgets it.
//
// Runs the REAL prompt against the REAL store (`useYieldPrefsState`), with the
// trigger batch taken out of the real projection (`projectPublicState` →
// `pendingTriggerBatch`) so the keys are minted from what the client is
// actually handed.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { makeInstance, makeState } from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { turnFaceDown } from "@convex/gre/faceDown";
import { NO_BOARD_LAYER_VIEW } from "@convex/gre/layers";
import { projectPublicState } from "@convex/gameProjections";
import type {
    GameState,
    StackItem as EngineStackItem,
} from "@convex/gre/state";
import type { CardInstance, PendingChoice, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import {
    YieldPrefsContext,
    useSeatYields,
    useYieldPrefsState,
} from "~/hooks/useYieldPreferences";
import { useCardYieldMenuItems } from "~/hooks/useCardYieldMenuItems";
import { yieldKeyForStackItem } from "~/lib/yields";

vi.mock("@convex/_generated/api", () => ({
    api: { game: { submitResolutionChoice: "submitResolutionChoice" } },
}));

const submitCalls: { stackItemId: string; cardInstanceIds: string[] }[] = [];
let rejectSubmits = false;
let holdSubmits = false;
vi.mock("convex/react", () => ({
    useMutation:
        () => (args: { stackItemId: string; cardInstanceIds: string[] }) => {
            submitCalls.push(args);
            if (holdSubmits) return new Promise(() => {});
            return rejectSubmits
                ? Promise.reject(new Error("refused"))
                : Promise.resolve(null);
        },
}));

import TriggerOrderPrompt from "../trigger-order-prompt";
import ClearYieldsButton from "../clear-yields-button";

const NOBLE = getCardByName("Noble Hierarch");
const IGNOBLE = getCardByName("Ignoble Hierarch");
const EXALTED = "exalted";

type Candidate = { id: string; defId: string; faceDown?: boolean };
const noble = (id: string): Candidate => ({ id, defId: NOBLE.id });
const ignoble = (id: string): Candidate => ({ id, defId: IGNOBLE.id });
const faceDown = (id: string): Candidate => ({
    id,
    defId: IGNOBLE.id,
    faceDown: true,
});

/** The chooser's `pendingTriggerBatch` as the CLIENT is handed it. */
function projectBatch(candidates: Candidate[]): StackItem[] {
    const engineBatch = candidates.map((c) => {
        const source = makeInstance(c.defId, {
            id: c.id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        });
        if (c.faceDown)
            turnFaceDown(NO_BOARD_LAYER_VIEW, source as never, "morph");
        return {
            ...source,
            castById: "p1",
            triggeredAbilityId: EXALTED,
            triggerSourceId: "src",
        } as EngineStackItem;
    });
    const state = makeState({
        pendingTriggerBatch: engineBatch,
    } as Partial<GameState>);
    return projectPublicState(state, 1, "p1")
        .pendingTriggerBatch as unknown as StackItem[];
}

type Occurrence = { choice: PendingChoice; batch: StackItem[] };
let occurrenceSeq = 0;
function occurrence(candidates: Candidate[]): Occurrence {
    occurrenceSeq += 1;
    return {
        choice: {
            stackItemId: `trigger-batch-${occurrenceSeq}`,
            step: 0,
            choiceId: "p1",
            playerId: "p1",
            kind: "trigger-order",
            count: candidates.length,
            prompt: "Order these triggers",
            candidateIds: candidates.map((c) => c.id),
        } as unknown as PendingChoice,
        batch: projectBatch(candidates),
    };
}

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

function YieldArmer({ item }: { item: StackItem }) {
    const seat = useSeatYields();
    return (
        <button
            data-arm={item.card.id}
            onClick={() => seat.toggle(yieldKeyForStackItem(item)!)}
        />
    );
}

function CardMenuProbe({ card }: { card: CardInstance }) {
    const items = useCardYieldMenuItems(card);
    return (
        <>
            {items.map((i) => (
                <button key={i.key} onClick={(e) => i.onSelect(e)}>
                    {i.label}
                </button>
            ))}
        </>
    );
}

const permanent = (defId: string): CardInstance =>
    ({
        id: `perm-${defId}`,
        card: { id: defId },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
    }) as CardInstance;

function Board({
    gameId = "game-a",
    current,
    armable = [],
}: {
    gameId?: string;
    current: Occurrence | null;
    armable?: StackItem[];
}) {
    const yieldPrefs = useYieldPrefsState(gameId);
    const ctx = {
        gameId,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "BEGIN_COMBAT",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        pendingTriggerBatch: current?.batch ?? [],
    } as unknown as React.ContextType<typeof GameContext>;
    return (
        <GameContext value={ctx}>
            <YieldPrefsContext value={yieldPrefs}>
                <MinimizedChoiceContext value={noopMinimized}>
                    {current && (
                        <TriggerOrderPrompt
                            key={current.choice.stackItemId}
                            choice={current.choice}
                            gameId={gameId as never}
                        />
                    )}
                    <ClearYieldsButton />
                    {armable.map((item) => (
                        <YieldArmer key={item.id} item={item} />
                    ))}
                    <CardMenuProbe card={permanent(NOBLE.id)} />
                </MinimizedChoiceContext>
            </YieldPrefsContext>
        </GameContext>
    );
}

const flush = () => act(async () => {});
const picker = () => document.querySelector("[data-auto-order-toggle]");
const toggle = () => document.querySelector('[role="checkbox"]') as HTMLElement;
const clearButton = () => document.querySelector("[data-clear-yields]");
const doneButton = () =>
    Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Done"
    )!;

async function confirm({ autoOrder }: { autoOrder: boolean }) {
    if (autoOrder && toggle().getAttribute("aria-checked") !== "true")
        fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-checked")).toBe(String(autoOrder));
    await act(async () => {
        fireEvent.click(doneButton());
        await Promise.resolve();
    });
}

const lastSubmit = () => submitCalls[submitCalls.length - 1];

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    setItem = vi.spyOn(Storage.prototype, "setItem");
});
afterEach(() => {
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    cleanup();
    submitCalls.length = 0;
    rejectSubmits = false;
    holdSubmits = false;
});

describe("Auto-order — remember and skip (issue #3617 §1-§3)", () => {
    it("is off by default, and remembers nothing when confirmed off", async () => {
        const first = occurrence([noble("n1"), ignoble("i1")]);
        const { rerender } = render(<Board current={first} />);
        expect(toggle().getAttribute("aria-checked")).toBe("false");
        await confirm({ autoOrder: false });

        rerender(<Board current={occurrence([noble("n2"), ignoble("i2")])} />);
        await flush();
        expect(picker()).not.toBeNull();
        expect(submitCalls).toHaveLength(1);
    });

    it("submits the remembered order for the same multiset without rendering the picker — copies keep their collection order", async () => {
        const first = occurrence([noble("n1a"), ignoble("i1"), noble("n1b")]);
        const { rerender } = render(<Board current={first} />);
        await confirm({ autoOrder: true });
        expect(lastSubmit().cardInstanceIds).toEqual(["n1b", "i1", "n1a"]);

        // Same abilities, new instances, a DIFFERENT collection order: the
        // default (unordered) submit would be n2b, n2a, i2.
        const second = occurrence([ignoble("i2"), noble("n2a"), noble("n2b")]);
        rerender(<Board current={second} />);
        await flush();

        expect(picker()).toBeNull();
        expect(submitCalls).toHaveLength(2);
        expect(lastSubmit()).toMatchObject({
            stackItemId: second.choice.stackItemId,
            cardInstanceIds: ["n2b", "i2", "n2a"],
        });
    });

    it("submits a manually confirmed choice exactly once, though confirming just remembered its own set", async () => {
        render(<Board current={occurrence([noble("n1"), ignoble("i1")])} />);
        await confirm({ autoOrder: true });
        await flush();
        expect(submitCalls).toHaveLength(1);
    });

    it("keeps the toggle on for the next picker it opens", async () => {
        const { rerender } = render(
            <Board current={occurrence([noble("n1"), ignoble("i1")])} />
        );
        await confirm({ autoOrder: true });
        rerender(<Board current={occurrence([noble("n2a"), noble("n2b")])} />);
        await flush();
        expect(toggle().getAttribute("aria-checked")).toBe("true");
    });
});

describe("Auto-order — sets it must not match (issue #3617 §4-§5)", () => {
    it("opens the picker for a different multiset, and remembers that one too", async () => {
        const { rerender } = render(
            <Board current={occurrence([noble("n1"), ignoble("i1")])} />
        );
        await confirm({ autoOrder: true });

        rerender(<Board current={occurrence([noble("n2a"), noble("n2b")])} />);
        await flush();
        expect(picker()).not.toBeNull();
        expect(submitCalls).toHaveLength(1);
        await confirm({ autoOrder: true });

        rerender(<Board current={occurrence([noble("n3a"), noble("n3b")])} />);
        await flush();
        expect(picker()).toBeNull();
        expect(submitCalls).toHaveLength(3);
    });

    it("always opens the picker for a set with a face-down candidate (CR 708.2a)", async () => {
        const { rerender } = render(
            <Board current={occurrence([noble("n1"), faceDown("fd1")])} />
        );
        await confirm({ autoOrder: true });

        rerender(
            <Board current={occurrence([noble("n2"), faceDown("fd2")])} />
        );
        await flush();
        expect(picker()).not.toBeNull();
        expect(submitCalls).toHaveLength(1);
    });

    it("falls back to the picker when the server refuses the remembered order", async () => {
        const { rerender } = render(
            <Board current={occurrence([noble("n1"), ignoble("i1")])} />
        );
        await confirm({ autoOrder: true });

        rejectSubmits = true;
        rerender(<Board current={occurrence([noble("n2"), ignoble("i2")])} />);
        await flush();
        expect(submitCalls).toHaveLength(2);
        expect(picker()).not.toBeNull();
    });
});

describe("Auto-order — reset with the seat's yields (issue #3617 §6-§7)", () => {
    it("keeps Clear all yields reachable with zero yields and a remembered order, and clearing forgets it", async () => {
        const { rerender } = render(
            <Board current={occurrence([noble("n1"), ignoble("i1")])} />
        );
        expect(clearButton()).toBeNull();
        await confirm({ autoOrder: true });
        rerender(<Board current={null} />);

        expect(clearButton()?.textContent).toBe("Clear all yields (1)");
        fireEvent.click(clearButton()!);
        expect(clearButton()).toBeNull();

        rerender(<Board current={occurrence([noble("n2"), ignoble("i2")])} />);
        await flush();
        expect(picker()).not.toBeNull();
        expect(toggle().getAttribute("aria-checked")).toBe("false");
        expect(submitCalls).toHaveLength(1);
    });

    it("forgets remembered orders when the per-card reset removes the seat's LAST yield — not before", async () => {
        const [nobleItem, ignobleItem] = projectBatch([
            noble("y-n"),
            ignoble("y-i"),
        ]);
        const armable = [nobleItem, ignobleItem];
        const { rerender, getByText } = render(
            <Board
                current={occurrence([noble("n1"), ignoble("i1")])}
                armable={armable}
            />
        );
        fireEvent.click(document.querySelector(`[data-arm="${NOBLE.id}"]`)!);
        fireEvent.click(document.querySelector(`[data-arm="${IGNOBLE.id}"]`)!);
        await confirm({ autoOrder: true });
        expect(clearButton()?.textContent).toBe("Clear all yields (3)");

        // Removing ONE of two yields leaves the seat's memory standing.
        rerender(<Board current={null} armable={armable} />);
        fireEvent.click(getByText("Turn off auto-yield for Noble Hierarch"));
        rerender(
            <Board
                current={occurrence([noble("n2"), ignoble("i2")])}
                armable={armable}
            />
        );
        await flush();
        expect(picker()).toBeNull();
        expect(submitCalls).toHaveLength(2);

        // Re-arm Noble, drop Ignoble's yield (via the store), then clear the
        // LAST one through the per-card reset.
        rerender(<Board current={null} armable={armable} />);
        fireEvent.click(document.querySelector(`[data-arm="${IGNOBLE.id}"]`)!);
        fireEvent.click(document.querySelector(`[data-arm="${NOBLE.id}"]`)!);
        expect(clearButton()?.textContent).toBe("Clear all yields (2)");
        fireEvent.click(getByText("Turn off auto-yield for Noble Hierarch"));
        expect(clearButton()).toBeNull();

        rerender(
            <Board
                current={occurrence([noble("n3"), ignoble("i3")])}
                armable={armable}
            />
        );
        await flush();
        expect(picker()).not.toBeNull();
        expect(submitCalls).toHaveLength(2);
    });

    it("does not survive a new gameId", async () => {
        const { rerender } = render(
            <Board current={occurrence([noble("n1"), ignoble("i1")])} />
        );
        await confirm({ autoOrder: true });

        rerender(
            <Board
                gameId="game-b"
                current={occurrence([noble("n2"), ignoble("i2")])}
            />
        );
        await flush();
        expect(picker()).not.toBeNull();
        expect(submitCalls).toHaveLength(1);
    });
});

describe("Auto-order — resets landing under an open decision (issue #3617 review)", () => {
    it("unchecks an open picker's toggle when Clear all yields lands, so confirming does not re-record", async () => {
        const { rerender } = render(
            <Board current={occurrence([noble("n1"), ignoble("i1")])} />
        );
        await confirm({ autoOrder: true });

        // A different set: the picker opens with the toggle carried on.
        rerender(<Board current={occurrence([noble("n2a"), noble("n2b")])} />);
        await flush();
        expect(toggle().getAttribute("aria-checked")).toBe("true");

        // Minimized, the board is reachable: the seat clears its yields.
        fireEvent.click(clearButton()!);
        expect(toggle().getAttribute("aria-checked")).toBe("false");
        await confirm({ autoOrder: false });

        rerender(<Board current={occurrence([noble("n3a"), noble("n3b")])} />);
        await flush();
        expect(picker()).not.toBeNull();
        expect(submitCalls).toHaveLength(2);
    });

    it("remembers a manual order only once the server has accepted it", async () => {
        const first = occurrence([noble("n1"), ignoble("i1")]);
        const { rerender } = render(<Board current={first} />);
        holdSubmits = true;
        fireEvent.click(toggle());
        await act(async () => {
            fireEvent.click(doneButton());
            await Promise.resolve();
        });
        // Still unanswered by the server: nothing is remembered yet, so the
        // reset control has nothing to count.
        expect(clearButton()).toBeNull();
        holdSubmits = false;

        rerender(<Board current={occurrence([noble("n2"), ignoble("i2")])} />);
        await flush();
        expect(picker()).not.toBeNull();
        expect(submitCalls).toHaveLength(1);
    });

    it("does not reopen the picker when a reset lands while the remembered order is in flight", async () => {
        const { rerender } = render(
            <Board current={occurrence([noble("n1"), ignoble("i1")])} />
        );
        await confirm({ autoOrder: true });

        holdSubmits = true;
        rerender(<Board current={occurrence([noble("n2"), ignoble("i2")])} />);
        await flush();
        expect(submitCalls).toHaveLength(2);

        fireEvent.click(clearButton()!);
        await flush();
        expect(picker()).toBeNull();
        expect(submitCalls).toHaveLength(2);
    });
});
